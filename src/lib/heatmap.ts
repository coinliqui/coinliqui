import type { LiqMap } from "./liqmap.ts";
import { CH, INK, RAMP, transfer, rampIndex, rampValue, niceTicks, timeTicks, text, rect, fint, compact, crosshair, n2, MONO } from "./chart.ts";

/* =========================================================================================
   Painting the density field.

   Two things carry the picture. The RAMP moves through hue, lightness and chroma at once,
   because a single hue at varying alpha compresses into near-identical blues and the field
   reads flat — that is what the last attempt got wrong. The TRANSFER FUNCTION is solved from
   the data so the median cell always lands low on the ramp, which is what makes the field
   mostly ground with bands rather than a wall of cyan.

   Candles are drawn over the field with a dark halo, so they read on the ground and on the
   brightest cell alike. They are monochrome: red and green mean funding direction.
   ========================================================================================= */

const MAP_H = 576;

export interface Painted {
  svg: string;
  scale: number; gamma: number;
  legend: string;
  plot: [number, number, number, number];
  axisX: number;
  cellW: number; rowH: number;
  cells: number;
}

export function paintHeatMap(m: LiqMap, opts: { height?: number; mid?: number; mark?: { t: number; label: string } } = {}): Painted {
  const h = opts.height ?? MAP_H;
  const plotX = CH.padL, plotW = CH.w - CH.padL - CH.padR;
  const plotY = 3 * 4, plotH = h - plotY - CH.padB;
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

  const slot = plotW / m.cols;
  const bw = Math.max(1.2, slot - Math.min(3, Math.max(0.6, slot * 0.28)));
  const ww = bw < 6 ? 1 : 1.5;
  for (let i = 0; i < m.candles.length; i++) {
    const c = m.candles[i], x = plotX + slot * (i + 0.5);
    const wy = yOf(c[2]), wh = Math.max(0.7, yOf(c[3]) - yOf(c[2]));
    const bt = yOf(Math.max(c[1], c[4])), bh = Math.max(1, yOf(Math.min(c[1], c[4])) - bt);
    s.push(rect(x - ww / 2 - 1.4, wy - 1.4, ww + 2.8, wh + 2.8, "#04070a", ' opacity=".85"'));
    s.push(rect(x - bw / 2 - 1.4, bt - 1.4, bw + 2.8, bh + 2.8, "#04070a", ' opacity=".85"'));
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
    s.push(text(lx + lw / 2 + 1, plotY + 20, opts.mark.label, "#e9edf2", 10.5, "middle", 600, MONO));
  }

  for (const v of niceTicks(m.loPrice, m.hiPrice, 5)) {
    s.push(text(axisX + 10, yOf(v) + 3.5, fint(v), INK.dim, 11));
  }
  for (const { i, label } of timeTicks(m.candles.map((c) => c[0]), 10)) {
    s.push(text(plotX + slot * (i + 0.5), h - 9, label, INK.faint, 11, "middle"));
  }

  // MODELLED, said inside the picture — not only in the caption underneath it
  s.push(rect(plotX + 8, plotY + 8, 76, 19, "rgba(10,13,18,.72)", ' rx="4"'));
  s.push(text(plotX + 46, plotY + 21, "MODELLED", "#c7cfda", 10, "middle", 600, MONO));

  s.push(crosshair(plotX, plotY, plotW, plotH, axisX));

  return {
    svg: `<svg viewBox="0 0 ${CH.w} ${h}" width="100%" role="img" aria-label="Modelled liquidation density by price and time">${s.join("")}</svg>`,
    scale, gamma,
    legend: legendSvg(scale, gamma, m.peak),
    plot: [plotX, plotY, plotW, plotH],
    axisX, cellW: cw, rowH: rh, cells,
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
    s.push(rect(1 + i * cw, barY, cw + 0.4, barH, RAMP[i], i === 0 || i === RAMP.length - 1 ? ' rx="2"' : ""));
  }
  const step = niceTicks(0, scale, 4).filter((v) => v > 0);
  s.push(text(1, 26, "none", INK.faint, 10.5, "start"));
  for (const v of step) {
    const t = Math.min(1, (v / scale) ** gamma);
    const x = 1 + t * (w - 2);
    s.push(rect(x - 0.5, barH, 1, 3, "#4b535d"));
    s.push(text(Math.min(w - 22, Math.max(26, x)), 26, compact(v), INK.dim, 10.5, "middle"));
  }
  s.push(text(w, 26, `peak ${compact(peak)}`, INK.faint, 10.5, "end"));
  return `<svg viewBox="0 0 ${w} 30" width="${w}" height="30" role="img" aria-label="Intensity scale">${s.join("")}</svg>`;
}

export { rampValue };
