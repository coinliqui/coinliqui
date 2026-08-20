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
];
