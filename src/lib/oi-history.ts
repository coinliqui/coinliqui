/* =========================================================================================
   WHAT OPEN INTEREST HAS DONE, WHICH THIS SITE COULD NOT SAY UNTIL IT STARTED KEEPING IT.

   Every aggregator in this space leads with "OI Change 1h / 4h / 24h", and it was the most
   visible thing coinliqui did not show. Not because the arithmetic is hard: because the reading
   was never stored. funding_snapshot keeps a rate and nothing else, so the site could state what
   open interest IS and never what it had done — and a delta cannot be backfilled. It exists only
   if somebody kept yesterday.

   THE ANSWER IS A STATE, NOT A NUMBER, and that is the whole design. For the first day after the
   table is created there is no 24-hour comparison to make, and the honest output is "collecting",
   not zero and not a blank. A site whose argument is that it says how old every figure is cannot
   print a change of 0.00% because it has nothing to subtract from.
   ========================================================================================= */
import type { D1Like } from "./flips.ts";

export type OiHistory =
  /** A comparison exists: `change` holds the fractional move per symbol over `hours`. */
  | { status: "ready"; hours: number; since: number; change: Map<string, number> }
  /** The table exists but does not reach back far enough yet. `covered` is what it does hold. */
  | { status: "warming"; hours: number; covered: number }
  /** No binding, no table, or the query failed. Says nothing rather than guessing. */
  | { status: "no-store" };

/**
 * The reading nearest to `hours` ago, per symbol, compared with what is on the page now.
 *
 * TAKEN FROM A BAND, NOT FROM AN EXACT TIMESTAMP. The writer stores on the first tick of each
 * hour and a missed tick skips one, so asking for exactly 24h ago would find nothing on any day
 * the worker hiccuped. The band reaches three hours further back and the newest row inside it
 * wins, which is the same "nearest earlier reading" rule the freshness clock uses everywhere
 * else on this site.
 *
 * THE WINDOW IT ACTUALLY USED IS RETURNED, because a delta labelled "24h" that was measured over
 * 26 is the defect this codebase keeps finding — a label asserting what the expression did not
 * compute. The caller prints `since`, not the number it asked for.
 */
export async function readOiHistory(
  db: D1Like | undefined,
  now: number,
  hours = 24,
  bandHours = 3,
): Promise<OiHistory> {
  if (!db) return { status: "no-store" };
  const cutoff = now - hours * 3_600_000;
  try {
    const oldest = await db
      .prepare("SELECT MIN(at) AS a FROM oi_snapshot")
      .first<{ a: number | null }>();
    if (!oldest?.a) return { status: "warming", hours, covered: 0 };
    if (oldest.a > cutoff) {
      return { status: "warming", hours, covered: (now - oldest.a) / 3_600_000 };
    }

    const { results } = await db
      .prepare(
        `SELECT symbol, oi, at FROM oi_snapshot
         WHERE at <= ?1 AND at >= ?2
         ORDER BY at DESC`,
      )
      .bind(cutoff, cutoff - bandHours * 3_600_000)
      .all<{ symbol: string; oi: number; at: number }>();

    const then = new Map<string, { oi: number; at: number }>();
    for (const r of results ?? []) {
      /* Rows arrive newest first, so the first sighting of a symbol is the nearest earlier
         reading and every later one is older. */
      if (!then.has(r.symbol) && Number.isFinite(r.oi) && r.oi > 0) then.set(r.symbol, r);
    }
    if (!then.size) return { status: "warming", hours, covered: (now - oldest.a) / 3_600_000 };

    const since = Math.max(...[...then.values()].map((v) => v.at));
    const change = new Map<string, number>();
    for (const [symbol, v] of then) change.set(symbol, v.oi);
    return { status: "ready", hours, since, change };
  } catch {
    /* SAY NOTHING RATHER THAN GUESS. A missing table on a database that has not run the migration
       yet reaches here, and the page must render without a delta column rather than 500. */
    return { status: "no-store" };
  }
}

/**
 * The fractional move from a stored reading to the live one.
 *
 * Returns null when there is nothing to compare, which the caller must render as an absence
 * rather than as zero: a contract listed since the stored reading has no history, and printing
 * "0.00%" for it would be a claim that it had not moved.
 */
export function oiChange(history: OiHistory, symbol: string, nowOi: number): number | null {
  if (history.status !== "ready") return null;
  const before = history.change.get(symbol);
  if (!Number.isFinite(before) || !(before! > 0) || !Number.isFinite(nowOi)) return null;
  return nowOi / before! - 1;
}

/**
 * ONE CONTRACT'S OPEN INTEREST AT A MOMENT: the nearest hourly reading at or before `at`, no older
 * than `bandHours` before it, with the time it was actually read. The liquidation map's day-ago run
 * sizes its positions with it and prints that time, so a reading taken three hours off is said to be.
 * Null on any absence — the caller shows no change rather than an invented one.
 */
export async function readOiAt(db: D1Like | undefined, symbol: string, at: number, bandHours = 3): Promise<{ oi: number; at: number } | null> {
  if (!db) return null;
  try {
    const r = await db
      .prepare("SELECT oi, at FROM oi_snapshot WHERE symbol = ?1 AND at <= ?2 AND at >= ?3 ORDER BY at DESC LIMIT 1")
      .bind(symbol, at, at - bandHours * 3_600_000)
      .first<{ oi: number; at: number }>();
    return r && Number.isFinite(r.oi) && r.oi > 0 ? { oi: r.oi, at: r.at } : null;
  } catch {
    return null;
  }
}

/**
 * OPEN INTEREST OVER TIME, per contract, in fixed buckets — one aggregating query, so a page reads a
 * few thousand rows rather than every hourly reading of thirty days. A bucket a contract has no
 * reading in is NaN, never zero: an absent reading is not a book that emptied.
 */
export interface OiSeries { buckets: number[]; bySymbol: Map<string, number[]> }
export async function readOiSeries(db: D1Like | undefined, now: number, days = 30, bucketHours = 4): Promise<OiSeries | null> {
  if (!db) return null;
  const step = bucketHours * 3_600_000;
  const first = Math.floor((now - days * 86_400_000) / step) + 1;
  const last = Math.floor(now / step);
  try {
    const { results } = await db
      .prepare("SELECT symbol, CAST(at / ?1 AS INTEGER) AS b, AVG(oi) AS oi FROM oi_snapshot WHERE at >= ?2 GROUP BY symbol, b")
      .bind(step, first * step)
      .all<{ symbol: string; b: number; oi: number }>();
    const buckets = Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
    const bySymbol = new Map<string, number[]>();
    for (const r of results ?? []) {
      const i = r.b - first;
      if (i < 0 || i >= buckets.length || !(r.oi > 0)) continue;
      if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, buckets.map(() => NaN));
      bySymbol.get(r.symbol)![i] = r.oi;
    }
    return bySymbol.size ? { buckets, bySymbol } : null;
  } catch {
    return null;
  }
}
