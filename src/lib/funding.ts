/**
 * Funding-rate normalisation.
 *
 * Venues quote funding per settlement interval, and the intervals differ:
 * Hyperliquid settles hourly, Binance and Bybit every 8h (4h in some regimes).
 * Comparing the raw numbers side by side is arithmetically wrong — it makes the
 * venue with the shorter interval look cheaper by exactly the interval ratio.
 *
 * Worked example, real values observed 2026-08-14:
 *   Hyperliquid 0.0000125 per 1h  -> 0.0000125 * 8760 = 10.95% APR
 *   Binance     0.00005   per 4h  -> 0.00005   * 2190 = 10.95% APR
 * Identical cost of carry; the raw figures differ 4x.
 */

export const HOURS_PER_YEAR = 24 * 365; // 8760

export type Venue = "HlPerp" | "BinPerp" | "BybitPerp";

export const VENUE_LABEL: Record<Venue, string> = {
  HlPerp: "Hyperliquid",
  BinPerp: "Binance",
  BybitPerp: "Bybit",
};

export interface VenueFunding {
  venue: Venue;
  /** Raw rate per settlement interval, as quoted by the venue. */
  rate: number;
  /** Settlement interval in hours. */
  intervalHours: number;
  /** Annualised, simple (not compounded). */
  apr: number;
  nextFundingTime: number | null;
}

/** Annualise a per-interval funding rate. Simple annualisation, no compounding. */
export function toApr(ratePerInterval: number, intervalHours: number): number {
  if (!Number.isFinite(ratePerInterval) || !Number.isFinite(intervalHours) || intervalHours <= 0) {
    return NaN;
  }
  return ratePerInterval * (HOURS_PER_YEAR / intervalHours);
}

/** Settlements per year for a given interval. */
export function settlementsPerYear(intervalHours: number): number {
  return HOURS_PER_YEAR / intervalHours;
}

/**
 * Spread between the most expensive and cheapest venue, in APR percentage points.
 * This is the number the product exists to show: it is only meaningful after
 * normalisation, which is why nobody else displays it correctly.
 */
export function aprSpread(venues: VenueFunding[]): number | null {
  const aprs = venues.map((v) => v.apr).filter(Number.isFinite);
  if (aprs.length < 2) return null;
  return Math.max(...aprs) - Math.min(...aprs);
}

/** Cost of holding a notional position for N days at a given APR. Sign follows the APR. */
export function carryCost(notionalUsd: number, apr: number, days: number): number {
  return notionalUsd * apr * (days / 365);
}

/** Format a rate as a percentage string with a fixed number of decimals. */
export function pct(x: number, decimals = 2): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

/** Format a raw per-interval rate, which is a very small number. */
export function rawRate(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Colour carries exactly ONE meaning across the whole product: which side pays.
 * Positive funding means longs pay shorts; negative means shorts pay longs. Nothing else —
 * price change, venue spread, open interest, volume — is ever tinted, because tinting a
 * neutral quantity implies a judgement the data does not support.
 */
export const paysClass = (apr: number) => (apr >= 0 ? "pays-l" : "pays-s");
export const paysLabel = (apr: number) => (apr >= 0 ? "longs pay shorts" : "shorts pay longs");
export const paysArrow = (apr: number) => (apr >= 0 ? "▲" : "▼");
export const LEGEND = "▲ longs pay shorts · ▼ shorts pay longs";

export function usd(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3 && decimals === 0) return `$${Math.round(x).toLocaleString("en-US")}`;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
