/**
 * THE FACTS BOTH SIDES NEED, IN ONE FILE THAT BOTH SIDES ACTUALLY READ.
 *
 * WHY THIS EXISTS. Five times this project has shipped one fact computed by two implementations
 * at different moments, and every one of them was found by accident rather than by a check:
 *
 *   1. the token-quantity formatter used toFixed(1) on the client where the server used
 *      toFixed(2), so clicking a timeframe rewrote 200 volume cells from "23.37K" to "23.4K";
 *   2. compactUsd was qty() with a dollar sign glued on, so a heatmap legend read "≥ $29.6M"
 *      while the tooltip over the same cell read "$29.65M";
 *   3. gapMin truncated in SQL and rounded in JS, disagreeing by up to a whole minute;
 *   4. the age ladder existed three times — Base.astro, interact.js, and three templates that
 *      printed raw minutes — and the split only appeared when the data was old;
 *   5. the crosshair said "longs paying shorts" where every server-rendered surface said
 *      "longs pay shorts".
 *
 * Each was fixed by aligning two copies. Aligning copies is how you get a sixth. The copies are
 * the defect, so this file is the fix: `src/lib/funding.ts` and `src/lib/freshness.ts` import
 * from here, `public/interact.js` imports from here, and there is no second implementation left
 * to drift. It is plain JavaScript with no types precisely so that all three toolchains — the
 * Astro server build, the esbuild worker bundle, and a browser fetching a static file — can read
 * the same bytes.
 *
 * IT LIVES IN public/ FOR THE SAME REASON. Anything under src/ would need generating or copying
 * to reach a browser, and a generated copy is a copy. This is served verbatim, and
 * scripts/gen-assets.mjs already fingerprints every .js in this directory, so cache-busting is
 * inherited rather than invented.
 *
 * WHAT BELONGS HERE: pure functions over numbers and strings, no DOM, no imports, no state.
 * Anything that touches a document belongs in interact.js; anything that touches KV or a request
 * belongs in src/lib. If a function here ever needs either, it has stopped being shared.
 */

/* COLOUR MEANS THE DIRECTION OF A FUNDING PAYMENT AND NOTHING ELSE. The class was decided in
   five places — once on the server and four times in interact.js — and a sign convention
   repeated five times is a sign convention waiting to be inverted in one of them. */
export const paysClass = (apr) => (apr >= 0 ? "pays-l" : "pays-s");
export const paysLabel = (apr) => (apr >= 0 ? "longs pay shorts" : "shorts pay longs");
export const paysArrow = (apr) => (apr >= 0 ? "▲" : "▼");

/** Cost of holding a notional position for N days at a given APR. Sign follows the APR. */
export const carryCost = (notionalUsd, apr, days) => notionalUsd * apr * (days / 365);

/** Widest gap between a set of APRs, or null when fewer than two are finite.
 *  Named spreadOf rather than aprSpread so src/lib/funding.ts can keep exporting aprSpread() —
 *  the venue-shaped adapter callers already import — without two things sharing one name. */
export function spreadOf(aprs) {
  const xs = aprs.filter(Number.isFinite);
  if (xs.length < 2) return null;
  return Math.max(...xs) - Math.min(...xs);
}

/** A rate as a percentage string. The em dash for a non-number is part of the contract: it is
 *  what every table cell shows for an absent figure, on both sides. */
export function pct(x, decimals = 2) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

/** Signed percentage change, arrow included — the 24-hour cell, rendered identically either
 *  side of hydration. */
export function changeWords(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  return `${paysArrow(fraction)} ${(Math.abs(fraction) * 100).toFixed(2)}%`;
}

/**
 * Minutes, then hours, then days. "361 min ago" is arithmetic homework, not a reading.
 * This was three implementations before it was one; see the note in src/lib/freshness.ts.
 */
export function ageWords(min) {
  const m = Math.max(0, Math.round(min));
  if (m === 0) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** Minutes since a stamp, floored at zero. */
export const minutesSince = (at, now = Date.now()) => Math.max(0, Math.round((now - at) / 60000));

/* ---------------------------------------------------------------------------------------
   NUMBER FORMATS. Every one of these existed twice before it existed here, and two of them had
   already drifted in production — see the notes at the head of this file.
   --------------------------------------------------------------------------------------- */

/** Fixed-decimal locale number. The primitive the others are built from. */
export const nf = (n, dp) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * TOKEN QUANTITY, not dollars. Two decimals at every rung — the client used toFixed(1) on the K
 * branch once and rewrote 200 volume cells from "23.37K" to "23.4K" on a click that changed
 * nothing else.
 */
export function qty(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

/**
 * MONEY AT CHART SCALE, and a DIFFERENT rule from qty() — one decimal at M, whole thousands at
 * K. The client once implemented it as `"$" + qty(n)`, which made one formatter answer to two
 * different rules and match neither: a heatmap legend read "≥ $29.6M" while the tooltip over the
 * same cell read "$29.65M". They are separate functions because they are separate rules.
 */
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

/**
 * MONEY AT PAGE SCALE. The em dash above 1e15 is deliberate: past that a double no longer
 * represents integers exactly, and /tools/leverage?notional=1e30 once rendered
 * "$50000000000000008192.00B" — every digit past the sixteenth an artefact of the format rather
 * than a quantity. Nothing honest on this site exceeds it.
 */
export function usd(x, decimals = 0) {
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e15) return "—";
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3 && decimals === 0) return `$${Math.round(x).toLocaleString("en-US")}`;
  return `$${nf(x, decimals)}`;
}

/**
 * HOW MANY DECIMALS A PRICE NEEDS, and the axis variant that shows fewer.
 *
 * This ladder existed NINE times across the templates and the chart library — `px >= 100 ? 2 :
 * px >= 1 ? 3 : px >= 0.01 ? 5 : 7` in seven places, and an `axisDp` variant in two more. One
 * fact, nine implementations, which is the shape this file exists to end.
 *
 * It was not merely duplicated, it was IGNORED. /liquidations computed axisDp correctly and then
 * called paintHeatMap, which formatted every y-axis tick and the live price pill with fint() —
 * integer dollars, unconditionally. On a sub-dollar contract the entire price axis of the
 * liquidation map rendered "0", with the live pill reading "0" on top of it. Verified on the
 * deployed page for DOGE before this was changed.
 */
export const priceDp = (px) => (px >= 100 ? 2 : px >= 1 ? 3 : px >= 0.01 ? 5 : 7);
/** Fewer decimals for an axis, where the label has to stay short — but never zero on a coin
 *  whose whole price is below a dollar, which is what fint() did. */
export const axisDp = (px) => (px >= 100 ? 0 : px >= 1 ? 2 : priceDp(px));
