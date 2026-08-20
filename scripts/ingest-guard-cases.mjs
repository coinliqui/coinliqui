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
