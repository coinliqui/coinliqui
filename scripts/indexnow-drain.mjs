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
 * So this exists as the escape hatch, not the plan. It reads the SAME `pending` map the Worker
 * maintains, sends only what an endpoint is actually owed, and writes the state back with those
 * endpoints cleared — so the Worker stops retrying them and the backoff resets. Nothing is
 * invented here: if the Worker owes nothing, this sends nothing.
 *
 * Bing is the index behind DuckDuckGo, Yahoo and Ecosia. The durable fix is Bing Webmaster
 * Tools, which needs an account only the owner can create; until then, run this.
 *
 *   node scripts/indexnow-drain.mjs [--dry]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEXNOW_KEY } from "../worker/indexnow.ts";

const NS = "09d5ddc598f34f36b11d367aac0aad87";
const KEY = "indexnow:submitted";
const ORIGIN = "https://coinliqui.com";
const DRY = process.argv.includes("--dry");

const kv = (args) =>
  execFileSync("npx", ["wrangler", "kv", "key", ...args, "--namespace-id", NS, "--remote"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let state;
try {
  state = JSON.parse(kv(["get", KEY]));
} catch (e) {
  console.error(`could not read ${KEY}: ${e.message}\nIs the wrangler token live? Run: npm run preflight`);
  process.exit(1);
}
/* The Worker migrated a bare array to { known }. Either shape is readable; only the new one written. */
const known = Array.isArray(state) ? state : state.known;
const pending = (Array.isArray(state) ? {} : state.pending) ?? {};
const backoff = (Array.isArray(state) ? {} : state.backoff) ?? {};

const owed = Object.entries(pending).filter(([, urls]) => urls?.length);
if (!owed.length) {
  console.log(`nothing owed — ${known.length} URLs known, no endpoint carrying a backlog.`);
  process.exit(0);
}

/* Endpoint hostname -> the URL it posts to. Mirrors ENDPOINTS in worker/indexnow.ts; only the
   two that refuse the Worker are drainable here, and an unknown label is reported rather than
   guessed at. */
const POST_TO = {
  "api.indexnow.org": "https://api.indexnow.org/indexnow",
  "bing.com": "https://www.bing.com/indexnow",
  "yandex.com": "https://yandex.com/indexnow",
  "search.seznam.cz": "https://search.seznam.cz/indexnow",
  "searchadvisor.naver.com": "https://searchadvisor.naver.com/indexnow",
};

let cleared = 0;
for (const [name, urls] of owed) {
  const endpoint = POST_TO[name];
  if (!endpoint) { console.log(`  ${name.padEnd(26)} SKIP — no endpoint known for this label; add it to POST_TO`); continue; }
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
   deliver would be worse than no drain at all. */
const next = { known, ...(Object.keys(pending).length ? { pending } : {}), ...(Object.keys(backoff).length ? { backoff } : {}) };
const tmp = join(tmpdir(), "indexnow-state.json");
writeFileSync(tmp, JSON.stringify(next));
kv(["put", KEY, "--path", tmp]);
console.log(`\ncleared ${cleared} endpoint(s); ${Object.keys(pending).length} still owed. State written.`);
