/* =========================================================================================
   CHART FOUNDATION — the one scale every chart on this site is drawn to.

   Two rules this file exists to enforce.

   1. NOTHING IS EYEBALLED. Every dimension below is a multiple of U, every tick value is a
      round number, every tick date sits on a calendar boundary. If a number appears in a
      chart file that is not derived from here, that is a defect.

   2. EVERY GENERATED SVG STYLES ITSELF INLINE. Astro compiles `<style>` selectors against a
      `data-astro-cid-*` attribute that markup injected with `set:html` never carries, so a
      class on a generated element silently resolves to nothing and the shape falls back to
      black. That has shipped on this site three times. There is no class attribute anywhere
      in generated chart markup — presentation attributes only — and the interaction layer
      writes presentation attributes too.
   ========================================================================================= */

/** The spacing unit. Padding, gutters, panel heights and gaps are all multiples of it. */
export const U = 4;

export const CH = {
  /** viewBox width. Content column maxes at 1320 minus rail and card padding, so this lands
      within a few percent of 1:1 on a large screen and scales down cleanly below. */
  w: 1260,
  padL: 4 * U,   // 16
  padR: 20 * U,  // 80 — fits "$120,000" at 11px mono plus the tick gap
  padT: 4 * U,   // 16
  padB: 7 * U,   // 28 — one line of axis text plus breathing room
  gap: 3 * U,    // 12 — between stacked panels
  radius: 10,
} as const;

/* ---------------------------------------------------------------------------- palette
   Chart ink. Red and green appear ONLY in the funding band and its legend: they encode the
   direction of a funding payment and nothing else, which is why candles are monochrome and
   the density ramp is built to avoid both hues entirely. */
export const INK = {
  well: "#14171b",       // recessed plot ground, one step below the card
  hair: "#22272e",       // gridline
  zero: "#2b3138",       // the one line that means zero
  dim: "#9aa1ab",        // axis values — 6.9:1 on the well
  faint: "#6c737d",      // secondary labels
  up: "#e8ecf1",
  down: "#737e8c",
  upVol: "#59636f",
  downVol: "#3b434d",
  acc: "#8ab4f8",
  accInk: "#12161c",
  paysLFill: "#e0655a",  // band fill — lower chroma than the text token
  paysSFill: "#4bb583",
  paysL: "#ef6b5e",      // edge stroke and text
  paysS: "#58c48c",
} as const;

/* ------------------------------------------------------------------------- ramp
   Density intensity. A single hue at varying alpha reads flat, so this moves through hue,
   lightness AND chroma at once: near-ground indigo, through violet and azure, to a cyan
   white. Generated in OKLCh so lightness rises evenly — an eyeballed hex ramp has flat
   spots you cannot see in a swatch but can see in a field of 20,000 cells. */
function oklch(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const enc = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    const g = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v;
    return Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, "0");
  };
  return `#${enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}

export const RAMP: string[] = Array.from({ length: 22 }, (_, i) => {
  const t = i / 21;
  return oklch(0.205 + 0.75 * t ** 0.95, 0.132 * Math.sin(Math.PI * (0.1 + 0.88 * t)) ** 0.6, 290 - 89 * t ** 0.82);
});

/**
 * Transfer function, solved from the data rather than picked.
 *
 * A fixed gamma makes the picture's character depend on the window: some months saturate to
 * a wall of cyan, others collapse to near-black. Instead the exponent is solved so the
 * MEDIAN cell always lands at `mid` on the ramp. The field then reads the same way every
 * time — mostly ground, with bands — and the legend still prints the true value at each stop.
 */
export function transfer(sortedNonZero: number[], mid = 0.06, top = 0.995) {
  if (!sortedNonZero.length) return { scale: 1, gamma: 1 };
  const at = (p: number) => sortedNonZero[Math.min(sortedNonZero.length - 1, Math.floor(sortedNonZero.length * p))];
  const scale = at(top);
  const r = Math.max(1e-6, Math.min(0.999, at(0.5) / scale));
  return { scale, gamma: Math.max(1, Math.min(3.2, Math.log(mid) / Math.log(r))) };
}
export const rampIndex = (v: number, scale: number, gamma: number) =>
  v <= 0 ? 0 : Math.min(RAMP.length - 1, Math.round(Math.min(1, (v / scale) ** gamma) * (RAMP.length - 1)));
/** Inverse, for the legend: the value at a given position along the ramp. */
export const rampValue = (t: number, scale: number, gamma: number) => scale * t ** (1 / gamma);

/* ------------------------------------------------------------------------- ticks */

/** Round tick values — 1/2/2.5/5 x 10^n. 63,447 is not a price anyone thinks in. */
export function niceTicks(lo: number, hi: number, want = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const raw = span / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s * 1.0001) ?? mag * 10;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}

type TickUnit = { key: string; label: (d: Date) => string; bucket: (d: Date) => string };
const pad = (n: number) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
const UNITS: TickUnit[] = [
  { key: "year", label: (d) => String(d.getUTCFullYear()), bucket: (d) => `${d.getUTCFullYear()}` },
  { key: "quarter", label: (d) => `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`, bucket: (d) => `${d.getUTCFullYear()}-${Math.floor(d.getUTCMonth() / 3)}` },
  { key: "month", label: (d) => `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`, bucket: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}` },
  { key: "week", label: dm, bucket: (d) => `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000 + 4) / 7)}` },
  { key: "day", label: dm, bucket: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` },
  { key: "6h", label: (d) => `${pad(d.getUTCHours())}:00`, bucket: (d) => `${d.getUTCDate()}-${Math.floor(d.getUTCHours() / 6)}` },
  { key: "hour", label: (d) => `${pad(d.getUTCHours())}:00`, bucket: (d) => `${d.getUTCDate()}-${d.getUTCHours()}` },
];

/**
 * Time ticks land on calendar boundaries, never on "every 25th bar". The unit is chosen as
 * the coarsest one that still yields roughly `want` labels, so a 30-day window is labelled
 * in days and a 2-year window in quarters without either being configured by hand.
 */
export function timeTicks(times: number[], want = 8): { i: number; label: string }[] {
  if (times.length < 2) return [];
  let chosen = UNITS[UNITS.length - 1];
  let picks: number[] = [];
  for (const u of UNITS) {
    const idx: number[] = [];
    let prev = "";
    for (let i = 0; i < times.length; i++) {
      const b = u.bucket(new Date(times[i]));
      if (b !== prev) { idx.push(i); prev = b; }
    }
    if (idx.length >= 3) { chosen = u; picks = idx; }
    if (idx.length >= want) break;
  }
  if (picks.length > want) {
    const step = Math.ceil(picks.length / want);
    picks = picks.filter((_, k) => k % step === 0);
  }
  return picks.filter((i) => i > 0).map((i) => ({ i, label: chosen.label(new Date(times[i])) }));
}

/* ------------------------------------------------------------------- svg primitives */
/** Axis furniture: two sizes, two weights, nothing between them. */
export const FS_AXIS = 11, FS_MICRO = 10;
export const PILL_H = 20, PILL_R = 5, PILL_GAP = 5;

export const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
export const SANS = "ui-sans-serif,system-ui,-apple-system,sans-serif";
export const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

export function text(x: number, y: number, s: string, fill: string, size = 11, anchor: "start" | "middle" | "end" = "start", weight = 400, fam = MONO) {
  return `<text x="${n2(x)}" y="${n2(y)}" fill="${fill}" font-size="${size}" font-family="${fam}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
}
export function rect(x: number, y: number, w: number, h: number, fill: string, extra = "") {
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(0, w))}" height="${n2(Math.max(0, h))}" fill="${fill}"${extra}/>`;
}
export function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1, extra = "") {
  return `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
}

/** Integer money with thousands separators. Charts never show cents. */
export const fint = (v: number) => Math.round(v).toLocaleString("en-US");
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

/**
 * Crosshair furniture. Emitted hidden; the interaction layer moves it and fills in the
 * labels. Every attribute is inline for the reason at the top of this file, and the pill
 * geometry is fixed here so the script never has to compute a size at runtime.
 */
export function crosshair(plotX: number, plotY: number, plotW: number, plotH: number, axisX: number, opts: { dot?: boolean } = {}) {
  /* Same geometry as the static last-price pill (PILL_H / PILL_R / left edge), so the two
     never read as two different kinds of object sharing one axis slot. */
  const pill = (id: string, w: number) =>
    `<g data-xh="${id}" opacity="0" transform="translate(0,0)">` +
    `<rect x="0" y="0" width="${w}" height="${PILL_H}" rx="${PILL_R}" fill="#3c4650"/>` +
    `<text x="${w / 2}" y="${PILL_H / 2 + 4}" fill="#f2f5f8" font-size="11.5" font-family="${MONO}" font-weight="600" text-anchor="middle"></text></g>`;
  /* The crosshair is NEUTRAL. The accent dashed rule already means "last price"; drawing the
     cursor in the same blue dashed line made two different facts look like one. */
  return (
    `<g data-xh="g" opacity="0" pointer-events="none">` +
    `<line data-xh="v" x1="0" y1="${n2(plotY)}" x2="0" y2="${n2(plotY + plotH)}" stroke="#c3ccd6" stroke-width="1" stroke-dasharray="1 3" opacity=".8"/>` +
    `<line data-xh="h" x1="${n2(plotX)}" y1="0" x2="${n2(plotX + plotW)}" y2="0" stroke="#c3ccd6" stroke-width="1" stroke-dasharray="1 3" opacity=".62"/>` +
    (opts.dot ? `<circle data-xh="dot" cx="0" cy="0" r="3.2" fill="#eef1f5" stroke="#14171b" stroke-width="1.4"/>` : "") +
    pill("py", 74).replace("translate(0,0)", `translate(${n2(axisX + 5)},0)`) +
    pill("tx", 92) +
    `</g>`
  );
}
