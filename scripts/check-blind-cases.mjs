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
  staleCalculatorFigures, controlGroupOverflow, MEASUREMENT_EXPORTS, stampVerdict,
  stampSurfacesAgree,
  symbolAddressing,
  staleAnnouncerState,
  underLinked,
  duplicateHeadMetadata,
  computedFigureFloor, COMPUTED_FIGURES,
  leadsWithItsSubject,
  llmsHostsAgree,
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

let bad0 = 0;
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
    why: "a page may not announce a change NEWER than the data it is showing — that is a recrawl a crawler makes and finds nothing for. The reverse, a document older than its live numbers, is the ordinary case on /unlocks and /liquidations/sweep and must stay quiet",
    fire: () => dateModifiedAgreement(doc(
      `<span data-fresh="1780000000000"></span>` +
      `<script type="application/ld+json">{"dateModified":"2286-01-01T00:00:00.000Z"}</script>`)),
    /* TWO QUIET SHAPES. Equal is the ordinary market page. OLDER is the case the old rule got
       wrong and forced four pages to misstate: a document that has not changed while the numbers
       inside it have. Only one of these was tested before, which is why the wrong rule survived. */
    quiet: () => [
      ...dateModifiedAgreement(doc(
        `<span data-fresh="1780000000000"></span>` +
        `<script type="application/ld+json">{"dateModified":"${new Date(1780000000000).toISOString()}"}</script>`)),
      ...dateModifiedAgreement(doc(
        `<span data-fresh="1780000000000"></span>` +
        `<script type="application/ld+json">{"dateModified":"2026-01-15T06:07:00.000Z"}</script>`)),
    ],
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
      `<td data-repaint="mark">$100.00</td><td data-repaint="last">$50.00</td><td data-repaint="basis">12.0</td>`)),
    /* 100.05 against 100.00 is +5.0 bps, printed as such — inside tolerance, so silent. */
    quiet: () => basisSelfConsistent(doc(
      `<td data-repaint="mark">$100.05</td><td data-repaint="last">$100.00</td><td data-repaint="basis">5.0</td>`)),
  },
  {
    check: "uncoveredRoutes",
    why: "a template the build produced that the smoke pass never requests is a page nobody has ever looked at",
    fire: () => uncoveredRoutes('{"route":"/funding/[symbol]"},{"route":"/brand-new-thing"}', ["/funding/btc"]),
    quiet: () => uncoveredRoutes('{"route":"/funding/[symbol]"}', ["/funding/btc"]),
  },
  {
    check: "staleDerivedCells",
    why: "a cell computed from a live APR without data-repaint keeps its render-time value after the overlay repaints the rate",
    fire: () => staleDerivedCells([["fixture.astro",
      `<tr><td data-repaint={x + "apr"}>5%</td><td>{carryCost(10000, apr, 7)}</td></tr>`]]),
    quiet: () => staleDerivedCells([["fixture.astro",
      `<tr><td data-repaint={x + "apr"}>5%</td><td data-repaint="carry">{carryCost(10000, apr, 7)}</td></tr>`]]),
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
    /* TWO WAYS OF BEING QUIET, because only one of them was ever tested and the other was
       broken. The first is a flex row that wraps. The second is a container whose rule is
       ELEMENT-QUALIFIED — `table.tbl`, which is how the layout declares every table on this
       site — and the lookup used to miss it and report a styled class as unstyled. Both must
       return nothing or the check is guessing. */
    quiet: () => [
      ...controlGroupOverflow(
        `.tf { display: inline-flex; flex-wrap: wrap; gap: var(--seg-gap); padding: 2px; }`,
        [["fixture.astro", `<div class="tf">{TIMEFRAMES.map((t) => (<button data-tf={t.key}>{t.label}</button>))}</div>`]]),
      ...controlGroupOverflow(
        `table.tbl { border-collapse: collapse; width: 100%; }`,
        [["fixture.astro", `<table class="tbl"><tbody>{rows.map((r) => (<tr><td><a href={r.h}>{r.s}</a></td></tr>))}</tbody></table>`]]),
    ],
  },
  {
    check: "stampSurfacesAgree",
    why: "a URL states when it changed twice — <lastmod> in its sitemap and dateModified on the page — and until this nothing compared the two; /data-sources published a commit date of 20 August and an hourly one on the page for a week with both of its own checks green",
    fire: () => stampSurfacesAgree(
      [{ path: "/data-sources", lastmod: "2026-08-20T10:00:00.000Z", dateModified: "2026-08-27T09:12:00.000Z" }],
      { "/data-sources": "2026-08-20T10:00:00.000Z" }),
    /* BOTH QUIET SHAPES, because they are quiet for different reasons and only one of them was
       obvious: a commit date matching exactly, and a data stamp whose sitemap copy is floored to
       the hour while the page carries the exact instant. Testing only the first would leave the
       tolerance branch unexercised, which is the hole this suite keeps finding elsewhere. */
    quiet: () => [
      ...stampSurfacesAgree(
        [{ path: "/data-sources", lastmod: "2026-08-20T10:00:00.000Z", dateModified: "2026-08-20T10:00:00.000Z" }],
        { "/data-sources": "2026-08-20T10:00:00.000Z" }),
      ...stampSurfacesAgree(
        [{ path: "/", lastmod: "2026-08-27T09:00:00.000Z", dateModified: "2026-08-27T09:47:00.000Z" }], {}),
    ],
  },
  {
    check: "symbolAddressing",
    why: "a page that changes when a parameter changes, at a URL whose canonical says it does not — /liquidations rendered fifty complete contract pages and published all fifty at one URL, so forty-nine finished pages were in no sitemap, announced to no index, and instructed every crawler to discard them, while Search Console carried seven coin-named liquidation-map queries that week",
    /* THE DEFECT EXACTLY AS IT SHIPPED: the route varies, and nothing anywhere records that. */
    fire: () => symbolAddressing(
      [{ path: "/liquidations", redirect: null, identityVaries: true, canonicalQuery: "" }], []),
    /* FOUR QUIET SHAPES AND THREE MORE LOUD ONES, because the entry can rot in several
       directions and only the first is obvious. A check that only ever sees the shipped defect
       is a check that will pass the day the verdict outlives the behaviour. */
    quiet: () => [
      // addressed, and the redirect is still there
      ...symbolAddressing(
        [{ path: "/liquidations", redirect: "/liquidations/eth", identityVaries: false, canonicalQuery: "" }],
        [{ path: "/liquidations", verdict: "addressed", why: "x" }]),
      // parameter-only on purpose, varying, canonical clean
      ...symbolAddressing(
        [{ path: "/tools/leverage", redirect: null, identityVaries: true, canonicalQuery: "" }],
        [{ path: "/tools/leverage", verdict: "parameter-only", why: "x" }]),
      // a route that simply does not vary, and is not recorded — the common case
      ...symbolAddressing(
        [{ path: "/about", redirect: null, identityVaries: false, canonicalQuery: "" }], []),
      // nothing probed and nothing declared
      ...symbolAddressing([], []),
    ],
    /* The three regressions the entry is supposed to catch after it exists. Asserted here
       rather than trusted, because each one leaves the gate green under a naive implementation:
       the record still exists, so a check that only asks "is it recorded?" says yes. */
    also: () => [
      // the redirect regressed to a 200 with a per-contract title
      symbolAddressing(
        [{ path: "/liquidations", redirect: null, identityVaries: true, canonicalQuery: "" }],
        [{ path: "/liquidations", verdict: "addressed", why: "x" }]).length === 1,
      // Base started putting the query in the canonical, so each parameter-only page is now
      // fifty self-canonicalising copies of itself
      symbolAddressing(
        [{ path: "/tools/leverage", redirect: null, identityVaries: true, canonicalQuery: "?symbol=ETH" }],
        [{ path: "/tools/leverage", verdict: "parameter-only", why: "x" }]).length === 1,
      // the verdict outlived the behaviour: the route stopped varying and the entry stayed
      symbolAddressing(
        [{ path: "/tools/leverage", redirect: null, identityVaries: false, canonicalQuery: "" }],
        [{ path: "/tools/leverage", verdict: "parameter-only", why: "x" }]).length === 1,
    ],
  },
  {
    check: "staleAnnouncerState",
    why: "the IndexNow drain read the key the Worker stopped writing after a rename, so it held 79 URLs against the live 133 — running it would have posted 4 URLs instead of the 58 owed, cleared no backoff, and printed \"cleared 2 endpoint(s); 0 still owed\"",
    /* THE DRIFT EXACTLY AS MEASURED: a state that predates two templates. */
    fire: () => staleAnnouncerState(
      ["https://coinliqui.com/", "https://coinliqui.com/funding/btc"],
      ["https://coinliqui.com/", "https://coinliqui.com/funding/btc",
       "https://coinliqui.com/liquidations/eth", "https://coinliqui.com/liquidations/sol",
       "https://coinliqui.com/learn"]),
    quiet: () => [
      // in step, in a different order — set membership, not sequence
      ...staleAnnouncerState(
        ["https://coinliqui.com/funding/btc", "https://coinliqui.com/"],
        ["https://coinliqui.com/", "https://coinliqui.com/funding/btc"]),
      // the state knows MORE than the site publishes, which is the retirement case and correct:
      // `known` is a record of what has ever been published, not of what is published today
      ...staleAnnouncerState(
        ["https://coinliqui.com/", "https://coinliqui.com/funding/fet"],
        ["https://coinliqui.com/"]),
      ...staleAnnouncerState([], []),
    ],
    /* One line per TEMPLATE, not per URL: the failure mode this replaced would print fifty
       identical-looking lines and bury the one fact worth reading. */
    also: () => [
      staleAnnouncerState([], Array.from({ length: 49 }, (_, i) => `https://coinliqui.com/liquidations/c${i}`)).length === 1,
      /^the announcer's state is missing 49 of the 49/.test(
        staleAnnouncerState([], Array.from({ length: 49 }, (_, i) => `https://coinliqui.com/liquidations/c${i}`))[0]),
      staleAnnouncerState([], ["https://coinliqui.com/a", "https://coinliqui.com/b/c"])[0].includes("1x /a"),
    ],
  },
  {
    check: "underLinked",
    why: "forty-nine liquidation maps shipped with two inbound links each — the band where eight of the ten contract pages Google has not indexed were sitting, measured on this site in August",
    fire: () => underLinked({ "/liquidations/eth": 2, "/liquidations/sol": 2, "/funding/btc": 53 }),
    quiet: () => [
      ...underLinked({ "/liquidations/eth": 50, "/funding/btc": 53, "/coins/bitcoin": 12 }),
      // the homepage is exempt: every page links it from the nav brand, which is chrome
      ...underLinked({ "/": 0, "/about": 132 }),
      ...underLinked({}),
    ],
    /* THE MEASUREMENT NEARLY WENT IN WRONG, and these pin the shape that caught it. The first
       version of the graph excluded any href carrying a query string, so the fifty
       `/tools/position-size?symbol=X` links the contract pages carry were not counted at all:
       the template read 3 inbound where it actually has 53, and /tools/position-size is the
       page Google currently has as "Discovered - currently not indexed". A wrong number and a
       real symptom agreeing is the most convincing thing a bad instrument can produce, and it
       would have sent somebody to fix a template that was never broken. The caller normalises
       a parameterised href to its path before counting; these assert the consequences. */
    also: () => [
      underLinked({ "/tools/position-size": 53 }).length === 0,
      underLinked({ "/tools/position-size": 3 }).length === 1,
      // a Map is accepted as well as an object, because the caller accumulates in one
      underLinked(new Map([["/x", 1]])).length === 1,
      // the floor is inclusive-below: exactly at the floor passes
      underLinked({ "/x": 5 }).length === 0 && underLinked({ "/x": 4 }).length === 1,
    ],
  },
  {
    check: "duplicateHeadMetadata",
    why: "two published URLs handing a crawler the same claim about what they are — the mirror of the /liquidations defect, where fifty different titles lived at one URL; one title at fifty URLs would have gone unnoticed the same way",
    fire: () => duplicateHeadMetadata([
      { path: "/liquidations/eth", title: "Liquidation heatmap", description: "a" },
      { path: "/liquidations/sol", title: "Liquidation heatmap", description: "b" },
    ]),
    quiet: () => [
      ...duplicateHeadMetadata([
        { path: "/liquidations/eth", title: "ETH liquidation heatmap", description: "a" },
        { path: "/liquidations/sol", title: "SOL liquidation heatmap", description: "b" },
      ]),
      ...duplicateHeadMetadata([]),
    ],
    /* BOTH FIELDS, AND THE ABSENT CASE. A template can keep its title varying while its
       description stops — the two are separate expressions in every page on this site — and an
       empty tag is not a duplicate of anything, so a check that only groups by value would
       report nothing at all for a page that has no description. */
    also: () => [
      duplicateHeadMetadata([
        { path: "/a", title: "A", description: "same" },
        { path: "/b", title: "B", description: "same" },
      ]).length === 1,
      duplicateHeadMetadata([{ path: "/a", title: "A", description: "" }]).length === 1,
      duplicateHeadMetadata([{ path: "/a", title: "", description: "d" }]).length === 1,
      // whitespace is not a difference
      duplicateHeadMetadata([
        { path: "/a", title: " X ", description: "1" },
        { path: "/b", title: "X", description: "2" },
      ]).length === 1,
    ],
  },
  {
    check: "computedFigureFloor",
    why: "forty-nine templated pages shipped in one day with 62% sibling overlap — the shape Google's scaled-content policy is aimed at, and the only defence offered at the time was an argument made after they had shipped",
    fire: () => computedFigureFloor(
      [{ route: "/coins/[coin]", sources: ["const p = perp.markPx; const chart = aggregate(d, 1);"] }], {}, 3),
    quiet: () => [
      ...computedFigureFloor(
        [{ route: "/liquidations/[symbol]", sources: ["buildLiqMap({}); corridorAt(1,2,3); mixUsed(a,b); aggregate(x,1);"] }], {}, 3),
      ...computedFigureFloor([], {}, 3),
    ],
    /* THE FOUR WAYS THIS FLOOR CAN BE FOOLED, and it was written knowing them. */
    also: () => [
      /* A REGISTRY ENTRY THAT NO LONGER EXISTS counts nothing on every page and says nothing.
         This is not hypothetical: the first run reported carryCost missing because the caller's
         export scan did not understand `export { … } from "…"`, which is how src/lib/funding.ts
         re-exports sixteen names. The check refusing to trust its own list is what surfaced a
         bug in the scan rather than a phantom finding about the site. */
      computedFigureFloor([], { "funding.ts": ["toApr"] }, 3).some((f) => /no longer exports/.test(f)),
      computedFigureFloor([], { "funding.ts": COMPUTED_FIGURES_NAMES() }, 3).length === 0,
      /* A MENTION IS NOT A CALL. A page that names buildLiqMap in a comment computes nothing. */
      computedFigureFloor(
        [{ route: "/x/[y]", sources: ["/* see buildLiqMap and corridorAt and mixUsed */"] }], {}, 3).length === 1,
      /* THE COMPONENT COUNTS. /liquidations/[symbol] delegates its whole body to LiqMap.astro;
         reading only the route file would score the page that computes most on this site at 0. */
      computedFigureFloor(
        [{ route: "/x/[y]", sources: ["import L from './L.astro'", "buildLiqMap(); corridorAt(); mixUsed();"] }], {}, 3).length === 0,
    ],
  },
  {
    check: "leadsWithItsSubject",
    why: "/funding/{symbol} takes 70% of this site's verified ChatGPT-User fetches and its opening 900 characters did not contain the words funding or a rate — an extractor that truncates would answer with the price",
    fire: () => leadsWithItsSubject(
      "<h1>BTC perpetual</h1><p>$78,595.00, down 12.6% over 220 daily bars. Period high $90,587. Open interest $2.87B.</p>",
      [{ label: "the funding rate", re: /funding/i }, { label: "a percentage", re: /\d+(\.\d+)?%/ }]),
    quiet: () => [
      ...leadsWithItsSubject(
        "<h1>BTC perpetual</h1><p>BTC funding on Hyperliquid is 10.95% a year at its 1-hour settlement.</p>",
        [{ label: "the funding rate", re: /funding/i }, { label: "a percentage", re: /\d+(\.\d+)?%/ }]),
      ...leadsWithItsSubject("<p>anything</p>", []),
    ],
    also: () => [
      /* THE WINDOW IS THE WHOLE POINT. The same document passes when the check reads far enough
         and fails when it reads only the opening — which is exactly the difference between an
         extractor that consumed the page and one that truncated. A version that scanned the
         whole body would have reported this page as fine, because the figure IS on it. */
      leadsWithItsSubject(`<p>${"price and volume and open interest. ".repeat(30)} funding 10.9%</p>`,
        [{ label: "the funding rate", re: /funding/i }], 700).length === 1,
      leadsWithItsSubject(`<p>${"price and volume and open interest. ".repeat(30)} funding 10.9%</p>`,
        [{ label: "the funding rate", re: /funding/i }], 5000).length === 0,
      /* MARKUP IS NOT TEXT: a term hidden in an attribute, a script or an SVG has not been said
         to a reader, and a check counting raw HTML would accept it. */
      leadsWithItsSubject('<div data-kind="funding"><script>var funding=1</script><p>price only</p></div>',
        [{ label: "the funding rate", re: /funding/i }]).length === 1,
      leadsWithItsSubject("", [{ label: "anything", re: /x/ }]).length === 1,
    ],
  },
  {
    check: "llmsHostsAgree",
    why: "llms.txt said the CSP names exactly one script host on a morning when it named two — a precise, checkable claim addressed to machines that will not ask a follow-up question, wrong for as long as nobody happened to reread the file",
    fire: () => llmsHostsAgree(
      "The Content-Security-Policy names exactly one host, static.cloudflareinsights.com, in script-src.",
      "'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.googletagmanager.com"),
    quiet: () => [
      ...llmsHostsAgree(
        "The Content-Security-Policy names exactly two hosts in script-src, static.cloudflareinsights.com and www.googletagmanager.com.",
        "'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.googletagmanager.com"),
      ...llmsHostsAgree("It names no host at all in script-src.", "'self' 'unsafe-inline'"),
    ],
    also: () => [
      /* THE OTHER DIRECTION: a host the file still advertises after the header stopped
         permitting it is a claim the site cannot support, and is exactly as wrong. */
      llmsHostsAgree("script-src permits static.cloudflareinsights.com.", "'self'").length === 1,
      /* READING NOTHING IS NOT AGREEING. If the sentence this anchors on is ever reworded away,
         the check must say so rather than returning an empty list that looks like a pass — the
         failure mode every silent instrument in this repository has had. */
      llmsHostsAgree("A file with no such sentence.", "'self' https://x.test").length === 1,
      /* The site's own domain appears in that sentence and is not an off-origin script host. */
      llmsHostsAgree("script-src on https://coinliqui.com permits static.cloudflareinsights.com.",
        "'self' https://static.cloudflareinsights.com").length === 0,
      /* Subdomains are distinct hosts: www.googletagmanager.com is not googletagmanager.com. */
      llmsHostsAgree("script-src names googletagmanager.com.", "'self' https://www.googletagmanager.com").length === 2,
    ],
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
    /* THE READ SHAPES ARE PART OF THE CASE. This check used to match one syntax and say it
       covered every KV series the code reads; the fixture below now carries all three it can
       see — a template prefix, a literal key and a module constant — so a future narrowing
       that silently drops one of them fails here rather than in production. Each read carries
       its type argument, because that is what distinguishes a KV read from searchParams.get. */
    fire: () => fixtureGaps([["fixture.ts", 'const REACH = "identity:reach";\nkv.get(`candles:${sym}`, "json");\nkv.get("live", "json");\nkv.get(REACH, "json");\nurl.searchParams.get("tf");']], ["snapshot"]).gaps,
    quiet: () => fixtureGaps([["fixture.ts", 'const REACH = "identity:reach";\nkv.get(`candles:${sym}`, "json");\nkv.get("live", "json");\nkv.get(REACH, "json");\nurl.searchParams.get("tf");']], ["candles", "live", "identity:reach"]).gaps,
    /* THE FOURTH READ SHAPE, added 27 August 2026 after it went unseen on a live page. /status
       reads `indexnow:state` as STATE_KEY, imported from the worker that writes it — the
       announcer's whole state, on the only account-free route into the non-Google indexes,
       read from a page with no fixture behind it while the success line said all eleven
       prefixes were covered. Case 3 resolved constants only within one file.

       Three assertions, because the interesting half is what must NOT happen: the declaring
       file supplies the constant and NOT its own reads, or the cron's keys would be demanded
       of a fixture built to render pages. */
    also: () => [
      // an imported constant resolves when its declaring file is passed as constantSources
      fixtureGaps([["page.astro", 'kv.get(STATE_KEY, "json");']], ["snapshot"],
        [["worker/indexnow.ts", 'export const STATE_KEY = "indexnow:state";']]).gaps.length === 1,
      // ...and is quiet once the fixture carries that prefix
      fixtureGaps([["page.astro", 'kv.get(STATE_KEY, "json");']], ["indexnow:state"],
        [["worker/indexnow.ts", 'export const STATE_KEY = "indexnow:state";']]).gaps.length === 0,
      // the declaring file's OWN reads are not collected — it is not on the render path
      fixtureGaps([["page.astro", 'kv.get("live", "json");']], ["live"],
        [["worker/ingest.ts", 'export const K = "x:y";\nkv.get("funding:rot", "json");']]).gaps.length === 0,
    ],
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
  {
    check: "stampVerdict",
    why: "a worker behind the source tree and a site still serving the previous Pages version are opposite problems, and one message told the operator to fix the half that was already right",
    fire: () => stampVerdict("ccc", "bbb", "aaa").state !== "current",
    quiet: () => stampVerdict("aaa", "aaa", "aaa").state !== "current",
  },
];

/* THE THREE-WAY SPLIT, WHICH THE PAIR ABOVE CANNOT PROVE. fire/quiet only establish that a
   disagreement is noticed; the point of this check is WHICH half is behind, and getting that
   backwards is what sends someone to re-deploy the component that is already current. */
{
  let vbad = 0;
  for (const [name, d, e, l, want] of [
    ["identical everywhere", "aaa", "aaa", "aaa", "current"],
    ["deployed matches the source tree — the site is the lagging half", "aaa", "bbb", "aaa", "site-behind"],
    ["deployed matches neither — the worker really is behind", "ccc", "bbb", "aaa", "worker-stale"],
    ["deployed matches the site but not the tree — nothing to deploy yet", "bbb", "bbb", "aaa", "current"],
    ["no local stamp readable — refuse to blame the site on no evidence", "aaa", "bbb", null, "worker-stale"],
  ]) {
    const got = stampVerdict(d, e, l).state;
    if (got !== want) { vbad++; console.log(`  MISS  stampVerdict            ${name}: got ${got}, want ${want}`); }
  }
  /* THE FOURTH INPUT, added 27 August 2026. The worker writes its stamp on the FIVE-MINUTE
     ingest tick, and both callers waited 150 seconds — a number sized from a comment claiming
     the tick runs every minute. Half of one chance, not two and a half, so the check failed
     whenever the next tick was further out than that: twice in one afternoon, on a worker that
     was fine. `tickRan` is what separates "the cron has not fired" from "it fired and the
     stamp is old", and these four rows are the ones that distinction turns on. */
  for (const [name, d, e, l, tick, want] of [
    ["no tick yet, stamps disagree — nothing to fix, the cron has not fired", "ccc", "bbb", "aaa", false, "awaiting-tick"],
    ["a tick ran and the stamp did not change — a real skew", "ccc", "bbb", "aaa", true, "worker-stale"],
    ["site-behind is decided BEFORE awaiting-tick: a deploy-order fault is not cron timing", "aaa", "bbb", "aaa", false, "site-behind"],
    ["agreement needs no tick at all", "aaa", "aaa", "aaa", false, "current"],
  ]) {
    const got = stampVerdict(d, e, l, tick).state;
    if (got !== want) { vbad++; console.log(`  MISS  stampVerdict            ${name}: got ${got}, want ${want}`); }
  }
  /* A caller that cannot observe the tick must get the OLD behaviour, not a silent downgrade
     to "probably fine" — an unobservable tick defaulting to false would turn every real skew
     into a shrug. */
  if (stampVerdict("ccc", "bbb", "aaa").state !== "worker-stale") {
    vbad++; console.log("  MISS  stampVerdict            omitting tickRan must default to the old, stricter behaviour");
  }
  if (!vbad) console.log(`  ok    stampVerdict             names which half is behind, and tells "not ticked yet" from "ticked and stale"`);
  else bad0 += vbad;
}

const COMPUTED_FIGURES_NAMES = () => COMPUTED_FIGURES.map(([fn]) => fn);

let bad = bad0;
for (const c of cases) {
  const f = c.fire(), q = c.quiet();
  const fires = Array.isArray(f) ? f.length > 0 : Boolean(f);
  const quiet = Array.isArray(q) ? q.length === 0 : !q;
  if (!fires) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} did NOT fire on a fixture built to make it fire`); continue; }
  if (!quiet) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} fired on the clean fixture too — it cannot tell them apart`); console.log(`          ${JSON.stringify(q).slice(0, 140)}`); continue; }
  /* `also` IS FOR CHECKS WITH MORE THAN ONE WAY TO BE WRONG, and every one of them is a
     regression the fire/quiet pair cannot see. symbolAddressing is the case that needed it: its
     entry can rot in three separate directions — the redirect disappears, the canonical starts
     carrying the query, the verdict outlives the behaviour — and in all three the record still
     EXISTS, so an implementation that only asks "is it recorded?" stays green on the shipped
     fixture and green on the clean one. Each assertion is a boolean; all must hold. */
  const also = typeof c.also === "function" ? c.also() : [];
  const failedAlso = also.map((v, i) => [v, i]).filter(([v]) => !v).map(([, i]) => i);
  if (failedAlso.length) {
    bad++;
    console.log(`  MISS  ${c.check.padEnd(24)} fires and is quiet, but ${failedAlso.length} of ${also.length} regression assertion(s) failed: #${failedAlso.join(", #")}`);
    continue;
  }
  console.log(`  ok    ${c.check.padEnd(24)} fires on the fault, silent on the clean page${also.length ? `, and holds ${also.length} regression(s)` : ""}  — ${c.why}`);
}

/* THE COVERAGE LINE IS THE POINT: how many finding-returning checks have a standing fixture
   proving they can fire. Four are proven instead by cases living in blind-cases.mjs,
   sitemap-honesty.mjs and weight-cases.mjs.

   THE TOTAL IS COUNTED, NOT TRANSCRIBED. It was the literal 25, which is a number that was true
   on the day it was typed. Adding a check printed "30 of 25 finding-returning checks now have a
   standing fixture" and, underneath it, "-5 still report green that has never been falsified".
   A coverage line that can go negative is not measuring coverage. */
/* ---------------------------------------------------------------------------------------------
   TWO CHECKS MEASURED AND REJECTED, 27 AUGUST 2026 — "a count printed over a list it does not
   count".

   The defect was real and shipped that morning, in this repository, written while adding the
   per-contract liquidation maps: /liquidations printed "50 contracts have a published margin
   table" directly above a table of 49 rows. The sentence counted every contract with a tier
   table; the rows deliberately excluded the default, whose map is that page. A reader counting
   rows got a different number from the one printed over them.

   BOTH CANDIDATE CHECKS WERE BUILT AND RUN AGAINST THE LIVE SITE BEFORE BEING DROPPED. The
   numbers are here so the next person to have this idea can skip the hour:

     A. RENDERED. For every <p class="section-note"> immediately followed by a table.tbl,
        compare each bare integer in the note against the table's row count.
          26 pages fetched, 31 note-then-table pairs, 19 bare integers inside them.
          Near-misses (|n - rows| <= 3): 6. Of those, ONE was the defect. The other five were
          "Row 8 is the one most worth reading twice", "in the last 24 hours", "finished on
          4 November 2025", "Step 2 is where every heatmap differs" — twice on one page.
        One finding, five exemptions.

        Narrowing it to notes that OPEN with an integer gives one finding and zero exemptions
        today, and is worthless: it is defeated by writing "There are 50 contracts", which is
        the same sentence.

     B. SOURCE. Inside one .astro file, compare the identifier in the nearest preceding
        {X.length} against the {Y.map( that renders the <tbody> beneath it.
          8 such pairs across src/pages and src/components. 4 identifier mismatches, of which
          ONE was the defect; the others are a note about one collection standing above an
          unrelated table — /learn prints the contract count above BTC's venue rows,
          /status prints the run count above the bindings table and the covered count above
          series coverage. All three correct.
        One finding, three exemptions.

   Both fail the test written immediately below, so neither shipped. The defect was fixed
   STRUCTURALLY instead: the default contract went back into the table, so the count and the
   rows are one array and the two cannot disagree. That is not a general guard, and this
   comment is the honest record of that — the class can recur in a file nobody has looked at.
   What it is not is a check with more exemptions than findings, which is the thing that gets
   switched off and then cited as coverage.
   --------------------------------------------------------------------------------------------- */

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
