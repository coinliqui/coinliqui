import type { LiqMap } from "./liqmap.ts";
import { CH, INK, RAMP, transfer, rampIndex, rampValue, niceTicks, timeTicks, text, rect, line, fint, compact, crosshair, n2, MONO, FS_AXIS, FS_MICRO, PILL_GAP } from "./chart.ts";
import { axisDp, nf } from "../../public/shared.js";

/* =========================================================================================
   Painting the density field.

   Two things carry the picture. The RAMP moves through hue, lightness and chroma at once,
   because a single hue at varying alpha compresses into near-identical blues and the field
   reads flat — that is what the last attempt got wrong. The TRANSFER FUNCTION is solved from
   the data so the median cell always lands low on the ramp, which is what makes the field
   mostly ground with bands rather than a wall of cyan.

   Candles are drawn over the field with a dark halo, so they read on the ground and on the
   brightest cell alike. They stay MONOCHROME here even though candles elsewhere on the site
   now take green and red — the reason changed rather than disappeared. On the contract charts
   hue is free, because nothing else on that canvas competes for it. Here the density field IS
   the information, and it owns the full ramp; tinting the candles would put a second hue
   channel on top of the one the page exists to show. This page carries no funding figures at
   all (verified: zero pays-* elements), so nothing is ambiguous either way.
   ========================================================================================= */

const MAP_H = 576;
/* A strip under the field, on the same time axis, for the notional price cleared in each
   bar. The field shows where levels STAND; a sweep was only ever visible in it as an
   absence, and an absence is not a signal a reader can point at. */
const SWEPT_H = 12 * 4;

export interface Painted {
  svg: string;
  scale: number; gamma: number;
  legend: string;
  plot: [number, number, number, number];
  axisX: number;
  cellW: number; rowH: number;
  cells: number; scars: number; timeAxisY: number;
}

export function paintHeatMap(m: LiqMap, opts: { height?: number; mid?: number; mark?: { t: number; label: string }; live?: { px: number; at: number } } = {}): Painted {
  const h = opts.height ?? MAP_H;
  const plotX = CH.padL, plotW = CH.w - CH.padL - CH.padR;
  const plotY = 3 * 4;
  const sweptY = h - CH.padB - SWEPT_H;
  const plotH = sweptY - plotY - 3 * 4;
  const axisX = plotX + plotW;
  const { scale, gamma } = transfer(m.sorted, opts.mid ?? 0.06);
  const cw = plotW / m.cols, rh = plotH / m.rows;
  const yOf = (p: number) => plotY + ((m.hiPrice - p) / (m.hiPrice - m.loPrice)) * plotH;

  const s: string[] = [rect(0, 0, CH.w, h, INK.well, ` rx="${CH.radius}"`)];

  /* Run-length merge along each row: 150 x 180 is 27,000 cells, and the field is mostly
     runs of one colour. Merging takes the emitted rect count down by roughly 8x. */
  let cells = 0;
  for (let r = 0; r < m.rows; r++) {
    const y = plotY + r * rh, g = m.grid[r];
    let c0 = 0;
    while (c0 < m.cols) {
      const i0 = rampIndex(g[c0], scale, gamma);
      let c1 = c0 + 1;
      while (c1 < m.cols && rampIndex(g[c1], scale, gamma) === i0) c1++;
      if (i0 > 0) { s.push(rect(plotX + c0 * cw, y, (c1 - c0) * cw + 0.35, rh + 0.4, RAMP[i0])); cells++; }
      c0 = c1;
    }
  }

  /* THE SCARS — where price traded through a standing level.
     Drawn as VERTICAL ticks, not filled cells. The field's whole grammar is horizontal: a
     band is a price level persisting through time. Cleared is the opposite event — one
     moment, many prices at once — so it is drawn across the grain, and a sweep becomes a
     continuous bright vertical streak instead of another bright horizontal thing to tell
     apart from the ramp. Neutral white, because the ramp owns the colour on this canvas.
     Under the candles: the observed price path stays the top layer. */
  const cpk = m.clearedPeak || 1;
  const tickW = Math.max(1.2, Math.min(2.4, cw * 0.5));
  let scars = 0;
  for (let r = 0; r < m.rows; r++) {
    const row = m.cleared[r];
    const y = plotY + r * rh;
    for (let c = 0; c < m.cols; c++) {
      const v = row[c];
      if (v <= 0) continue;
      const a = Math.min(0.95, 0.3 + 0.65 * (v / cpk) ** 0.45);
      s.push(rect(plotX + c * cw + (cw - tickW) / 2, y, tickW, rh + 0.4, "#ffffff", ` opacity="${a.toFixed(3)}"`));
      scars++;
    }
  }

  const slot = plotW / m.cols;
  const bw = Math.max(1.2, slot - Math.min(3, Math.max(0.6, slot * 0.28)));
  const ww = bw < 6 ? 1 : 1.5;
  /* Everything from here on is drawn OVER the field, and the readout identifies a cell by the
     fill of the element under the cursor. Without this, hovering the price path returns a
     candle and the tooltip claims there is nothing standing there. */
  s.push(`<g pointer-events="none">`);
  for (let i = 0; i < m.candles.length; i++) {
    const c = m.candles[i], x = plotX + slot * (i + 0.5);
    const wy = yOf(c[2]), wh = Math.max(0.7, yOf(c[3]) - yOf(c[2]));
    const bt = yOf(Math.max(c[1], c[4])), bh = Math.max(1, yOf(Math.min(c[1], c[4])) - bt);
    /* The halo is proportional. A flat 1.4 around a 1px wick made the dark outline two and a
       half times the wick itself, so the price path read as a dark line with a bright seam. */
    const hw = Math.max(0.7, ww * 0.55), hb = Math.max(0.8, Math.min(1.5, bw * 0.22));
    s.push(rect(x - ww / 2 - hw, wy - hw, ww + 2 * hw, wh + 2 * hw, "#04070a", ' opacity=".8"'));
    s.push(rect(x - bw / 2 - hb, bt - hb, bw + 2 * hb, bh + 2 * hb, "#04070a", ' opacity=".8"'));
    const k = c[4] >= c[1] ? "#ffffff" : "#8a97a8";
    s.push(rect(x - ww / 2, wy, ww, wh, k));
    s.push(rect(x - bw / 2, bt, bw, bh, k));
  }

  /* One annotation, or none. A showcase needs the reader pointed at the bar that carries the
     argument; anything beyond that one mark is decoration on a picture that is already busy. */
  if (opts.mark) {
    let mi = 0;
    for (let i = 0; i < m.candles.length; i++) if (Math.abs(m.candles[i][0] - opts.mark.t) < Math.abs(m.candles[mi][0] - opts.mark.t)) mi = i;
    const mx = plotX + slot * (mi + 0.5);
    s.push(rect(mx - 0.5, plotY + 26, 1, plotH - 26, "#ffffff", ' opacity=".34"'));
    const lw = opts.mark.label.length * 6.2 + 20;
    const lx = Math.max(plotX + 2, Math.min(plotX + plotW - lw - 2, mx - lw / 2));
    s.push(rect(lx, plotY + 6, lw, 20, "rgba(8,11,15,.82)", ' rx="4"'));
    s.push(rect(lx, plotY + 6, 2, 20, "#ffffff", ' rx="1" opacity=".65"'));
    s.push(text(lx + lw / 2 + 1, plotY + 20, opts.mark.label, "#e9edf2", FS_MICRO, "middle", 600, MONO));
  }

  /* BY MAGNITUDE, NOT ALWAYS INTEGERS. fint() rounds to whole dollars, so on a sub-dollar
     contract every tick on this axis printed "0" — three distinct price levels, all labelled
     zero, on the page whose whole subject is where price sits relative to those levels.
     Verified on the deployed /liquidations?symbol=DOGE before this changed. */
  const tickDp = axisDp(m.hiPrice);
  const tick = (v: number) => (tickDp === 0 ? fint(v) : nf(v, tickDp));
  s.push(`<g data-ax="y">${niceTicks(m.loPrice, m.hiPrice, 5)
    .map((v) => text(axisX + PILL_GAP, yOf(v) + 3.5, tick(v), INK.dim, FS_AXIS)).join("")}</g>`);
  s.push(`<g data-ax="x">${timeTicks(m.candles.map((c) => c[0]), 10)
    .map(({ i, label }) => text(plotX + slot * (i + 0.5), h - 9, label, INK.faint, FS_AXIS, "middle")).join("")}</g>`);

  // MODELLED, said inside the picture — not only in the caption underneath it
  s.push(rect(plotX + 8, plotY + 8, 76, 19, "rgba(10,13,18,.72)", ' rx="4"'));
  s.push(text(plotX + 46, plotY + 21, "MODELLED", "#c7cfda", FS_MICRO, "middle", 600, MONO));

  s.push(`</g>`);

  /* The same quantity as a strip, so the moment is legible at a glance without hunting for
     a streak. Same x scale as the field; nothing here is a second time axis. */
  const smax = Math.max(...m.swept, 1);
  s.push(rect(plotX, sweptY, plotW, SWEPT_H, "#181c21", ' rx="3"'));
  for (let c = 0; c < m.cols; c++) {
    const v = m.swept[c];
    if (v <= 0) continue;
    const bh = Math.max(1, (v / smax) * (SWEPT_H - 12));
    s.push(rect(plotX + c * cw, sweptY + SWEPT_H - bh, Math.max(1, cw - 0.4), bh, "#ffffff", ' opacity=".82"'));
  }
  s.push(text(plotX + 6, sweptY + 12, "CLEARED BY PRICE", "#8d97a3", FS_MICRO, "start", 600, MONO));
  s.push(text(axisX - 4, sweptY + 12, compact(smax) + " peak bar", "#8d97a3", FS_MICRO, "end", 400, MONO));

  /* THE LIVE MARK. Candles come from hourly KV and are up to two hours behind at the right
     edge; the mark comes from the five-minute snapshot. Drawing it makes the map current at
     a glance, and the page states both ages rather than letting one stand for the other. */
  if (opts.live && opts.live.px >= m.loPrice && opts.live.px <= m.hiPrice) {
    const ly = yOf(opts.live.px);
    s.push(line(plotX, ly, axisX, ly, INK.acc, 1, ' stroke-dasharray="2 5" opacity=".8"'));
    s.push(rect(axisX + 5, ly - 10, 74, 20, INK.acc, ' rx="5"'));
    s.push(text(axisX + 42, ly + 4, tick(opts.live.px), INK.accInk, 11.5, "middle", 600));
  }

  s.push(crosshair(plotX, plotY, plotW, plotH, axisX));

  return {
    svg: `<svg viewBox="0 0 ${CH.w} ${h}" width="100%" role="img" aria-label="Modelled liquidation density by price and time">${s.join("")}</svg>`,
    scale, gamma,
    legend: legendSvg(scale, gamma, m.peak),
    plot: [plotX, plotY, plotW, plotH],
    axisX, cellW: cw, rowH: rh, cells, scars, timeAxisY: h - 27,
  };
}

/**
 * The legend is a scale, not decoration: ticks sit at the x-position where each round value
 * actually lands on the ramp, so a reader can convert a colour back into dollars.
 */
function legendSvg(scale: number, gamma: number, peak: number): string {
  const w = 560, barY = 0, barH = 12;
  const s: string[] = [];
  const cw = (w - 2) / RAMP.length;
  for (let i = 0; i < RAMP.length; i++) {
    s.push(rect(1 + i * cw, barY, cw + 0.4, barH, RAMP[i]));
  }
  const step = niceTicks(0, scale, 4).filter((v) => v > 0 && v < scale * 0.94);
  s.push(text(1, 26, "none", INK.faint, FS_MICRO, "start"));
  for (const v of step) {
    const t = Math.min(1, (v / scale) ** gamma);
    const x = 1 + t * (w - 2);
    s.push(rect(x - 0.5, barH, 1, 3, "#4b535d"));
    s.push(text(Math.min(w - 40, Math.max(26, x)), 26, compact(v), INK.dim, FS_MICRO, "middle"));
  }
  /* The last swatch is open-ended — it covers everything from where it starts up to the peak.
     Printing the peak at the end of the bar implied the ramp finished there, so a cell at the
     top of the scale read 1.5x higher than the legend actually promised. */
  const topStart = scale * ((RAMP.length - 1.5) / (RAMP.length - 1)) ** (1 / gamma);
  s.push(text(w, 26, `≥ ${compact(topStart)}`, INK.dim, FS_MICRO, "end"));
  return `<svg viewBox="0 0 ${w} 30" width="${w}" height="30" role="img" aria-label="Intensity scale">${s.join("")}</svg>`;
}

export { rampValue };
