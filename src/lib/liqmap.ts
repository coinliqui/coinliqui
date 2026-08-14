import type { Candle } from "./candles.ts";

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

export interface Cluster { price: number; notional: number; side: "long" | "short"; distance: number }

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
  /** bars of warm-up modelled before the first drawn column; short of ageBars means partial */
  warmBars: number;
}

export function buildLiqMap(opts: {
  /** full series INCLUDING the warm-up that precedes the drawn window */
  candles: Candle[];
  /** index in `candles` of the first drawn column */
  start: number;
  cols: number;
  mmf: number;
  maxLeverage: number;
  openInterest: number;
  profile: LevProfile;
  rows?: number;
  /** assumed position life, in bars of this series */
  ageBars?: number;
  /** minimum drawn price span, as a fraction of last price */
  minSpan?: number;
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
  const fromMinSpan = last * (opts.minSpan ?? 0.16);
  /* Which rule won matters to the reader, so it is reported rather than assumed. In a quiet
     window the minimum span wins and the axis is NOT fitted to the traded range — saying it is would
     be a false statement on a page whose whole argument is that its inputs are stated. */
  const spanRule: "traded" | "minSpan" = fromTraded >= fromMinSpan ? "traded" : "minSpan";
  const span = Math.max(fromTraded, fromMinSpan) * 1.06;
  const mid = (tradedHi + tradedLo) / 2;
  const hiPrice = mid + span / 2, loPrice = Math.max(0, mid - span / 2);
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

  const lev = opts.profile.weights.filter(([L]) => L <= opts.maxLeverage);
  const wsum = lev.reduce((a, [, w]) => a + w, 0) || 1;
  const diff: Float64Array[] = Array.from({ length: rows }, () => new Float64Array(NC + 1));
  /* Cleared is an EVENT, not a range: it happens in one bar, at one price row, so it is
     accumulated directly rather than prefix-summed like the standing field. */
  const clearedAll: Float64Array[] = Array.from({ length: rows }, () => new Float64Array(NC));
  const swept = new Float64Array(NC);
  const clusterAcc = new Map<string, Cluster>();
  let clipped = 0, placed = 0;

  for (let i = 0; i < NC; i++) {
    const base = (opts.openInterest * vol[i]) / Math.max(1e-9, trail[i]) / LIFE;
    if (!(base > 0)) continue;
    const close = all[i][4];
    for (const [Lv, w] of lev) {
      const longLiq = (close * (1 - 1 / Lv)) / (1 - opts.mmf);
      const shortLiq = (close * (1 + 1 / Lv)) / (1 + opts.mmf);
      for (const [price, isLong] of [[longLiq, true], [shortLiq, false]] as [number, boolean][]) {
        const half = (base * w) / wsum / 2;
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
              const key = `${r}:${isLong ? "l" : "s"}`;
              const prev = clusterAcc.get(key);
              if (prev) prev.notional += share;
              else clusterAcc.set(key, { price: hiPrice - (r + 0.5) * band, notional: share, side: isLong ? "long" : "short", distance: 0 });
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
    .map((c) => ({ ...c, distance: (c.price - last) / last }))
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
    totalNotional: opts.openInterest,
    ageBars, spanRule, warmBars: warm,
  };
}
