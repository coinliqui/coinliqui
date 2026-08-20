#!/usr/bin/env node
/**
 * A CHECK THAT HAS NEVER PRODUCED A FINDING IS INDISTINGUISHABLE FROM ONE THAT CANNOT.
 *
 * Measured, not assumed. checks.mjs was instrumented so every exported function recorded its
 * calls and whether it returned a non-empty finding list, and the full `npm run check` was run
 * against it. At the time: nothing was never called, FOUR were observed to fire — flipTableColour,
 * inlineScriptSyntax, sitemapLastmodHonesty, weightFaults — and every other check ran and
 * returned empty on every gate, every time.
 *
 * The great majority of the suite was therefore reporting green that had never been falsified.
 * The current split is printed at the bottom of this file rather than written here, because a
 * ratio in a comment is a measurement with no way to go stale visibly.
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
import { readFileSync } from "node:fs";
import {
  hiddenFromEveryone, dateModifiedAgreement, breadcrumbAgreement, publishesAPerson,
  contradictoryStates, rawEnums, founderAgreement, readmeCounts,
  basisSelfConsistent, uncoveredRoutes, staleDerivedCells, botPolicyReasons,
  undefinedClasses, undefinedVars, unreadableText, colourLegend, colourLanguageDrift,
  chartAgreement, duplicateRuleImplementations, fixtureGaps, requestedLeverageLabels, phantomInlineElements, malformedAttributes, uncitedPermissionClaims, unconditionalCadenceClaims,
  staleCalculatorFigures, controlGroupOverflow, MEASUREMENT_EXPORTS,
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
    check: "unconditionalCadenceClaims",
    why: "a page that promises a refresh cadence keeps promising it after the cadence stops",
    /* The fire fixture is the sentence that actually shipped on three page families. The quiet
       fixture carries the three shapes that must NOT trip it, because each is a way this check
       could become unusable: the claim supplied by freshness() through an expression, the same
       words inside a comment documenting the defect, and an explanatory cadence in prose that is
       not a promise about the figures on the page. */
    fire: () => unconditionalCadenceClaims([["f.astro",
      `<p class="clock">Mark price and funding update every minute. Open interest comes from the snapshot.</p>`]]),
    quiet: () => unconditionalCadenceClaims([["f.astro",
      `<p class="clock">{fresh.note} Open interest comes from the snapshot.</p>` +
      `{/* it used to say "funding updates every minute" unconditionally */}` +
      `<p>The candle series behind the chart is collected every 2 hours; each panel prints its own age.</p>`]]),
  },
  {
    check: "uncitedPermissionClaims",
    why: "a legal conclusion about a third party, in our own voice, with nothing a reader can check",
    /* The fire fixture is the sentence that actually shipped, twice, from a root in src/lib.
       The quiet fixture carries all three legitimate forms side by side, because each is a way
       the check could over-reach and make itself unusable: a cited claim, an openly unverified
       one, and a conditional that asserts nothing. It also carries an infrastructure sentence
       about our own CSP — the false-positive class that took the first version of this check
       from 4 real hits to 23. */
    fire: () => uncitedPermissionClaims([["f.astro",
      `Coinbase Exchange is free, without a key, and permits display with attribution.`]]),
    quiet: () => uncitedPermissionClaims([["f.astro",
      `Coinbase permits display with attribution — https://www.coinbase.com/legal/market_data says so. ` +
      `What OKX's API agreement permits is unverified and uncited here. ` +
      `If Hyperliquid's terms turn out to permit redistribution, the feature comes back. ` +
      `script-src permitted one named Google host while the analytics ran.`]]),
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
    check: "staleCalculatorFigures",
    why: "a figure in a calculator's verdict with no id keeps its first-byte value while the cards beside it repaint — observed live as \"At 5x\" beside a price only 60x produces",
    fire: () => staleCalculatorFigures([["fixture.astro",
      `<div data-when="liq">the entire <b>{usd(marginAtRisk, 2)}</b> of margin goes with it</div>`]]),
    quiet: () => staleCalculatorFigures([["fixture.astro",
      `<div data-when="liq">the entire <b id="v-margin1">{usd(marginAtRisk, 2)}</b> of margin goes with it</div>`]]),
  },
  {
    check: "controlGroupOverflow",
    why: "a container holding a GENERATED list of controls that neither wraps nor scrolls loses its last options off the edge of a phone — measured live at 371px, the 442px timeframe group put 1W and 1M off-screen on all sixty chart pages",
    fire: () => controlGroupOverflow(
      `.tf { display: inline-flex; gap: var(--seg-gap); padding: 2px; }`,
      [["fixture.astro", `<div class="tf">{TIMEFRAMES.map((t) => (<button data-tf={t.key}>{t.label}</button>))}</div>`]]),
    quiet: () => controlGroupOverflow(
      `.tf { display: inline-flex; flex-wrap: wrap; gap: var(--seg-gap); padding: 2px; }`,
      [["fixture.astro", `<div class="tf">{TIMEFRAMES.map((t) => (<button data-tf={t.key}>{t.label}</button>))}</div>`]]),
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
    check: "duplicateRuleImplementations",
    why: "one fact implemented twice drifts, and comparing the copies is how you get a third",
    /* The fire fixture is the real shape: shared.js defines the rule and a second file defines it
       again. The quiet fixture is the design — one definition, and re-exports elsewhere, because
       funding.ts and chart.ts both re-export so callers keep their import paths and a re-export
       must never read as a duplicate. */
    fire: () => duplicateRuleImplementations([
      ["public/shared.js", "export function usd(x) { return `$${x}`; }\nexport const pct = (x) => `${x}%`;\nexport function paysClass(a){return a>=0?'pays-l':'pays-s';}\nexport const paysLabel=(a)=>a>=0?'l':'s';\nexport const paysArrow=(a)=>a>=0?'u':'d';\nexport const carryCost=(n,a,d)=>n*a*d;\nexport function spreadOf(x){return x;}\nexport function changeWords(x){return `${x}`;}\nexport function ageWords(m){return `${m}`;}\nexport const minutesSince=(a)=>a;\nexport const nf=(n,d)=>`${n}`;\nexport function qty(n){return `${n}`;}\nexport function compact(v){return `$${v}`;}\nexport function aprSpread(x){return x;}"],
      ["public/interact.js", "const usd = (x) => `$${x}`;"],
    ]),
    quiet: () => duplicateRuleImplementations([
      ["public/shared.js", "export function usd(x) { return `$${x}`; }\nexport const pct = (x) => `${x}%`;\nexport function paysClass(a){return a>=0?'pays-l':'pays-s';}\nexport const paysLabel=(a)=>a>=0?'l':'s';\nexport const paysArrow=(a)=>a>=0?'u':'d';\nexport const carryCost=(n,a,d)=>n*a*d;\nexport function spreadOf(x){return x;}\nexport function changeWords(x){return `${x}`;}\nexport function ageWords(m){return `${m}`;}\nexport const minutesSince=(a)=>a;\nexport const nf=(n,d)=>`${n}`;\nexport function qty(n){return `${n}`;}\nexport function compact(v){return `$${v}`;}\nexport function aprSpread(x){return x;}"],
      ["src/lib/funding.ts", 'export { usd, pct, compact } from "../../public/shared.js";'],
    ]),
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

/* THE COVERAGE LINE IS THE POINT: how many finding-returning checks have a standing fixture
   proving they can fire. Four are proven instead by cases living in blind-cases.mjs,
   sitemap-honesty.mjs and weight-cases.mjs.

   THE TOTAL IS COUNTED, NOT TRANSCRIBED. It was the literal 25, which is a number that was true
   on the day it was typed. Adding a check printed "30 of 25 finding-returning checks now have a
   standing fixture" and, underneath it, "-5 still report green that has never been falsified".
   A coverage line that can go negative is not measuring coverage. */
/* ---------------------------------------------------------------------------------------------
   THE QUESTION TO ASK BEFORE WIRING A CHECK IN, and it is not "does it pass".

   Two of them: what does this fire on TODAY, and is that list shorter than its exemptions?

   Written down because having it written down was not enough. checks.mjs already carried the
   sentence "an inferred rule that fires on every flex row would be turned off within a week",
   and the first version of controlGroupOverflow asked every flex rule in the stylesheet to wrap
   or be exempted. It fired on ten — .btn, .verdict, .empty, .nav-item, both topbar clusters —
   every one a fixed arrangement of two or three children that cannot grow. Ten findings, ten
   exemptions, zero defects. That check would have been deleted or ignored within a month, and
   the real defect it was written for would have come back unnoticed.

   The rewrite narrowed the INPUT rather than the rule: containers whose children come from a
   .map(). It fires on nothing today and needs no exemptions, because the question it asks is
   the one that matters.

   A check with more exemptions than findings is not a strict check, it is a list of things
   somebody decided not to fix, wearing a check's clothes. The ratio is recorded below so it is
   visible rather than remembered.
   --------------------------------------------------------------------------------------------- */
const EXEMPTION_COUNTS = {
  /* check name -> how many named exemptions it carries. A check absent from this map carries
     none, which is the state to aim for. */
  "check-inventory: MANUAL_BY_DESIGN": 3,
  "coin-charts: EXPECTED_TFS": 0,
  "controlGroupOverflow": 0,
};
for (const [name, n] of Object.entries(EXEMPTION_COUNTS)) {
  if (n > 3) console.log(`  note  ${name} carries ${n} exemptions — ask what it fires on today`);
}

const PROVEN_ELSEWHERE = ["flipTableColour", "inlineScriptSyntax", "sitemapLastmodHonesty", "weightFaults"];
const TOTAL_CHECKS = [...readFileSync(new URL("./checks.mjs", import.meta.url), "utf8")
  .matchAll(/^export function (\w+)/gm)].map((m) => m[1])
  .filter((n) => !MEASUREMENT_EXPORTS.includes(n)).length;
const covered = new Set([...cases.map((c) => c.check), ...PROVEN_ELSEWHERE]).size;
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log(`\n  ${covered} of ${TOTAL_CHECKS} finding-returning checks now have a standing fixture that proves they fire`);
console.log(`  ${TOTAL_CHECKS - covered} still report green that has never been falsified — the number to drive down`);
