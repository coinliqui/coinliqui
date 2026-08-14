import { type Candle, type FundingPoint, T, O, H, L, C, V } from "./candles.ts";
import { U, CH, INK, SANS, niceTicks, timeTicks, text, rect, line, fint, crosshair, n2, FS_AXIS, FS_MICRO, PILL_H, PILL_R, PILL_GAP } from "./chart.ts";

/* =========================================================================================
   PRICE CHART — candles, volume, and the funding band.

   The funding band is the reason this chart exists in this form. Anyone can draw candles;
   the panel underneath, on the same time axis, showing which side was paying and by how
   much, is the dataset this site is built on. It is the only place hue appears.

   Every dimension is a multiple of U from ./chart.ts. Every SVG attribute is inline.
   ========================================================================================= */

export interface Timeframe {
  key: string; label: string; base: "hour" | "day";
  factor: number; bars: number; hours: number;
}
export const TIMEFRAMES: Timeframe[] = [
  { key: "1h", label: "1H", base: "hour", factor: 1, bars: 300, hours: 1 },
  { key: "4h", label: "4H", base: "hour", factor: 4, bars: 180, hours: 4 },
  { key: "1d", label: "1D", base: "day", factor: 1, bars: 220, hours: 24 },
  { key: "1w", label: "1W", base: "day", factor: 7, bars: 130, hours: 168 },
];
export const DEFAULT_TF = "1d";

export function aggregate(src: Candle[], factor: number): Candle[] {
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

export function buildPriceChart(candles: Candle[], funding: FundingPoint[] | null, tf: Timeframe): PriceChart | null {
  const gid = `f${tf.key}`;
  if (candles.length < 3) return null;
  const px = candles[candles.length - 1][C];
  const dp = px >= 100 ? 0 : px >= 1 ? 2 : 4;
  const plotX = CH.padL, plotW = CH.w - CH.padL - CH.padR;
  const axisX = plotX + plotW;

  /* Funding coverage decides whether the band is drawn at all. A panel covering 3% of the
     window is a sliver at the right edge that looks like a rendering fault; below the floor
     the panel is dropped and the page says so in words instead. */
  const barMs = tf.hours * 3_600_000;
  const aprAt = new Map<number, number>();
  if (funding && funding.length > 4) {
    const acc = new Map<number, { s: number; n: number }>();
    for (const [t, r] of funding) {
      const k = Math.floor(t / barMs) * barMs;
      const a = acc.get(k) ?? { s: 0, n: 0 };
      a.s += r * 8760; a.n++;            // HL settles hourly: APR = rate x 8760
      acc.set(k, a);
    }
    for (const c of candles) {
      const a = acc.get(Math.floor(c[T] / barMs) * barMs);
      if (a?.n) aprAt.set(c[T], a.s / a.n);
    }
  }
  const coverage = aprAt.size / candles.length;
  const fundOn = coverage >= 0.06;
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
  s.push(rect(0, 0, CH.w, LY.h, INK.well, ` rx="${CH.radius}"`));

  const lastY = yOf(px);
  /* Axis labels live in one group so the interaction layer can fade them while the crosshair
     is on. Without that the live pill lands on top of a static tick and both stay half
     readable, which is the single ugliest thing a crosshair can do. */
  const yLabels: string[] = [];
  for (const v of niceTicks(lo, hi, 5)) {
    const y = yOf(v);
    s.push(line(plotX, y, axisX, y, INK.hair));
    if (Math.abs(y - lastY) > 16) yLabels.push(text(axisX + 10, y + 3.5, dp ? v.toFixed(dp) : fint(v), INK.dim, FS_AXIS));
  }
  s.push(`<g data-ax="y">${yLabels.join("")}</g>`);

  for (let i = 0; i < n; i++) {
    const c = candles[i], x = xOf(i), k = c[C] >= c[O] ? INK.up : INK.down;
    s.push(rect(x - ww / 2, yOf(c[H]), ww, Math.max(0.7, yOf(c[L]) - yOf(c[H])), k));
    const bt = yOf(Math.max(c[O], c[C])), bb = yOf(Math.min(c[O], c[C]));
    s.push(rect(x - bw / 2, bt, bw, Math.max(1, bb - bt), k, rx));
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
    s.push(text(axisX + 10, fundY + 11, `+${(fmax * 100).toFixed(0)}%`, INK.faint, FS_MICRO));
    s.push(text(axisX + 10, fundY + fundH - 2, `−${(fmax * 100).toFixed(0)}%`, INK.faint, FS_MICRO));
  }

  s.push(line(plotX, lastY, axisX, lastY, INK.acc, 1, ' stroke-dasharray="2 5" opacity=".6"'));
  s.push(rect(axisX + PILL_GAP, lastY - PILL_H / 2, 74, PILL_H, INK.acc, ` rx="${PILL_R}"`));
  s.push(text(axisX + PILL_GAP + 37, lastY + 4, "$" + (dp ? px.toFixed(dp) : fint(px)), INK.accInk, 11.5, "middle", 600));

  s.push(`<g data-ax="x">${timeTicks(candles.map((c) => c[T]), 8)
    .map(({ i, label }) => text(xOf(i), LY.h - 9, label, INK.faint, FS_AXIS, "middle")).join("")}</g>`);
  s.push(crosshair(plotX, priceY, plotW, LY.h - CH.padB - priceY, axisX, { dot: true }));

  const first = candles[0][C];
  return {
    svg: `<svg viewBox="0 0 ${CH.w} ${LY.h}" width="100%" role="img" aria-label="Price, volume and funding history">${s.join("")}</svg>`,
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

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const CHART_H = LY.h;
