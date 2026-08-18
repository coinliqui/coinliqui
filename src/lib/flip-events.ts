/**
 * FLIPS DETECTED WHERE BOTH SIDES OF THE COMPARISON ALREADY EXIST, WHICH IS THE INGEST PASS.
 *
 * Moving the flip feed off the page and into the worker made its cost independent of traffic,
 * which was the goal, and the meter then showed that it had not made the cost smaller: ~2.6M
 * D1 rows read per hour, flat, against ~2.7M per hour before. Twelve passes an hour of a query
 * with two window functions over a 24-hour window costs about what the same query cost when
 * every reader ran it. Flat was worth having; flat and large is not the finished job.
 *
 * The observation that removes it entirely: a flip is a change of sign between two consecutive
 * samples, and the ingest pass HOLDS BOTH. It has just fetched the current APR for every
 * symbol-venue pair, and the previous pass's values are one small KV record away. Re-deriving
 * 24 hours of history from D1 to answer "did anything change since five minutes ago" reads
 * 43,200 rows to learn something computable from 150 numbers and 150 numbers.
 *
 * So D1 keeps doing what only D1 can — being the durable history, which cannot be
 * reconstructed and is what /status and the retention policy are about — and the feed is
 * maintained incrementally as a rolling event list.
 *
 * readFlips (the SQL) is retained deliberately as the REFERENCE IMPLEMENTATION. It is no
 * longer on any hot path, and scripts/flips-parity.mjs runs it against production to prove the
 * incremental feed agrees with it row for row. That is the only reason to trust an optimisation
 * like this: not that the logic looks equivalent, but that the expensive version and the cheap
 * version are measured against each other on real data.
 */
import type { Flip, FlipsResult } from "./flips.ts";

/** APRs from one pass, keyed `SYMBOL|VENUE`. Small: about 150 numbers. */
export interface AprSample {
  at: number;
  aprs: Record<string, number>;
}

export const LAST_KEY = "flips:last";
export const EVENTS_KEY = "flips:events";

/** How many events to keep. A 24-hour window over ~150 pairs cannot approach this; the cap is
 *  a backstop against a bug appending without bound, not a design parameter. */
export const MAX_EVENTS = 5000;

export const sampleFrom = (rows: [string, string, number, number][], at: number): AprSample => {
  const aprs: Record<string, number> = {};
  for (const [symbol, venue, apr] of rows) aprs[`${symbol}|${venue}`] = apr;
  return { at, aprs };
};

/**
 * Sign changes between two consecutive samples.
 *
 * The boundary follows the SQL exactly: `(prev < 0 AND curr >= 0) OR (prev >= 0 AND curr < 0)`.
 * Zero counts as non-negative on BOTH sides, so a rate resting at exactly 0 is not a flip and
 * moving off it in either direction is judged against the same rule. Getting this wrong by one
 * boundary would produce a feed that looks right and disagrees with the reference on the rows
 * nobody inspects.
 *
 * `gapMin` is the distance between the two SAMPLES, not the two events — the reversal happened
 * somewhere inside that interval and the page says so rather than implying a precision the
 * sampling never had.
 */
export function detectFlips(prev: AprSample | null, curr: AprSample): Flip[] {
  if (!prev || !Number.isFinite(prev.at) || prev.at >= curr.at) return [];
  const gapMin = Math.round((curr.at - prev.at) / 60000);
  const out: Flip[] = [];
  for (const [key, apr] of Object.entries(curr.aprs)) {
    const prevApr = prev.aprs[key];
    if (!Number.isFinite(prevApr) || !Number.isFinite(apr)) continue;
    const flipped = (prevApr < 0 && apr >= 0) || (prevApr >= 0 && apr < 0);
    if (!flipped) continue;
    const i = key.lastIndexOf("|");
    out.push({ symbol: key.slice(0, i), venue: key.slice(i + 1), prevApr, apr, at: curr.at, gapMin });
  }
  return out;
}

/** Append, drop anything outside the window, and bound the list. */
export function mergeEvents(existing: Flip[], fresh: Flip[], now: number, hours: number): Flip[] {
  const cutoff = now - hours * 3_600_000;
  const kept = [...existing, ...fresh].filter((f) => f.at >= cutoff);
  kept.sort((a, b) => a.at - b.at);
  return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

/**
 * The feed the page renders, assembled to match the SQL's shape exactly:
 *   - one row per symbol+venue, the LATEST flip for that pair (the SQL's rn = 1 dedupe)
 *   - ordered by time descending
 *   - at most 25 rows
 *   - `total` counting DISTINCT PAIRS that flipped in the window, not events
 * The last of those was a real defect once: the page said "in the last 24 hours" above 25 rows
 * while 104 contracts had flipped, because rows and total came from different sets.
 */
export function feedFromEvents(events: Flip[], since: number, now: number, hours: number): FlipsResult {
  const cutoff = now - hours * 3_600_000;
  const latest = new Map<string, Flip>();
  for (const f of events) {
    if (f.at < cutoff) continue;
    const k = `${f.symbol}|${f.venue}`;
    const prev = latest.get(k);
    if (!prev || f.at > prev.at) latest.set(k, f);
  }
  const rows = [...latest.values()].sort((a, b) => b.at - a.at);
  return { status: "ready", rows: rows.slice(0, 25), since, total: rows.length };
}
