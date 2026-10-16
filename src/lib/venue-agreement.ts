/* =========================================================================================
   HOW OFTEN TWO VENUES DISAGREED ABOUT WHO PAYS.

   /funding prints each venue's rate now. What no page prints is how often, over a month, the
   venues pointed in OPPOSITE directions on the same contract in the same hour — longs paying on
   Hyperliquid while shorts paid on Binance. That is what a cross-venue funding trade lives on,
   and it is a property of a month, not of a moment.

   THE READING: funding_snapshot holds the rate each venue was quoting, every five minutes, for
   30 days. Averaged per contract, per venue, per hour, then each Binance and Bybit hour is set
   against Hyperliquid's for the same hour. Opposite signs are a disagreement; a zero on either
   side is not counted as one. The mean absolute gap between the two annualised rates rides along.

   PRECOMPUTED ONCE A DAY by the worker (worker/venue-agreement.ts), because the query reads about
   three million rows: fine once a day, not on every page view. Pages read one KV key.
   ========================================================================================= */

export const VENUE_AGREE_KEY = "venues:agree";

/** [symbol, venue, hours compared, hours with opposite signs, mean |APR gap|] */
export type AgreeRow = [string, string, number, number, number];

export interface VenueAgreement {
  v: 1;
  /** When the record was computed; the window ends here. */
  at: number;
  /** When the last attempt ran, successful or not: the cadence is read from this. */
  attemptAt: number;
  /** The earliest hour the comparison holds. */
  from: number;
  rows: AgreeRow[];
  error?: string;
}

export async function getVenueAgreement(kv: { get(key: string, type: "json"): Promise<unknown> } | undefined): Promise<VenueAgreement | null> {
  if (!kv) return null;
  try {
    const v = (await kv.get(VENUE_AGREE_KEY, "json")) as VenueAgreement | null;
    return v && v.v === 1 && Array.isArray(v.rows) && v.rows.length ? v : null;
  } catch {
    return null;
  }
}

/** One contract's rows, by venue. */
export function agreementFor(a: VenueAgreement | null, symbol: string): { venue: string; hours: number; opposite: number; gap: number }[] {
  return (a?.rows ?? [])
    .filter((r) => r[0] === symbol && r[2] > 0)
    .map(([, venue, hours, opposite, gap]) => ({ venue, hours, opposite, gap }));
}
