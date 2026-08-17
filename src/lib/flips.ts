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
}

export type FlipsResult =
  | { status: "ready"; rows: Flip[]; since: number }
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
export async function readFlips(db: D1Like | undefined, hours = 24): Promise<FlipsResult> {
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

    const covered = (Date.now() - since) / 3_600_000;
    if (covered < hours) return { status: "warming", since, hours: covered };

    const cutoff = Date.now() - hours * 3_600_000;
    const { results } = await db
      .prepare(
        `WITH ordered AS (
           SELECT symbol, venue, apr, at,
                  LAG(apr) OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_apr
           FROM funding_snapshot
           WHERE at >= ?1
         )
         , flips AS (
           SELECT symbol, venue, prev_apr AS prevApr, apr, at,
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
         SELECT symbol, venue, prevApr, apr, at
         FROM flips
         WHERE rn = 1
         ORDER BY at DESC
         LIMIT 25`,
      )
      .bind(cutoff)
      .all<Flip>();

    return { status: "ready", rows: results ?? [], since };
  } catch {
    return { status: "no-store" };
  }
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
