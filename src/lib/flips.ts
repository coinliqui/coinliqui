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
  | { status: "ready"; rows: Flip[]; since: number; total: number }
  | { status: "no-store" }
  | { status: "warming"; since: number; hours: number };

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
                  (at - prev_at) / 60000 AS gapMin,
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
         SELECT symbol, venue, prevApr, apr, at, gapMin,
                (SELECT count(*) FROM latest) AS total
         FROM latest
         ORDER BY at DESC
         LIMIT 25`,
      )
      .bind(cutoff)
      .all<Flip & { total: number }>();

    const rows = results ?? [];
    return { status: "ready", rows, since, total: Number(rows[0]?.total ?? rows.length) };
  } catch {
    return { status: "no-store" };
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
    return { status: "warming", since, hours: 0 };
  }
  return cached.result;
}

/** Written by the ingest worker, once per pass. */
export async function writeCachedFlips(kv: KVLike, result: FlipsResult, now: number): Promise<void> {
  await kv.put(FLIPS_KEY, JSON.stringify({ computedAt: now, result } satisfies CachedFlips));
}

export function describeCoverage(r: FlipsResult): string {
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
