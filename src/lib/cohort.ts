/* =========================================================================================
   WHERE ONE CONTRACT STANDS AMONG THE OTHERS, AND WHAT ITS OWN DAYS DID TO A LEVERAGE.

   WHY THIS FILE. Measured 19 October 2026 over every live page, prose only (tables and coin
   lists stripped), 6-word shingles: the sentences on /coins/{coin}, /funding/{symbol} and
   /liquidations/{symbol} were 83–91% the same from one contract to the next, with 76–167 words
   of each page its own. The figures differed; what the page SAID about them did not. A page that
   is a template with numbers poured in tells the reader nothing the numbers alone would not.

   Two readings here are specific to the contract by construction, and neither is padding:

   - Its place in the covered book: open interest, turnover, and whether its funding sits on
     Hyperliquid's base rate with most of the book or off it. "10.95%" means nothing until you
     know thirty-odd other contracts print the same figure.
   - What its own last thirty days would have done to each leverage: how many of those days a
     long opened at the day's open was closed before the day ended, read off the traded daily
     candles. The distance to liquidation is the same arithmetic on every coin; how often a
     coin's days cover that distance is not.

   Ties are counted, never broken: a rank among equal values is a fact about sort order, not
   about the market.
   ========================================================================================= */
import type { Perp } from "./hyperliquid.ts";
import type { Candle } from "./candles.ts";
import { HL_BASE_APR, isHlBaseApr, pct } from "./funding.ts";

/** "1st", "2nd", "23rd". */
export const ordinal = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
};

/** Position by a value, largest first, ties sharing the better place. null when the contract or its value is missing. */
export function placeBy(perps: readonly Perp[], symbol: string, value: (p: Perp) => number) {
  const own = perps.find((p) => p.symbol === symbol);
  if (!own) return null;
  const v = value(own);
  if (!Number.isFinite(v)) return null;
  const vals = perps.map(value).filter(Number.isFinite);
  const above = vals.filter((x) => x > v).length;
  const tied = vals.filter((x) => x === v).length - 1;
  return { place: above + 1, of: vals.length, tied };
}

/** "the largest", "the 3rd-largest", "the smallest" — with "(tied)" when another contract shares it. */
function placeWords(pl: { place: number; of: number; tied: number }, big: string, small: string) {
  const tie = pl.tied > 0 ? `, level with ${pl.tied === 1 ? "one other" : `${pl.tied} others`}` : "";
  if (pl.place === 1) return `the ${big}${tie}`;
  if (pl.place + pl.tied === pl.of) return `the ${small}${tie}`;
  return `the ${ordinal(pl.place)}-${big}${tie}`;
}

/**
 * The book sentence: how big the contract's open interest is among the covered ones, and how
 * fast it turns over against its own 24-hour volume compared with the rest.
 */
export function bookWords(perps: readonly Perp[], symbol: string): string | null {
  const oi = placeBy(perps, symbol, (p) => p.oiNotional);
  if (!oi || oi.of < 5) return null;
  const turn = placeBy(perps, symbol, (p) => (p.oiNotional > 0 && p.dayNtlVlm > 0 ? p.dayNtlVlm / p.oiNotional : NaN));
  const head = `${symbol} carries ${placeWords(oi, "largest", "smallest")} open interest of the ${oi.of} contracts covered here`;
  if (!turn) return `${head}.`;
  /* Turnover is volume over open interest: the higher it is, the more of the day's trading is
     churn against a book that stays put. Third by third, because a rank of 31 out of 56 is not
     something a reader can use and "middle third" is. */
  const third = turn.place <= turn.of / 3 ? "top" : turn.place > (2 * turn.of) / 3 ? "bottom" : "middle";
  const tail = third === "top"
    ? `, and its book churns faster than most: a day's volume against open interest puts it ${placeWords(turn, "highest", "lowest")} of ${turn.of}`
    : third === "bottom"
      ? `, and its book turns over slowly: a day's volume against open interest puts it ${placeWords(turn, "highest", "lowest")} of ${turn.of}`
      : `; a day's volume against its open interest sits in the middle third of the book, ${ordinal(turn.place)} of ${turn.of}`;
  return `${head}${tail}.`;
}

/**
 * The funding sentence, which is where a single number misleads most. Most of Hyperliquid's
 * book sits on the base rate, and a contract on it is not telling you which side is crowded.
 */
export function fundingStandingWords(perps: readonly Perp[], symbol: string): string | null {
  const own = perps.find((p) => p.symbol === symbol);
  if (!own || !Number.isFinite(own.hlApr)) return null;
  const rated = perps.filter((p) => Number.isFinite(p.hlApr));
  const n = rated.length;
  if (n < 5) return null;
  const onBase = rated.filter((p) => isHlBaseApr(p.hlApr)).length;
  if (isHlBaseApr(own.hlApr)) {
    return `That is Hyperliquid's base rate, ${pct(HL_BASE_APR)}, and ${onBase - 1} of the other ${n - 1} covered contracts print exactly the same figure: a venue constant rather than a view about ${symbol}, so on its own it says little about which side is crowded.`;
  }
  const others = (k: number, verb: string) => (k === 0 ? `no other covered contract ${verb}` : `${k} of the other ${n - 1} covered contracts ${verb === "does" ? "do" : "are"}`);
  if (own.hlApr < 0) {
    const neg = rated.filter((p) => p.hlApr < 0).length;
    const pl = placeBy(rated, symbol, (p) => -p.hlApr)!;
    return `Shorts are paying longs, which ${others(neg - 1, "does")} right now, and ${pl.place === 1 && pl.tied === 0 ? `${symbol} pays longs the most of any` : `${symbol} is ${ordinal(pl.place)} by how much longs are paid`}. ${onBase} of the ${n} sit on the base rate of ${pct(HL_BASE_APR)}.`;
  }
  if (own.hlApr > HL_BASE_APR) {
    const over = rated.filter((p) => p.hlApr > HL_BASE_APR + 1e-9).length;
    const pl = placeBy(rated, symbol, (p) => p.hlApr)!;
    return `That is above Hyperliquid's base rate of ${pct(HL_BASE_APR)}, as ${others(over - 1, "is")}: longs here pay more than the venue's constant, ${pl.place === 1 && pl.tied === 0 ? "the most in the book" : `the ${ordinal(pl.place)}-most in the book`}. ${onBase} of the ${n} sit on the base rate.`;
  }
  const under = rated.filter((p) => p.hlApr > 0 && p.hlApr < HL_BASE_APR - 1e-9).length;
  return `That is under Hyperliquid's base rate of ${pct(HL_BASE_APR)} while longs still pay, as ${others(under - 1, "is")}: the market has pulled the rate below the venue's constant without turning it. ${onBase} of the ${n} sit on the base rate.`;
}

const DAY = 86_400_000;
/** The last `n` daily bars that have closed by `now`. */
export function closedDays(daily: readonly Candle[] | undefined | null, now: number, n = 30): Candle[] {
  return (daily ?? []).filter((c) => c[0] + DAY <= now && c[1] > 0).slice(-n);
}

/** Daily bars built from hourly ones, for pages that hold only the hourly series: a UTC day counts
 *  only when all 24 of its hours are there, so a gap cannot pass for a quiet day. */
export function daysFromHourly(hourly: readonly Candle[] | undefined | null, now: number, n = 30): Candle[] {
  const byDay = new Map<number, Candle[]>();
  for (const c of hourly ?? []) {
    const d = Math.floor(c[0] / DAY) * DAY;
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(c);
  }
  const days: Candle[] = [];
  for (const [d, cs] of [...byDay].sort((x, y) => x[0] - y[0])) {
    if (cs.length !== 24 || d + DAY > now) continue;
    cs.sort((x, y) => x[0] - y[0]);
    days.push([d, cs[0][1], Math.max(...cs.map((c) => c[2])), Math.min(...cs.map((c) => c[3])), cs[23][4], cs.reduce((t, c) => t + c[5], 0)]);
  }
  return days.filter((c) => c[1] > 0).slice(-n);
}

/**
 * For each distance to liquidation, on how many of these days a position opened at the day's
 * open was carried that far before the day ended — down for a long, up for a short. Traded
 * candles, not the mark, and one day at a time: a position held across days would fare worse.
 */
export function daysThatReached(days: readonly Candle[], longDist: number, shortDist: number) {
  let long = 0, short = 0;
  for (const [, o, h, l] of days) {
    if ((o - l) / o >= longDist) long++;
    if ((h - o) / o >= shortDist) short++;
  }
  return { long, short, of: days.length };
}

export interface RungDays { L: number; long: number; short: number; of: number }
/** The sentence under a leverage table: the highest leverage its own month left standing, and the lowest it did not. */
export function rungDaysWords(symbol: string, rows: readonly RungDays[]): string | null {
  if (!rows.length || rows[0].of < 10) return null;
  const of = rows[0].of;
  const byL = [...rows].sort((a, b) => b.L - a.L);
  const clean = byL.find((r) => r.long === 0 && r.short === 0);
  const top = byL[0];
  const worse = top.long >= top.short ? "long" : "short";
  const hit = Math.max(top.long, top.short);
  const lead = hit === 0
    ? `None of ${symbol}'s last ${of} days moved far enough from its open to close even a position at ${top.L}× opened there.`
    : `On ${hit} of ${symbol}'s last ${of} days, a ${worse} at ${top.L}× opened at the day's open was closed before the day ended.`;
  const tail = hit === 0 ? "" : clean
    ? ` ${clean.L}× is the highest leverage here that every one of those days left standing, long or short.`
    : ` No leverage on this table got through all ${of} of them on both sides.`;
  return `${lead}${tail}`;
}
