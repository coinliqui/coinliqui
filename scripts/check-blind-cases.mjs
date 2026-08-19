#!/usr/bin/env node
/**
 * A CHECK THAT HAS NEVER PRODUCED A FINDING IS INDISTINGUISHABLE FROM ONE THAT CANNOT.
 *
 * Measured, not assumed. checks.mjs was instrumented so every exported function recorded its
 * calls and whether it returned a non-empty finding list, and the full `npm run check` was run
 * against it. Of 27 exports — 25 finding-returning checks and 2 measurement functions —
 *
 *   0  were never called          (extractionRatio was the last one, fixed the cycle before)
 *   4  were observed to fire      flipTableColour, inlineScriptSyntax, sitemapLastmodHonesty,
 *                                 weightFaults
 *  21  ran and returned empty     every gate, every time
 *
 * Twenty-one of twenty-five is 84% of the suite reporting green that has never been falsified.
 * Several of those had a fault injected BY HAND at the time they were written — that proves the
 * check once and proves nothing after the next refactor. This file is the standing version: one
 * fixture per check, built to make it fire, run on every gate.
 *
 * The audit harness needed its own blind case too. Its first version counted any truthy return
 * as "fired", which scored pageWeight 33/33 — pageWeight returns a measurement object and is
 * truthy on every call. Return shape is now recorded, and the question is only asked of checks
 * that return a list.
 *
 * Fixtures are added a batch per cycle; the coverage line at the bottom is the number to watch.
 */
import {
  hiddenFromEveryone, dateModifiedAgreement, breadcrumbAgreement, publishesAPerson,
  contradictoryStates, rawEnums, founderAgreement, readmeCounts,
  basisSelfConsistent, uncoveredRoutes, staleDerivedCells, botPolicyReasons,
  undefinedClasses, undefinedVars, unreadableText, colourLegend, colourLanguageDrift,
  chartAgreement, formatterDrift, fixtureGaps, requestedLeverageLabels, phantomInlineElements, malformedAttributes,
} from "./checks.mjs";

/* Enough page for a check to have something to read. Deliberately minimal: a fixture that is
   almost a real page hides which detail made the check fire. */
/* The real palette shape, so colourLegend is looking at the colours the site actually uses. */
const PALETTE = {
  candle: { up: "#26a69a", down: "#ef5350" },
  funding: { paysL: "#f5a623", paysS: "#22b8cf" },
  token: { paysL: "#f5a623", paysS: "#22b8cf" },
};

const doc = (body, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const cases = [
  {
    check: "hiddenFromEveryone",
    why: "text present in the DOM and hidden by CSS is redacted from a browser and from nothing else",
    fire: () => hiddenFromEveryone(doc(
      `<style>.gone{display:none}</style><div class="gone">Not updating</div>`)),
    quiet: () => hiddenFromEveryone(doc(`<div>Updated 2 min ago</div>`)),
  },
  {
    check: "contradictoryStates",
    why: "a page carrying both an age and a claim it is not updating tells two stories at once",
    fire: () => contradictoryStates(doc(`<p>Updated 3 min ago</p><p>Not updating</p>`)),
    quiet: () => contradictoryStates(doc(`<p>Updated 3 min ago</p>`)),
  },
  {
    check: "malformedAttributes",
    why: "an attribute a browser ignores is an attribute that renders correctly and is still wrong",
    /* BOTH observed shapes, verbatim from the live coin pages: the empty geometry attribute that
       131 candles carried, and the fragment-as-value that the wide-candle branch produced. The
       quiet fixture carries a correct rx AND a data- attribute holding an equals sign, because
       the second signature must not fire on legitimate values that contain markup-like text. */
    fire: () => malformedAttributes(doc(
      `<svg><rect x="1" y="2" width="3" height="4" rx="" fill="none"/>` +
      `<rect x="5" y="6" width="7" height="8" rx=" rx="1"" fill="none"/></svg>`)),
    quiet: () => malformedAttributes(doc(
      `<svg><rect x="1" y="2" width="3" height="4" rx="1" fill="none"/></svg>` +
      `<div data-plot="16,16,1164,476" data-q="a=&quot;b&quot;"><a href="/x?a=1&amp;b=2">k</a></div>`)),
  },
  {
    check: "phantomInlineElements",
    why: "an inline element the compiler invented, left open, puts the rest of a page in the wrong typeface",
    /* BOTH SIGNATURES IN THE FIRE FIXTURE, and both taken verbatim from the shape @astrojs/compiler
       actually emitted for /privacy: an empty <code> after </table>, and a second one left open
       before the following <p>. The quiet fixture is the same markup with real content in the
       <code>, because "an inline element containing a short string" is the overwhelmingly common
       legitimate case and a check that flags it is unusable. */
    fire: () => phantomInlineElements(doc(
      `<table><tbody><tr><td><code>rail</code></td></tr></tbody></table><code></code></div><code> <p>after</p>`)),
    quiet: () => phantomInlineElements(doc(
      `<table><tbody><tr><td><code>rail</code></td></tr></tbody></table><p>after, in <code>the right</code> typeface</p>`)),
  },
  {
    check: "rawEnums",
    why: "an upstream's internal venue code reaching the reader is a leak of the data layer",
    fire: () => rawEnums(doc(`<p>Funding on HlPerp is 12%</p>`)),
    quiet: () => rawEnums(doc(`<p>Funding on Hyperliquid is 12%</p>`)),
  },
  {
    check: "dateModifiedAgreement",
    why: "the date the machine layer states must be the date the page states",
    fire: () => dateModifiedAgreement(doc(
      `<span data-fresh="1780000000000"></span>` +
      `<script type="application/ld+json">{"dateModified":"2020-01-01T00:00:00.000Z"}</script>`)),
    quiet: () => dateModifiedAgreement(doc(
      `<span data-fresh="1780000000000"></span>` +
      `<script type="application/ld+json">{"dateModified":"${new Date(1780000000000).toISOString()}"}</script>`)),
  },
  {
    check: "breadcrumbAgreement",
    why: "a BreadcrumbList that disagrees with the visible crumb shapes the search result wrongly",
    fire: () => breadcrumbAgreement(doc(
      `<p class="crumb"><a href="/funding">Funding</a> › BTC</p>`,
      `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[` +
      `{"@type":"ListItem","position":1,"name":"Coins"},{"@type":"ListItem","position":2,"name":"BTC"}]}</script>`)),
    quiet: () => breadcrumbAgreement(doc(
      `<p class="crumb"><a href="/funding">Funding</a> › BTC</p>`,
      `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[` +
      `{"@type":"ListItem","position":1,"name":"Funding"},{"@type":"ListItem","position":2,"name":"BTC"}]}</script>`)),
  },
  {
    check: "publishesAPerson",
    why: "a personal email in the markup is the exact leak that got an address harvested once",
    fire: () => publishesAPerson(doc(`<a href="mailto:someone@icloud.com">write to me</a>`)),
    quiet: () => publishesAPerson(doc(`<a href="mailto:hello@coinliqui.com">contact</a>`)),
  },
  {
    check: "founderAgreement",
    why: "the page and the structured data must not half-ship a name",
    fire: () => founderAgreement(doc(
      `<p>The project is independently run.</p>`,
      `<script type="application/ld+json">{"founder":{"@type":"Person","name":"A Name"}}</script>`)),
    quiet: () => founderAgreement(doc(`<p>The project is independently run.</p>`)),
  },
  {
    check: "readmeCounts",
    why: "a hardcoded count in the README goes stale the moment a contract crosses the floor",
    fire: () => readmeCounts("# x\n\nIt covers 50 contracts across 3 venues.\n"),
    quiet: () => readmeCounts("# x\n\nIt covers every contract above the open-interest floor.\n"),
  },
  /* ---- batch 2: content and structural integrity ---------------------------------------- */
  {
    check: "basisSelfConsistent",
    why: "a printed basis that is not the gap between the mark and spot printed beside it means one of the three is read off a different clock",
    /* 100.00 vs 50.00 is +10,000 bps. Printing 12.0 is a contradiction far outside the
       display-rounding tolerance the check derives from the decimal places themselves. */
    fire: () => basisSelfConsistent(doc(
      `<td data-spot="mark">$100.00</td><td data-spot="last">$50.00</td><td data-spot="basis">12.0</td>`)),
    /* 100.05 against 100.00 is +5.0 bps, printed as such — inside tolerance, so silent. */
    quiet: () => basisSelfConsistent(doc(
      `<td data-spot="mark">$100.05</td><td data-spot="last">$100.00</td><td data-spot="basis">5.0</td>`)),
  },
  {
    check: "uncoveredRoutes",
    why: "a template the build produced that the smoke pass never requests is a page nobody has ever looked at",
    fire: () => uncoveredRoutes('{"route":"/funding/[symbol]"},{"route":"/brand-new-thing"}', ["/funding/btc"]),
    quiet: () => uncoveredRoutes('{"route":"/funding/[symbol]"}', ["/funding/btc"]),
  },
  {
    check: "staleDerivedCells",
    why: "a cell computed from a live APR without data-spot keeps its render-time value after the overlay repaints the rate",
    fire: () => staleDerivedCells([["fixture.astro",
      `<tr><td data-spot={x + "apr"}>5%</td><td>{carryCost(10000, apr, 7)}</td></tr>`]]),
    quiet: () => staleDerivedCells([["fixture.astro",
      `<tr><td data-spot={x + "apr"}>5%</td><td data-spot="carry">{carryCost(10000, apr, 7)}</td></tr>`]]),
  },
  {
    check: "botPolicyReasons",
    why: "excluding a crawler without saying why is a decision nobody can review later",
    fire: () => botPolicyReasons(`const BLOCKED = [{ ua: "SomeBot", why: "" }];`),
    quiet: () => botPolicyReasons(`const BLOCKED = [{ ua: "SomeBot", why: "scrapes aggressively and ignores crawl-delay" }];`),
  },
  /* ---- batch 3: the visual language, and the three that read source rather than markup ---- */
  {
    check: "undefinedClasses",
    why: "a class in the markup with no rule behind it is styling the author believes exists",
    fire: () => undefinedClasses(doc(`<div class="totally-made-up">x</div>`), `.something-else{color:red}`),
    quiet: () => undefinedClasses(doc(`<div class="real-one">x</div>`), `.real-one{color:red}`),
  },
  {
    check: "undefinedVars",
    why: "var(--missing) with no fallback resolves to nothing, and nothing is not a colour",
    fire: () => undefinedVars(doc(`<div style="color:var(--never-declared)">x</div>`), `:root{--other:#fff}`),
    /* Two ways to be clean, and both must be silent: declared, or given a fallback. */
    quiet: () => undefinedVars(doc(`<div style="color:var(--declared)">x</div>`), `:root{--declared:#fff}`)
      .concat(undefinedVars(doc(`<div style="color:var(--absent,#fff)">x</div>`), `:root{}`)),
  },
  {
    check: "unreadableText",
    why: "text below 4.5:1 on the surface it sits on is unreadable, whatever the palette intended",
    /* #777 on #666 is about 1.3:1. The tokens are the real ones so the check finds them. */
    fire: () => unreadableText(`:root{--bg:#666666;--surface-1:#666666;--surface-2:#666666;--surface-3:#666666;--text:#777777;--text-dim:#777777;--text-faint:#777777}`),
    quiet: () => unreadableText(`:root{--bg:#000000;--surface-1:#000000;--surface-2:#000000;--surface-3:#000000;--text:#ffffff;--text-dim:#ffffff;--text-faint:#ffffff}`),
  },
  {
    check: "colourLanguageDrift",
    why: "the chart ink and the CSS token for one meaning must be the same colour, or a table and a chart show it two ways",
    fire: () => colourLanguageDrift({
      candle: { up: "#26a69a", down: "#ef5350" },
      funding: { paysL: "#f5a623", paysS: "#22b8cf" },
      token:   { paysL: "#ff0000", paysS: "#22b8cf" },
    }),
    quiet: () => colourLanguageDrift({
      candle: { up: "#26a69a", down: "#ef5350" },
      funding: { paysL: "#f5a623", paysS: "#22b8cf" },
      token:   { paysL: "#f5a623", paysS: "#22b8cf" },
    }),
  },
  {
    check: "colourLegend",
    why: "colour carrying meaning without a written explanation excludes every reader who cannot separate the hues",
    fire: () => colourLegend(doc(`<div class="pays-l">longs</div><div class="pays-s">shorts</div>`), PALETTE),
    quiet: () => colourLegend(doc(
      `<div class="pays-l">longs</div><div class="pays-s">shorts</div>` +
      `<p>Amber means longs pay shorts; cyan means shorts pay longs.</p>` +
      `<p>Candles are green when the close is above the open and red when it is below.</p>`), PALETTE),
  },
  {
    check: "chartAgreement",
    why: "a chart whose plotted points disagree with the table beside it is two answers to one question",
    /* Three faults, one fixture each, because they are three different branches: unparsable
       points, a point that is not a tuple (which used to throw and take the gate down), and an
       incoherent candle whose high is below its open. */
    fire: () => [
      ...chartAgreement(doc(`<div data-tfpanel="1h" data-on></div><script id="pts-1h">{ not json</script>`)),
      ...chartAgreement(doc(`<div data-tfpanel="1h" data-on></div><script id="pts-1h">[{"o":1}]</script>`)),
      ...chartAgreement(doc(`<div data-tfpanel="1h" data-on></div><script id="pts-1h">[[1,0,10,5,1,8]]</script>`)),
    ],
    quiet: () => [
      ...chartAgreement(doc(`<p>no chart on this page at all</p>`)),
      ...chartAgreement(doc(`<div data-tfpanel="1h" data-on></div><script id="pts-1h">[[1,0,5,10,1,8]]</script>`)),
    ],
  },
  {
    check: "formatterDrift",
    why: "the server and the client must format one number the same way, or the value changes when JS lands",
    /* extractFn looks for `const NAME = (`, the shape interact.js actually uses — my first
       fixture wrote `function usd(v)` and the check reported that it could not find it, which is
       the check being right about a fixture that was wrong. */
    fire: () => formatterDrift('const usd = (v) => "$" + (v * 2).toFixed(2);', { usd: (v) => `$${v.toFixed(2)}` }),
    quiet: () => formatterDrift('const usd = (v) => "$" + v.toFixed(2);', { usd: (v) => `$${v.toFixed(2)}` }),
  },
  {
    check: "fixtureGaps",
    why: "a KV key the code reads but the seed never writes makes the smoke pass exercise an empty store",
    fire: () => fixtureGaps([["fixture.ts", 'kv.get(`candles:${sym}`)']], ["snapshot"]),
    quiet: () => fixtureGaps([["fixture.ts", 'kv.get(`candles:${sym}`)']], ["candles"]),
  },
  {
    check: "requestedLeverageLabels",
    why: "a page computing a tier-correct liquidation price while printing the leverage the reader asked for mislabels it — this shipped twice",
    /* It tests for clamp AWARENESS by behaviour rather than by variable name — deliberately, per
       its own comment, because a name test cried wolf on /tools/leverage. So the clean fixture
       has to actually compute the clamp, not merely rename the variable. */
    fire: () => requestedLeverageLabels(["f.astro"], () =>
      `const liq = liquidationPrice({ leverage, table });\n<p>At {leverage}x your liquidation price is {liq}</p>`),
    quiet: () => requestedLeverageLabels(["f.astro"], () =>
      `const permitted = maxLeverage(table);\nconst effective = Math.min(requested, permitted);\n` +
      `const liq = liquidationPrice({ leverage: effective, table });\n<p>At {effective}x your liquidation price is {liq}</p>`),
  },
];

let bad = 0;
for (const c of cases) {
  const f = c.fire(), q = c.quiet();
  const fires = Array.isArray(f) ? f.length > 0 : Boolean(f);
  const quiet = Array.isArray(q) ? q.length === 0 : !q;
  if (!fires) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} did NOT fire on a fixture built to make it fire`); continue; }
  if (!quiet) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} fired on the clean fixture too — it cannot tell them apart`); console.log(`          ${JSON.stringify(q).slice(0, 140)}`); continue; }
  console.log(`  ok    ${c.check.padEnd(24)} fires on the fault, silent on the clean page  — ${c.why}`);
}

/* THE COVERAGE LINE IS THE POINT. 25 finding-returning checks exist; this is how many have a
   standing fixture proving they can fire. Four more were already proven by cases living in
   blind-cases.mjs, sitemap-honesty.mjs and weight-cases.mjs. */
const PROVEN_ELSEWHERE = ["flipTableColour", "inlineScriptSyntax", "sitemapLastmodHonesty", "weightFaults"];
const TOTAL_CHECKS = 25;
const covered = new Set([...cases.map((c) => c.check), ...PROVEN_ELSEWHERE]).size;
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log(`\n  ${covered} of ${TOTAL_CHECKS} finding-returning checks now have a standing fixture that proves they fire`);
console.log(`  ${TOTAL_CHECKS - covered} still report green that has never been falsified — the number to drive down`);
