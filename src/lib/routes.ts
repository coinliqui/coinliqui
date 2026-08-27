/**
 * EVERY STATIC ROUTE THIS SITE PUBLISHES, IN ONE PLACE, BECAUSE THERE WERE FOUR.
 *
 * Each sitemap route carried its own hardcoded list, and worker/indexnow.ts carried a fifth,
 * independent one. Nothing enforced agreement, and they had drifted badly: measured on
 * 19 August 2026, 22 of the 79 URLs in the sitemaps were absent from the IndexNow set —
 * every prose page, every calculator, both /liquidations sub-pages, and all ten coin pages,
 * the last because the call site passed a literal `[]` where the live coin slugs belonged.
 *
 * The cost is specific rather than theoretical. IndexNow is this project's only account-free
 * channel into the indexes that are not Google, and for 28% of the site it had never fired and
 * never could. Three of the four URLs Google reported as "URL is unknown to Google" were in
 * that 28%, as were both /liquidations pages it had discovered and not indexed.
 *
 * So: one source, imported by the sitemap routes AND by the announcer, and a check in the smoke
 * pass that compares the announcer's set against the RENDERED sitemaps rather than against this
 * file — a check that reads the same constant both sides read would confirm nothing.
 *
 * Adding a route means adding it here. Forgetting to means the gate fails, which is the whole
 * point: a divergence that took a hand-run query to notice is now unshippable.
 */

/** Prose and the homepage. Split by how each is dated — see src/pages/sitemaps/pages.xml.ts. */
/* /about MOVED ACROSS THE LINE ON 20 AUGUST 2026, the same way /methodology did, and for the
   same reason: it reads the live store. It prints how many perpetual contracts are covered
   today and what the open-interest floor is, both from `getSnapshot`, so its text changes when
   a coin crosses the floor and no commit is involved. It was listed as CODE and given a git
   date, and the gate — which measures store dependence rather than trusting this list —
   refused it within one run. Its own structured data had been taking a data stamp from
   `fetchedAt` the whole time, so the two surfaces disagreed until now. */
export const PAGES_DATA = ["/", "/methodology", "/about"] as const;
export const PAGES_CODE = ["/methodology/liquidations", "/data-sources", "/privacy", "/terms"] as const;

/** The calculators. /tools/liquidation-price is deliberately absent: it serves 410 Gone. */
export const TOOLS = ["/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"] as const;

/** The liquidation surface. /liquidations/sweep is frozen; the other two move with the market. */
export const LIQUIDATIONS = ["/liquidations", "/liquidations/sweep", "/liquidations/survival"] as const;

/**
 * THE EXPLAINERS, and the one template on this site whose job is to answer a question rather
 * than to show a number.
 *
 * WHY IT IS SPLIT THE SAME WAY /pages IS. Two of these read the live store on purpose — an
 * explanation of what a funding rate costs is worth more with today's rate in it than with a
 * made-up one — and two do not, because a model's assumptions and a margin formula do not
 * change when the market does. Filing all five on one side would put a git date on a page that
 * moves hourly, or an hourly date on a page that has not changed in a week. The gate measures
 * store dependence rather than trusting this list, so getting it wrong fails within one run.
 */
export const LEARN_DATA = ["/learn", "/learn/funding-rate", "/learn/open-interest"] as const;
export const LEARN_CODE = ["/learn/liquidation-heatmap", "/learn/liquidation-price"] as const;
export const LEARN = [...LEARN_DATA, ...LEARN_CODE] as const;

/** One-page templates, each its own sitemap so its indexation rate is separately observable. */
export const FUNDING_HUB = ["/funding"] as const;
export const OPEN_INTEREST = ["/open-interest"] as const;
export const UNLOCKS = ["/unlocks"] as const;
export const COINS_HUB = ["/coins"] as const;

/**
 * Every static route, in the order the sitemap index lists its children.
 *
 * NOT INCLUDING /watchlist, and that is not an oversight: it is a reader's own saved list, it
 * carries noindex, and it appears in no sitemap. A URL that asks not to be indexed must not be
 * announced to an index either — the check in the smoke pass compares this set against the
 * rendered sitemaps in BOTH directions, so adding it here would fail as loudly as omitting a
 * real page does.
 */
export const STATIC_ROUTES: readonly string[] = [
  ...PAGES_DATA, ...PAGES_CODE,
  ...COINS_HUB, ...FUNDING_HUB, ...OPEN_INTEREST,
  ...TOOLS, ...LIQUIDATIONS, ...UNLOCKS,
  ...LEARN,
];

/**
 * THE CONTRACT WHOSE LIQUIDATION MAP LIVES AT `/liquidations` RATHER THAN AT
 * `/liquidations/{symbol}`, AND THE PATHS OF ALL THE OTHERS.
 *
 * Two files have to agree about this and they are not in the same runtime: the sitemap
 * renders in a Pages function, the IndexNow announcer runs in the cron worker. That is the
 * exact shape of the drift documented at the top of this file — two independent lists of
 * what the site publishes, nothing comparing them, 22 URLs apart when somebody finally
 * looked. So the rule is written once, here, and both import it.
 *
 * The default is PINNED rather than derived from open interest. `/liquidations` is the URL
 * Google has indexed for the "btc liquidation map" cluster, and requestedPerp's header
 * records what happened the last time a flagship page's subject was a live sort key:
 * BTC $3.36B against ETH $2.11B is a 1.59x margin, and when it closes the indexed URL
 * silently starts serving a different coin under a different title with no deploy.
 * requestedPerp's fallback reads this constant, so there is one pin rather than two.
 */
export const MAP_DEFAULT = "BTC";

/**
 * `/liquidations/{symbol}` for every contract EXCEPT the default, which answers 301 to
 * `/liquidations`. A sitemap or an announcement that includes a redirect is spending a
 * crawler's fetch to teach it something the file already knew.
 */
export function liqMapPaths(symbols: readonly string[]): string[] {
  return symbols
    .filter((s) => s.toUpperCase() !== MAP_DEFAULT)
    .map((s) => `/liquidations/${s.toLowerCase()}`);
}

/**
 * WHERE ONE CONTRACT'S MAP ACTUALLY LIVES, for the pages that link to it.
 *
 * The default's map is at `/liquidations`, so `/funding/btc` linking to `/liquidations/btc`
 * would send every reader and every crawler through a 301 on the site's most-linked internal
 * edge. One function so no call site has to remember the exception.
 */
export const liqMapHref = (symbol: string) =>
  symbol.toUpperCase() === MAP_DEFAULT ? "/liquidations" : `/liquidations/${symbol.toLowerCase()}`;

/**
 * EVERY ROUTE THAT RENDERS A DIFFERENT PAGE FOR `?symbol=`, AND WHETHER THAT PAGE HAS AN
 * ADDRESS OF ITS OWN.
 *
 * THE DEFECT THIS EXISTS TO STOP HAPPENING AGAIN. `/liquidations` rendered fifty complete
 * pages — its own <title>, <h1>, chart and every figure per contract — and served all fifty
 * at one URL, while Base built the canonical tag from the pathname alone. So forty-nine
 * finished pages told every crawler they were a page they were not. They were in no sitemap,
 * announced to no index, and reachable only by submitting a <select>, which nothing that
 * crawls does. The demand for them was in Search Console the whole time: seven coin-named
 * liquidation-map queries in the week to 22 August 2026.
 *
 * Nobody decided that. It was what happened when a parameter was the easiest way to add a
 * second contract, and it stayed true for as long as nothing looked. The point of this list
 * is that looking is now automatic: scripts/smoke.mjs probes every route with a second real
 * contract, and any route whose title changes must appear here with a verdict. An unrecorded
 * one fails the gate.
 *
 * The list does not decide the verdict, because the verdict is a judgement about whether the
 * content is worth an index entry and mechanical rules cannot make it. What it prevents is
 * the judgement never being made.
 *
 *   `addressed`       — every value has its own URL, and `?symbol=` answers 301 to it.
 *                       The gate re-checks that the redirect is still there.
 *   `parameter-only`  — one URL on purpose. The gate re-checks that the page still varies,
 *                       so an entry cannot quietly outlive the behaviour it describes.
 */
export const SYMBOL_PARAMETERISED: { path: string; verdict: "addressed" | "parameter-only"; why: string }[] = [
  {
    path: "/liquidations",
    verdict: "addressed",
    why: "Every contract's map is at /liquidations/{symbol} since 27 August 2026; the pinned default keeps this URL because it is the one with measured demand behind it. ?symbol= is a 301 to the real address.",
  },
  {
    path: "/liquidations/survival",
    verdict: "parameter-only",
    why:
      "Same shape as the map and a real per-contract backtest, so this is a candidate — but as of 2026-W35 Google has this template's one page as 'Discovered — currently not indexed', meaning it has never been crawled. Multiplying an uncrawled template by fifty is not how it gets crawled. Revisit when /liquidations/survival is indexed.",
  },
  {
    path: "/tools/leverage",
    verdict: "parameter-only",
    why: "A calculator, and the symbol is a pre-filled input rather than a subject. Fifty near-identical calculator pages is the thin-template rule broken on purpose; /tools/position-size is already sitting in 'Discovered — currently not indexed' with five URLs.",
  },
  {
    path: "/tools/funding-cost",
    verdict: "parameter-only",
    why: "As /tools/leverage: the contract is an input to the calculation, and the page it produces is the same page with different numbers in the boxes.",
  },
  {
    path: "/tools/position-size",
    verdict: "parameter-only",
    why: "As /tools/leverage. This is the URL Google currently has as 'Discovered — currently not indexed', which is the direct evidence that the tools template does not want more URLs.",
  },
];
