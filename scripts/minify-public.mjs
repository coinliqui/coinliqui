#!/usr/bin/env node
/**
 * THE THREE HAND-WRITTEN SCRIPTS SHIP MINIFIED; THEIR SOURCES DO NOT CHANGE.
 *
 * public/*.js is copied into dist/ verbatim, comments and all, and src/ imports public/shared.js
 * on the server, so the source has to stay readable. This runs after `astro build` and minifies
 * the COPIES in dist/: the reader downloads code, the repository keeps the reasoning.
 *
 * ES modules in, ES modules out: format "esm" keeps every export name, which interact.js's
 * runtime import of shared.js depends on. The ?v= hashes come from the sources
 * (scripts/gen-assets.mjs) and a minified file is a pure function of its source, so they stay
 * correct. Fails the build if a file is missing or esbuild refuses it.
 *
 *   node scripts/minify-public.mjs
 */
import { transform } from "esbuild";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const files = readdirSync("public").filter((f) => f.endsWith(".js"));
let before = 0, after = 0;
for (const f of files) {
  const src = readFileSync(`dist/${f}`, "utf8");
  const out = await transform(src, { loader: "js", format: "esm", minify: true, target: "es2022", legalComments: "none" });
  /* The export list must survive. A rename here would break interact.js at runtime in a way no
     build step notices, so it is compared rather than trusted. */
  const names = (s) => [...s.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/g)].map((m) => m[1]).sort().join(",");
  const exported = names(src);
  if (exported && !exported.split(",").every((n) => new RegExp(`\\b${n}\\b`).test(out.code))) {
    console.error(`minify-public: ${f} lost an export name`);
    process.exit(1);
  }
  writeFileSync(`dist/${f}`, out.code);
  before += src.length; after += out.code.length;
  console.log(`  ${f.padEnd(14)} ${src.length.toLocaleString()} → ${out.code.length.toLocaleString()} bytes`);
}
console.log(`minify-public: ${files.length} scripts, ${before.toLocaleString()} → ${after.toLocaleString()} bytes`);
