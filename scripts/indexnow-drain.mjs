#!/usr/bin/env node
/**
 * DRAIN THE INDEXNOW BACKLOG FROM A NON-CLOUDFLARE ADDRESS.
 *
 * The ingest Worker announces new URLs to five IndexNow endpoints. Three accept. The two
 * Microsoft-run ones — api.indexnow.org and www.bing.com — return 429 to the Worker and 200 to
 * this laptop, for the same host, the same key, the same URL list, in the same minute, on
 * payloads of both one URL and twenty-two. The variable is the source address: they throttle
 * Cloudflare's shared Workers egress. Yandex, Seznam and Naver do not.
 *
 * That is the third time this project has hit the shared-egress ceiling — Binance 403s from it,
 * and the ingest cron had to be phase-shifted off :00 and :30 because failure rates doubled at
 * exactly the minutes every other scheduler on the platform fires.
 *
 * So this exists as the escape hatch, not the plan. It reads the SAME state the Worker
 * maintains, sends only what an endpoint is actually owed, and writes the state back with those
 * endpoints cleared — so the Worker stops retrying them and the backoff resets. Nothing is
 * invented here: if the Worker owes nothing, this sends nothing.
 *
 * IT READ THE WRONG KEY FOR A WEEK. The Worker's state was renamed `indexnow:submitted` →
 * `indexnow:state`, and after the rename it writes only the new one. This file kept its own
 * string literal and kept reading the old one. Measured 27 August 2026, the two had drifted:
 *
 *     indexnow:state       133 known, 58 owed to each Microsoft endpoint, last accepted
 *                          2026-08-27 11:32 UTC, all 49 liquidation maps present
 *     indexnow:submitted    79 known,  4 owed, nothing ever accepted, no maps, no /learn
 *
 * So a run would have posted FOUR URLs — none of them owed — written the 79-URL state back to
 * a key the Worker never reads, and printed "cleared 2 endpoint(s); 0 still owed. State
 * written." Green, on a drain that delivered nothing and reset nothing. Two changes, because
 * the structural one alone only survives until the next rename:
 *
 *   1. every name comes from worker/indexnow.ts — the key, the endpoints, the label rule.
 *      There is no literal here to fall out of step.
 *   2. before sending anything, the state it read is checked against what the site actually
 *      publishes (staleAnnouncerState). A state file that has never heard of a template is
 *      stale whatever the cause, and this refuses to send from it.
 *
 * Bing is the index behind DuckDuckGo, Yahoo and Ecosia. The durable fix is Bing Webmaster
 * Tools, which needs an account only the owner can create; until then, run this.
 *
 *   node scripts/indexnow-drain.mjs [--dry]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEXNOW_KEY, ENDPOINTS, STATE_KEY, endpointLabel } from "../worker/indexnow.ts";
import { staleAnnouncerState } from "./checks.mjs";

/* THE NAMESPACE ID WAS A LITERAL HERE TOO, and it is the same class of copy as the key name:
   one string, in one file, that nothing compares to the binding the Worker actually uses.
   wrangler.toml is where that binding is declared, so it is where this reads it. */
const NS = (() => {
  const toml = readFileSync("wrangler.toml", "utf8");
  const block = /\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*"([0-9a-f]{32})"/.exec(toml);
  if (!block) throw new Error("no kv_namespaces id in wrangler.toml");
  return block[1];
})();
const ORIGIN = "https://coinliqui.com";
const DRY = process.argv.includes("--dry");

const kv = (args) =>
  execFileSync("npx", ["wrangler", "kv", "key", ...args, "--namespace-id", NS, "--remote"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let state;
try {
  state = JSON.parse(kv(["get", STATE_KEY]));
} catch (e) {
  console.error(`could not read ${STATE_KEY}: ${e.message}\nIs the wrangler token live? Run: npm run preflight`);
  process.exit(1);
}
/* The Worker migrated a bare array to { known }. Either shape is readable; only the new one written. */
const known = Array.isArray(state) ? state : state.known;
const pending = (Array.isArray(state) ? {} : state.pending) ?? {};
const backoff = (Array.isArray(state) ? {} : state.backoff) ?? {};
const sentAt = Array.isArray(state) ? undefined : state.sentAt;

console.log(`state ${STATE_KEY}: ${known.length} known, last accepted ${sentAt ? new Date(sentAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}`);

/* IS THE STATE THIS READ THE LIVE ONE? Asked against the rendered sitemaps rather than against
   publishedUrls(), for the reason the smoke pass gives for the same comparison: a check that
   reads the same module the announcer reads agrees with itself and proves nothing. */
const sitemapUrls = await (async () => {
  const idx = await (await fetch(`${ORIGIN}/sitemap-index.xml`)).text();
  const children = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const c of children) {
    const body = await (await fetch(c)).text();
    for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  }
  return urls;
})();
const stale = staleAnnouncerState(known, sitemapUrls);
if (stale.length) {
  console.error(`\nREFUSING TO SEND — ${stale[0]}`);
  console.error(`The state this read is not the one the Worker is maintaining, or the Worker has`);
  console.error(`not run since those URLs shipped. Sending from it would announce the wrong set`);
  console.error(`and clear a backlog it did not deliver.`);
  process.exit(1);
}
console.log(`state agrees with the ${sitemapUrls.length} URL(s) in the live sitemaps.`);

const owed = Object.entries(pending).filter(([, urls]) => urls?.length);
if (!owed.length) {
  console.log(`nothing owed — no endpoint carrying a backlog.`);
  process.exit(0);
}

/* Endpoint label -> the URL it posts to, derived from the Worker's own list with the Worker's
   own label rule. This was a hand-written map with a comment saying it "mirrors ENDPOINTS in
   worker/indexnow.ts"; a mirror is a copy, and src/lib/routes.ts records what the last copy
   in this repository cost. */
const POST_TO = Object.fromEntries(ENDPOINTS.map((e) => [endpointLabel(e), e]));

let cleared = 0;
for (const [name, urls] of owed) {
  const endpoint = POST_TO[name];
  if (!endpoint) { console.log(`  ${name.padEnd(26)} SKIP — not an endpoint the Worker posts to; state may be from an older ENDPOINTS list`); continue; }
  const fails = backoff[name]?.fails ?? 0;
  if (DRY) { console.log(`  ${name.padEnd(26)} would send ${urls.length} URL(s) (worker has failed ${fails}x)`); continue; }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(ORIGIN).host, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  console.log(`  ${name.padEnd(26)} HTTP ${res.status}  ${urls.length} URL(s)  (worker had failed ${fails}x)`);
  if (res.ok) { delete pending[name]; delete backoff[name]; cleared++; }
}

if (DRY) { console.log("\n--dry: nothing sent, nothing written."); process.exit(0); }
if (!cleared) { console.log("\nno endpoint accepted from here either — state left untouched."); process.exit(1); }

/* Written back only for endpoints that accepted. A drain that cleared a backlog it did not
   deliver would be worse than no drain at all.

   `sentAt` IS CARRIED AND ADVANCED. It was dropped by the old write-back, so a successful drain
   silently reset the Worker's record of whether anything had ever been accepted — and that
   field exists precisely so an operator reading the run log is not told "submitted and
   accepted" about a site nothing has ever accepted. */
const next = {
  known,
  ...(Object.keys(pending).length ? { pending } : {}),
  ...(Object.keys(backoff).length ? { backoff } : {}),
  sentAt: Date.now(),
};
const tmp = join(tmpdir(), "indexnow-state.json");
writeFileSync(tmp, JSON.stringify(next));
kv(["put", STATE_KEY, "--path", tmp]);
console.log(`\ncleared ${cleared} endpoint(s); ${Object.keys(pending).length} still owed. State written to ${STATE_KEY}.`);
