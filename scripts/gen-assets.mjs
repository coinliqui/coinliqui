#!/usr/bin/env node
/**
 * Content hashes for the two hand-written scripts in public/.
 *
 * Astro fingerprints everything it compiles into _astro/, but files in public/ are served
 * verbatim, and Cloudflare Pages gives them `max-age=14400, must-revalidate`. So for four
 * hours after a deploy a returning visitor runs the OLD interact.js against the NEW HTML.
 *
 * That is not theoretical: it happened on this deploy. The table-follows-the-chart fix was
 * live in the file, the markup it needed was live in the page, and the browser kept running
 * yesterday's script — which looks exactly like the fix not working, and would have been
 * "fixed" a second time by someone chasing a bug that no longer existed.
 *
 * A query string is enough: the path stays stable, the URL changes whenever the bytes do,
 * and the long cache becomes correct instead of dangerous. Wired into `npm run build` rather
 * than left as a step to remember — the whole point is that it cannot be forgotten.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

/* SHARED.JS IS A DEPENDENCY OF THE OTHERS, SO IT HAS TO BE IN THEIR HASH.
 *
 * interact.js imports public/shared.js at runtime. Hashing each file over its own bytes would
 * leave a change to shared.js invisible to interact.js's URL, and Cloudflare Pages serves this
 * directory with max-age=14400 — so for four hours a browser would run the new interact.js
 * against the old shared.js. That is the exact failure this file was written to prevent,
 * reintroduced one import deeper.
 *
 * So every entry point is versioned over ITSELF PLUS shared.js. Any change to either busts both
 * URLs, and interact.js forwards its own ?v= to the module it imports, which keeps the two
 * halves of one deploy together. shared.js keeps its own self-hash for completeness; nothing
 * links to it directly. */
const files = readdirSync("public").filter((f) => f.endsWith(".js"));
const sharedBytes = files.includes("shared.js") ? readFileSync("public/shared.js") : Buffer.alloc(0);
const out = {};
for (const f of files) {
  const h = createHash("sha256").update(readFileSync(`public/${f}`));
  if (f !== "shared.js") h.update(sharedBytes);
  out[`/${f}`] = h.digest("hex").slice(0, 10);
}
writeFileSync("src/data/assets.json", JSON.stringify(out, null, 2) + "\n");
for (const [k, v] of Object.entries(out)) console.log(`  ${v}  ${k}`);
