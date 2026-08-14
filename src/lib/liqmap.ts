/**
 * MODELLED liquidation density — price on Y, time on X.
 *
 * This file produces a MODEL. It is not an observation and must never be presented as one.
 * No venue publishes the distribution of open positions by leverage and entry price, so any
 * surface of this kind rests on assumptions. The response is to state them, print them next
 * to the picture, and let the reader change them — not to refuse to draw it.
 *
 * THE ASSUMPTIONS, in the order they are applied:
 *
 *  1. HOW MUCH is open. Total modelled notional is set equal to the contract's CURRENT open
 *     interest, which is observed. The model redistributes a real quantity rather than
 *     inventing one.
 *  2. WHEN it was opened. That notional is spread across the bars of the window in
 *     proportion to each bar's TRADED VOLUME, which is observed. Busy hours carry more
 *     positions than quiet ones.
 *  3. AT WHAT LEVERAGE. Split across leverage buckets by a weight vector the reader picks.
 *     This is the assumption with the most influence and the least evidence behind it.
 *  4. WHICH WAY. Long and short in equal measure.
 *  5. WHAT HAPPENS NEXT. A position is only ever removed by liquidation — nobody takes
 *     profit, adds margin or closes manually. This overstates how much survives to the
 *     present, and it is the assumption most obviously wrong in detail.
 *
 * Everything downstream of those five inputs is arithmetic on published margin tiers.
 */

import type { Candle } from "./candles.ts";
export type HCandle = Candle; // [t,o,h,l,c,v]

export interface LevProfile {
  key: string;
  label: string;
  note: string;
  /** leverage -> share of notional; shares sum to 1 */
  weights: [number, number][];
}

export const PROFILES: LevProfile[] = [
  {
    key: "aggressive",
    label: "Aggressive",
    note: "Most size at high leverage. Closest to what a retail-dominated perp book is usually assumed to look like.",
    weights: [[40, 0.22], [25, 0.24], [20, 0.2], [10, 0.18], [5, 0.11], [2, 0.05]],
  },
  {
    key: "balanced",
    label: "Balanced",
    note: "Weight spread across the range, tilted slightly to the middle. A deliberately unopinionated default.",
    weights: [[40, 0.08], [25, 0.15], [20, 0.22], [10, 0.27], [5, 0.19], [2, 0.09]],
  },
  {
    key: "conservative",
    label: "Conservative",
    note: "Most size at low leverage, as a book dominated by funded desks rather than retail would look.",
    weights: [[40, 0.02], [25, 0.06], [20, 0.12], [10, 0.25], [5, 0.32], [2, 0.23]],
  },
];

export interface Cluster {
  price: number;
  notional: number;
  side: "long" | "short";
  distance: number;
}

export interface LiqMap {
  /** density[row][col], notional USD; row 0 is the HIGHEST price */
  grid: number[][];
  rows: number;
  cols: number;
  priceAt: (row: number) => number;
  bucketLo: number[];
  bucketHi: number[];
  times: number[];
  closes: number[];
  maxDensity: number;
  totalNotional: number;
  clusters: Cluster[];
  loPrice: number;
  hiPrice: number;
  /** share of modelled notional sitting outside the drawn price range */
  clippedMass: number;
}

/**
 * Difference-array accumulation: each modelled level contributes to one price bucket over a
 * contiguous span of time, so it is added once at its start and removed once at its end,
 * then prefix-summed. O(levels + cells) instead of O(levels x cells) — the difference
 * between fitting a Worker's CPU budget and not.
 */
export function buildLiqMap(opts: {
  candles: HCandle[];
  mark: number;
  mmf: number;
  maxLeverage: number;
  openInterest: number;
  profile: LevProfile;
  rows?: number;
}): LiqMap {
  const { candles, mark, mmf, maxLeverage, openInterest, profile } = opts;
  const rows = opts.rows ?? 44;
  const cols = candles.length;

  /* The profile gives ANCHOR weights at a handful of leverages. Real books do not cluster on
     six round numbers, and six anchors draw six fat stripes instead of a density. Interpolate
     the anchors onto a dense ladder so the surface has the texture it should. */
  const anchors = profile.weights.filter(([L]) => L <= maxLeverage).sort((a, b) => a[0] - b[0]);
  const LADDER = 20;
  const lo = anchors[0][0], hi = anchors[anchors.length - 1][0];
  const weights: [number, number][] = [];
  for (let i = 0; i < LADDER; i++) {
    const L = lo + ((hi - lo) * i) / (LADDER - 1);
    let w = 0;
    for (let a = 0; a < anchors.length - 1; a++) {
      const [l0, w0] = anchors[a], [l1, w1] = anchors[a + 1];
      if (L >= l0 && L <= l1) { w = w0 + ((w1 - w0) * (L - l0)) / Math.max(1e-9, l1 - l0); break; }
    }
    if (w > 0) weights.push([L, w]);
  }
  const wSum = weights.reduce((s, [, w]) => s + w, 0) || 1;

  /* Fit the price axis to where the modelled NOTIONAL is, not to its extremes. Fitting to
     extremes let a 2x level 50% away stretch the axis and squeeze the region that matters
     into a thin strip. Take the central 92% of notional by price, then make sure the traded
     range is included — the price path must never leave its own chart. */
  const volSumForFit = candles.reduce((s, c) => s + (c[5] || 0), 0) || 1;
  const pts: [number, number][] = [];
  for (const c of candles) {
    const bar = (c[5] || 0) / volSumForFit;
    for (const [L, w] of weights) {
      pts.push([(c[4] * (1 - 1 / L)) / (1 - mmf), bar * w]);
      pts.push([(c[4] * (1 + 1 / L)) / (1 + mmf), bar * w]);
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  const massTotal = pts.reduce((s, x) => s + x[1], 0) || 1;
  const pick = (frac: number) => {
    let acc = 0;
    for (const [price, m] of pts) { acc += m; if (acc / massTotal >= frac) return price; }
    return pts[pts.length - 1][0];
  };
  let lvLo = pick(0.04), lvHi = pick(0.96);
  for (const c of candles) { lvLo = Math.min(lvLo, c[3]); lvHi = Math.max(lvHi, c[2]); }
  const clippedMass = pts.filter(([pr]) => pr < lvLo || pr > lvHi).reduce((s, x) => s + x[1], 0) / massTotal;
  const padPx = (lvHi - lvLo) * 0.04;
  const loPrice = lvLo - padPx;
  const hiPrice = lvHi + padPx;
  const band = (hiPrice - loPrice) / rows;
  const rowOf = (p: number) => Math.floor((hiPrice - p) / band);

  const volSum = candles.reduce((s, c) => s + (c[5] || 0), 0) || 1;

  const diff: number[][] = Array.from({ length: rows }, () => new Array(cols + 1).fill(0));
  const clusterAcc = new Map<string, Cluster>();

  for (let i = 0; i < cols; i++) {
    const barNotional = openInterest * ((candles[i][5] || 0) / volSum);
    if (barNotional <= 0) continue;
    const close = candles[i][4];

    for (const [L, w] of weights) {
      const share = (barNotional * w) / wSum / 2; // half long, half short
      const longLiq = (close * (1 - 1 / L)) / (1 - mmf);
      const shortLiq = (close * (1 + 1 / L)) / (1 + mmf);

      for (const [price, side] of [[longLiq, "long"], [shortLiq, "short"]] as const) {
        const r = rowOf(price);
        if (r < 0 || r >= rows) continue;
        // the level survives until price trades through it
        let end = cols;
        for (let j = i + 1; j < cols; j++) {
          if (side === "long" ? candles[j][3] <= price : candles[j][2] >= price) { end = j; break; }
        }
        diff[r][i] += share;
        diff[r][end] -= share;

        const key = `${r}:${side}`;
        const prev = clusterAcc.get(key);
        if (end === cols) {
          // only levels still alive at the right-hand edge are "standing" clusters
          if (prev) prev.notional += share;
          else clusterAcc.set(key, { price: (hiPrice - (r + 0.5) * band), notional: share, side, distance: 0 });
        }
      }
    }
  }

  const grid: number[][] = [];
  let maxDensity = 0;
  for (let r = 0; r < rows; r++) {
    const line = new Array(cols).fill(0);
    let run = 0;
    for (let c = 0; c < cols; c++) {
      run += diff[r][c];
      line[c] = run > 0 ? run : 0;
      if (line[c] > maxDensity) maxDensity = line[c];
    }
    grid.push(line);
  }

  const clusters = [...clusterAcc.values()]
    .map((c) => ({ ...c, distance: (c.price - mark) / mark }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 12);

  return {
    grid, rows, cols,
    priceAt: (row: number) => hiPrice - (row + 0.5) * band,
    bucketLo: Array.from({ length: rows }, (_, r) => hiPrice - (r + 1) * band),
    bucketHi: Array.from({ length: rows }, (_, r) => hiPrice - r * band),
    times: candles.map((c) => c[0]),
    closes: candles.map((c) => c[4]),
    maxDensity,
    totalNotional: openInterest,
    clusters,
    loPrice, hiPrice, clippedMass,
  };
}

/** Single-hue ramp, deep navy -> near white. No red or green: those encode funding direction. */
export const RAMP = ["#1d2531", "#22314b", "#2a4470", "#345c99", "#4278c4", "#5f9ae0", "#8fbdf2", "#c8dffb"];

export function rampColor(v: number, max: number): string | null {
  if (v <= 0 || max <= 0) return null;
  // sqrt keeps the low end visible; a linear ramp buries everything but the top cluster
  const t = Math.sqrt(v / max);
  return RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))))];
}
