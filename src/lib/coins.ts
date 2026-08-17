import type { Candle } from "./candles.ts";

/* =========================================================================================
   COINS — the spot layer, and why it comes from Coinbase.

   The question "what is the bitcoin price" has one honest answer and it is a SPOT price. The
   options, all measured rather than assumed:

     Hyperliquid spot        REJECTED. There is no BTC/USDC market. The entire HL spot book is
                             324 pairs turning over about $60M a day, dominated by HIP-1
                             tokens; the only major-adjacent listings are Unit-bridged
                             wrappers (UBTC, UETH, USOL) that do not reach the top twelve by
                             volume. A "bitcoin price" taken from there would be a wrapper's
                             price on a thin venue.

     Hyperliquid oraclePx    KEPT, but as a cross-check rather than the headline. It is HL's
                             own published index — a validator-computed median across major
                             spot venues — so it is Hyperliquid data and attributable to
                             Hyperliquid. It is an index, though, not a traded price, and
                             nobody can hit it.

     Binance / Bybit         Unreachable from Cloudflare's egress. Not a licensing question.

     OKX                     Reachable, but its API agreement forbids displaying the data.
                             Internal fallback only, never attributed, never rendered.

     CoinGecko free tier     Non-commercial use only.

     Coinbase Exchange       CHOSEN. A real USD order book with a real bid and ask, free, no
                             key, no rate-limit tier to buy, display permitted with
                             attribution, and reachable from Workers. 397 online USD pairs
                             cover 40 of the 50 contracts this site already carries. One call
                             to /products/stats returns 24-hour open/high/low/last/volume for
                             every product at once, which is a single subrequest per tick.

   So: the price is Coinbase spot, the chart is Coinbase spot candles, and Hyperliquid supplies
   the derivatives layer beside it. THE GAP BETWEEN THE TWO IS THE POINT — a spot price next to
   the perpetual mark, the basis in basis points, and what the funding rate costs to hold. That
   is the part a price table does not have, and it is why these pages exist.
   ========================================================================================= */

const CB = "https://api.exchange.coinbase.com";
export const SPOT_SOURCE = "Coinbase Exchange";

export interface Coin {
  /** URL slug — the full name, because that is what people search. */
  slug: string;
  name: string;
  /** Hyperliquid perp symbol, for the derivatives layer. */
  symbol: string;
  /** Coinbase product id. */
  product: string;
  /** One line on what the asset is, so the page is not purely numeric. */
  blurb: string;
  /**
   * PUBLICATION DATE, and the reason it exists: no more than 25-30 new URLs a week. Twenty-five
   * contract pages went live on 14 August, so only the hub and four coins can follow this week.
   * A coin is absent from the sitemap, unlinked from the hub and 404s until its date passes —
   * the rate limit is enforced by the code rather than remembered by a person.
   */
  publishAt: string;
}

export const COINS: Coin[] = [
  { slug: "bitcoin", name: "Bitcoin", symbol: "BTC", product: "BTC-USD", publishAt: "2026-08-14",
    blurb: "The first and largest cryptocurrency, and the one whose derivatives market sets the tone for every other." },
  { slug: "ethereum", name: "Ethereum", symbol: "ETH", product: "ETH-USD", publishAt: "2026-08-14",
    blurb: "The largest smart-contract platform, and the second-largest perpetual market by open interest." },
  { slug: "solana", name: "Solana", symbol: "SOL", product: "SOL-USD", publishAt: "2026-08-14",
    blurb: "A high-throughput layer-1 whose perpetual funding is among the most volatile of the majors." },
  { slug: "xrp", name: "XRP", symbol: "XRP", product: "XRP-USD", publishAt: "2026-08-14",
    blurb: "A payment-focused asset with a large retail spot base and comparatively small open interest." },
  { slug: "bnb", name: "BNB", symbol: "BNB", product: "BNB-USD", publishAt: "2026-08-17",
    blurb: "The BNB Chain asset, listed here because its perpetual funding rarely matches its spot demand." },
  { slug: "dogecoin", name: "Dogecoin", symbol: "DOGE", product: "DOGE-USD", publishAt: "2026-08-17",
    blurb: "The original memecoin, and a reliable example of funding running far ahead of spot." },
  { slug: "cardano", name: "Cardano", symbol: "ADA", product: "ADA-USD", publishAt: "2026-08-17",
    blurb: "A research-led layer-1 with deep spot liquidity relative to its open interest." },
  { slug: "avalanche", name: "Avalanche", symbol: "AVAX", product: "AVAX-USD", publishAt: "2026-08-17",
    blurb: "A layer-1 with a subnet architecture, and one of the smaller major perpetual markets by open interest." },
  { slug: "chainlink", name: "Chainlink", symbol: "LINK", product: "LINK-USD", publishAt: "2026-08-17",
    blurb: "The dominant oracle network, whose token trades with unusually persistent positive funding." },
  { slug: "litecoin", name: "Litecoin", symbol: "LTC", product: "LTC-USD", publishAt: "2026-08-17",
    blurb: "One of the oldest altcoins, with a long, clean price history and a modest derivatives market." },
];

/** Live if its publication date has passed. Compared in UTC, on date alone. */
export const isLive = (c: Coin, now = Date.now()) => Date.parse(c.publishAt + "T00:00:00Z") <= now;
export const liveCoins = (now = Date.now()) => COINS.filter((c) => isLive(c, now));
export const findCoin = (slug: string | undefined) =>
  slug ? COINS.find((c) => c.slug === slug.toLowerCase()) : undefined;

export interface SpotQuote {
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  /** Base units traded in the last 24 hours, NOT notional. */
  volume24h: number;
}
export interface SpotSet {
  at: number;
  q: Record<string, SpotQuote>;
}

const num = (x: unknown) => (typeof x === "string" || typeof x === "number" ? Number(x) : NaN);

/**
 * Every coin's 24-hour stats in ONE upstream call.
 *
 * /products/stats returns the whole exchange, which is more than is needed but costs a single
 * subrequest — against ten if each product were fetched separately. On a five-minute tick that
 * is the difference between an affordable spot layer and an unaffordable one.
 */
export async function fetchSpot(): Promise<SpotSet> {
  /* ONE BOUNDED RETRY, for the same reason hyperliquid.ts info() has one — and it should have
   * been added at the same time. Measured over the 5.3 hours since the minute tick began
   * recording every attempt: 303 ticks fired, 49 failed, and every single failure was
   * `coinbase 429`. The Hyperliquid leg failed zero times in the same 303. So the entire
   * failure rate of the one-minute path was this call, unretried, and /data-sources' "1 min"
   * for spot price was being delivered 80% of the time while funding and mark were at 95%.
   *
   * Coinbase rate-limits per IP and Workers egress from shared addresses, so a tick can be
   * refused for traffic that is not ours — the same shape as the Hyperliquid 429s that the
   * cron phase shift fixed. A second attempt 1.2s later is a different second of that budget.
   *
   * Whether this actually moves the number is a HYPOTHESIS until an hour of post-deploy data
   * exists; `npm run cadence` reports the spot leg separately now precisely so it can be
   * answered rather than assumed. */
  const send = () => fetch(`${CB}/products/stats`, { headers: { "user-agent": "coinliqui.com" } });
  let r = await send();
  if (r.status === 429 || r.status === 502) {
    await new Promise((res) => setTimeout(res, 1200));
    r = await send();
  }
  if (!r.ok) throw new Error(`coinbase ${r.status}`);
  const all = (await r.json()) as Record<string, { stats_24hour?: Record<string, string> }>;
  const q: Record<string, SpotQuote> = {};
  for (const c of COINS) {
    const s = all[c.product]?.stats_24hour;
    if (!s) continue;
    const last = num(s.last);
    if (!Number.isFinite(last)) continue;
    q[c.symbol] = { last, open24h: num(s.open), high24h: num(s.high), low24h: num(s.low), volume24h: num(s.volume) };
  }
  return { at: Date.now(), q };
}

/**
 * Spot candles. Coinbase caps a response at 300 candles, so the two granularities fetched
 * here are the two the site aggregates from — hourly for 1H/4H, daily for 1D/1W — exactly as
 * the perpetual series does. Returned oldest-first to match the rest of the codebase; Coinbase
 * serves newest-first.
 */
export async function fetchSpotCandles(product: string, granularity: 3600 | 86400): Promise<Candle[]> {
  const r = await fetch(`${CB}/products/${product}/candles?granularity=${granularity}`, {
    headers: { "user-agent": "coinliqui.com" },
  });
  if (!r.ok) throw new Error(`coinbase candles ${r.status}`);
  const rows = (await r.json()) as number[][];
  // Coinbase order is [time, low, high, open, close, volume]; ours is [t, o, h, l, c, v].
  return rows
    .map((x) => [x[0] * 1000, x[3], x[2], x[1], x[4], x[5]] as Candle)
    .filter((c) => c.every(Number.isFinite))
    .sort((a, b) => a[0] - b[0]);
}

export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export async function getSpot(kv: KVLike | undefined, devReadThrough = false): Promise<SpotSet | null> {
  try {
    const v = (await kv?.get("spot", "json")) as SpotSet | null;
    if (v?.q && Object.keys(v.q).length) return v;
  } catch { /* fall through */ }
  if (!devReadThrough) return null;
  try { return await fetchSpot(); } catch { return null; }
}

export async function getSpotCandles(
  kv: KVLike | undefined,
  symbol: string,
  kind: "h" | "d",
  devReadThrough = false,
): Promise<Candle[] | null> {
  try {
    const v = (await kv?.get(`cb${kind}:${symbol}`, "json")) as Candle[] | null;
    if (v?.length) return v;
  } catch { /* fall through */ }
  if (!devReadThrough) return null;
  const c = COINS.find((x) => x.symbol === symbol);
  if (!c) return null;
  try { return await fetchSpotCandles(c.product, kind === "h" ? 3600 : 86400); } catch { return null; }
}

/**
 * The basis: how far the perpetual trades from spot, in basis points.
 *
 * Positive means the perpetual is richer than spot — longs are paying for leverage, and the
 * funding rate is the mechanism that pulls it back. This is the number that connects the two
 * halves of the site, and it is why a spot price here is worth more than a spot price anywhere
 * else: nobody prints it next to the funding that settles it.
 */
export const basisBps = (mark: number, spot: number) =>
  Number.isFinite(mark) && Number.isFinite(spot) && spot > 0 ? (mark / spot - 1) * 10_000 : NaN;
