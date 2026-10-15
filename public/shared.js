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

/* THE FUNDING-COST CALCULATOR'S MONEY, once for its server render and its script. Both carried their
   own moneyAt, printed-figure parser, tolerance test and decimal search, the script's on one line
   each, and the notional it printed three ways on one page (15 October 2026). */
/** usd(a, 2), or two significant digits under half a cent; e extra decimals, own zeros dropped. */
export function moneyAt(a, e = 0) {
  const m = Math.abs(a);
  if (!Number.isFinite(a) || m >= 1e15) return "—";
  const sub = a > 0 && a < 0.005;
  const u = sub || m < 1e6 ? 1 : m < 1e9 ? 1e6 : 1e9;
  const d0 = sub ? Math.min(12, 1 - Math.floor(Math.log10(a))) : 2;
  const d = Math.min(20, d0 + e);
  let s = sub || u > 1 ? (a / u).toFixed(d) : a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  while (s.endsWith("0") && s.length - s.indexOf(".") - 1 > d0) s = s.slice(0, -1);
  return `$${s}${u === 1e9 ? "B" : u === 1e6 ? "M" : ""}`;
}
/** The number a printed money figure stands for: "$1.23M" -> 1230000. */
export function printedMoney(s) {
  const m = /\$([\d,]*\.?\d+)([MB]?)/.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) * (m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : 1) : NaN;
}
/** Whether x rounds to the printed text (money, or a percentage when pctText). */
export function nearPrinted(x, text, pctText = false) {
  const m = pctText ? /(-?\d*)(?:\.(\d+))?%/.exec(text) : /\$([\d,]*)(?:\.(\d+))?([MB]?)/.exec(text);
  if (!m) return false;
  const half = 0.5 * 10 ** -(m[2] ?? "").length * (m[3] === "B" ? 1e9 : m[3] === "M" ? 1e6 : 1);
  return Math.abs(x - (pctText ? Number(text.slice(0, -1)) : printedMoney(text))) <= half * (1 + 1e-9);
}
/** The fewest extra decimals at which a check on the printed figures holds; 12 if none does. */
export function fitDecimals(ok) {
  for (let e = 0; e < 12; e++) if (ok(e)) return e;
  return 12;
}
/** An amount exactly as typed: "$2,500,000", "$1.125". */
export const exactUsd = (x) => `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 6 })}`;
/** A count or quantity as typed, up to six decimals. */
export const fineNum = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** "3 queries", "1 query" — the count and the right noun. */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A small count in words — one to ten spelled out, larger as digits. `zero` is the caller's word
 *  for nothing: "no" before a noun ("no venues"), "zero" on its own. Six tables did this with limits
 *  of three, six, eight, ten and fourteen, so four venues read "four" on one page and "4" on the next. */
const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const numberWord = (n, zero = "no") => (n === 0 ? zero : NUMBER_WORDS[n] ?? String(n));

/** Hyperliquid's maintenance margin: half the initial margin at the tier's max leverage. Here so
 *  the calculators' scripts read the server's rule instead of writing 1 / (2 * L) again. */
export const maintenanceMarginFraction = (maxLeverage) => 1 / (2 * maxLeverage);

/** MONTHS AND THE SHORT DATE, once. Five files carried their own month table, and two pages used
 *  toLocaleDateString("en-GB", {month: "short"}) instead — which prints "Sept" for September, so a
 *  date read "16 Sept 2026" on /unlocks and "16 Sep 2026" on every chart (15 October 2026). */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
/** "16 Sep 2026", in UTC. */
export function shortDate(t) {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "16 Sep 2026, 15:00 UTC" — a bar or an event at a minute, always with its zone. */
export function dateTimeUtc(t) {
  const d = new Date(t);
  return `${shortDate(t)}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** A signed percentage: U+2212 for a fall, "+" for a rise, and NO sign on a figure whose printed
 *  digits are zero. Five copies of this existed on 15 October 2026 with three rules between them —
 *  two printed "+0.00%" for a flat value, one printed an ASCII hyphen, two never read the digits at
 *  all — so a candle that closed where it opened read "+0.00%" in one table and "0.00%" beside it. */
export function signedPct(x, decimals = 2) {
  if (!Number.isFinite(x)) return "—";
  const printed = (Math.abs(x) * 100).toFixed(decimals);
  return `${Number(printed) === 0 ? "" : x > 0 ? "+" : "−"}${printed}%`;
}

/**
 * THE LIQUIDATION MAP'S "A MOVE TO HERE CLOSES", for any price, from the model's own rows.
 *
 * `curve` is what src/lib/liqmap.ts levelsCurve() publishes: the top of the drawn range, the row
 * height, and the standing notional per row (row 0 is the HIGHEST price) on each side, in whole
 * dollars. A move down from the mark reaches every long level whose row centre is at or above the
 * target; a move up reaches every short level at or below it. The server prints its eight standard
 * moves and a reader's own ?at= price with this function, and the page's script calls the same
 * function on the same published curve when the reader drags, so the figure under the cursor
 * cannot disagree with the one in the table. It counts only rows inside the drawn range — a price
 * beyond it gets the whole of that side, and the page says what lies past the edge.
 */
export function cumulativeAt(curve, mark, price) {
  let n = 0;
  const below = price <= mark;
  const rows = below ? curve.long : curve.short;
  for (let r = 0; r < rows.length; r++) {
    const mid = curve.hi - (r + 0.5) * curve.band;
    if (below ? mid >= price : mid <= price) n += rows[r];
  }
  return { side: below ? "long" : "short", notional: n };
}

/** A price a reader typed: "78500", "78,500", "$78,500.5". Anything else is null, never a guess. */
export function parsePrice(s) {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\s,$]/g, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 && v < 1e15 ? v : null;
}

/**
 * THE READER'S OWN PRICE, AS ONE SENTENCE — printed by the server for ?at= and rewritten by the
 * page's script while the reader drags, from this one function, so the two cannot word it apart.
 * Beyond the drawn range it does not pretend to know what stands past the edge: it gives the whole
 * of that side inside the range and says the rest is not counted.
 */
export function atReading(curve, mark, price, lo, hi, dp, then = null) {
  const { side, notional } = cumulativeAt(curve, mark, price);
  const who = side === "long" ? "longs" : "shorts";
  const where = `${usd(price, dp)} (${signedPct((price - mark) / mark)})`;
  /* With the day-earlier rows, the same move a day earlier: how the reader's own price has changed
     since yesterday is the one reading no published figure can carry. */
  const was = then ? ` A day earlier the same move would have closed ${compact(cumulativeAt(then, mark, price).notional)}.` : "";
  if (price < lo || price > hi) {
    return `${where} is ${price < lo ? "below" : "above"} the drawn range, which ends at ${usd(price < lo ? lo : hi, dp)}. ` +
      `A move there would close all ${compact(notional)} of modelled ${who} inside the range; what stands past its edge is not counted.${was}`;
  }
  return `A move to ${where} closes ${compact(notional)} of modelled ${who} on the way.${was}`;
}

/** How many changes are up and down, BY THE ARROW changeWords() PRINTS — so "31 up, 22 down" counts
 *  exactly the ▲ and ▼ a reader can see, and a +0.001% that prints "0.00%" with no arrow is flat.
 *  The home page and /coins each counted raw signs with their own filter. */
export function moveCounts(fractions) {
  const shown = fractions.filter(Number.isFinite).map((f) => Number((f * 100).toFixed(2)));
  return { up: shown.filter((v) => v > 0).length, down: shown.filter((v) => v < 0).length, n: shown.length };
}

/** Signed percentage change, arrow included — the 24-hour cell, rendered identically either
 *  side of hydration. */
export function changeWords(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  /* No arrow on a change whose printed digits are zero — the signedPct rule. "▲ 0.00%" claimed a
     direction for a flat candle that signedPct, on the next table, printed as "0.00%". */
  const printed = (Math.abs(fraction) * 100).toFixed(2);
  return Number(printed) === 0 ? `${printed}%` : `${paysArrow(fraction)} ${printed}%`;
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
  if (v < 0) return "\u2212" + compact(-v);
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
  /* A loss is "−$5.00": the sign before the currency, as U+2212. It printed "$-5.00" here while
     /learn/funding-rate wrote "-$5.00" and the arbitrage tool "−$5.00" (15 October 2026). */
  if (x < 0 && Math.abs(x) < 1e15 && Number(Math.abs(x).toFixed(decimals)) !== 0) return "\u2212" + usd(-x, decimals);
  if (x < 0 && Math.abs(x) < 1e15) x = 0;
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

/**
 * WHICH OF THREE THINGS IS TRUE ABOUT A STOP — and it is three, not two.
 *
 * /tools/position-size chose between "the stop executes first" and "liquidation executes first"
 * by comparing two prices: for a long, liquidation above the stop meant liquidation came first.
 * That is an ORDERING, and the question the page answers is whether an ADVERSE move reaches the
 * stop before it reaches liquidation. The two agree only while the stop is on the losing side of
 * entry, and nothing checked that it was.
 *
 * Measured on the live page, 20 August 2026: a short entered at $110,000 with a stop at $100,000
 * — 9.09% into PROFIT — rendered `data-state="stop"` and the sentence "the stop executes first
 * and the loss is bounded by the $250.00 you budgeted". The only exit on the losing side of that
 * position is liquidation at $130,370.37, which takes the whole $550.00 of margin. The page was
 * stating a bound that does not exist, on the one number a reader is there to trust.
 *
 * It is one interaction from the default. The stop input is populated, the side control is a
 * dropdown, and switching it carries the stop across.
 *
 * Both halves of the page read this: the Astro template through src/lib/funding.ts, and the
 * calculator's own script through the same module. There is no second copy to drift — that is
 * the shape which produced the original defect twice over on this page already.
 */
export function stopVerdict(side, entry, stop, liquidationPrice) {
  const long = side === "long";
  /* THE STOP MUST BE ON THE LOSING SIDE OF ENTRY BEFORE ANY ORDERING MEANS ANYTHING. */
  const adverse = long ? stop < entry : stop > entry;
  if (!adverse) return "wrongside";
  return (long ? liquidationPrice > stop : liquidationPrice < stop) ? "liq" : "stop";
}

/**
 * WHICH PANEL A TIMEFRAME GROUP SHOULD SHOW — and the answer is never "none".
 *
 * public/interact.js toggled `data-on` with
 * `panels.forEach(p => p.toggleAttribute("data-on", p.dataset.tfpanel === key))`, which hides
 * every panel when none matches the key. None matches whenever apply() runs for a timeframe
 * whose fetch has not landed, and that happens on any two clicks in flight at once: `tf` is
 * shared by the group, so the first response applies the SECOND click's key.
 *
 * Measured on the live site — click 4H then 1W in one task on a cold page: blank for 13ms with
 * both fetches fast, and 4 SECONDS with 1.5s of latency on the second. The reported symptom
 * exactly: the chart disappears instead of the new one appearing. A serial sweep cannot produce
 * it, because it waits for each panel before clicking the next.
 *
 * The decision lives here, away from the DOM, so it can be exercised without a browser —
 * scripts/panel-cases.mjs. Showing the outgoing chart a moment longer is also simply better
 * than showing a hole while the next one loads.
 */
export function visiblePanel(keys, want, current) {
  if (keys.includes(want)) return want;
  if (current && keys.includes(current)) return current;
  return keys.length ? keys[0] : null;
}
