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
 *   node scripts/ingest-guard-cases.mjs
 */
const decide = (prevCount, newCount) =>
  newCount === 0 || (prevCount >= 10 && newCount < prevCount / 2);

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
console.log(blind ? `\n  ${blind} WRONG` : "\n  guard behaves correctly on every case, including the healthy ones");
