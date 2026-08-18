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

/**
 * THE LAST KNOWN APR FOR EVERY PAIR, WHICH IS NOT THE SAME AS THE LAST PASS'S APRS.
 *
 * The first version stored one pass's values and compared the next pass against them. Parity
 * against the SQL failed on real production data and the reason is exact: `LAG(apr) OVER
 * (PARTITION BY symbol, venue ORDER BY at)` steps to the previous EXISTING ROW for that pair.
 * A pair whose APR arrives non-finite is filtered out of the insert, so it has no row for that
 * pass — and the SQL then compares across the gap while a last-pass snapshot has already
 * forgotten the value. Flips spanning a missing sample were silently invisible, which is also
 * why gapMin legitimately reaches into the hundreds of minutes.
 *
 * So the record carries forward: a pair keeps its last known value and the instant it was seen,
 * updated only when a new finite value arrives. That makes the comparison span gaps exactly as
 * LAG does, and makes gapMin the true distance between the two samples compared rather than the
 * distance between two passes.
 */
export interface AprSample {
  /** When this record was last updated, for observability only — comparisons use per-pair `at`. */
  at: number;
  aprs: Record<string, { apr: number; at: number }>;
}

export const LAST_KEY = "flips:last";
export const EVENTS_KEY = "flips:events";

/** How many events to keep. A 24-hour window over ~150 pairs cannot approach this; the cap is
 *  a backstop against a bug appending without bound, not a design parameter. */
export const MAX_EVENTS = 5000;

/** Fold this pass's rows into the carried record, leaving absent pairs untouched. */
export function carryForward(prev: AprSample | null, rows: [string, string, number, number][], at: number): AprSample {
  const aprs: Record<string, { apr: number; at: number }> = { ...(prev?.aprs ?? {}) };
  for (const [symbol, venue, apr] of rows) {
    if (Number.isFinite(apr)) aprs[`${symbol}|${venue}`] = { apr, at };
  }
  return { at, aprs };
}

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
export function detectFlips(prev: AprSample | null, rows: [string, string, number, number][], at: number): Flip[] {
  if (!prev) return [];
  const out: Flip[] = [];
  for (const [symbol, venue, apr] of rows) {
    if (!Number.isFinite(apr)) continue;
    const was = prev.aprs[`${symbol}|${venue}`];
    if (!was || !Number.isFinite(was.apr) || was.at >= at) continue;
    const flipped = (was.apr < 0 && apr >= 0) || (was.apr >= 0 && apr < 0);
    if (!flipped) continue;
    /* The gap is between the two SAMPLES compared, which for a pair that went missing is
       wider than the pass interval — the same number the SQL derives from prev_at. */
    out.push({ symbol, venue, prevApr: was.apr, apr, at, gapMin: Math.round((at - was.at) / 60000) });
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
  /* TIME DESCENDING, THEN SYMBOL, THEN VENUE. Parity failed on two rows that had the SAME
     timestamp and came back in opposite orders: the SQL's ORDER BY at DESC leaves ties
     arbitrary, and so did this. Simultaneous flips are common — one snapshot stamps every pair
     with the same `at` — so the tie-break is specified on both sides rather than left to
     whichever engine happens to be sorting. */
  /* CODEPOINT ORDER, NOT LOCALE ORDER. localeCompare put kBONK before LTC; SQLite's default
     BINARY collation puts LTC first, because uppercase letters precede lowercase in codepoint
     order and this site has symbols of both cases — kPEPE, kBONK against BTC, LTC. Two engines
     sorting "the same" column differently is exactly the divergence the parity harness caught,
     and the fix is to say which order is meant rather than to trust either default. */
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const rows = [...latest.values()].sort((a, b) => b.at - a.at || cmp(a.symbol, b.symbol) || cmp(a.venue, b.venue));
  return { status: "ready", rows: rows.slice(0, 25), since, total: rows.length };
}
