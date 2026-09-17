#!/usr/bin/env node
/**
 * THE BRANCHES THAT SAY "NOT YET" — AND HAD NEVER RUN.
 *
 * This site states a gap rather than hiding one. Ten places render a named empty state instead
 * of a chart, a table or a feed: candles not collected, funding history still warming, no flips
 * in the window, no report yet, no runs recorded. Every one of them is a first-run path or a
 * hole-in-the-data path, every one is what a reader sees on the worst day, and **not one of them
 * was rendered by anything**.
 *
 * HOW THAT HAPPENED IS THE INTERESTING PART, because it was the fix for the opposite defect.
 * scripts/seed-smoke-kv.mjs exists because the warm fixture was a capture from a point in time,
 * so every feature added after it read a key that was not there, the gate rendered the empty
 * branch, and the defects in the new feature shipped. That happened twice — the flip feed and
 * the 15-minute series both drew placeholders on every gate run for as long as they existed.
 * Seeding every key fixed it, and made the empty branches unreachable in the same stroke.
 *
 * Both halves matter. The happy path must render, and the degraded path must be exercised
 * DELIBERATELY rather than by accident — which is the difference between this file and the bug
 * it is named after.
 *
 * WHAT IT DOES. Copies the warm store, deletes a chosen set of keys, and serves the built site
 * against the hole. Then asserts, for each affected route: it answers 200 rather than throwing;
 * it says the thing it is supposed to say; the rest of the page is still there; and no figure
 * has decayed into NaN, undefined or an empty currency symbol on the way.
 *
 * The margin-table 500 is the model this was written from. A branch nothing exercises is a
 * claim about behaviour under a condition that has not happened yet, and the claim is worth
 * whatever the last person to read it thought.
 *
 *   node scripts/degraded.mjs
 */
import { spawn } from "node:child_process";
import { cpSync, rmSync, existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const SRC = ".wrangler/smoke";
const DIR = ".wrangler/degraded";
const PORT = 8794;

if (!existsSync(`${SRC}/v3/kv/miniflare-KVNamespaceObject`)) {
  console.log("  ---   no warm store yet — run `npm run check` once, which builds it\n");
  process.exit(0);
}

/* ONE STORE, MANY HOLES. The states below touch different keys, so a single store with all of
   them removed renders every one in a single server run. Where two states share a key — the
   coin page and the contract page both read candles:BTC — that is the point: one hole, two
   templates, and they must degrade the same way. */
const REMOVE = [
  "candles:BTC", "hourly:BTC", "m15:BTC", "funding:BTC",   // every series for one symbol
  "flips:24h",                                              // the flip feed
];

/** route -> the sentence its degraded branch must say, and what must survive alongside it. */
const CASES = [
  { path: "/coins/bitcoin", says: /Candles not collected yet/,
    survives: [/Open interest/, /24-hour change/], why: "the coin page keeps every figure that does not come from candles" },
  { path: "/funding/btc", says: /Candles not collected yet|Collecting/,
    survives: [/Maintenance margin|margin tiers|Open interest/], why: "the contract page keeps the funding table and the tier ladder" },
  { path: "/liquidations?symbol=BTC", says: /Hourly candles not collected yet/,
    survives: [/liquidation/i], why: "the density map needs hourly bars and nothing else on the page does" },
  /* "not collected yet" was the old title, and it was false whenever the series existed but could
     not be read (16 September 2026) — the page now names what is missing without naming a cause. */
  { path: "/liquidations/survival?symbol=BTC", says: /No BTC daily candles to test/,
    survives: [/leverage/i], why: "the backtest needs daily bars" },
  { path: "/", says: /No flips in the last 24 hours|Collecting funding history|Flip feed unavailable/,
    survives: [/Funding/], why: "the home page states which feed is missing rather than dropping the section" },
];

rmSync(DIR, { recursive: true, force: true });
cpSync(SRC, DIR, { recursive: true });
const objDir = join(DIR, "v3/kv/miniflare-KVNamespaceObject");
let removed = 0, present = [];
for (const f of readdirSync(objDir).filter((x) => x.endsWith(".sqlite"))) {
  const db = new DatabaseSync(join(objDir, f));
  try {
    const keys = db.prepare("SELECT key FROM _mf_entries").all().map((r) => r.key);
    if (!keys.includes("snapshot")) continue;
    present = keys;
    for (const k of REMOVE) {
      if (!keys.includes(k)) continue;
      db.prepare("DELETE FROM _mf_entries WHERE key = ?").run(k);
      removed++;
    }
  } catch { /* not a KV store */ } finally { db.close(); }
}
/* A HOLE THAT WAS NEVER THERE PROVES NOTHING. If the key was already absent the branch would
   have rendered in the warm gate too, and this file would be asserting on the happy path's
   absence rather than on a deliberate hole. */
const notThere = REMOVE.filter((k) => !present.includes(k));
if (notThere.length) {
  console.error(`\n  FAIL  ${notThere.join(", ")} was not in the warm store, so removing it removed nothing\n`);
  process.exit(1);
}

console.log(`\n=== degraded store — ${removed} keys removed from a ${present.length}-key fixture ===\n`);
console.log(`   ---   removed: ${REMOVE.join(", ")}\n`);

const srv = spawn("npx", ["wrangler", "pages", "dev", "dist", "--port", String(PORT), "--ip", "127.0.0.1",
  "--kv", "SNAPSHOT", "--d1", "DB", "--persist-to", DIR], { stdio: ["ignore", "pipe", "pipe"] });
const kill = () => { try { srv.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", kill);
process.on("SIGINT", () => { kill(); process.exit(130); });

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/robots.txt`); if (r.status) return true; } catch { /* not yet */ }
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
};
if (!(await up())) { console.error("degraded: the worker never came up"); kill(); process.exit(1); }

let bad = 0;
const fail = (m) => { bad++; console.log(`   FAIL  ${m}`); };
let ran = CASES.length;
for (const c of CASES) {
  let status = 0, body = "";
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${c.path}`, { headers: { accept: "text/html", "user-agent": "coinliqui-degraded" } });
    status = r.status; body = await r.text();
  } catch (e) { fail(`${c.path} threw: ${e.message}`); continue; }

  if (status !== 200) { fail(`${c.path} answered ${status} — a missing series must degrade, not fail`); continue; }
  /* A PAGE THAT DIES MID-STREAM STILL ANSWERS 200. Astro streams, so a TypeError thrown while
     rendering arrives as a truncated body behind a 200 header — which is how the margin-table
     defect would have presented. The closing tag is the only thing that says it finished. */
  if (!/<\/html>\s*$/.test(body)) { fail(`${c.path} body is truncated (${body.length}B, no closing tag) — it threw mid-render`); continue; }
  if (!c.says.test(body)) { fail(`${c.path} does not say what is missing (expected ${c.says})`); continue; }
  /* THE OK LINE USED TO PRINT WHATEVER THESE FOUND. The two loops below call fail() and do not
     continue — deliberately, so one route reports every one of its problems rather than the
     first — and the success line sat after them unconditionally. A route that lost a series or
     rendered a NaN printed a FAIL and then "states the gap, keeps the rest, no decayed
     figures" about itself. The run still exited non-zero, so this was never a false green
     overall; it was a line asserting three clauses when only one had been established. */
  const before = bad;
  for (const s of c.survives) if (!s.test(body)) fail(`${c.path} lost ${s} — a missing series must not take the rest of the page with it`);
  /* The decay a missing input produces if a figure is computed from it anyway. */
  const text = body.replace(/<script[\s\S]*?<\/script>/g, " ");
  for (const junk of [/\bNaN\b/, /\bundefined\b/, /\$\s*<|\$\s*$/, /Infinity/]) {
    if (junk.test(text)) fail(`${c.path} rendered ${junk} — a figure was computed from the series that is not there`);
  }
  if (bad === before) console.log(`   ok    ${c.path.padEnd(34)} states the gap, keeps the rest, no decayed figures — ${c.why}`);
  else ran--;
}

kill();
/* IT SAID "EVERY BRANCH" AND IT MEANT FIVE. CASES holds five routes against five removed keys;
   this file's own header counts ten stated-degradation branches in the templates and a grep
   finds more than that. Five is a good five — they are the ones a reader hits first — but a
   line reading "every branch that says not yet was rendered" is a coverage claim the array
   beneath it does not support, and it is the reason nobody went looking for the other eight.
   The count is derived from CASES so it cannot drift, and the sentence no longer says every. */
console.log(bad
  ? `\n  ${bad} degraded route(s) wrong\n`
  : `\n  ${ran} of ${CASES.length} route(s) rendered against a hole and degraded rather than throwing — not every "not yet" branch in the site, only these\n`);
process.exit(bad ? 1 : 0);
