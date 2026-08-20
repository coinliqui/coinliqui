/**
 * THREE DECISIONS ABOUT WHICH CONTRACTS ARE COVERED, IN ONE PLACE BECAUSE THEY DISAGREED.
 *
 * The plausibility floor lived inline in worker/ingest.ts and was TRANSCRIBED a second time
 * into scripts/ingest-guard-cases.mjs, which is the shape this project keeps finding: one
 * fact, two implementations, and a test that passes because it is testing its own copy. Moving
 * the rule here makes the check exercise the thing that ships.
 *
 * More importantly, the floor was only ever half a decision. It said whether to WRITE the new
 * coverage set; it said nothing about which set everything downstream should then USE, and the
 * downstream code went on naming the freshly fetched one. See publishedSet.
 */

/**
 * A PLAUSIBILITY FLOOR, because "the upstream failed" and "the upstream answered nonsense" need
 * the same response and only one of them throws.
 *
 * src/lib/hyperliquid.ts `info()` checks the HTTP status and then trusts the body. Fed a 200
 * carrying an empty universe, contexts full of nulls, or markPx as the string "n/a",
 * fetchSnapshot returns a perfectly well-formed snapshot containing ZERO contracts — exercised
 * against the real function, all three produced perps=0.
 *
 * The partial case is quieter and worse: a response carrying one contract instead of fifty
 * leaves rows.length > 0, so the run records itself OK and /status shows a healthy ingest while
 * forty-nine contracts have silently vanished.
 *
 * Half of the previously published set, and only once there IS a meaningful set, so first boot
 * and genuine growth are unaffected.
 */
export const collapsedCoverage = (prevCount: number, newCount: number): boolean =>
  newCount === 0 || (prevCount >= 10 && newCount < prevCount / 2);

/**
 * THE SET THIS TICK PUBLISHES — the one it just wrote, or the one it declined to overwrite.
 *
 * The floor above refuses to write a degenerate set, and then both consumers of that decision
 * carried on naming the raw fetch: the IndexNow announcement, and the symbol list every bulk
 * sweep walks. A condition evaluated on one value and acted on with another, one line apart.
 *
 * The sweep is where it bit. A sweep prunes when its cycle wraps — see orphans — and a
 * degenerate list of one wraps inside a single chunk.
 */
export const publishedSet = (collapsed: boolean, prev: string[], fetched: string[]): string[] =>
  collapsed ? prev : fetched;

/**
 * KEYS TO DELETE WHEN A SWEEP CYCLE WRAPS: series held for contracts no longer covered.
 *
 * This is the correct and necessary cleanup — a contract that leaves coverage would otherwise
 * keep its `hourly:`/`m15:`/`candles:`/`funding:` record in KV forever. It is also, handed the
 * wrong scope, the most destructive line in the worker: one collapsed tick with a scope of one
 * deletes the chart series for the other forty-nine, whose pages are still published and still
 * being served. The site does not go stale, it goes empty, and refills over hours.
 *
 * Extracted so that consequence is testable rather than argued about.
 */
export const orphans = (have: Iterable<string>, scope: string[]): string[] => {
  const covered = new Set(scope);
  return [...have].filter((s) => !covered.has(s));
};
