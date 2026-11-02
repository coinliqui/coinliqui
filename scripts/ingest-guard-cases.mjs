#!/usr/bin/env node
/**
 * The ingest plausibility floor, exercised as the worker computes it.
 *
 * WHY IT EXISTS. src/lib/hyperliquid.ts `info()` checks the HTTP status and then trusts the
 * body. Fed a 200 carrying an empty universe, contexts full of nulls, or markPx as the string
 * "n/a", fetchSnapshot returns a well-formed snapshot with ZERO contracts — verified by calling
 * the real function with a stubbed fetch, all three produced perps=0 — and the worker used to
 * write it straight over the healthy one, along with the published set and the D1 history.
 *
 * The partial case is quieter and worse: one contract instead of fifty leaves rows.length > 0,
 * so the run recorded itself as OK and /status showed a healthy ingest while forty-nine
 * contracts had vanished.
 *
 * WHAT THIS FILE IS FOR. The guard's danger is the opposite of the bug's: a floor set wrongly
 * refuses HEALTHY runs, and the site then serves an ageing snapshot for hours while every check
 * says the upstream is fine. So the healthy cases are tested first and by name — steady state,
 * churn, growth, first boot, a small site shrinking — and they must all be accepted.
 *
 * THE RULE USED TO BE TRANSCRIBED HERE. This file carried its own two-line copy of the floor,
 * so it could only ever prove that the copy agreed with itself: changing the threshold in the
 * worker left every case below green. It now imports the function the worker calls.
 *
 * AND THE FLOOR WAS ONLY HALF THE DECISION, which the second half of this file is about. It
 * decided whether to WRITE the new coverage set and said nothing about which set everything
 * downstream should then use — and both consumers went on naming the raw fetch.
 *
 *   node --experimental-strip-types scripts/ingest-guard-cases.mjs
 */
import { collapsedCoverage as decide, publishedSet, orphans } from "../worker/coverage.ts";

const cases = [
  ["healthy steady state",        50, 50, false],
  ["one contract retired",        50, 49, false],
  ["normal churn down",           50, 46, false],
  ["growth",                      50, 55, false],
  ["first boot, empty prev",       0, 50, false],
  ["exactly half — allowed",      50, 25, false],
  ["just under half — refused",   50, 24, true],
  ["upstream drops 49 of 50",     50,  1, true],
  ["upstream returns nothing",    50,  0, true],
  ["nothing, and nothing before",  0,  0, true],
  ["tiny site shrinks (prev<10)",  8,  3, false],
];
let blind = 0;
for (const [name, prev, now, want] of cases) {
  const got = decide(prev, now);
  const ok = got === want;
  if (!ok) blind++;
  console.log(`  ${ok ? "ok   " : "BLIND"}  ${String(prev).padStart(2)} -> ${String(now).padStart(2)}  ${got ? "REFUSE" : "accept"}  ${name}`);
}
if (blind) { console.error(`\n  ${blind} WRONG`); process.exit(1); }
console.log("  guard behaves correctly on every case, including the healthy ones");

/* ---------------------------------------------------------------------------------------- *
 * WHAT THE FLOOR DID NOT COVER: THE SCOPE EVERYTHING DOWNSTREAM WALKS.
 *
 * A sweep prunes when its cycle wraps, deleting `<kind>:<SYM>` for anything outside the scope
 * it just covered. That is the correct cleanup for a contract leaving coverage. Handed the
 * degenerate list from a collapsed tick it is the most destructive line in the worker: the
 * list of one wraps inside a single chunk, and the other forty-nine lose their chart series
 * while their pages stay published and served.
 *
 * `published:set` was never rewritten, so nothing about the site's URL set would change and
 * nothing would appear on /status. The pages would simply start rendering chart-shaped holes.
 * ---------------------------------------------------------------------------------------- */
const FIFTY = Array.from({ length: 50 }, (_, i) => `SYM${i}`);
const DEGENERATE = ["SYM0"];

console.log("\n  the scope the sweeps walk, on a collapsed tick:");
let bad = 0;
const scopeCases = [
  {
    name: "collapsed: scope is the set still published",
    collapsed: true, prev: FIFTY, fetched: DEGENERATE,
    wantScope: 50, wantPruned: 0,
  },
  {
    name: "the defect, for comparison: scope is the raw fetch",
    collapsed: false, prev: FIFTY, fetched: DEGENERATE,
    wantScope: 1, wantPruned: 49,
  },
  {
    name: "healthy tick: scope is what was just fetched",
    collapsed: false, prev: FIFTY, fetched: FIFTY,
    wantScope: 50, wantPruned: 0,
  },
  {
    name: "one contract genuinely retired: it is pruned, as intended",
    collapsed: false, prev: FIFTY, fetched: FIFTY.slice(0, 49),
    wantScope: 49, wantPruned: 1,
  },
  {
    name: "first boot: nothing published yet, nothing to prune",
    collapsed: false, prev: [], fetched: FIFTY,
    wantScope: 50, wantPruned: 0,
  },
];
for (const c of scopeCases) {
  const scope = publishedSet(c.collapsed, c.prev, c.fetched);
  /* `have` is what the sweep meta records as holding data — the previously covered set. */
  const pruned = orphans(c.prev.length ? c.prev : c.fetched, scope);
  const ok = scope.length === c.wantScope && pruned.length === c.wantPruned;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok   " : "MISS "}  scope ${String(scope.length).padStart(2)}  deletes ${String(pruned.length).padStart(2)} series  ${c.name}`);
}

/* THE ACTUAL CALL THE WORKER MAKES, not a re-derivation of it: on a collapse the floor says
   refuse, and the scope must then be the set the floor declined to overwrite. */
const collapsed = decide(FIFTY.length, DEGENERATE.length);
const scope = publishedSet(collapsed, FIFTY, DEGENERATE);
if (!collapsed) { console.log("  MISS  50 -> 1 was not judged a collapse"); bad++; }
if (orphans(FIFTY, scope).length !== 0) { console.log("  MISS  a collapsed tick still prunes live pages"); bad++; }

if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  a collapsed tick refuses the write AND keeps the scope, so no live page loses its series");

/* ---------------------------------------------------------------------------------------- *
 * SHAPES THE UPSTREAM HAS NEVER SENT US.
 *
 * info() checks the HTTP status and then trusts the body, and every branch below is reached by
 * a 200. The floor above catches a response that is EMPTY or SHRUNKEN; none of it looks at a
 * response that is the right size and the wrong shape.
 *
 * Run against the real fetchSnapshot with a stubbed fetch, because a transcription of what the
 * parser does is a transcription of what somebody thought it did. Two outcomes are acceptable
 * and one is not: it may return a snapshot that survives every downstream assumption, or it may
 * throw — worker/ingest.ts catches, records the message on the run row and keeps the previous
 * snapshot, which is the designed refusal. What it must never do is return a contract that
 * looks fine and breaks a page.
 *
 * The third case is the one that did. A universe entry with no marginTableId publishes a
 * contract whose table id is `undefined`; String(undefined) is "undefined", which is not a key
 * in src/data/margin-tables.json, and tierFor() reads table.marginTiers unguarded. That is a
 * TypeError thrown mid-render — and because Astro streams, it reaches a reader or a crawler as
 * a 200 with a truncated body, not as a 500. Measured: 0 bytes. pickPerp declines such a
 * contract now, and this case is what keeps that true.
 * ---------------------------------------------------------------------------------------- */
const { fetchSnapshot } = await import("../src/lib/hyperliquid.ts");
const U = [{ name: "BTC", maxLeverage: 40, szDecimals: 5, marginTableId: 51 }];
const C = [{ funding: "0.00001", openInterest: "100000", prevDayPx: "100000", dayNtlVlm: "1e9", premium: "0", oraclePx: "100000", markPx: "100000", midPx: "100000" }];
const P = [["BTC", [["HlPerp", { fundingRate: "0.00001", nextFundingTime: 1, fundingIntervalHours: 1 }]]]];
const TABLES = JSON.parse(await (await import("node:fs/promises")).readFile("src/data/margin-tables.json", "utf8"));

const shapes = [
  ["the healthy shape, so the rest mean something", [{ universe: U }, C], P, "one usable contract"],
  ["ctxs shorter than universe", [{ universe: [...U, { name: "NEW", maxLeverage: 5, szDecimals: 2, marginTableId: 99 }] }, C], P, "one usable contract"],
  ["a universe entry with no marginTableId", [{ universe: [{ name: "BTC", maxLeverage: 40, szDecimals: 5 }] }, C], P, "no usable contract"],
  ["markPx is the string n/a", [{ universe: U }, [{ ...C[0], markPx: "n/a" }]], P, "no usable contract"],
  ["openInterest is null", [{ universe: U }, [{ ...C[0], openInterest: null }]], P, "no usable contract"],
  ["fundingIntervalHours is 0", [{ universe: U }, C], [["BTC", [["HlPerp", { fundingRate: "0.00001", nextFundingTime: 1, fundingIntervalHours: 0 }]]]], "one usable contract"],
  ["meta is an object rather than a pair", { universe: U, ctxs: C }, P, "refused"],
  ["ctxs missing entirely", [{ universe: U }], P, "refused"],
  ["universe missing", [{}, C], P, "refused"],
  ["predictedFundings is an object", [{ universe: U }, C], { BTC: [] }, "refused"],
];

console.log("\n  shapes the upstream has never sent, against the real parser:");
let sbad = 0;
const realFetch = globalThis.fetch;
for (const [name, meta, pred, want] of shapes) {
  globalThis.fetch = async (_u, o) =>
    new Response(JSON.stringify(JSON.parse(o.body).type === "metaAndAssetCtxs" ? meta : pred),
      { status: 200, headers: { "content-type": "application/json" } });
  let got, detail = "";
  try {
    const snap = await fetchSnapshot(["BTC"]);
    /* USABLE means every downstream assumption holds — which for these pages means a committed
       tier table, because five templates compute a liquidation price from one. */
    const usable = snap.perps.filter((p) => Object.prototype.hasOwnProperty.call(TABLES, String(p.marginTableId)));
    got = usable.length ? "one usable contract" : "no usable contract";
    detail = `perps=${snap.perps.length} usable=${usable.length}`;
  } catch (e) { got = "refused"; detail = e.constructor.name; }
  const ok = got === want;
  if (!ok) sbad++;
  console.log(`  ${ok ? "ok   " : "MISS "}  ${got.padEnd(20)} ${name.padEnd(42)} ${detail}`);
}
globalThis.fetch = realFetch;
if (sbad) { console.error(`\n  ${sbad} shape(s) behaved unexpectedly`); process.exit(1); }
console.log("\n  every unseen shape either yields a contract that survives its pages, or is refused outright");

/* =====================================================================================
   THE CANARY'S ok COLUMN MEANT "NOTHING THREW".

   migrations/0002_upstream_check.sql documents it as `ok : 1 only when usable rows were
   written`. The minute tick wrote `liveErr ? 0 : 1`, and two paths write nothing without
   throwing: `published:set` empty or absent — that key comes from the FIVE-minute ingest, which
   fails about one run in six — and fetchLive() returning no marks, which it does without
   throwing and which then overwrote a good `live` with an empty one.

   Either way the table would have recorded 1,440 rows a day of ok=1 while the one-minute path
   wrote nothing, and any success rate computed from it would have read 100%. That is precisely
   the failure the function's own header was written about, reproduced one level up inside the
   instrument built to catch it.

   Three cases, and the third is what stops the other two being satisfied by a tick that never
   reports success at all.
   ===================================================================================== */
let canary = 0;
{
  const { minute } = await import("../worker/ingest.ts");
  const realFetch = globalThis.fetch;

  const env = (published, universe) => {
    const kv = new Map();
    if (published) kv.set("published:set", published);
    const rows = [];
    globalThis.fetch = async (_u, opts) => {
      const type = JSON.parse(opts.body).type;
      const body = type === "metaAndAssetCtxs"
        ? [{ universe: universe.map((name) => ({ name })) }, universe.map(() => ({ markPx: "100" }))]
        : universe.map((name) => [name, [["HlPerp", { fundingRate: "0.00001", fundingIntervalHours: 1 }]]]);
      return { ok: true, status: 200, json: async () => body };
    };
    return {
      rows,
      env: {
        SNAPSHOT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, JSON.parse(v)); } },
        DB: { prepare: () => ({ bind: (...a) => ({ run: async () => rows.push(a) }) }) },
        wrote: () => kv.has("live"),
        live: () => kv.get("live"),
      },
    };
  };

  const cases = [
    ["published:set absent — nothing was fetched", null, ["BTC"], 0, false],
    ["the upstream returned no marks for the published set", ["BTC"], [], 0, false],
    ["marks written — the case that keeps the other two honest", ["BTC"], ["BTC"], 1, true],
  ];
  for (const [name, published, universe, wantOk, wantWrite] of cases) {
    const { rows, env: e } = env(published, universe);
    await minute(e);
    const row = rows[0] ?? [];
    const gotOk = row[4];
    const note = (() => { try { return JSON.parse(row[5] ?? "{}"); } catch { return {}; } })();
    const wrote = e.wrote();
    const pass = gotOk === wantOk && wrote === wantWrite;
    console.log(`  ${pass ? "ok  " : "FAIL"}  ${name.padEnd(56)} ok=${gotOk} wrote-live=${wrote} note=${JSON.stringify(note).slice(0, 62)}`);
    if (!pass) { canary++; console.log(`        wanted ok=${wantOk} wrote-live=${wantWrite}`); }
  }
  globalThis.fetch = realFetch;
}
/* ITS OWN GATE. This file already exits at three points above, on `blind`, on `bad` and on
   `sbad`, and every one of them had run by the time these cases did — so incrementing `bad`
   here would have printed a FAIL and exited 0. A block appended after the last exit is a suite
   that cannot fail, which is the shape this whole pass exists to remove; adding one while
   removing them would have been funny in the wrong way. */
if (canary) { console.error(`\n  ${canary} canary case(s) wrong`); process.exit(1); }
