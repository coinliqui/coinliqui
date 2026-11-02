/**
 * Funding sign flips — the event tier.
 *
 * A sign flip means the side paying to hold the position reversed. Unlike a rate level,
 * that is an event: it happened at a time, and it is a reason to open the site today
 * rather than whenever. Without it phase 0 would be a state table, which is the archetype
 * with the worst measured session depth in this category.
 *
 * Derived entirely from snapshots the cron already fetches — no new data source. The same
 * table backs the on-site flip feed, the only event surface on the homepage. History cannot
 * be backfilled, so it starts accruing from day one.
 */

export interface Flip {
  symbol: string;
  venue: string;
  prevApr: number;
  apr: number;
  at: number;
  /* HOW WIDE THE DETECTION WINDOW WAS, in minutes.
     `at` is when the reversal was FIRST SEEN — the timestamp of the later of the two samples
     being compared — not when it happened. Those are the same thing only when the samples are
     adjacent. Measured against production D1 over a trailing 24 h: of the 104 contracts that
     flipped, 21 were detected across a gap wider than 15 minutes and the worst was 890 minutes,
     so a fifth of the feed was printing a to-the-minute time for an event that could have
     occurred any time in the previous fourteen hours. The number travels with the row so the
     page can say so instead of implying a precision the sampling never had. */
  gapMin: number;
}

export type FlipsResult =
  /* `total` is how many contracts flipped in the window; `rows` is the truncated head of that
     list. They were the same number in the copy and never in the data — the page said "in the
     last 24 hours" above 25 rows while 104 contracts had flipped. */
  | { status: "ready"; rows: Flip[]; since: number; total: number; legs: number }
  | { status: "no-store" }
  | { status: "warming"; since: number; hours: number }
  /**
   * THE FEED IS OLD, WHICH IS NOT THE SAME AS SHORT, AND IT USED TO BE REPORTED AS SHORT.
   *
   * A cache older than FLIPS_MAX_AGE_MS means the ingest has stopped writing `flips:24h`. That
   * was returned as `{ status: "warming", since, hours: 0 }` — `since` carried over from a
   * result that had been READY, so necessarily at least 24 hours old, and `hours` a hardcoded
   * zero measuring nothing. Rendered, with a cache 25 minutes stale and a first snapshot three
   * days back, the homepage printed:
   *
   *     0% progress bar
   *     0 of 24 hours collected · started 2026-08-21 06:26 UTC · first flips appear after
   *     2026-08-22 06:26 UTC          (today being 2026-08-24)
   *
   * A reader takes that as a site still filling up. The truth is a stalled ingest, and the two
   * want opposite responses: wait, versus go and look at the run log. `hours: 0` was the label
   * asserting elapsed coverage over a value that was a placeholder for a different condition.
   */
  | { status: "stale"; since: number; computedAt: number };

export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
    all<T>(): Promise<{ results: T[] }>;
    first<T>(): Promise<T | null>;
  };
}

/**
 * Flips in the trailing window. Reports honestly when history is too short to answer:
 * "no flips" and "not enough history to know" are different statements and must not be
 * collapsed into the same empty state.
 */
export async function readFlips(db: D1Like | undefined, hours = 24, now = Date.now()): Promise<FlipsResult> {
  /* `now` IS A PARAMETER SO THE WINDOW CAN BE PINNED. The cutoff is `now - hours`, a window
     that slides continuously, so recomputing this two minutes after the worker did returns a
     legitimately different answer — one flip ages out of the window and `total` drops by one.
     That is correct behaviour and it is indistinguishable, to a comparison, from the cache
     being wrong. scripts/flips-parity.mjs passes the stored computedAt so both sides evaluate
     the same window and any difference that remains is a real one. */
  if (!db) return { status: "no-store" };

  // The store may be bound but not yet migrated — that must degrade to an honest message,
  // never to a 500. A data-layer failure has no business taking down a page whose other
  // numbers are fine.
  try {
    const oldest = await db
      .prepare("SELECT MIN(at) AS a FROM funding_snapshot")
      .first<{ a: number | null }>();
    const since = oldest?.a ?? 0;
    if (!since) return { status: "warming", since: 0, hours: 0 };

    const covered = (now - since) / 3_600_000;
    if (covered < hours) return { status: "warming", since, hours: covered };

    const cutoff = now - hours * 3_600_000;
    /* gapMin ROUNDS, AND USED TO TRUNCATE.
     *
     * `at` and `prev_at` are integer milliseconds, so `(at - prev_at) / 60000` is INTEGER
     * division in SQLite and truncates. flip-events.ts — the implementation that actually
     * produces the stored feed — uses Math.round. Two implementations of one printed number,
     * disagreeing by up to a whole minute, and the cron's phase-shifted five-minute cadence
     * puts nearly every real gap in the fractional band where they differ: a 4.7-minute gap
     * was 4 here and 5 there. scripts/flips-parity.mjs found it, thirteen of twenty-five rows
     * off by exactly one in one direction, which is a signature no data produces.
     * `/ 60000.0` forces real division; ROUND then matches the JS exactly.
     *
     * THIS EXPLANATION LIVES OUT HERE, and that is the second lesson of the same fix. Written
     * as a SQL comment inside the query it read perfectly and broke the statement, because it
     * contained an apostrophe — D1 tracks quotes without understanding comments, so one `'`
     * inside a `/* *\/` ended the string as far as the wire protocol was concerned and every
     * call threw. The catch below turned that into `no-store`, so the page reported an empty
     * store rather than a broken query, and the only symptom was the parity check flipping
     * from "thirteen rows differ" to "live no-store vs stored ready".
     * Keep SQL comments short, and keep apostrophes out of them.
     */
    const { results } = await db
      .prepare(
        `WITH ordered AS (
           SELECT symbol, venue, apr, at,
                  LAG(apr) OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_apr,
                  LAG(at)  OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_at
           FROM funding_snapshot
           WHERE at >= ?1
         )
         , flips AS (
           SELECT symbol, venue, prev_apr AS prevApr, apr, at,
                  CAST(ROUND((at - prev_at) / 60000.0) AS INTEGER) AS gapMin,
                  ROW_NUMBER() OVER (PARTITION BY symbol, venue ORDER BY at DESC) AS rn
           FROM ordered
           WHERE prev_apr IS NOT NULL
             AND ((prev_apr < 0 AND apr >= 0) OR (prev_apr >= 0 AND apr < 0))
         )
         /* ONE ROW PER CONTRACT — the LATEST flip.
            Without this, every flip event in the window was listed, so LTC on Bybit appeared
            four times and ENA on Bybit four times, each with a different value under a column
            headed "Now (APR)". Four mutually exclusive "now"s for one contract in one document.
            A contract that oscillates around zero is not four separate pieces of news. */
         , latest AS (
           SELECT symbol, venue, prevApr, apr, at, gapMin FROM flips WHERE rn = 1
         )
         /* The count comes from the same CTE the rows come from, so the number the page prints
            and the rows it shows can never describe different sets. */
         /* THE DENOMINATOR COMES FROM THE SAME WINDOW AS THE NUMERATOR, which it did not.
            The home page printed "N of the M coin-venue pairs flipped" with N counted here,
            over 24 hours of funding_snapshot, and M counted on the page from the CURRENT
            snapshot: one population measured over a day against another measured at an
            instant. The page already knows they differ — a flip row whose pair is absent from
            the live snapshot renders an em dash reading "no longer published at this venue",
            and every such pair is in N and cannot be in M. The published set is capped at 50
            while 59 contracts clear the floor, so the rank-50 boundary is crossed by ordinary
            open-interest moves and pairs leave the denominator mid-window. On a broad reversal
            day that prints N greater than M, which is the impossible-looking figure the
            denominator was added to prevent. The ordered CTE is every row in the window,
            flipped or not, so the population is one DISTINCT away and needs no second query.
            NOTE the comment rule two blocks up applies to backticks as well as apostrophes:
            this SQL lives in a template literal, so a backtick here ends the statement and
            TypeScript reports a missing name twenty lines away. */
         SELECT symbol, venue, prevApr, apr, at, gapMin,
                (SELECT count(*) FROM latest) AS total,
                (SELECT count(*) FROM (SELECT DISTINCT symbol, venue FROM ordered)) AS legs
         FROM latest
         /* Tie-break specified, not inherited. One snapshot stamps every pair with the same
            at, so simultaneous flips are the common case and ORDER BY at DESC alone left their
            order to the engine — which is how the incremental feed and this query came back
            with two rows transposed under identical timestamps. Note the collation: this is
            BINARY by default, so LTC precedes kBONK, and flip-events.ts compares by codepoint
            to match rather than using localeCompare, which orders them the other way. */
         ORDER BY at DESC, symbol ASC, venue ASC
         LIMIT 25`,
      )
      .bind(cutoff)
      .all<Flip & { total: number; legs: number }>();

    const rows = results ?? [];
    return { status: "ready", rows, since, total: Number(rows[0]?.total ?? rows.length), legs: Number(rows[0]?.legs ?? 0) };
  } catch (e) {
    /* SAY WHY, THEN DEGRADE. This was a bare `catch` returning no-store, which is the correct
       READER behaviour and was the wrong DIAGNOSTIC behaviour: a query that threw on every
       call looked exactly like a database with nothing in it. It cost three rounds of guessing
       on an apostrophe in a SQL comment, because the only visible symptom was a feed that had
       gone quiet. The reader still gets the same graceful empty state; the operator now gets
       the reason, in `wrangler tail` and in any local run. */
    console.warn("readFlips failed, degrading to no-store:", e instanceof Error ? e.message : e);
    return { status: "no-store" };
  }
}

/**
 * EVERY flip event in the window — not deduped, not truncated.
 *
 * The incremental detector accumulates events from the pass it starts on, so on a cold start it
 * would under-report for 24 hours: the feed would show what it had seen rather than what
 * happened. This is the one-time bootstrap that makes the handover exact, and it is the same
 * `flips` CTE the feed query uses, without the rn = 1 dedupe and without the LIMIT, because the
 * event list holds events and the dedupe belongs to the presentation.
 *
 * Run once, when the event list is absent. Expensive by design and cheap by frequency.
 */
export async function readFlipEvents(db: D1Like | undefined, hours = 24, now = Date.now()): Promise<Flip[]> {
  if (!db) return [];
  try {
    const { results } = await db
      .prepare(
        `WITH ordered AS (
           SELECT symbol, venue, apr, at,
                  LAG(apr) OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_apr,
                  LAG(at)  OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_at
           FROM funding_snapshot
           WHERE at >= ?1
         )
         SELECT symbol, venue, prev_apr AS prevApr, apr, at, CAST(ROUND((at - prev_at) / 60000.0) AS INTEGER) AS gapMin
         FROM ordered
         WHERE prev_apr IS NOT NULL
           AND ((prev_apr < 0 AND apr >= 0) OR (prev_apr >= 0 AND apr < 0))
         ORDER BY at ASC`,
      )
      .bind(now - hours * 3_600_000)
      .all<Flip>();
    return results ?? [];
  } catch (e) {
    /* Same reasoning as readFlips: an empty bootstrap and a broken bootstrap are the same
       value, and only one of them is worth waking up for. */
    console.warn("readFlipEvents failed, degrading to an empty event list:", e instanceof Error ? e.message : e);
    return [];
  }
}

/* =========================================================================================
   THE SAME ANSWER, COMPUTED ONCE PER SNAPSHOT INSTEAD OF ONCE PER READER.

   readFlips above is a windowed scan with two window functions over every funding_snapshot
   row in the trailing 24 hours. It ran on EVERY uncached homepage render, and the meter is
   what exposed the size of that: 64.5 million D1 rows read per day, against a table holding
   83,808 rows and a site receiving two clicks a week. Roughly 43,200 rows per homepage
   render — the whole window, every time — for an answer that changes only when the cron
   writes a new snapshot, which is once every five minutes.

   Nothing about it was wrong. It was correct, indexed, and bounded. It was simply being asked
   the same question by every reader, and D1 bills rows read, so it was the one cost line on
   this project that scaled with traffic. That mattered more than its size: the whole point of
   the current work is to increase traffic, so the cheap line was the one that would stop being
   cheap precisely when the work succeeded.

   The computation is unchanged and still lives in readFlips — the WORKER calls it once per
   ingest pass and stores the result. Pages read the stored result. Same rows, same ordering,
   same dedupe, because it is the same function and the same SQL producing them.
   ========================================================================================= */

/** What the worker stores. The result plus when it was computed, so staleness is observable. */
export interface CachedFlips {
  computedAt: number;
  result: FlipsResult;
}

export const FLIPS_KEY = "flips:24h";

/** Anything older than this is not shown. Two ingest passes; a third missed one is a fault. */
export const FLIPS_MAX_AGE_MS = 20 * 60 * 1000;

export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/**
 * Read the precomputed feed. Deliberately does NOT fall back to the D1 query: a fallback would
 * reintroduce the per-render scan exactly when something is already wrong, and would hide the
 * fault by continuing to look correct. "warming" is a state this page already renders honestly,
 * and /status reports the age so a stalled worker is visible rather than silently absorbed.
 */
export async function readCachedFlips(kv: KVLike | undefined): Promise<FlipsResult> {
  if (!kv) return { status: "no-store" };
  let cached: CachedFlips | null = null;
  try {
    cached = (await kv.get(FLIPS_KEY, "json")) as CachedFlips | null;
  } catch {
    return { status: "no-store" };
  }
  if (!cached || typeof cached.computedAt !== "number" || !cached.result) {
    return { status: "warming", since: 0, hours: 0 };
  }
  if (Date.now() - cached.computedAt > FLIPS_MAX_AGE_MS) {
    /* Stale is not the same as missing, and printing a day-old event feed as current would be
       the exact defect this codebase keeps finding elsewhere. Report it as what it is. */
    const since = cached.result.status === "ready" ? cached.result.since : 0;
    return { status: "stale", since, computedAt: cached.computedAt };
  }
  return cached.result;
}

/** Written by the ingest worker, once per pass. */
export async function writeCachedFlips(kv: KVLike, result: FlipsResult, now: number): Promise<void> {
  await kv.put(FLIPS_KEY, JSON.stringify({ computedAt: now, result } satisfies CachedFlips));
}

export function describeCoverage(r: FlipsResult): string {
  if (r.status === "stale") {
    return `The flip feed is computed once per ingest pass and has not been rewritten since ${new Date(r.computedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. That is a stalled ingest rather than a gap in the history.`;
  }
  if (r.status === "no-store") {
    return "The flip feed reads the funding-history database, and it is not answering here.";
  }
  if (r.status === "warming") {
    if (!r.since) return "Collecting funding snapshots now. The first flips appear once 24 hours of history exist.";
    const h = Math.floor(r.hours);
    return `Collecting funding snapshots since ${new Date(r.since).toISOString().slice(0, 16).replace("T", " ")} UTC — ${h} hour${h === 1 ? "" : "s"} of history so far. Flips are reported once the window covers 24 hours, so that "no flips" means no flips rather than no data.`;
  }
  return "";
}
