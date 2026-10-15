import type { Candle } from "./candles.ts";
import { slotBars } from "./series.ts";
import { cumulativeAt, parsePrice, atReading, axisDp } from "../../public/shared.js";

/** The narrowest drawn span, as a fraction of the last price: ±8% either side. */
export const MIN_SPAN = 0.16;
/** How far either side of the live mark the axis must reach: the largest printed move (10%) plus a
 *  margin, so the −10% row lands inside a row of the picture rather than on its frame. */
export const LADDER_REACH = 0.11;

/** Row 8's sentence — how the drawn range was set — once, for every page that draws a map. */
export function spanWords(m: { spanRule: "traded" | "minSpan"; reached: boolean; tradedLo: number; tradedHi: number; loPrice: number; hiPrice: number }, fmt: (v: number) => string): string {
  const base = m.spanRule === "traded"
    ? `Fitted to the traded range, ${fmt(m.tradedLo)}–${fmt(m.tradedHi)}, plus headroom`
    : `The traded range was quieter than the ±${Math.round(MIN_SPAN * 50)}% minimum, so the minimum set the axis — not the traded range`;
  return m.reached
    ? `${base}, then widened to ${fmt(m.loPrice)}–${fmt(m.hiPrice)} so a ${Math.round(Math.max(...MOVE_STEPS) * 100)}% move either way from the live mark stays on the picture.`
    : `${base}.`;
}

/* =========================================================================================
   MODELLED LIQUIDATION DENSITY — price on Y, time on X.

   This is a MODEL. It is labelled as one inside the picture, its inputs are printed beside
   it marked observed or assumed, and the reader can change the one that matters most.
   Refusing to model would produce a page nobody can use; presenting a model as an
   observation would be worse. Both are avoided by saying which is which, loudly.

   THE ASSUMPTIONS, in the order they are applied:

    1. HOW MUCH is open — set equal to the contract's current open interest, which is
       observed. The model redistributes a real quantity; it does not invent one.
    2. WHEN it was opened — spread across bars in proportion to TRADED VOLUME, observed.
    3. HOW LONG it stays open — a bounded position life, decaying in four tranches over that
       span. This replaces the previous "a position is only ever removed by liquidation",
       which was both wrong and the direct cause of a picture that brightened left to right
       because open positions never stopped accumulating.
    4. AT WHAT LEVERAGE — a weight per leverage tier, chosen by the reader. Most influence,
       least evidence.
    5. WHICH WAY — long and short in equal measure.

   Everything after those five is arithmetic on published margin tiers.

   TWO CORRECTIONS OVER THE FIRST VERSION, both structural:

   * WARM-UP. Open positions are built for `ageBars` before the first drawn column, so column zero
     already holds a full position-life window of positions. Without it the field brightens monotonically left to right
     and the picture says "time passed" rather than "levels cluster here".

   * DISCRETE LEVERAGE. Interpolating the profile onto a smooth 20-rung ladder produced a
     uniform field — 87% of cells non-zero, median at half the 97th percentile, nothing to
     see. Real positions cluster on round leverages, and that discreteness is exactly what makes
     the picture legible: each tier traces a shadow of the price path, and where price dwelt,
     the shadows stack into a band.
   ========================================================================================= */

export interface LevProfile {
  key: string; label: string; note: string;
  /** leverage -> share of notional; shares sum to 1 */
  weights: [number, number][];
}

export const PROFILES: LevProfile[] = [
  {
    key: "aggressive", label: "Aggressive",
    note: "Most size at high leverage. Closest to what a retail-dominated perp market is usually assumed to look like.",
    weights: [[2, 0.05], [5, 0.11], [10, 0.18], [20, 0.20], [25, 0.24], [40, 0.22]],
  },
  {
    key: "balanced", label: "Balanced",
    note: "Weight spread across the range, tilted slightly to the middle. A deliberately unopinionated default.",
    weights: [[2, 0.09], [5, 0.19], [10, 0.27], [20, 0.22], [25, 0.15], [40, 0.08]],
  },
  {
    key: "conservative", label: "Conservative",
    note: "Most size at low leverage, as a market dominated by funded desks rather than retail would look.",
    weights: [[2, 0.23], [5, 0.32], [10, 0.25], [20, 0.12], [25, 0.06], [40, 0.02]],
  },
];

/** A position's life, as four tranches of a decaying survival curve. A single hard cut-off
    would make every unswept band exactly `ageBars` long — a regularity you can see. */
const TRANCHES: [number, number][] = [[0.25, 0.42], [0.5, 0.26], [0.75, 0.18], [1, 0.14]];
/** Mean life of a cohort as a fraction of the full position life: 0.51 here.
    Cohorts are sized so that the ones OPENED over a window sum to open interest, but each
    survives only part of it, so without dividing this back out the notional STANDING at any
    instant is 0.51x OI — and every dollar printed beside the picture is half what the page
    claims it is. Caught by review; the picture's shape never showed it, because the transfer
    function is solved from the data and absorbs a constant factor silently. */
const LIFE = TRANCHES.reduce((a, [frac, w]) => a + frac * w, 0);
/** Softens each tier across three price rows so a band is a band, not a hairline. */
const KERNEL: [number, number][] = [[-1, 0.16], [0, 0.68], [1, 0.16]];

/* `fromClose`, NOT `distance`, AND THE RENAME IS THE FIX.
   The field was `distance` and it was measured from the last DRAWN CANDLE's close — the only price
   this function is given. Every caller put it under the words "from the mark": the column header
   "Distance from mark", and the page's opening sentence, which names the live mark and then says
   the cluster "sits 8.90% below it". Measured on production 16 September: the cluster at $69,160
   against a $75,732 mark is 8.68% away, not 8.90% — the gap between an hourly close up to two hours
   old and the minute-old mark, printed as though it were the mark. Worse, the same clause decided
   "below" against the mark and the percentage against the candle, so the two halves of one sentence
   used two prices.
   A name that says which price it is measured from cannot be put under a "from mark" heading by
   accident, and removing the old name made the compiler list every site that had been doing so. */
export interface Cluster { price: number; notional: number; side: "long" | "short"; fromClose: number }

export interface LiqMap {
  /** grid[row][col] in USD; row 0 is the highest price */
  grid: number[][];
  rows: number; cols: number;
  loPrice: number; hiPrice: number; band: number;
  candles: Candle[];
  /** ascending non-zero cell values — the transfer function is solved from this */
  sorted: number[];
  peak: number;
  /** modelled notional removed by price trading through it, per drawn column */
  swept: number[];
  /** cleared[row][col] — notional removed AT that cell because price traded through it.
      The standing grid shows what is there; this shows what the market took, which is the
      more informative half and was previously only inferable from a gap. */
  cleared: number[][];
  /** largest single cleared cell, for scaling the scar layer */
  clearedPeak: number;
  clusters: Cluster[];
  /** share of modelled notional whose level sits outside the drawn price range */
  clipped: number;
  tradedLo: number; tradedHi: number;
  totalNotional: number;
  ageBars: number;
  /** which rule set the drawn price span */
  spanRule: "traded" | "minSpan";
  /** the axis was widened past that rule so the live mark's ±10% moves stay on the picture */
  reached: boolean;
  /** bars of warm-up modelled before the first drawn column; short of ageBars means partial */
  warmBars: number;
  /** The notional STILL STANDING at the right-hand edge, per price row, split by side and by
   *  leverage rung (indexes into `levs`). The same set the clusters are summed from — a level
   *  that price has traded through or that has aged out is not in it — so the liquidation map
   *  drawn from this and the cluster table cannot disagree. */
  standing: { long: number[][]; short: number[][]; levs: number[] };
}

/**
 * THE WEIGHTS THE MODEL ACTUALLY USES, WHICH ARE NOT THE WEIGHTS IN THE PROFILE.
 *
 * A profile is written for a 40x contract and sums to 1 there. On anything capped lower, the
 * rungs above the cap are dropped and what remains is RENORMALISED — a 10x contract's positions
 * are all at 10x or below, not 55% of an absent book. buildLiqMap has always divided by that
 * sum; the table on /liquidations printed the raw weight beside a note reading "the exact
 * weight vector behind the picture", and it was the vector for a contract the reader was not
 * looking at.
 *
 * Measured over the ten committed margin tables: exactly one caps at 40x. The rest cap at 3x,
 * 5x, 10x, 20x and 25x, where the Balanced profile's surviving weights sum to 0.09, 0.28, 0.55,
 * 0.77 and 0.92. On the 3x contract the table printed 9% of open interest at 2x while the model
 * placed 100% of it there, and the page's own assumption row says the total modelled notional
 * equals open interest — so the page contradicted itself by a factor of eleven.
 *
 * Exported so the picture and the table it claims to describe cannot be computed two ways.
 */
export function mixUsed(profile: LevProfile, maxLeverage: number): { L: number; share: number }[] {
  const kept = profile.weights.filter(([L]) => L <= maxLeverage);
  const wsum = kept.reduce((a, [, w]) => a + w, 0) || 1;
  return kept.map(([L, w]) => ({ L, share: w / wsum }));
}

/**
 * WHETHER THE PROFILE SWITCH CAN CHANGE ANYTHING ON A CONTRACT WITH THIS CAP.
 *
 * Renormalising over ONE rung gives 100% on that rung whatever the weights were, so on a 3x
 * contract (only 2x survives) Aggressive, Balanced and Conservative are the same vector and draw
 * the same map. The page said otherwise. Measured 16 September 2026 on
 * https://coinliqui.com/liquidations/useless?profile=conservative&win=7 and the Aggressive
 * render of the same URL: both printed "2x | 100.00% | $7.66M", the same $0.26055 / $81K top
 * cluster, the same $135K cleared and the same 54.69% outside the range — under "Change the
 * leverage mix in the form above and the bands move" and "Aggressive — Most size at high
 * leverage". /liquidations/pons and /liquidations/vvv, also 3x, did the same.
 *
 * COMPUTED FROM mixUsed, NOT FROM "cap < 5". A threshold typed here is the lowest rung of today's
 * profiles and would go stale the day a profile gains a 3x rung; comparing the vectors the model
 * actually uses cannot disagree with the model.
 */
export function profilesCoincide(maxLeverage: number, eps = 1e-9): boolean {
  const [first, ...rest] = PROFILES.map((p) => mixUsed(p, maxLeverage));
  return rest.every((m) =>
    m.length === first.length && m.every((r, i) => r.L === first[i].L && Math.abs(r.share - first[i].share) <= eps));
}

/* =========================================================================================
   THE WINDOWS, AND THE ONE TEST FOR "THIS WINDOW CAN BE DRAWN", SHARED BY THE PAGE AND ITS <head>.

   Each window picks a bar size that gives ~180 columns, which is the density at which a candle is
   still a candle rather than a hairline — the price path has to have presence.

   They lived in src/components/LiqMap.astro, which the <head> cannot see: the route builds the meta
   description before the component renders. So the description promised "a modelled heatmap with
   every assumption printed on the page and adjustable" on every contract — measured 16 September
   2026 on https://coinliqui.com/liquidations/pons?profile=balanced&win=30, which printed no heatmap
   and no assumptions table because PONS had too little hourly history for 30 days. One test, read
   by both, means the snippet and the body cannot disagree about whether there is a map.
   ========================================================================================= */
export interface MapWindow { days: number; label: string; factor: number; cols: number }
export const MAP_WINDOWS: MapWindow[] = [
  { days: 7, label: "7 days", factor: 1, cols: 168 },
  { days: 14, label: "14 days", factor: 2, cols: 168 },
  { days: 30, label: "30 days", factor: 4, cols: 180 },
];
export const DEFAULT_WINDOW = MAP_WINDOWS[2];
/** The window a query asks for; anything unknown falls back to the default rather than erroring. */
export const resolveWindow = (q: URLSearchParams): MapWindow =>
  MAP_WINDOWS.find((w) => String(w.days) === q.get("win")) ?? DEFAULT_WINDOW;
/** Enough bars for the window plus a little warm-up, on the series already aggregated to its step. */
export const canDrawMap = (series: Candle[], w: MapWindow) => series.length - w.cols > 4 && series.length > 40;
/** The same test from raw hourly candles, for callers that have not aggregated them. */
export const mapDrawable = (hourly: Candle[] | null | undefined, w: MapWindow) =>
  !!hourly && canDrawMap(slotBars(hourly, 60, w.factor), w);

/* THREE STATES, NOT TWO, BECAUSE "NO MAP" HAS TWO CAUSES AND ONLY ONE OF THEM IS "TOO LITTLE HISTORY".
   getHourly() in src/lib/candles.ts returns null for a key never written, a series written empty, a
   KV read that threw and a failed upstream fetch alike. The first version of this test was a
   boolean, and the <head> and the page both turned `false` into "too little hourly price history".
   Measured 16 September 2026 on http://localhost:4322/liquidations/paxg?profile=balanced&win=7:
   two loads out of three read no series and printed "PAXG has too little hourly price history for
   it" and "PAXG has no map in any window yet"; the third drew a full 7-day map of 168 bars. So
   `short` is said only when a series WAS read and is too short, and `unread` claims nothing about
   the history beyond that none could be read — which is true of all four causes. */
export type MapState = "drawn" | "short" | "unread";
export const mapState = (hourly: Candle[] | null | undefined, w: MapWindow): MapState =>
  !hourly ? "unread" : mapDrawable(hourly, w) ? "drawn" : "short";

export function buildLiqMap(opts: {
  /** full series INCLUDING the warm-up that precedes the drawn window */
  candles: Candle[];
  /** index in `candles` of the first drawn column */
  start: number;
  cols: number;
  mmf: number;
  maxLeverage: number;
  /* THE NAME WAS `openInterest` AND THE VALUE IS USD NOTIONAL. src/lib/hyperliquid.ts:38
     declares `openInterest: number; // base units` on the perp itself, and the only caller
     passes `perp.oiNotional` — two fields, one name, different units, in one codebase. The
     value this function RETURNS was already called `totalNotional`, which is the same fact
     admitted at the other end. A future caller passing the base-units field would scale the
     whole map by the price of the asset — 71,000x on BTC — and produce a plausible picture
     nothing would flag, because both are numbers. */
  oiNotional: number;
  profile: LevProfile;
  rows?: number;
  /** assumed position life, in bars of this series */
  ageBars?: number;
  /** minimum drawn price span, as a fraction of last price */
  minSpan?: number;
  /** a live price the axis must reach LADDER_REACH either side of — see the note at the range */
  reach?: number;
  /** draw on exactly this axis instead of fitting one: the 24-hours-ago map uses today's, so the
   *  two are compared row for row at the same prices */
  axis?: { lo: number; hi: number };
}): LiqMap {
  const rows = opts.rows ?? 150;
  const ageBars = opts.ageBars ?? 84;
  const warm = Math.min(opts.start, ageBars);
  const all = opts.candles.slice(opts.start - warm, opts.start + opts.cols);
  const NC = all.length;
  const disp = all.slice(warm);
  const cols = disp.length;

  /* Each cohort is sized so that positions left unswept would total exactly current OI. The
     trailing-window denominator is what removes the accumulation trend: without it, older
     bars keep adding and the right of the picture is always brighter than the left. */
  const vol = all.map((c) => c[5]);
  const trail: number[] = [];
  let run = 0;
  for (let i = 0; i < NC; i++) {
    run += vol[i];
    if (i >= ageBars) run -= vol[i - ageBars];
    trail.push(i >= ageBars ? run : (run * ageBars) / (i + 1));
  }

  /* PRICE AXIS FITTED TO THE TRADED RANGE. Fitting to the extremes of the model let a 2x
     level 50% away stretch the axis until real price movement was a flat squiggle. The
     traded range sets the axis; levels beyond it clip, and the clipped share is disclosed.
     The minimum span stops a very quiet window from zooming into noise, and the 6% headroom keeps
     the outermost band off the frame edge, where it would read as a border artifact. */
  const tradedLo = Math.min(...disp.map((c) => c[3]));
  const tradedHi = Math.max(...disp.map((c) => c[2]));
  const last = disp[disp.length - 1][4];
  const fromTraded = (tradedHi - tradedLo) * 1.14;
  const fromMinSpan = last * (opts.minSpan ?? MIN_SPAN);
  /* Which rule won matters to the reader, so it is reported rather than assumed. In a quiet
     window the minimum span wins and the axis is NOT fitted to the traded range — saying it is would
     be a false statement on a page whose whole argument is that its inputs are stated. */
  const spanRule: "traded" | "minSpan" = fromTraded >= fromMinSpan ? "traded" : "minSpan";
  const span = Math.max(fromTraded, fromMinSpan) * 1.06;
  const mid = (tradedHi + tradedLo) / 2;
  let hiPrice = mid + span / 2, loPrice = Math.max(0, mid - span / 2);
  /* THE AXIS REACHES THE MOVES THE PAGE PRINTS. Fitted to the traded range alone, ETH's axis ended
     4.6% under the live mark (15 October 2026), so the map's −5% and −10% rows both read "every long
     inside the range", $206.3M, the same figure twice — an honest mark on a question the page did
     not answer. So when a live price is given the axis is widened, never narrowed, to LADDER_REACH
     either side of it. Widening only adds rows of price the model already places levels in; it
     takes resolution from the picture, which is the price of answering. */
  const reached = opts.reach !== undefined &&
    (opts.reach * (1 + LADDER_REACH) > hiPrice || opts.reach * (1 - LADDER_REACH) < loPrice);
  if (opts.reach !== undefined) {
    hiPrice = Math.max(hiPrice, opts.reach * (1 + LADDER_REACH));
    loPrice = Math.max(0, Math.min(loPrice, opts.reach * (1 - LADDER_REACH)));
  }
  if (opts.axis) { hiPrice = opts.axis.hi; loPrice = opts.axis.lo; }
  const band = (hiPrice - loPrice) / rows;

  /* For each price row, the first future bar that trades through it. Quantising the level to
     its row FIRST turns a per-level search into one backward scan per row: O(rows x bars)
     instead of O(levels x bars), which is the difference between fitting a Worker's CPU
     budget and not. */
  const lows = all.map((c) => c[3]), highs = all.map((c) => c[2]);
  const sweepDn: Int32Array[] = [], sweepUp: Int32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const P = hiPrice - (r + 0.5) * band;
    const dn = new Int32Array(NC + 1).fill(NC), up = new Int32Array(NC + 1).fill(NC);
    for (let j = NC - 1; j >= 0; j--) {
      dn[j] = lows[j] <= P ? j : dn[j + 1];
      up[j] = highs[j] >= P ? j : up[j + 1];
    }
    sweepDn.push(dn); sweepUp.push(up);
  }

  const lev = mixUsed(opts.profile, opts.maxLeverage);
  const diff: Float64Array[] = Array.from({ length: rows }, () => new Float64Array(NC + 1));
  /* Cleared is an EVENT, not a range: it happens in one bar, at one price row, so it is
     accumulated directly rather than prefix-summed like the standing field. */
  const clearedAll: Float64Array[] = Array.from({ length: rows }, () => new Float64Array(NC));
  const swept = new Float64Array(NC);
  const clusterAcc = new Map<string, Cluster>();
  const standLong = Array.from({ length: rows }, () => new Array<number>(lev.length).fill(0));
  const standShort = Array.from({ length: rows }, () => new Array<number>(lev.length).fill(0));
  let clipped = 0, placed = 0;

  for (let i = 0; i < NC; i++) {
    const base = (opts.oiNotional * vol[i]) / Math.max(1e-9, trail[i]) / LIFE;
    if (!(base > 0)) continue;
    const close = all[i][4];
    for (let li = 0; li < lev.length; li++) {
      const { L: Lv, share: w } = lev[li];
      const longLiq = (close * (1 - 1 / Lv)) / (1 - opts.mmf);
      const shortLiq = (close * (1 + 1 / Lv)) / (1 + opts.mmf);
      for (const [price, isLong] of [[longLiq, true], [shortLiq, false]] as [number, boolean][]) {
        const half = (base * w) / 2;
        if (price < loPrice || price > hiPrice) { clipped += half; continue; }
        const r0 = Math.floor((hiPrice - price) / band);
        const sw = isLong ? sweepDn : sweepUp;
        for (const [dk, kw] of KERNEL) {
          const r = r0 + dk;
          if (r < 0 || r >= rows) continue;
          const swAt = sw[r][Math.min(NC, i + 1)];
          for (const [frac, tw] of TRANCHES) {
            const share = half * kw * tw;
            placed += share;
            const expire = Math.min(NC, i + Math.round(ageBars * frac));
            const end = Math.min(expire, swAt);
            diff[r][i] += share;
            diff[r][end] -= share;
            if (swAt < expire && swAt < NC) { swept[swAt] += share; clearedAll[r][swAt] += share; }
            if (end === NC) {
              (isLong ? standLong : standShort)[r][li] += share;
              const key = `${r}:${isLong ? "l" : "s"}`;
              const prev = clusterAcc.get(key);
              if (prev) prev.notional += share;
              else clusterAcc.set(key, { price: hiPrice - (r + 0.5) * band, notional: share, side: isLong ? "long" : "short", fromClose: 0 });
            }
          }
        }
      }
    }
  }

  const grid: number[][] = [];
  let peak = 0;
  const sorted: number[] = [];
  for (let r = 0; r < rows; r++) {
    const line = new Array<number>(cols);
    let acc = 0;
    const d = diff[r];
    for (let c = 0; c < NC; c++) {
      acc += d[c];
      if (c >= warm) {
        const v = acc > 1 ? acc : 0;
        line[c - warm] = v;
        if (v > 0) { sorted.push(v); if (v > peak) peak = v; }
      }
    }
    grid.push(line);
  }
  sorted.sort((a, b) => a - b);

  const cleared: number[][] = [];
  let clearedPeak = 0;
  for (let r = 0; r < rows; r++) {
    const line = new Array<number>(cols);
    for (let c = 0; c < cols; c++) {
      const v = clearedAll[r][warm + c];
      line[c] = v;
      if (v > clearedPeak) clearedPeak = v;
    }
    cleared.push(line);
  }

  const clusters = [...clusterAcc.values()]
    .map((c) => ({ ...c, fromClose: (c.price - last) / last }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 10);

  return {
    grid, rows, cols, loPrice, hiPrice, band,
    candles: disp, sorted, peak,
    cleared, clearedPeak,
    swept: Array.from(swept.slice(warm)),
    clusters,
    clipped: clipped / Math.max(1e-9, clipped + placed),
    tradedLo, tradedHi,
    totalNotional: opts.oiNotional,
    ageBars, spanRule, reached, warmBars: warm,
    standing: { long: standLong, short: standShort, levs: lev.map((x) => x.L) },
  };
}

/* =========================================================================================
   THE LIQUIDATION MAP: WHAT IS STANDING NOW, BY PRICE, AND WHAT A MOVE WOULD TAKE.

   The heatmap answers "where did levels sit, and which did price clear" across a window. The
   question a trader opens a liquidation map with is narrower and more urgent: if price goes to
   X from here, how much gets closed on the way? That is a cumulative sum outward from the mark
   over the standing set — longs below, shorts above — and it is the whole of this function.

   Everything here is the model's standing set re-binned, so every figure carries the model's
   assumptions and nothing new. A level outside the drawn price range is not in the set (it is
   in `clipped`), so a cumulative figure is "within the drawn range" and says so where printed.
   ========================================================================================= */
export interface LevelBin {
  lo: number; hi: number; mid: number;
  /** standing notional per leverage rung (same order as `levs`) */
  long: number[]; short: number[];
  longSum: number; shortSum: number;
}
export interface LevelsView {
  bins: LevelBin[];
  levs: number[];
  mark: number;
  /** cumulative notional liquidated by a move from the mark to a price, for any price */
  cumAt: (price: number) => { side: "long" | "short"; notional: number };
  /** the rows cumAt reads, published on the page so the reader's own price is read by the same
   *  function in the browser — see cumulativeAt() in public/shared.js */
  curve: LevelsCurve;
  /** the drawn range: a price outside it is read with every row of its side, and no more */
  lo: number; hi: number;
  /** the standard reads: a move of ±k% from the mark */
  moves: { pct: number; price: number; side: "long" | "short"; notional: number; beyond: boolean }[];
  totalLong: number; totalShort: number;
  peakBin: number;
}

export interface LevelsCurve { hi: number; band: number; long: number[]; short: number[] }

export const MOVE_STEPS = [0.01, 0.02, 0.05, 0.1];

export function levelsView(m: LiqMap, mark: number, binRows = 2): LevelsView {
  const levs = m.standing.levs;
  const bins: LevelBin[] = [];
  /* Row 0 is the HIGHEST price; bins are built low to high so they read left to right. */
  for (let r = m.rows - 1; r >= 0; r -= binRows) {
    const rs = Array.from({ length: binRows }, (_, k) => r - k).filter((x) => x >= 0);
    const lo = m.hiPrice - (rs[rs.length - 1] + 1) * m.band;
    const hi = m.hiPrice - rs[0] * m.band;
    const long = levs.map((_, li) => rs.reduce((a, x) => a + m.standing.long[x][li], 0));
    const short = levs.map((_, li) => rs.reduce((a, x) => a + m.standing.short[x][li], 0));
    bins.push({
      lo: Math.min(lo, hi), hi: Math.max(lo, hi), mid: (lo + hi) / 2,
      long, short,
      longSum: long.reduce((a, b) => a + b, 0), shortSum: short.reduce((a, b) => a + b, 0),
    });
  }
  /* THE CUMULATIVE FIGURES ARE READ FROM THE MODEL'S OWN ROWS, NOT FROM THE DRAWN BINS. The first
     version summed the display bins, and changing the bin size from two rows to three moved the
     "−1%" figure from $837K to $5.2M on the same data (BTC, 15 October 2026): a bin straddling the
     line was counted whole. A row is the finest price the model resolves, so the reading no longer
     depends on how the picture is cut.

     A LONG level above the mark (or a short below it) can stand only between the last drawn close
     and the live mark: price has not traded through it on the hourly series yet. It is still a
     level a move from the mark reaches at once, so it is counted from the first step. */
  /* Whole dollars, because the curve is published in the page and the server reads the SAME
     rounded rows it publishes: a figure printed here and a figure read from the curve by the
     page's script are then one sum, not two that agree to within rounding. */
  const rowSums = (side: number[][]) => side.map((xs) => Math.round(xs.reduce((a, b) => a + b, 0)));
  const curve: LevelsCurve = { hi: m.hiPrice, band: m.band, long: rowSums(m.standing.long), short: rowSums(m.standing.short) };
  const cumAt = (price: number) => cumulativeAt(curve, mark, price) as { side: "long" | "short"; notional: number };
  /* A STANDARD MOVE CAN LAND PAST THE DRAWN RANGE — BTC's −10% sat at $73,149 under a range ending
     at $73,593 (15 October 2026) — and its figure is then every level of that side INSIDE the range,
     not the move's total. `beyond` lets the table say so, as atReading() does for a reader's price. */
  const beyond = (p: number) => p < m.loPrice || p > m.hiPrice;
  const moves = MOVE_STEPS.flatMap((k) => [
    { pct: -k, price: mark * (1 - k), ...cumAt(mark * (1 - k)), beyond: beyond(mark * (1 - k)) },
    { pct: k, price: mark * (1 + k), ...cumAt(mark * (1 + k)), beyond: beyond(mark * (1 + k)) },
  ]);
  return {
    bins, levs, mark, cumAt, moves, curve,
    lo: m.loPrice, hi: m.hiPrice,
    totalLong: bins.reduce((a, b) => a + b.longSum, 0),
    totalShort: bins.reduce((a, b) => a + b.shortSum, 0),
    peakBin: Math.max(1, ...bins.map((b) => b.longSum + b.shortSum)),
  };
}

/**
 * THE MAP'S TITLE AND DESCRIPTION, ONCE, BECAUSE TWO ROUTES NOW RENDER THE MAP.
 *
 * `/liquidations` serves the pinned default and `/liquidations/{symbol}` serves the rest.
 * Both need the same <title> shape and the same meta description, and a template string
 * copied into a second file is a copy that drifts — the two sitemap lists in
 * src/lib/routes.ts drifted by 22 URLs before anything compared them. One implementation
 * means the search result for BTC and the search result for ETH cannot describe two
 * differently-worded products.
 */
/* THE TITLE NAMES WHAT THE PAGE DRAWS, LIKE THE DESCRIPTION BENEATH IT. It was "PONS liquidation
   heatmap (modelled)" in every state, so once the description learned to say the heatmap was not
   drawn, the <head> contradicted itself — measured 16 September 2026 on
   http://localhost:4322/liquidations/pons (30-day window, no map): that title over "The modelled
   30-day heatmap is not drawn yet". Without a map the page carries the corridor table — long and
   short liquidation prices per leverage, labelled "derived, not modelled" — so that is its name.
   Both tags read the same MapState, so they cannot disagree about whether there is a heatmap. */
export const mapTitle = (symbol: string, state: MapState) =>
  state === "drawn" ? `${symbol} liquidation heatmap (modelled)` : `${symbol} liquidation prices by leverage (derived)`;
/* THE DESCRIPTION IS OF THE PAGE AT THAT ADDRESS, IN THE STATE IT RENDERS. It read "a modelled
   heatmap with every assumption printed on the page and adjustable" everywhere. Two of the eight
   assumptions are adjustable (the leverage mix and the window), not all of them; on a 3× cap the
   mix changes nothing (see profilesCoincide); and a contract without enough hourly history prints
   no heatmap and no assumptions at all — see the note on MAP_WINDOWS for the URL. `state` comes
   from mapState() and the cap from the same tier-1 row the page charts, so each clause is stated
   only in the state where it holds — and "too little history" only when a series was read and
   found short (see MapState for the PAXG render that said it about a failed read). */
export const mapDescription = (symbol: string, at: { state: MapState; maxLeverage: number; days: number; reading?: string | null; asOf: string }) =>
  /* A shared ?at= link unfurls as its own answer. The canonical is the bare path, so this text is
     what a chat preview shows, not a second indexed description. */
  at.state === "drawn" && at.reading
    /* WITH ITS MOMENT, ALWAYS DATED. A chat caches an unfurl, so the figure is read hours or days
       after it was true; without a stamp yesterday's sum reads as today's. */
    ? `${symbol} at ${at.asOf}: ${at.reading} Modelled from Hyperliquid's price path and open interest, every assumption printed on the page.`
    : at.state === "drawn"
    ? `Where ${symbol} liquidation levels sit on Hyperliquid and which ones price has already cleared — a modelled heatmap with every assumption printed on the page${profilesCoincide(at.maxLeverage) ? "" : " and the leverage mix switchable"}, beside the liquidation prices derived from the published margin tiers.`
    : `Liquidation prices for ${symbol} on Hyperliquid, derived from the published margin tiers and the live mark. The modelled ${at.days}-day heatmap is not drawn ${at.state === "short" ? `yet: ${symbol} has too little hourly price history for it` : `on this page: no hourly price history for ${symbol} could be read`}.`;

/* =========================================================================================
   THE MAP FOR ONE PAGE VIEW, COMPUTED ONCE, BY THE ROUTE.

   It lived inside src/components/LiqMap.astro, which is rendered after the <head>. So the head
   could not know what the page answered: a link to /liquidations?at=78000 sent to a chat unfurled
   as the generic page description, and the one thing that link carries — what a move to 78,000
   closes — was missing exactly where its recipient sees it. The routes now call this, put the
   reading in the description, and hand the same object to the component, so the model still runs
   once per request and the head and the body read one result.
   ========================================================================================= */
/** Position life: how long a modelled position stays open before it is assumed closed. */
export const POSITION_LIFE_DAYS = 14;
export const DEFAULT_PROFILE = PROFILES[1];

/** When the day-earlier run's candles end, for a view: the route reads that contract's open interest
 *  at this moment, so the earlier run's positions and its price path are of one time (they were two
 *  hours apart on the first deploy, 15 October 2026). Null when there is no such cut. */
export function dayEarlierCut(hourly: { d: Candle[] } | null | undefined, q: URLSearchParams): number | null {
  const win = resolveWindow(q);
  const series = slotBars(hourly?.d, 60, win.factor);
  const shift = Math.round(24 / win.factor);
  return series.length > shift ? series[series.length - shift][0] : null;
}

export function mapModel(o: {
  hourly: { d: Candle[] } | null | undefined;
  q: URLSearchParams;
  mark: number; oiNotional: number; maxLeverage: number; mmf: number;
  /** this contract's open interest about a day ago, from the hourly oi_snapshot; null when the
   *  store has none — then the page shows no change rather than an invented one */
  oiThen?: { oi: number; at: number } | null;
}) {
  const win = resolveWindow(o.q);
  const profile = PROFILES.find((p) => p.key === o.q.get("profile")) ?? DEFAULT_PROFILE;
  const ageBars = Math.round((POSITION_LIFE_DAYS * 24) / win.factor);
  /* Columns sit on fixed 2- and 4-hour slots (slotBars), so they do not move with the render hour. */
  const series: Candle[] = slotBars(o.hourly?.d, 60, win.factor);
  const start = series.length - win.cols;
  const map = canDrawMap(series, win)
    ? buildLiqMap({
        candles: series, start, cols: win.cols, mmf: o.mmf, maxLeverage: o.maxLeverage,
        oiNotional: o.oiNotional, profile, rows: 150, ageBars, reach: o.mark,
      })
    : null;
  const levels = map ? levelsView(map, o.mark, 3) : null;
  /* THE READER'S OWN PRICE (?at=), parsed by the one parser the script also uses. An unreadable
     value is kept as typed so the page can say it could not read it, rather than show nothing. */
  const atRaw = o.q.get("at");
  const at = atRaw === null ? null : parsePrice(atRaw);
  const dp = axisDp(o.mark);
  /* THE SAME MAP A DAY AGO, ON TODAY'S AXIS. The same model, the same profile and window, run on the
     candles that had closed 24 hours earlier and on the open interest recorded then — and drawn on
     today's price rows, so a row is the same prices in both and the difference is the change. What it
     is not: a record of what stood yesterday. It is what this model said yesterday, which is the
     only thing a comparison of two model runs can honestly be. */
  const shift = Math.round(24 / win.factor);
  const prior = series.slice(0, Math.max(0, series.length - shift));
  const then = map && o.oiThen && o.oiThen.oi > 0 && canDrawMap(prior, win)
    ? (() => {
        const m = buildLiqMap({
          candles: prior, start: prior.length - win.cols, cols: win.cols, mmf: o.mmf, maxLeverage: o.maxLeverage,
          oiNotional: o.oiThen!.oi, profile, rows: 150, ageBars, axis: { lo: map.loPrice, hi: map.hiPrice },
        });
        return {
          levels: levelsView(m, o.mark, 3),
          /** when the earlier run's last candle closed, and when its open interest was read */
          candlesTo: dayEarlierCut(o.hourly, o.q)!, oiAt: o.oiThen!.at,
          /** modelled notional price traded through in the day between the two runs */
          cleared: map.swept.slice(-shift).reduce((a, b) => a + b, 0),
        };
      })()
    : null;
  const reading = levels && at !== null ? atReading(levels.curve, o.mark, at, levels.lo, levels.hi, dp, then ? then.levels.curve : null) as string : null;
  return { win, profile, ageBars, map, levels, at, atRaw, dp, reading, then };
}
export type MapModel = ReturnType<typeof mapModel>;
