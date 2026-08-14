import { type Candle, T, O, H, L, C, V } from "./candles.ts";

/**
 * Timeframes and chart geometry for the price chart.
 *
 * Only two series are stored: 1h and 1d. 4h and 1w are ROLLED UP from them, so four
 * timeframes cost no extra upstream calls and no extra KV writes.
 */
export interface Timeframe {
  key: string;
  label: string;
  /** which stored series to roll up from */
  base: "hour" | "day";
  /** how many base bars per displayed bar */
  factor: number;
  /** how many displayed bars to show */
  bars: number;
  /** date format for the x axis */
  fmt: (d: Date) => string;
}

const hm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const dm = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const my = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export const TIMEFRAMES: Timeframe[] = [
  { key: "1h", label: "1H", base: "hour", factor: 1, bars: 168, fmt: hm },
  { key: "4h", label: "4H", base: "hour", factor: 4, bars: 84, fmt: dm },
  { key: "1d", label: "1D", base: "day", factor: 1, bars: 120, fmt: dm },
  { key: "1w", label: "1W", base: "day", factor: 7, bars: 104, fmt: my },
];
export const DEFAULT_TF = "1d";

/** Roll up N consecutive candles into one, preserving true OHLCV semantics. */
export function aggregate(src: Candle[], factor: number): Candle[] {
  if (factor <= 1) return src;
  const out: Candle[] = [];
  // anchor from the END so the most recent bucket is the partial one, not the oldest
  for (let end = src.length; end > 0; end -= factor) {
    const start = Math.max(0, end - factor);
    const slice = src.slice(start, end);
    if (!slice.length) continue;
    out.unshift([
      slice[0][T],
      slice[0][O],
      Math.max(...slice.map((c) => c[H])),
      Math.min(...slice.map((c) => c[L])),
      slice[slice.length - 1][C],
      slice.reduce((s, c) => s + c[V], 0),
    ]);
  }
  return out;
}

export interface ChartPoint { x: number; y: number; t: number; o: number; h: number; l: number; c: number; v: number }
export interface AreaChart {
  points: ChartPoint[];
  line: string;
  area: string;
  lo: number;
  hi: number;
  plot: { x: number; y: number; w: number; h: number };
  yTicks: { v: number; y: number }[];
  xTicks: { label: string; x: number }[];
  first: number;
  last: number;
  change: number;
  high: number;
  low: number;
  volume: number;
}

/**
 * Geometry only — no markup. The page renders it, the crosshair script reads the same
 * point list, so the interaction can never disagree with what was drawn.
 */
export function buildAreaChart(candles: Candle[], tf: Timeframe, w: number, h: number, pad: { l: number; r: number; t: number; b: number }): AreaChart | null {
  if (candles.length < 3) return null;
  const plot = { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };

  const highs = candles.map((c) => c[H]);
  const lows = candles.map((c) => c[L]);
  const hiRaw = Math.max(...highs), loRaw = Math.min(...lows);
  const span = Math.max(1e-9, hiRaw - loRaw);
  const hi = hiRaw + span * 0.08;
  const lo = Math.max(0, loRaw - span * 0.08);

  const xOf = (i: number) => plot.x + (candles.length === 1 ? plot.w / 2 : (i / (candles.length - 1)) * plot.w);
  const yOf = (v: number) => plot.y + ((hi - v) / (hi - lo)) * plot.h;

  const points: ChartPoint[] = candles.map((c, i) => ({
    x: +xOf(i).toFixed(2), y: +yOf(c[C]).toFixed(2),
    t: c[T], o: c[O], h: c[H], l: c[L], c: c[C], v: c[V],
  }));

  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const area = `${line} L${points[points.length - 1].x} ${plot.y + plot.h} L${points[0].x} ${plot.y + plot.h} Z`;

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = hi - ((hi - lo) * i) / 4;
    return { v, y: +yOf(v).toFixed(2) };
  });
  const every = Math.max(1, Math.floor(candles.length / 6));
  const xTicks: { label: string; x: number }[] = [];
  for (let i = 0; i < candles.length; i += every) {
    xTicks.push({ label: tf.fmt(new Date(candles[i][T])), x: +xOf(i).toFixed(2) });
  }

  const first = candles[0][C], last = candles[candles.length - 1][C];
  return {
    points, line, area, lo, hi, plot, yTicks, xTicks,
    first, last,
    change: first ? (last - first) / first : 0,
    high: hiRaw, low: loRaw,
    volume: candles.reduce((s, c) => s + c[V], 0),
  };
}
