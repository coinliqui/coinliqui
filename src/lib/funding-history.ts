/* =========================================================================================
   WHAT FUNDING TOOK FROM A LONG, OVER EVERYTHING THIS SITE HAS STORED.

   The worker keeps Hyperliquid's settled hourly funding per contract, merged forward and deepened
   backward, up to 5,200 hours — about seven months (src/lib/candles.ts, mergeFunding). Summed, that
   series is what a long position of CONSTANT DOLLAR SIZE paid in funding, as a share of its size:
   each hour it pays size × rate, so over N hours it pays size × Σrate. Set beside the price change
   over the same span, it answers the question a rate never does: how much of the move did the
   position keep.

   WHAT IS APPROXIMATED, and printed on the page:
   - constant dollar size. A position of fixed COIN size pays on a notional that moves with price;
     the sum here is per dollar held throughout, which is what the rate itself is quoted in.
   - "price change less funding" subtracts a sum taken at constant size from a buy-and-hold price
     change. It is the order of magnitude of what funding cost the long, not a backtest of one.
   - the price span runs from the open of the first stored day to the newest daily close.
   ========================================================================================= */
import { getFunding, type Candle, type FundingPoint } from "./candles.ts";
import { HL_BASE_HOURLY } from "./funding-paid.ts";

const DAY = 86_400_000;

export interface HistoryRow {
  symbol: string;
  from: number;
  to: number;
  hours: number;
  /** Σ hourly rate: what a long of constant size paid, as a fraction of its size. Negative: it was paid. */
  paid: number;
  /** The same hours at the base rate alone. */
  base: number;
  /** Share of hours that settled at exactly the base rate. */
  atBase: number;
  /** Share of hours with a negative rate: shorts paid longs. */
  shortsHours: number;
  /** Open of the first stored day to the newest close, or NaN when the candles do not reach. */
  price: number;
  /** The longest run of consecutive settled hours in which shorts paid, and the hour it ended. A gap
   *  in the series ends a run: hours that were not stored are not assumed to have continued it. */
  shortsRun: number;
  shortsRunEnd: number;
  /** The single hour with the largest rate either way, and when. */
  steepest: number;
  steepestAt: number;
}

export function fundingHistory(symbol: string, rates: readonly FundingPoint[] | null, candles: readonly Candle[] | null): HistoryRow | null {
  const r = (rates ?? []).filter(([, v]) => Number.isFinite(v));
  if (r.length < 24) return null;
  const from = r[0][0], to = r[r.length - 1][0];
  let paid = 0, atBase = 0, neg = 0, run = 0, shortsRun = 0, shortsRunEnd = NaN, steepest = 0, steepestAt = NaN;
  for (let i = 0; i < r.length; i++) {
    const [t, v] = r[i];
    paid += v;
    if (Math.abs(v - HL_BASE_HOURLY) < 1e-12) atBase++;
    if (v < 0) {
      neg++;
      const joined = i > 0 && r[i - 1][1] < 0 && t - r[i - 1][0] < 1.5 * 3_600_000;
      run = joined ? run + 1 : 1;
      if (run > shortsRun) { shortsRun = run; shortsRunEnd = t; }
    } else run = 0;
    if (Math.abs(v) > Math.abs(steepest)) { steepest = v; steepestAt = t; }
  }
  let price = NaN;
  if (candles?.length) {
    const d0 = Math.floor(from / DAY) * DAY;
    const first = candles.find((c) => c[0] >= d0);
    const last = candles[candles.length - 1];
    /* Only when the candles reach back to the funding series' first day: a price change over a
       shorter span set beside funding over a longer one would compare two different holds. */
    if (first && first[0] - d0 < DAY && Number.isFinite(first[1]) && first[1] > 0 && Number.isFinite(last[4])) {
      price = last[4] / first[1] - 1;
    }
  }
  return {
    symbol, from, to, hours: r.length, paid, base: r.length * HL_BASE_HOURLY,
    atBase: atBase / r.length, shortsHours: neg / r.length, price,
    shortsRun, shortsRunEnd, steepest, steepestAt,
  };
}

export const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The newest settled hour across the given contracts: the page's dateModified, and so the sitemap's
 * lastmod. One KV read per contract, the same reads the page makes.
 */
export async function historyStamp(kv: Parameters<typeof getFunding>[0], symbols: readonly string[]): Promise<string | undefined> {
  const series = await Promise.all(symbols.map((s) => getFunding(kv, s, import.meta.env.DEV)));
  const newest = Math.max(...series.map((r) => (r?.length ? r[r.length - 1][0] : -Infinity)));
  return Number.isFinite(newest) ? new Date(Math.floor(newest / 3_600_000) * 3_600_000).toISOString() : undefined;
}
