import { type Candle, type FundingPoint, T, O, H, L, C, V } from "./candles.ts";

/**
 * Chart geometry: candles, volume, and the funding band.
 *
 * COLOUR CONTRACT. Red and green encode the direction of a funding payment and nothing
 * else. Candles therefore CANNOT be red/green — they are monochrome, light for up and
 * muted for down, and the accent is reserved for interaction (crosshair, last price,
 * current-price pill). The one place hue is licensed is the funding band, which makes the
 * dataset nobody else charts the loudest thing on the picture.
 */

export interface Timeframe {
  key: string; label: string;
  base: "hour" | "day";
  factor: number; bars: number;
  fmt: (d: Date) => string;
  /** hours covered by one bar — used to bucket funding onto the same axis */
  hours: number;
}

const hm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const dm = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const my = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export const TIMEFRAMES: Timeframe[] = [
  { key: "1h", label: "1H", base: "hour", factor: 1, bars: 240, fmt: hm, hours: 1 },
  { key: "4h", label: "4H", base: "hour", factor: 4, bars: 168, fmt: dm, hours: 4 },
  { key: "1d", label: "1D", base: "day", factor: 1, bars: 200, fmt: dm, hours: 24 },
  { key: "1w", label: "1W", base: "day", factor: 7, bars: 112, fmt: my, hours: 168 },
];
export const DEFAULT_TF = "1d";

export function aggregate(src: Candle[], factor: number): Candle[] {
  if (factor <= 1) return src;
  const out: Candle[] = [];
  for (let end = src.length; end > 0; end -= factor) {
    const s = src.slice(Math.max(0, end - factor), end);
    if (!s.length) continue;
    out.unshift([s[0][T], s[0][O], Math.max(...s.map((c) => c[H])), Math.min(...s.map((c) => c[L])), s[s.length - 1][C], s.reduce((a, c) => a + c[V], 0)]);
  }
  return out;
}

export interface Bar {
  x: number; w: number; up: boolean;
  bodyY: number; bodyH: number; wickTop: number; wickBot: number;
  volY: number; volH: number;
  fundY: number; fundH: number; apr: number | null;
  t: number; o: number; h: number; l: number; c: number; v: number;
}
export interface Flip { x: number; t: number; toPositive: boolean }

export interface PriceChart {
  bars: Bar[];
  flips: Flip[];
  lo: number; hi: number;
  price: { y: number; h: number };
  vol: { y: number; h: number };
  fund: { y: number; h: number; zero: number; max: number; fromX: number | null; fromT: number | null } | null;
  yTicks: { v: number; y: number }[];
  xTicks: { label: string; x: number }[];
  plotX: number; plotW: number;
  last: number; lastY: number;
  change: number; high: number; low: number; volume: number;
  fundingCoverage: number;
  points: number[][];
}

export interface Layout { w: number; h: number; padR: number; padL: number; padT: number; padB: number; volH: number; fundH: number; gap: number }
export const LAYOUT: Layout = { w: 1180, h: 620, padR: 88, padL: 14, padT: 14, padB: 30, volH: 66, fundH: 116, gap: 10 };

export function buildPriceChart(candles: Candle[], funding: FundingPoint[] | null, tf: Timeframe, ly: Layout = LAYOUT): PriceChart | null {
  if (candles.length < 3) return null;

  const plotX = ly.padL;
  const plotW = ly.w - ly.padL - ly.padR;
  /* A funding panel covering 3% of a two-year chart is noise. Below a floor the panel is
     dropped and the page says why, rather than drawing a sliver at the right edge. */
  const covPre = funding && funding.length > 4
    ? (() => { const barMs = tf.hours * 3_600_000; const ks = new Set(funding.map(([t]) => Math.floor(t / barMs) * barMs));
        return candles.filter((c) => ks.has(Math.floor(c[T] / barMs) * barMs)).length / candles.length; })()
    : 0;
  const fundOn = covPre >= 0.06;
  const fundH = fundOn ? ly.fundH : 0;
  const priceH = ly.h - ly.padT - ly.padB - ly.volH - fundH - ly.gap * (fundOn ? 2 : 1);
  const priceY = ly.padT;
  const volY = priceY + priceH + ly.gap;
  const fundY = volY + ly.volH + ly.gap;

  const hiRaw = Math.max(...candles.map((c) => c[H]));
  const loRaw = Math.min(...candles.map((c) => c[L]));
  const span = Math.max(1e-9, hiRaw - loRaw);
  const hi = hiRaw + span * 0.06, lo = Math.max(0, loRaw - span * 0.06);
  const yOf = (v: number) => priceY + ((hi - v) / (hi - lo)) * priceH;

  const n = candles.length;
  const slot = plotW / n;
  const bw = Math.max(1.2, Math.min(14, slot * 0.68));
  const xOf = (i: number) => plotX + slot * (i + 0.5);

  const volMax = Math.max(...candles.map((c) => c[V]), 1);

  /* Funding is bucketed onto the SAME bars: mean APR over each bar's window. HL settles
     hourly, so APR = rate x 8760. */
  const aprAt = new Map<number, number>();
  let covered = 0;
  if (fundOn) {
    const barMs = tf.hours * 3_600_000;
    const acc = new Map<number, { s: number; n: number }>();
    for (const [t, rate] of funding!) {
      const k = Math.floor(t / barMs) * barMs;
      const a = acc.get(k) ?? { s: 0, n: 0 };
      a.s += rate * 8760; a.n++;
      acc.set(k, a);
    }
    for (const c of candles) {
      const k = Math.floor(c[T] / barMs) * barMs;
      const a = acc.get(k);
      if (a && a.n) { aprAt.set(c[T], a.s / a.n); covered++; }
    }
  }
  // where coverage actually begins, so the gap is labelled rather than looking like a bug
  let coverFromX: number | null = null, coverFromT: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    if (aprAt.has(candles[i][T])) { coverFromX = +xOf(i).toFixed(2); coverFromT = candles[i][T]; break; }
  }
  const fundMax = Math.max(0.01, ...[...aprAt.values()].map((v) => Math.abs(v)));
  const fundZero = fundY + fundH / 2;
  const fundScale = (fundH / 2 - 4) / fundMax;

  const bars: Bar[] = candles.map((c, i) => {
    const up = c[C] >= c[O];
    const bt = yOf(Math.max(c[O], c[C])), bb = yOf(Math.min(c[O], c[C]));
    const apr = aprAt.has(c[T]) ? aprAt.get(c[T])! : null;
    const fh = apr === null ? 0 : Math.max(1, Math.abs(apr) * fundScale);
    return {
      x: +xOf(i).toFixed(2), w: +bw.toFixed(2), up,
      bodyY: +bt.toFixed(2), bodyH: +Math.max(1, bb - bt).toFixed(2),
      wickTop: +yOf(c[H]).toFixed(2), wickBot: +yOf(c[L]).toFixed(2),
      volH: +Math.max(1, (c[V] / volMax) * ly.volH).toFixed(2),
      volY: +(volY + ly.volH - Math.max(1, (c[V] / volMax) * ly.volH)).toFixed(2),
      fundY: +(apr === null ? fundZero : apr >= 0 ? fundZero - fh : fundZero).toFixed(2),
      fundH: +fh.toFixed(2), apr,
      t: c[T], o: c[O], h: c[H], l: c[L], c: c[C], v: c[V],
    };
  });

  /* Sign flips come straight out of the funding series — no recorded history required.
     Deduped to ONE marker per bar: hourly funding on a daily chart produces dozens of flips
     inside a single candle, and a row of overlapping triangles says nothing. */
  const flips: Flip[] = [];
  if (fundOn) {
    const sorted = [...funding!].sort((a, b) => a[0] - b[0]);
    const t0 = candles[0][T];
    const seen = new Map<number, boolean>();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][0] < t0) continue;
      const a = sorted[i - 1][1], b = sorted[i][1];
      if (a === 0 || b === 0 || a < 0 === b < 0) continue;
      let idx = 0;
      for (let j = 0; j < candles.length; j++) if (candles[j][T] <= sorted[i][0]) idx = j;
      if (seen.has(idx)) continue;
      seen.set(idx, true);
      flips.push({ x: +xOf(idx).toFixed(2), t: candles[idx][T], toPositive: b > 0 });
    }
  }

  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const v = hi - ((hi - lo) * i) / 5;
    return { v, y: +yOf(v).toFixed(2) };
  });
  const every = Math.max(1, Math.floor(n / 7));
  const xTicks: { label: string; x: number }[] = [];
  for (let i = every >> 1; i < n; i += every) xTicks.push({ label: tf.fmt(new Date(candles[i][T])), x: +xOf(i).toFixed(2) });

  const first = candles[0][C], last = candles[n - 1][C];
  return {
    bars, flips, lo, hi,
    price: { y: priceY, h: priceH },
    vol: { y: volY, h: ly.volH },
    fund: fundOn ? { y: fundY, h: fundH, zero: fundZero, max: fundMax, fromX: coverFromX, fromT: coverFromT } : null,
    yTicks, xTicks, plotX, plotW,
    last, lastY: +yOf(last).toFixed(2),
    change: first ? (last - first) / first : 0,
    high: hiRaw, low: loRaw,
    volume: candles.reduce((s, c) => s + c[V], 0),
    fundingCoverage: n ? covered / n : 0,
    // [x, t, o, h, l, c, v, apr, closeY] — the crosshair reads exactly what was drawn
    points: bars.map((b) => [b.x, b.t, b.o, b.h, b.l, b.c, b.v, b.apr === null ? NaN : +b.apr.toFixed(6), +yOf(b.c).toFixed(2)]),
  };
}
