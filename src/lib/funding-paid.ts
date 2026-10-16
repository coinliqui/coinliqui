/* =========================================================================================
   FUNDING PAID: HOW MUCH MONEY MOVED BETWEEN LONGS AND SHORTS ON HYPERLIQUID.

   Every funding page in this space prints a RATE. None of them prints what the rate cost in
   dollars, summed over the book, because that needs two series nobody publishes together: the
   settled hourly rate, which Hyperliquid serves (fundingHistory), and open interest at each of
   those hours, which nobody serves — this site has kept it hourly since 16 September 2026
   (migrations/0003_oi_snapshot.sql). Multiplying them is the whole method.

   THE PAYMENT, AS HYPERLIQUID DEFINES IT (hyperliquid.gitbook.io, Trading > Funding, read
   16 October 2026): position_size × oracle_price × funding_rate, paid every hour. Summed over
   every position, position size is open interest — every long has a short on the other side, so
   open interest is one side's size, and what one side pays the other receives.

   WHAT IS APPROXIMATED, stated where it is used:
   - the notional is open interest × MARK price, read on the first tick of the hour, where the
     payment uses the ORACLE price at settlement. The two differ by the premium, which is what
     funding exists to close, and is a fraction of a percent outside a dislocation.
   - an hour counts only where BOTH readings exist. Nothing is interpolated: a missing hour is
     left out and counted, and the page prints the count beside every row.

   THE BASE RATE. Hyperliquid's rate is premium + clamp(interest − premium, ±0.05%) on an 8-hour
   basis, with interest fixed at 0.01% per 8 hours, paid hourly at one eighth. Whenever the premium
   sits inside the clamp the rate is exactly 0.00125% an hour, so longs pay shorts that amount on a
   quiet book. How much of the month's total is that fixed charge, and how much is the market, is
   the question this file exists to answer — measured on 16 October 2026 it was nearly all of it.
   ========================================================================================= */
import type { D1Like } from "./flips.ts";
import { getFunding, type FundingPoint } from "./candles.ts";

const HOUR = 3_600_000;
/** 0.01% per 8 hours, paid hourly at one eighth (Hyperliquid docs, Trading > Funding). */
export const HL_BASE_HOURLY = 0.0001 / 8;

export interface PaidRow {
  symbol: string;
  /** Longs paid shorts, in USD, summed over hours with a positive rate. */
  longsPaid: number;
  /** Shorts paid longs, in USD, summed over hours with a negative rate. */
  shortsPaid: number;
  /** longsPaid − shortsPaid. Positive: longs paid on balance. */
  net: number;
  /** What the same hours would have cost at the base rate alone. */
  base: number;
  /** Hours where both an open-interest reading and a settled rate were held. */
  hours: number;
  /** Of those, hours that settled at exactly the base rate. */
  baseHours: number;
}

export interface FundingPaid {
  from: number;
  to: number;
  /** Hours in the window, the denominator every row's `hours` is read against. */
  span: number;
  /** The newest hour any row joined: the settled rates lag the store by up to a refresh cycle,
   *  so this, not `to`, is the instant the figures are as of. */
  last: number;
  rows: PaidRow[];
  /** Contracts with open interest in the window and no hour that joined a settled rate: left out
   *  of every sum, and named, so the population is the one the page says it is. */
  unjoined: string[];
  longsPaid: number;
  shortsPaid: number;
  net: number;
  base: number;
  hours: number;
  baseHours: number;
}

/**
 * The arithmetic, with no I/O, so a fixture can hold it to account.
 *
 *   oi        rows of the hourly open-interest store: notional USD at `at`
 *   rates     settled hourly rates per symbol, [time, rate]
 *   from, to  the window, epoch ms; an hour counts when from <= hour < to
 */
export function fundingPaid(
  oi: readonly { symbol: string; oi: number; at: number }[],
  rates: ReadonlyMap<string, readonly FundingPoint[]>,
  from: number,
  to: number,
): FundingPaid {
  const h0 = Math.ceil(from / HOUR), h1 = Math.floor(to / HOUR);
  /* ONE READING PER SYMBOL PER HOUR, the first one. The writer stores on the first tick of the
     hour; a duplicate write (seen on 14 October, 06–13 UTC) must not count an hour twice. */
  const book = new Map<string, Map<number, number>>();
  for (const r of oi) {
    if (!Number.isFinite(r.oi) || r.oi <= 0) continue;
    const h = Math.floor(r.at / HOUR);
    if (h < h0 || h >= h1) continue;
    const m = book.get(r.symbol) ?? new Map<number, number>();
    if (!m.has(h)) m.set(h, r.oi);
    book.set(r.symbol, m);
  }
  const rows: PaidRow[] = [];
  let lastHour = -Infinity;
  const unjoined: string[] = [];
  for (const [symbol, hours] of book) {
    const rate = new Map<number, number>();
    for (const [t, v] of rates.get(symbol) ?? []) if (Number.isFinite(v)) rate.set(Math.floor(t / HOUR), v);
    const row: PaidRow = { symbol, longsPaid: 0, shortsPaid: 0, net: 0, base: 0, hours: 0, baseHours: 0 };
    let newest = -Infinity;
    for (const [h, notional] of hours) {
      const f = rate.get(h);
      if (f === undefined) continue;
      const paid = notional * f;
      if (paid > 0) row.longsPaid += paid; else row.shortsPaid -= paid;
      row.base += notional * HL_BASE_HOURLY;
      row.hours++;
      if (h > newest) newest = h;
      if (Math.abs(f - HL_BASE_HOURLY) < 1e-12) row.baseHours++;
    }
    if (!row.hours) { unjoined.push(symbol); continue; }
    if (newest > lastHour) lastHour = newest;
    row.net = row.longsPaid - row.shortsPaid;
    rows.push(row);
  }
  rows.sort((a, b) => b.longsPaid + b.shortsPaid - (a.longsPaid + a.shortsPaid));
  const sum = (k: "longsPaid" | "shortsPaid" | "base" | "hours" | "baseHours") => rows.reduce((s, r) => s + r[k], 0);
  const longsPaid = sum("longsPaid"), shortsPaid = sum("shortsPaid");
  return {
    from: h0 * HOUR, to: h1 * HOUR, span: h1 - h0, last: Number.isFinite(lastHour) ? lastHour * HOUR : NaN, rows, unjoined: unjoined.sort(),
    longsPaid, shortsPaid, net: longsPaid - shortsPaid,
    base: sum("base"), hours: sum("hours"), baseHours: sum("baseHours"),
  };
}

export type FundingPaidRead = { status: "ready"; paid: FundingPaid } | { status: "no-store" };

/**
 * The window is the open-interest store's own retention, 30 days back from `now`. The reads are
 * one D1 query and one KV read per symbol that query names, in parallel.
 */
export async function readFundingPaid(
  db: D1Like | undefined,
  kv: Parameters<typeof getFunding>[0],
  now: number,
  days = 30,
  devReadThrough = false,
): Promise<FundingPaidRead> {
  if (!db) return { status: "no-store" };
  const from = now - days * 24 * HOUR;
  try {
    const { results } = await db
      .prepare("SELECT symbol, oi, at FROM oi_snapshot WHERE at >= ?1")
      .bind(from)
      .all<{ symbol: string; oi: number; at: number }>();
    const oi = results ?? [];
    if (!oi.length) return { status: "no-store" };
    const symbols = [...new Set(oi.map((r) => r.symbol))];
    const series = await Promise.all(symbols.map((s) => getFunding(kv, s, devReadThrough)));
    const rates = new Map<string, FundingPoint[]>();
    symbols.forEach((s, i) => { if (series[i]) rates.set(s, series[i]!); });
    const paid = fundingPaid(oi, rates, from, now);
    return paid.rows.length ? { status: "ready", paid } : { status: "no-store" };
  } catch {
    /* SAY NOTHING RATHER THAN GUESS, as oi-history.ts does: the page renders its absence. */
    return { status: "no-store" };
  }
}
