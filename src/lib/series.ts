import { type Candle, type FundingPoint, T, O, H, L, C, V } from "./candles.ts";
import { U, CH, INK, SANS, MONO, niceTicks, timeTicks, text, rect, line, fint, crosshair, n2, FS_AXIS, FS_MICRO, PILL_H, PILL_R, PILL_GAP } from "./chart.ts";

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
    while (j < sorted.length && sorted[j][0] < end) { sum += sorted[j][1] * 8760; cnt++; j++; }
    if (cnt) out.set(start, sum / cnt);   // HL settles hourly: APR = rate x 8760
    i = j;
  }
  return out;
}

export function buildPriceChart(
  candles: Candle[],
  funding: FundingPoint[] | null,
  tf: Timeframe,
  mode: ChartMode = "candle",
): PriceChart | null {
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
        s.push(`<rect x="${n2(x - bw / 2 + 0.5)}" y="${n2(bt + 0.5)}" width="${n2(Math.max(0.5, bw - 1))}" height="${n2(Math.max(0.5, bh - 1))}" rx="${rx}" fill="none" stroke="${k}" stroke-width="1"/>`);
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
    s.push(text(axisX + PILL_GAP, fundY + 11, `+${(fmax * 100).toFixed(0)}% APR`, INK.faint, FS_MICRO));
    s.push(text(axisX + PILL_GAP, fundY + fundH - 2, `−${(fmax * 100).toFixed(0)}%`, INK.faint, FS_MICRO));
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
