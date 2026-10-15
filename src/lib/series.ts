import { type Candle, type FundingPoint, T, O, H, L, C, V } from "./candles.ts";
import { axisDp, shortDate, signedPct } from "../../public/shared.js";
import { HOURS_PER_YEAR, isHlBaseApr } from "./funding.ts";
import { U, CH, INK, SANS, MONO, niceTicks, timeTicks, xTick, text, rect, line, fint, crosshair, n2, FS_AXIS, FS_MICRO, PILL_H, PILL_R, PILL_GAP } from "./chart.ts";

/* =========================================================================================
   PRICE CHART — candles, volume, and the funding band.

   The funding band is the reason this chart exists in this form. Anyone can draw candles;
   the panel underneath, on the same time axis, showing which side was paying and by how
   much, is the dataset this site is built on. It is the only place hue appears.

   Every dimension is a multiple of U from ./chart.ts. Every SVG attribute is inline.
   ========================================================================================= */

export interface Timeframe {
  key: string; label: string; base: "m15" | "hour" | "day";
  factor: number; bars: number; hours: number;
}
export const TIMEFRAMES: Timeframe[] = [
  /* 15m AND 30m COME FROM A SERIES THAT ONLY EXISTS BECAUSE IT WAS VERIFIED FIRST. The store
     holds 1,345 fifteen-minute bars per contract — fourteen days, exact 15-minute spacing,
     every bar with volume — read back from KV before either of these rows was written. A
     timeframe whose data has not been confirmed is a button that empties the page. */
  { key: "15m", label: "15m", base: "m15", factor: 1, bars: 300, hours: 0.25 },
  { key: "30m", label: "30m", base: "m15", factor: 2, bars: 300, hours: 0.5 },
  { key: "1h", label: "1H", base: "hour", factor: 1, bars: 300, hours: 1 },
  { key: "4h", label: "4H", base: "hour", factor: 4, bars: 180, hours: 4 },
  /* 12H AND 1M ARE SET BY WHAT THE STORE ACTUALLY HOLDS, not by what looks tidy in a bar.
     Measured: the hourly series retains 1,081 bars (45 days) and the daily series 801 bars
     (800 days). So 12H can offer 90 bars and no more without inventing history, and 1M gets 26
     — two years of monthly closes, which is the longest honest view this data supports.
     THAT LAST PARAGRAPH USED TO SAY "nothing shorter than 1H is listed, because nothing shorter
     is collected", eight lines below the 15m and 30m rows it was contradicting. The m15 series
     was added and this note was not. Both are collected now, both are listed, and the warning it
     ended on still stands: a button for data that does not exist is the defect this bar has had
     once, and availability is therefore tested on the aggregated bar count rather than on the
     base series — see MIN_CHART_BARS below. */
  { key: "12h", label: "12H", base: "hour", factor: 12, bars: 90, hours: 12 },
  { key: "1d", label: "1D", base: "day", factor: 1, bars: 220, hours: 24 },
  { key: "1w", label: "1W", base: "day", factor: 7, bars: 130, hours: 168 },
  { key: "1m", label: "1M", base: "day", factor: 30, bars: 26, hours: 720 },
];
export const DEFAULT_TF = "1d";

/**
 * THE FEWEST AGGREGATED BARS WORTH DRAWING, and the reason it is a shared constant.
 *
 * buildPriceChart refuses below three; that is the floor at which a chart is arithmetically
 * possible, not the floor at which it is worth showing. Six is where a reader can see a shape.
 *
 * WHAT IT FIXES. Both templates tested availability on the BASE series — `base.length >= 6` —
 * and then drew from the AGGREGATED one. A contract with 45 daily bars passes that test for the
 * monthly timeframe, aggregates ×30 to two bars, buildPriceChart returns null, and the page
 * renders no chart AND no button bar AND no explanation: /funding/cashcat?tf=1m was a blank
 * section. That is precisely the defect the button-bar comment in that template says it fixed —
 * "pressing one that had no data selected it, showed no panel at all" — fixed for a missing base
 * series and not for a base series too short to aggregate.
 *
 * So the test is now on what will actually be drawn, and the number lives here so the two
 * templates and the check that guards them cannot hold three different opinions about it.
 */
export const MIN_CHART_BARS = 6;


/** Chunks `factor` base bars at a time, counted BACK from the newest. Not exported: a page that
    chunked its own bars is how /funding/[symbol] kept bars that moved with the render after
    /coins/[coin] stopped. Pages draw slotBars() or drawnBars(). */
function aggregate(src: Candle[], factor: number): Candle[] {
  if (factor <= 1) return src;
  const out: Candle[] = [];
  for (let end = src.length; end > 0; end -= factor) {
    const s = src.slice(Math.max(0, end - factor), end);
    if (!s.length) continue;
    out.unshift([s[0][T], s[0][O], Math.max(...s.map((c) => c[H])), Math.min(...s.map((c) => c[L])),
      s[s.length - 1][C], s.reduce((a, c) => a + c[V], 0)]);
  }
  return out;
}

/** Bar length of each base series, in minutes. */
export const BASE_MIN = { m15: 15, hour: 60, day: 1440 } as const;
const DAY_MS = 86_400_000;

/**
 * THE BARS A PAGE DRAWS FROM A BASE SERIES, built one way everywhere.
 *
 * Counting back from the newest base bar made where a bar opens depend on the minute of the
 * render. It was fixed on /coins/[coin] on 16 September 2026 and nowhere else, because the fix
 * lived in that template. Measured on production on 17 September 2026, /funding/btc: at 30m all
 * 300 bars opened at :15 or :45, at 12H all 90 at 08:00 and 20:00, and the first 1W bar was three
 * days wide under the same slot as a full week. /liquidations/sweep marked its $60,000 wick
 * "5 Feb, 23:00" — the two-hour bar that happened to hold it — while its own sentence said
 * 6 Feb 00:00. The liquidation map's 2- and 4-hour columns moved every hour.
 *
 * A bar length that divides a UTC day has fixed slots — floor(open / length) — and each bar is
 * the base bars inside one slot, stamped with the slot's own start. A slot missing a base bar is
 * drawn from the ones it has, in its own place. The oldest slot is dropped when the store began
 * inside it, so it is not a stub; the newest is the bar still open. Nothing about the render
 * time or the store's length can move a slot.
 *
 * Longer bars (7 and 30 days) keep whole chunks counted back from the newest day, with the
 * remainder dropped first so every bar holds exactly `factor` base bars. floor(open / length)
 * would anchor them on the epoch — weeks starting on a Thursday, 30-day bars starting nowhere a
 * reader would recognise — and their legends, from barSpan(), say only "weekly" and "thirty-day".
 */
export function slotBars(base: Candle[] | undefined, baseMin: number, factor: number): Candle[] {
  if (!base?.length) return [];
  if (factor <= 1) return base;
  const slotMs = baseMin * factor * 60_000;
  if (DAY_MS % slotMs !== 0) return aggregate(base.slice(base.length % factor), factor);
  const slots: Candle[][] = [];
  for (const c of base) {
    const open = slots[slots.length - 1];
    if (open && Math.floor(open[0][T] / slotMs) === Math.floor(c[T] / slotMs)) open.push(c);
    else slots.push([c]);
  }
  if (slots[0].length < factor) slots.shift();
  return slots.map((s): Candle => {
    const [bar] = aggregate(s, s.length);
    return [Math.floor(s[0][T] / slotMs) * slotMs, bar[O], bar[H], bar[L], bar[C], bar[V]];
  });
}

/** A timeframe's drawn bars: its base series in slots, the newest `tf.bars` of them. */
export const drawnBars = (base: Candle[] | undefined, tf: Timeframe): Candle[] =>
  slotBars(base, BASE_MIN[tf.base], tf.factor).slice(-tf.bars);

/**
 * WHY A TIMEFRAME IS NOT OFFERED, decided from its base series. Two reasons, and /funding/[symbol]
 * gave only the second for both: a store that could not be read (getCandles/getHourly/getM15 return
 * null) is not "not yet enough history". /coins/[coin] learned this on 16 September 2026 when
 * /coins/dogecoin blamed the length of a history it never read; the contract page kept one reason
 * and joined its list with "and … and" (read from source, 17 September 2026).
 */
export function timeframeGapNote(missing: readonly { tf: Timeframe; baseBars: number }[]): string {
  const list = (xs: string[]) => xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const note = (labels: string[], why: (one: boolean) => string) =>
    labels.length ? ` ${list(labels)} ${labels.length === 1 ? "is" : "are"} not offered: ${why(labels.length === 1)}` : "";
  const absent = missing.filter((m) => !(m.baseBars > 0)).map((m) => m.tf.label);
  const short = missing.filter((m) => m.baseBars > 0).map((m) => m.tf.label);
  return note(absent, (one) => `the candle series ${one ? "it is" : "they are"} built from could not be read when this page was rendered, so ${one ? "it is" : "they are"} left out rather than drawn from another.`) +
    note(short, (one) => `there is not yet enough history to draw ${one ? "it" : "them"} — fewer than ${MIN_CHART_BARS} bars at that size.`);
}

/* Numbers a bar length is said in. Only lengths the timeframes use need a word; any other falls
   back to digits, which stays true. */
const WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 6: "six", 12: "twelve", 15: "fifteen", 30: "thirty" };

/**
 * "26 thirty-day bars". The unit is worked out from the base bar length times the factor, so a
 * re-defined timeframe is described by its own numbers. "1M" is thirty daily bars, not a month,
 * and used to be called "monthly bars" (/coins/bnb?tf=1m, 16 September 2026: 26 bars 43,200
 * minutes apart, opening on the 29th, then the 28th, then the 27th); the fix read "over 26 30-day
 * bars", two numbers in a row. Only lengths English has a word for get the word.
 */
export function barSpan(tf: Timeframe, n: number): string {
  const min = BASE_MIN[tf.base] * tf.factor;
  const say = (k: number, unit: string) => `${WORD[k] ?? k}-${unit}`;
  const unit = min === 60 ? "hourly" : min === 1440 ? "daily" : min === 10080 ? "weekly"
    : min % 1440 === 0 ? say(min / 1440, "day") : min % 60 === 0 ? say(min / 60, "hour") : say(min, "minute");
  return `${n.toLocaleString("en-US")} ${unit} ${n === 1 ? "bar" : "bars"}`;
}

/* Panel heights in U. Price takes whatever is left, which keeps it dominant at any viewBox
   height without a second magic number to keep in sync. */
const LY = { h: 596, volH: 16 * U, fundH: 14 * U } as const;

export interface PriceChart {
  svg: string;
  /** [x, t, o, h, l, c, v, aprOrNaN, closeY] — what the crosshair reads. The same array the
      chart was drawn from, so hover can never disagree with the picture. */
  points: number[][];
  plot: [number, number, number, number];
  range: [number, number];
  axisX: number; slot: number;
  last: number; change: number; high: number; low: number; volume: number;
  fundingCoverage: number; fundingFrom: number | null;
  fundingMax: number; fundingClipped: number;
  dp: number; bars: number;
}

/* THE CANDLE SENTENCE DESCRIBED CANDLES ON THE LINE VIEW. It was one server string for both chart
   styles, and the client swap never touched it: /coins/bnb?tf=1m&view=line, on production on 16
   September 2026, drew one neutral close line (stroke #e8ecf1) and no candle bodies at all under
   "Candles are green for up and red for down, with the up candles hollow". All 26 line variants
   fetched that day said it.
   It was also not true of every candle on the Candles view. buildPriceChart outlines an up body
   only when it is tall enough to outline, and draws the rest solid: counted on the local render
   of /coins/bitcoin the same day, 30 of the 99 green candles on 4H and 33 of 154 on 30m were
   solid — the ones whose direction can be read only from colour.
   So the sentence is chosen by the style that was drawn, and the solid bodies are COUNTED FROM
   THE DRAWN SVG: every hollow body is the only <rect fill="none"> the price chart emits, and
   every green candle is a point whose close is at or above its open (the same `c >= o` that picks
   the colour). No threshold is copied out of series.ts, so if that one moves this count follows
   it. The sentence is a [data-tfstat] so the client swaps it with the panel — see the note on the
   legend below.
   MOVED HERE ON 17 SEPTEMBER 2026 because the contract page kept the sentence this replaced: its
   legend said "The up candles are hollow" under the same buildPriceChart bars, on every timeframe
   of /funding/{symbol}. */
export function candleStyleNote(chart: PriceChart, mode: ChartMode): string {
  if (mode === "line") {
    return "The line joins each bar's close instead of drawing candles, so a bar's high and low are not on it and the period high and low can sit beyond it; the volume bars beneath are green where a bar closed at or above its open and red where it closed below.";
  }
  const green = chart.points.filter((p) => p[5] >= p[2]).length;
  const hollow = (chart.svg.match(/<rect\b[^>]*\bfill="none"/g) ?? []).length;
  const solid = Math.max(0, green - hollow);
  const lead = "Candles and the volume bars beneath them are green where a bar closed at or above its open and red where it closed below";
  if (green === 0) return `${lead}.`;
  if (solid === 0) return `${lead}, and every green body is hollow, so direction reads without relying on colour.`;
  if (hollow === 0) return `${lead}. Every green body here is too short to outline and is drawn solid, so on this view direction is carried by colour alone.`;
  return `${lead}, and green bodies are hollow so direction reads without relying on colour — except ${solid} of the ${green} green candles, whose ${solid === 1 ? "body is" : "bodies are"} too short to outline and drawn solid.`;
}

/** Candles or a close line. The line is a presentation of the same array, not a second series. */
export type ChartMode = "candle" | "line";

/**
 * Mean funding APR for each DRAWN bar, keyed by that bar's own timestamp.
 *
 * Exported so it can be checked against an independently computed answer. It used to live
 * inline inside buildPriceChart(), which meant the only way to test it was to re-implement it
 * — and a test that re-implements the thing it is testing agrees with itself, not with the
 * shipped code. scripts/chart-bucketing.mjs calls THIS.
 *
 * `end` is the NEXT candle's timestamp rather than start + barMs, so the short leading bar that
 * aggregate() emits when the source does not divide evenly is closed correctly too.
 */
/* =========================================================================================
   ONE CONTRACT'S FUNDING, DESCRIBED FROM ITS OWN SERIES.

   Measured 15 October 2026: the prose of /funding/btc and /funding/eth was 91% the same five-word
   phrases — the template's — and only the figures differed. This is a short account no sibling can
   share, read from the same daily averages the funding figure draws (fundingByBar), so the words and
   the picture describe one series: how many days each side paid, the run the contract is in now and
   when it began, where the latest day sits among the window's days, and how many days it rested at
   the venue's base rate.
   ========================================================================================= */
export interface FundingRegime {
  days: number; longsPaid: number; shortsPaid: number; atBase: number;
  /** the current run: which side, how many consecutive days, and the day it began */
  run: { side: "long" | "short"; days: number; since: number };
  /** days in the window whose daily average was below the latest day's */
  below: number;
}
export function fundingRegime(candles: Candle[], funding: FundingPoint[] | null, tf: Timeframe): FundingRegime | null {
  if (!funding || funding.length < 5 || candles.length < 7) return null;
  const by = fundingByBar(candles, funding, tf.hours * 3_600_000);
  const pts = candles.map((c) => [c[T], by.get(c[T])] as const).filter((x): x is readonly [number, number] => Number.isFinite(x[1]));
  if (pts.length < 7) return null;
  const side = (a: number) => (a >= 0 ? "long" : "short") as "long" | "short";
  const last = pts[pts.length - 1];
  let k = pts.length - 1;
  while (k > 0 && side(pts[k - 1][1]) === side(last[1])) k--;
  return {
    days: pts.length,
    longsPaid: pts.filter(([, a]) => a > 0).length,
    shortsPaid: pts.filter(([, a]) => a < 0).length,
    atBase: pts.filter(([, a]) => isHlBaseApr(a)).length,
    run: { side: side(last[1]), days: pts.length - k, since: pts[k][0] },
    below: pts.filter(([, a]) => a < last[1]).length,
  };
}

export function fundingByBar(
  candles: Candle[],
  funding: FundingPoint[],
  barMs: number,
  out: Map<number, number> = new Map(),
): Map<number, number> {
  const sorted = [...funding].sort((a, b) => a[0] - b[0]);
  let i = 0;
  for (let ci = 0; ci < candles.length; ci++) {
    const start = candles[ci][T];
    const end = ci + 1 < candles.length ? candles[ci + 1][T] : start + barMs;
    while (i < sorted.length && sorted[i][0] < start) i++;
    let sum = 0, cnt = 0, j = i;
    while (j < sorted.length && sorted[j][0] < end) { sum += sorted[j][1] * HOURS_PER_YEAR; cnt++; j++; }
    if (cnt) out.set(start, sum / cnt);   // HL settles hourly: APR = rate x HOURS_PER_YEAR
    i = j;
  }
  return out;
}

export function buildPriceChart(
  candles: Candle[],
  funding: FundingPoint[] | null,
  tf: Timeframe,
  mode: ChartMode = "candle",
  /* THE BAND IS OPTIONAL NOW, AND ONLY ONE TEMPLATE TURNS IT OFF. /funding/{symbol} draws the
     funding series as a figure of its own — see buildFundingChart at the foot of this file — and
     two pictures of one series at two sizes on one page invites a reader to reconcile them.
     (An earlier version of this note said the coin pages keep the strip. They do not: /coins/{coin}
     passes no funding series at all, so its chart has never drawn one — a comment asserting what
     the code does not do, caught by a verifier on 16 September.) */
  opts: { band?: boolean; width?: number } = {},
): PriceChart | null {
  /* The viewBox width. The narrow variant (narrowChart) draws fewer bars into a phone-shaped box so
     its axis fits the bars a phone shows and its labels stay legible without sideways scrolling. */
  const W = opts.width ?? CH.w;
  const gid = `f${tf.key}`;
  if (candles.length < 3) return null;
  const px = candles[candles.length - 1][C];
  /* axisDp, not a ladder of its own: this one stopped at four decimals, so a coin at $0.00001234
     read "0.0000" down its whole axis — the defect public/shared.js records as fixed for the
     heatmap — and DOGE's price chart showed four decimals beside its heatmap's five. */
  const dp = axisDp(px);
  const plotX = CH.padL, plotW = W - CH.padL - CH.padR;
  const axisX = plotX + plotW;

  /* Funding coverage decides whether the band is drawn at all. A panel covering 3% of the
     window is a sliver at the right edge that looks like a rendering fault; below the floor
     the panel is dropped and the page says so in words instead. */
  const barMs = tf.hours * 3_600_000;
  const aprAt = new Map<number, number>();
  /* FUNDING IS KEYED ON THE BAR THE CHART ACTUALLY DREW, not on an epoch grid.
   *
   * It used to bucket with `Math.floor(t / barMs) * barMs` and read back the same way. Writer
   * and reader agreed on the key and still described different windows, because aggregate()
   * above chunks BACKWARDS from the newest candle: 4H bars open at whatever hour the newest
   * hourly candle implies — 07:00, 11:00, 15:00 on the day this was found — while the buckets
   * sit at 00/04/08/12/16/20. A 4H bar therefore overlapped its own funding by one hour in
   * four; a 1W bar by one day in seven.
   *
   * Measured from the JSON the page itself ships for /funding/btc: of the 4H bars with full
   * hourly coverage, 15 carried the epoch bucket's mean rather than their own, and TWO of
   * those had the opposite SIGN — drawn in the colour that says the other side pays. Red and
   * green mean one thing on this site, so that is not a rounding complaint.
   *
   * 1H and 1D looked correct throughout, which is why this survived: those candles happen to
   * be epoch-aligned already, so the wrong key returned the right window and the defect
   * rendered as a plausible number on exactly the two timeframes nobody cross-checked.
   *
   * Walking the drawn candles is also correct for whatever offset aggregate() produces next,
   * including the short leading bar it can emit, since each window is closed by the NEXT
   * candle's timestamp rather than by arithmetic. */
  if (funding && funding.length > 4) fundingByBar(candles, funding, barMs, aprAt);
  const coverage = aprAt.size / candles.length;
  const fundOn = (opts.band ?? true) && coverage >= 0.06;
  const fundH = fundOn ? LY.fundH : 0;

  const priceH = LY.h - CH.padT - CH.padB - LY.volH - fundH - CH.gap * (fundOn ? 2 : 1);
  const priceY = CH.padT;
  const volY = priceY + priceH + CH.gap;
  const fundY = volY + LY.volH + CH.gap;

  const hiR = Math.max(...candles.map((c) => c[H]));
  const loR = Math.min(...candles.map((c) => c[L]));
  const sp = Math.max(1e-9, hiR - loR);
  const hi = hiR + sp * 0.045, lo = Math.max(0, loR - sp * 0.045);
  const yOf = (v: number) => priceY + ((hi - v) / (hi - lo)) * priceH;

  const n = candles.length;
  const slot = plotW / n;
  /* Body width and the gap between bodies come from one ratio, so bar spacing reads the same
     at 130 bars and at 300. Wick weight steps with body width instead of staying at 1px,
     which is what makes wide candles look drawn rather than hairlined. */
  const bw = Math.max(1, slot - Math.min(3, Math.max(0.55, slot * 0.26)));
  const ww = bw < 6 ? 1 : bw < 13 ? 1.4 : 1.8;
  const rx = bw >= 8 ? ' rx="1"' : "";
  const xOf = (i: number) => plotX + slot * (i + 0.5);
  const vmax = Math.max(...candles.map((c) => c[V]), 1);

  /* The band is scaled to the 96th percentile, not the maximum: one funding spike otherwise
     flattens two years of shape onto the axis. Bars past the top are clipped, the axis prints
     the scale, and the number clipped is disclosed under the chart. */
  const mags = [...aprAt.values()].map(Math.abs).sort((a, b) => a - b);
  const fmax = Math.max(0.01, mags.length ? mags[Math.floor(mags.length * 0.96)] : 0.01);
  const fClipped = mags.filter((m) => m > fmax).length;
  const fz = fundY + fundH / 2;
  const fsc = (fundH / 2 - 5) / fmax;
  const clampF = (a: number) => Math.max(-fmax, Math.min(fmax, a));

  const s: string[] = [];
  s.push(rect(0, 0, W, LY.h, INK.well, ` rx="${CH.radius}"`));

  const lastY = yOf(px);
  /* Axis labels live in one group so the interaction layer can fade them while the crosshair
     is on. Without that the live pill lands on top of a static tick and both stay half
     readable, which is the single ugliest thing a crosshair can do. */
  const yLabels: string[] = [];
  /* A taller, narrower box takes more ticks, or the one near the live pill leaves a single label. */
  for (const v of niceTicks(lo, hi, W < 800 ? 8 : 5)) {
    const y = yOf(v);
    s.push(line(plotX, y, axisX, y, INK.hair));
    if (Math.abs(y - lastY) > 16) yLabels.push(text(axisX + PILL_GAP, y + 3.5, dp ? v.toFixed(dp) : fint(v), INK.dim, FS_AXIS));
  }
  s.push(`<g data-ax="y">${yLabels.join("")}</g>`);

  if (mode === "line") {
    /* THE LINE IS THE SAME DATA, NOT A DIFFERENT ONE. Closes only, in the same colour the
       up-candle uses, over a soft fill down to the plot floor — which is what makes a long
       window readable when 300 candle bodies collapse into texture. The wick range is
       deliberately dropped rather than shaded: a band around a close line reads as a
       confidence interval, and a high-low range is not one. */
    const pts = candles.map((c, i) => `${xOf(i).toFixed(1)},${yOf(c[C]).toFixed(1)}`).join(" ");
    const floor = (priceY + priceH).toFixed(1);
    s.push(
      `<defs><linearGradient id="ln${tf.key}" x1="0" y1="0" x2="0" y2="1">` +
        /* NEUTRAL, not the candle-up green. In line mode there are no candles and no per-bar
           direction — one continuous price line for the whole window. Tinting it green would
           assert a direction the line does not have. */
        `<stop offset="0" stop-color="${INK.neutral}" stop-opacity="0.16"/>` +
        `<stop offset="1" stop-color="${INK.neutral}" stop-opacity="0"/></linearGradient></defs>`,
    );
    s.push(`<path d="M${xOf(0).toFixed(1)},${floor} L${pts.split(" ").join(" L")} L${xOf(n - 1).toFixed(1)},${floor} Z" fill="url(#ln${tf.key})"/>`);
    s.push(`<polyline points="${pts}" fill="none" stroke="${INK.neutral}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else {
    /* HOLLOW UP, FILLED DOWN — the original candlestick convention, and here it is the part
       that carries the meaning when hue cannot. Measured under simulated protanopia the two
       candle colours separate by only dE 12.1, so a reader who cannot tell the hues apart
       still reads direction off the body: outlined means the close was above the open.
       The wick stays solid in both cases; only the body changes. */
    for (let i = 0; i < n; i++) {
      const c = candles[i], x = xOf(i), up = c[C] >= c[O], k = up ? INK.up : INK.down;
      s.push(rect(x - ww / 2, yOf(c[H]), ww, Math.max(0.7, yOf(c[L]) - yOf(c[H])), k));
      const bt = yOf(Math.max(c[O], c[C])), bb = yOf(Math.min(c[O], c[C]));
      const bh = Math.max(1, bb - bt);
      if (up && bh > 2.2) {
        /* A hollow body needs a stroke on the path, and stroke straddles the edge, so the rect
           is inset by half a stroke to keep the drawn width equal to the filled case. */
        /* `${rx}` AND NOT `rx="${rx}"`. rx is an attribute FRAGMENT — either ` rx="1"` or the
           empty string — which is what the rect() helper below takes as `extra`. Interpolated
           here as a VALUE it produced `rx=""` on every narrow candle (invalid: rx takes a
           length, and the browser logged one error per candle — 131 on a 1H chart, 88 on 1D)
           and `rx=" rx="1""` on every wide one (22 on 1W, 5 on 1M), where the quotes close
           early and the rest becomes stray attributes. Both shipped on every coin page from
           the day hollow candles were written; both rendered, which is why nobody saw them.
           Found in a browser console while verifying something else. */
        s.push(`<rect x="${n2(x - bw / 2 + 0.5)}" y="${n2(bt + 0.5)}" width="${n2(Math.max(0.5, bw - 1))}" height="${n2(Math.max(0.5, bh - 1))}"${rx} fill="none" stroke="${k}" stroke-width="1"/>`);
      } else {
        s.push(rect(x - bw / 2, bt, bw, bh, k, rx));
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const c = candles[i], h = Math.max(0.9, (c[V] / vmax) * LY.volH);
    s.push(rect(xOf(i) - bw / 2, volY + LY.volH - h, bw, h, c[C] >= c[O] ? INK.upVol : INK.downVol));
  }

  // ---- funding band: two filled areas with a defined edge, not two hundred pickets
  let fundingFrom: number | null = null;
  if (fundOn) {
    const cov: number[] = [];
    for (let i = 0; i < n; i++) if (aprAt.has(candles[i][T])) cov.push(i);
    fundingFrom = candles[cov[0]][T];
    const x0 = xOf(cov[0]);
    if (cov[0] > 2) {
      /* Absence drawn as absence: a distinct tone plus a boundary rule, so the empty part of
         the panel reads as "not collected" rather than "nothing happened". */
      s.push(rect(plotX, fundY, x0 - plotX, fundH, "#1b2026"));
      s.push(line(x0, fundY, x0, fundY + fundH, "#39414a"));
      s.push(text(x0 - 10, fz + 3.8, "no funding history before " + shortDate(fundingFrom), INK.faint, FS_MICRO, "end", 400, SANS));
    }
    s.push(
      `<defs><linearGradient id="${gid}l" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${INK.paysLFill}" stop-opacity=".92"/><stop offset="1" stop-color="${INK.paysLFill}" stop-opacity=".16"/></linearGradient>` +
      `<linearGradient id="${gid}s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${INK.paysSFill}" stop-opacity=".16"/><stop offset="1" stop-color="${INK.paysSFill}" stop-opacity=".92"/></linearGradient></defs>`,
    );
    for (const side of [1, -1]) {
      const pts = cov.map((i) => {
        const a = clampF(aprAt.get(candles[i][T])!);
        return `${n2(xOf(i))},${n2(fz - ((a >= 0) === (side > 0) ? a * fsc : 0))}`;
      }).join(" ");
      s.push(`<polygon points="${n2(x0)},${n2(fz)} ${pts} ${n2(xOf(cov[cov.length - 1]))},${n2(fz)}" fill="url(#${gid}${side > 0 ? "l" : "s"})"/>`);
      s.push(`<polyline points="${pts}" fill="none" stroke="${side > 0 ? INK.paysL : INK.paysS}" stroke-width="1.1" stroke-linejoin="round" opacity=".9"/>`);
    }
    s.push(line(plotX, fz, axisX, fz, INK.zero));
    s.push(text(axisX + PILL_GAP, fundY + 11, `${signedPct(fmax, 0)} APR`, INK.faint, FS_MICRO));
    s.push(text(axisX + PILL_GAP, fundY + fundH - 2, signedPct(-fmax, 0), INK.faint, FS_MICRO));
  }

  /* THE LAST-PRICE MARKER IS TAGGED so the live layer can move it.
     Untagged, it showed the last CANDLE close — up to two hours old on a page whose headline
     price is a minute old — and on BTC that put "$62,725" on the chart while the hero above it
     read "$62,977.52". Two prices for one asset on one screen, 0.4% apart, both presented as
     current. The candles are closed bars and stay put; this marker is what "now" means on a
     price chart, so it is the thing that has to move. */
  s.push(line(plotX, lastY, axisX, lastY, INK.acc, 1, ' stroke-dasharray="2 5" opacity=".6" data-live="line"'));
  s.push(rect(axisX + PILL_GAP, lastY - PILL_H / 2, 74, PILL_H, INK.acc, ` rx="${PILL_R}" data-live="pill"`));
  s.push(text(axisX + PILL_GAP + 37, lastY + 4, "$" + (dp ? px.toFixed(dp) : fint(px)), INK.accInk, 11.5, "middle", 600, MONO, ` data-live="txt"`));

  s.push(`<g data-ax="x">${timeTicks(candles.map((c) => c[T]), W < 800 ? 4 : 8)
    .map(({ i, label }) => xTick(xOf(i), LY.h - 9, label)).join("")}</g>`);
  s.push(crosshair(plotX, priceY, plotW, LY.h - CH.padB - priceY, axisX, { dot: true }));

  const first = candles[0][C];
  return {
    /* THE LABEL NAMES WHAT WAS ACTUALLY DRAWN. It read "Price, volume and funding history" on
       every rendering, including the ones where the band is off — /funding/{symbol} passes
       band:false because it draws funding as a figure of its own — so a screen reader was told
       about a panel that is not in the picture. A name asserting what its expression does not
       compute is the defect this codebase keeps finding in itself; it is the same fault whether
       the reader is a person or an extractor. */
    svg: `<svg viewBox="0 0 ${W} ${LY.h}" width="100%" role="img" aria-label="${fundOn ? "Price, volume and funding history" : "Price and volume history"}">${s.join("")}</svg>`,
    points: candles.map((c, i) => [
      +xOf(i).toFixed(2), c[T], c[O], c[H], c[L], c[C], c[V],
      aprAt.has(c[T]) ? +aprAt.get(c[T])!.toFixed(6) : NaN, +yOf(c[C]).toFixed(2),
    ]),
    plot: [plotX, priceY, plotW, priceH],
    range: [lo, hi],
    axisX, slot,
    last: px,
    change: first ? (px - first) / first : 0,
    high: hiR, low: loR,
    volume: candles.reduce((a, c) => a + c[V], 0),
    fundingCoverage: coverage, fundingFrom,
    fundingMax: fmax, fundingClipped: fClipped,
    dp, bars: n,
  };
}

/* =========================================================================================
   THE PRICE CHART ON A PHONE, DRAWN FOR A PHONE.

   Below 760px the full chart scrolls sideways at a legible size and opens on its newest bars —
   but its price axis is fitted to every bar, so on /funding/btc (15 October 2026) the sixty days a
   phone showed, all above $74,000, sat in the top third of a box scaled to the 200-day low of
   $57,768, with sixty per cent of the height empty. This is the same builder on the newest bars,
   in a narrower box, so the axis fits what is on screen. The wide chart is unchanged and is the one
   shown from 760px up; CSS picks one (Base.astro, .chart--price).
   ========================================================================================= */
export const NARROW_W = 380;
export const NARROW_BARS = 60;
export function narrowChart(candles: Candle[], funding: FundingPoint[] | null, tf: Timeframe, mode: ChartMode = "candle"): PriceChart | null {
  return buildPriceChart(candles.slice(-NARROW_BARS), funding, tf, mode, { band: false, width: NARROW_W });
}

/** The crosshair's attributes for a price chart's svg, once for both pages and both widths. */
export function xhairAttrs(chart: PriceChart, ptsId: string, unit: string, tf: Timeframe): string {
  return `data-xhair="${ptsId}" data-feed="mark" data-plot="${chart.plot.join(",")}" data-prange="${chart.range[0]},${chart.range[1]}" ` +
    `data-axx="${chart.axisX}" data-slot="${chart.slot.toFixed(2)}" data-taxisy="${CHART_H - 27}" data-unit="${unit}" data-dp="${chart.dp}" data-intraday="${tf.hours < 24 ? 1 : 0}" `;
}

export { shortDate } from "../../public/shared.js";
export const CHART_H = LY.h;

/* =========================================================================================
   THE FUNDING BAND ON ITS OWN, AT THE SIZE OF ITS OWN SUBJECT.

   WHAT THE READER WALK FOUND. /funding/{symbol} is the most-fetched template on this site and
   the page an assistant lands on for "BTC funding rate". Measured on the rendered page: the
   funding band occupied y 500–580 of a 596-unit viewBox — thirteen per cent of the chart's
   height, at the bottom, under the volume bars — while the price candles took seventy-five per
   cent and a $75,892.00 hero sat above the lot. The page's own title is funding and funding was
   the smallest thing on it.

   SO IT IS A FIGURE, NOT A STRIP. Same grammar as the band it replaces, because that grammar was
   already right: two mirrored areas about a drawn zero rule, amber where longs pay and cyan where
   shorts do, clipped at the 96th percentile so one spike cannot flatten a year, and absence drawn
   as absence rather than as a flat line at zero. What changes is the height it gets and the
   question it is answering — here it is the claim, there it was a footnote to the price.

   THE PRICE CHART STOPS DRAWING IT. Two pictures of one series at two sizes on one page invites
   the reader to reconcile them, and the smaller one would always lose; buildPriceChart takes
   `band: false` from this template for that reason. (The coin pages draw no band either: they pass
   no funding series to the price chart.)
   ========================================================================================= */
export interface FundingChart {
  svg: string;
  /** Fraction of drawn bars that carry a funding reading. */
  coverage: number;
  /** First bar with a reading, or null when none has one. */
  from: number | null;
  /** The drawn range, annualised: the axis runs −down..+up, each side to its own 96th percentile. */
  up: number; down: number;
  /** Readings beyond that range, pinned to the edge and disclosed rather than hidden. */
  clipped: number;
  /** Highest and lowest annualised readings actually present, whatever the axis shows. */
  hi: number; lo: number;
  bars: number;
}

/** Height of the standalone figure. A third of the price chart: enough to read a shape, not so
 *  much that a page about a rate becomes a page about a picture. */
const FUND_H = 200;

export function buildFundingChart(candles: Candle[], funding: FundingPoint[] | null, tf: Timeframe, width: number = CH.w): FundingChart | null {
  /* `width` is the viewBox width. At 1260 a 375px phone drew this — the page's own subject — as a
     strip 283×45 with five-pixel labels (15 October 2026); the page also renders it at NARROW_W for
     phones, every bar kept, so "90 days drawn" stays true at both widths. */
  const W = width;
  if (candles.length < MIN_CHART_BARS || !funding || funding.length < 5) return null;
  const barMs = tf.hours * 3_600_000;
  const aprAt = fundingByBar(candles, funding, barMs);
  const cov: number[] = [];
  for (let i = 0; i < candles.length; i++) if (aprAt.has(candles[i][T])) cov.push(i);
  /* The same floor the strip used: a band covering under 6% of the window is a sliver at the
     right edge that reads as a rendering fault rather than as data. */
  if (cov.length / candles.length < 0.06) return null;

  const plotX = CH.padL, plotW = W - CH.padL - CH.padR;
  const axisX = plotX + plotW;
  const top = CH.padT, h = FUND_H - CH.padT - CH.padB;
  const n = candles.length;
  const xOf = (i: number) => plotX + (plotW / n) * (i + 0.5);

  /* EACH SIDE TO ITS OWN RANGE. The axis was ±(96th percentile of |APR|), so BTC — longs paying on
     88 of 90 days — drew its whole history in the top half over an empty bottom half, at half the
     height it could have had (seen at 375px on /funding/btc, 15 October 2026). Each side now runs to
     its own 96th percentile, and either side keeps at least an eighth of the larger one, so zero is
     never the edge and two short-paying days still have somewhere to show. */
  const vals = [...aprAt.values()];
  const q96 = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.96))] : 0);
  const rawUp = q96(vals.filter((v) => v > 0)), rawDown = q96(vals.filter((v) => v < 0).map((v) => -v));
  const span = Math.max(0.01, rawUp, rawDown);
  const up = Math.max(rawUp, span / 8), down = Math.max(rawDown, span / 8);
  const clipped = vals.filter((v) => v > up || -v > down).length;
  const zeroY = top + (h * up) / (up + down);
  const yOf = (a: number) => a >= 0
    ? zeroY - (Math.min(a, up) / up) * (zeroY - top)
    : zeroY + (Math.min(-a, down) / down) * (top + h - zeroY);

  const s: string[] = [];
  const gid = `fc${tf.key}`;
  const x0 = xOf(cov[0]);
  /* ABSENCE DRAWN AS ABSENCE. A stored series that starts partway through the window leaves a
     region with no reading, and filling it with the zero line would say funding was flat there. */
  if (cov[0] > 2) {
    s.push(rect(plotX, top, x0 - plotX, h, "#1b2026"));
    s.push(line(x0, top, x0, top + h, "#39414a"));
    s.push(text(x0 - 10, zeroY + 3.8, "no funding history before " + shortDate(candles[cov[0]][T]), INK.faint, FS_MICRO, "end", 400, SANS));
  }
  s.push(
    `<defs><linearGradient id="${gid}l" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${INK.paysLFill}" stop-opacity=".92"/><stop offset="1" stop-color="${INK.paysLFill}" stop-opacity=".16"/></linearGradient>` +
    `<linearGradient id="${gid}s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${INK.paysSFill}" stop-opacity=".16"/><stop offset="1" stop-color="${INK.paysSFill}" stop-opacity=".92"/></linearGradient></defs>`,
  );
  for (const side of [1, -1]) {
    const pts = cov.map((i) => {
      const a = aprAt.get(candles[i][T])!;
      return `${n2(xOf(i))},${n2((a >= 0) === (side > 0) ? yOf(a) : zeroY)}`;
    }).join(" ");
    s.push(`<polygon points="${n2(x0)},${n2(zeroY)} ${pts} ${n2(xOf(cov[cov.length - 1]))},${n2(zeroY)}" fill="url(#${gid}${side > 0 ? "l" : "s"})"/>`);
    s.push(`<polyline points="${pts}" fill="none" stroke="${side > 0 ? INK.paysL : INK.paysS}" stroke-width="1.4" stroke-linejoin="round" opacity=".95"/>`);
  }
  s.push(line(plotX, zeroY, axisX, zeroY, INK.zero));
  s.push(text(axisX + PILL_GAP, top + 11, `${signedPct(up, 0)} APR`, INK.faint, FS_MICRO));
  /* Zero's label sits above its line when the band below is too thin to hold it and the bottom
     label apart — on BTC the two read as one "0% −2%" (15 October 2026). */
  s.push(text(axisX + PILL_GAP, top + h - zeroY < 24 ? zeroY - 3 : zeroY + 4, "0%", INK.dim, FS_MICRO));
  s.push(text(axisX + PILL_GAP, top + h - 2, signedPct(-down, 0), INK.faint, FS_MICRO));
  s.push(`<g data-ax="x">${timeTicks(candles.map((c) => c[T]), W < 800 ? 4 : 8)
    .map(({ i, label }) => xTick(xOf(i), FUND_H - 9, label)).join("")}</g>`);

  return {
    svg: `<svg viewBox="0 0 ${W} ${FUND_H}" width="100%" role="img" aria-label="Funding rate history, annualised, with the side paying shown by colour">${s.join("")}</svg>`,
    coverage: cov.length / candles.length,
    from: candles[cov[0]][T],
    up, down, clipped,
    hi: Math.max(...vals), lo: Math.min(...vals),
    bars: cov.length,
  };
}

/**
 * THE DAILY CLOSE A "SINCE N DAYS AGO" IS MEASURED FROM: the last daily bar that had closed by `at`.
 * Its close time is returned with it, so a page prints the instant it measured from and two coins are
 * compared only when both series hold that same close.
 */
export function dailyCloseBy(candles: Candle[] | null | undefined, at: number): { close: number; at: number } | null {
  if (!candles?.length) return null;
  const DAY = 86_400_000;
  for (let i = candles.length - 1; i >= 0; i--) {
    const end = candles[i][T] + DAY;
    if (end <= at) return Number.isFinite(candles[i][C]) && candles[i][C] > 0 ? { close: candles[i][C], at: end } : null;
  }
  return null;
}
