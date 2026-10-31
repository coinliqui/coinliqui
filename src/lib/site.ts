/**
 * Site config and the single navigation source of truth.
 *
 * BRAND. "Coinliqui" matches the domain, coinliqui.com. It is set once here and reaches
 * every title, the rail wordmark and the JSON-LD — pages pass a bare title and the layout
 * appends the suffix, so renaming again is one line rather than twenty-four.
 * The site is in ENGLISH; every target query is English.
 */
/* THE RENAME WAS PROPOSED WITH EVIDENCE, CONSIDERED, AND DECLINED. Recorded here so it is
 * not relitigated every time someone rediscovers the collision — which they will, because the
 * collision is real and the argument for moving is genuinely strong.
 *
 * THE CASE FOR RENAMING, stated fairly: coinliq.com is an operating crypto site at edit
 * distance 2 with years of index priority; a Brave search for "coinliqui" returns it, coinli.net,
 * coinlib.io and CoinMarketCap's page for Liqui — the exchange that collapsed in 2018 and shares
 * the root morpheme — and returns nothing for this domain. Bing does not recognise the token at
 * all and spell-corrects it to "clinique". The name collision is a first-order cause of this
 * site being described as "most likely a typo, or a malicious or fraudulent platform", not a
 * footnote to it. And at four days old the sunk brand equity is as close to zero as it will ever
 * be, so this is the cheapest moment a rename will ever cost.
 *
 * WHY IT WAS DECLINED ANYWAY (owner's decision, 18 August 2026): the asset is not the name. It
 * is positions 8 and 10 on tail queries, ~35 indexed URLs, the Search Console history that makes
 * indexation measurable per template, and a funding series accumulating since 14 August that
 * cannot be reconstructed after the fact. A rename resets every one of those to buy a name that
 * will not be recognised for months either way — because the replacement domain is also zero days
 * old, and inherits the same registration-cohort penalty that is doing most of the damage today.
 * The collision gets out-earned rather than fled.
 *
 * WHAT FOLLOWS FROM THAT, and is binding: the bare string "coinliqui" must never travel alone
 * externally. Every profile name, byline, directory entry and external description pairs it with
 * a disambiguator, because unaccompanied it resolves to somebody else's site. That is the price
 * of this decision and it is paid on every external surface, not here. */
import { numberWord } from "../../public/shared.js";
export const SITE = {
  name: "Coinliqui",
  tagline: "Perpetual funding, normalised.",
  locale: "en",
} as const;

/**
 * WHO THIS IS, in machine-readable form.
 *
 * WHY A SITE ABOUT FUNDING RATES NEEDS AN IDENTITY BLOCK. Asked "coinliqui.com", Google's
 * assistant answered that it "is not a known, authoritative or operating cryptocurrency
 * service" and is "most likely a typo, or a malicious or fraudulent (scam) platform imitating
 * well-known brands", then suggested Liqui (liqui.io) as the real thing the reader must have
 * meant.
 *
 * That answer was a REASONABLE INFERENCE FROM WHAT THE SITE PUBLISHED. A crypto domain a model
 * has never seen, whose name is one edit away from a defunct exchange brand, with an
 * Organization block carrying nothing but a name and a URL, no about page, no operator, no
 * contact, no launch date, and nothing anywhere stating that it is not an exchange. Given that
 * evidence, "probably a clone" is where the probability mass honestly sits.
 *
 * So the fix is not to argue with the model. It is to stop being indistinguishable from the
 * thing it is being mistaken for, and the strongest available argument is structural rather
 * than reputational: this site has no account, no deposit, no wallet connection and nothing to
 * sign, so it cannot take a payment or a credential even in principle. A site that cannot
 * receive money cannot take yours. Everything below exists to put that in front of a crawler,
 * an answer engine and a person.
 *
 * (This used to end "…and /privacy's guarantees are enforced by a Content-Security-Policy a
 * reader can check in their own network tab." That was an argument about analytics, which the
 * site now runs on purpose, and it was never the load-bearing half. Nothing about the
 * scam-signal problem depended on it: what answers that question is having no way to take
 * money, not having no way to count visitors.)
 */
export const IDENTITY = {
  /** First commit of the published build. Real, checkable, and not rounded up. */
  launched: "2026-08-14",
  /** Must ROUTE. An unreachable address in security.txt is worse than no security.txt. */
  contact: "hello@coinliqui.com",
  /**
   * A NAME, AND ONLY THE THINGS A NAME IS ACTUALLY FOR.
   *
   * This carried a real name once, then did not. The removal was right at the time and for a
   * reason worth keeping in front of whoever edits this next: the spam did not arrive because
   * a name appeared on a web page. It arrived because a PERSONAL EMAIL ADDRESS sat in machine-
   * readable commit metadata, where every scraper of every public repository reads it, forever,
   * with no way to withdraw it once published.
   *
   * Those are separable, and conflating them costs the site its strongest available signal for
   * nothing. So the rule here is narrow and permanent:
   *
   *   - The founder's NAME may be published. It is accountability, and a person willing to be
   *     named beside a crypto domain is exactly what an anonymous clone will not do.
   *   - The founder's PERSONAL EMAIL may not appear anywhere: not on a page, not in JSON-LD,
   *     not in git author fields, not in a package manifest. The project address is the only
   *     address this codebase knows, and it forwards.
   *   - No personal social or code-hosting account is linked. `sameAs` is for the PROJECT's own
   *     accounts, and there is no honest reason for it to point at somebody's personal profile.
   *
   * Set `founder` to null and the site says nothing about a person anywhere — /about and the
   * JSON-LD both fall back to the entity-only wording, and a check enforces that they agree, so
   * this can never half-ship with a name in the markup and not on the page or the reverse.
   */
  founder: { name: "Yury Fokin" } as { name: string } | null,
  /** What it is, in one sentence a machine can lift verbatim. */
  summary:
    "An independent, free, read-only reference site for crypto derivatives data: perpetual " +
    "funding rates across venues, open interest, modelled liquidation levels, on-chain token " +
    "vesting contracts and perpetual futures prices. It is published as ordinary web pages.",
  /** What it is NOT. This is the sentence the mistaken answer needed and could not find. */
  notThis:
    "Coinliqui is not an exchange, a broker, a wallet or a custodian. It has no accounts, no " +
    "sign-up, no deposits, no withdrawals, no wallet connection, no token and no referral " +
    "programme. It never asks for money, keys, seed phrases or personal details, and it has no " +
    "mechanism to accept them.",
  /** Named because the confusion is specific, and denying it vaguely would not help.
   *
   * coinliq.com WAS MISSING, AND IT IS THE ONE THAT MATTERS. This list named the defunct Liqui
   * exchange and three near-spellings, and omitted the single domain that actually captures the
   * query: measured on 19 August, Google rewrites "coinliqui" to "coinliq" before retrieval runs
   * and hands coinliq.com the entire result page with a sitelinks block, and Brave returns it
   * too. A reader who arrives here suspicious very likely arrived by that route, and a
   * disambiguation that omits the site they were actually shown is answering a question nobody
   * asked. It is an operating, unrelated crypto price tracker — not a clone, not a scam, and
   * nothing to do with this project in either direction. */
  /* "LiquiTrade" WAS IN THIS LIST AND IS NOT ANY MORE. Every other entry is a defunct
     exchange, a parked spelling, or a category. That one is an operating, regulator-registered
     company that has never been confused with this site by anybody, and naming a live business
     in a disambiguation list is a different act from naming a dead one: it puts our domain
     beside their name on a page we control, for a confusion nobody reported. Removed on a
     compliance audit's finding, which was right — the list should hold the confusions readers
     actually arrive with, and no more. */
  notAffiliated: ["coinliq.com", "Liqui", "liqui.io", "Coinliqui.io", "any exchange or broker"],
  /* sameAs IS NOT A FIELD HERE ANY MORE, and its absence from this object is the point.
   *
   * It was a compile-time constant. On 20 August 2026 it was found publishing
   * https://github.com/coinliqui/coinliqui on all 79 pages, in the visible /about link and in
   * llms.txt, while an anonymous GET of that URL returned 404 — the repository is public, but
   * its owning account is under a spam flag and GitHub hides a flagged account's pages from
   * anyone not signed in as its owner. A constant cannot know that. It asserted the link for as
   * long as nobody checked, and nothing in this repository checks anything outside our own
   * origin.
   *
   * Before that it was deliberately empty for a different reason, worth keeping: the repository
   * existed but sat under a personal account, and pointing at it would have traded the
   * operator's separation from the domain for the corroboration. Anything published here must
   * belong to the PROJECT, never to a person, and scripts/checks.mjs enforces that against the
   * rendered HTML rather than against this file.
   *
   * The candidates now live in src/lib/corroboration.ts, the ingest worker fetches each of them
   * once a day, and the site publishes only what a signed-out reader can actually reach. A field
   * called `sameAs` sitting in this object would be a name asserting something its value cannot
   * support — "these are published" — which is the exact defect being cleaned up elsewhere in
   * this pass. There is nothing to edit here to restore the link: it restores itself. */
} as const;

/* GOOGLE ANALYTICS 4 IS GONE, FOR THE SECOND TIME, AND THIS TIME IT WAS REPLACED RATHER THAN
   DROPPED. It ran 17-19 August 2026, was removed, came back on 27 August on the operator's
   instruction, and was removed again on 31 October 2026 when the operator moved reader analytics
   to PostHog. The measurement ID, the deferred gtag loader, its three advertising switches, the two
   _ga cookies in STORED_ON_DEVICE and the Google hosts in the CSP all went out together, because a
   half-removed tag is the failure mode the first removal warned about. The GA4 property itself is
   untouched in Google's console: its history is still read from there.

   WHAT REPLACED IT lives in public/analytics.js — PostHog, EU cloud, cookieless_mode "always" — and
   is described there option by option. It sets nothing on a reader's device, which is why the list
   below holds only this site's own two entries. The numbers that made gtag.js deferred (419 KB of
   JavaScript on a 6.5 KB homepage, 85 ms of blocking against 0) are why PostHog's loader waits for
   the page to settle as well. */


/** Namespace for anything this site writes to a visitor's own browser. One constant, so
 *  /privacy can document the exact key rather than a copy of it that drifts. */
export const STORE_NS = "coinliqui";
export const PINNED_KEY = `${STORE_NS}.pinned`;

/* =========================================================================================
   WHAT THIS SITE PUTS ON A READER'S DEVICE — ONE LIST, TWO PAGES THAT STATE IT.

   /privacy described "cookieless page-view analytics … one preference cookie" above a table of
   three cookies; that was fixed by deriving its summary from its own rows. The same audit then
   found /about saying "the one thing stored on your device is a cookie named rail … plus a
   coinliqui.pinned list", which omitted both Google Analytics cookies the site set from 27 August
   until GA4 was removed on 31 October. Two pages, two hand-written accounts of one fact, both
   understating it.

   So the fact lives here, next to the constants it is built from, and both pages render it. A new
   cookie is one entry in this array and both statements change on the next build. `purpose` is
   HTML because the privacy table links the watchlist; `short` is what a one-line summary names.
   ========================================================================================= */
export interface StoredItem {
  name: string;
  kind: "cookie" | "local-storage";
  /** Who writes it, for readers deciding what to block. Only this site, since 31 October 2026:
   *  the two Google Analytics cookies left with the tag, and PostHog runs cookieless. */
  by: "this site";
  purpose: string;
  expires: string;
}
export const STORED_ON_DEVICE: readonly StoredItem[] = [
  { name: "rail", kind: "cookie", by: "this site",
    purpose: "Whether you collapsed the sidebar. Two possible values; not an identifier",
    expires: "1 year" },
  { name: PINNED_KEY, kind: "local-storage", by: "this site",
    purpose: 'The coins you pinned on <a href="/watchlist">your watchlist</a>. Never sent anywhere',
    expires: "Until you clear it" },
];

/** "three cookies", "one local-storage key" — counted from the list, never typed. */
export const countWords = (n: number, one: string, many: string) =>
  `${numberWord(n)} ${n === 1 ? one : many}`;
export const storedCounts = () => {
  const cookies = STORED_ON_DEVICE.filter((s) => s.kind === "cookie").length;
  const storage = STORED_ON_DEVICE.length - cookies;
  return { cookies, storage };
};

/**
 * The canonical origin, from Astro's configured `site` (set by SITE_URL at build time).
 * There is deliberately no hardcoded fallback URL here: every caller has a context, and
 * a literal origin in this file is how a placeholder or a *.pages.dev host reaches
 * production canonicals.
 */
export function origin(site: URL | undefined): string {
  if (!site) throw new Error("Astro.site is not configured — SITE_URL was missing at build time.");
  return site.origin;
}

export interface NavItem {
  label: string;
  /** REQUIRED. See the note on NAV: an entry without a destination is not a nav entry. */
  href: string;
  icon: string;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Every entry here is a page that exists. That is enforced by the type: `href` is required,
 * so an aspiration cannot be written into this array at all.
 *
 * IT USED TO BE OPTIONAL. Four entries — Chains, Seasonality, Metrics, Research — carried no
 * href and rendered as a greyed <span> with a "soon" chip, on the theory that it kept the
 * shape of the product legible while it was being built. It did not survive contact with the
 * rest of the site. This is a site whose entire claim is that it tells you exactly how old
 * every number is and refuses to publish one it cannot source; "soon", with no date, on all
 * seventy-one URLs, was the least credible text we shipped. Four of eleven rail entries led
 * nowhere. They come back as real sections or not at all.
 *
 * The same reasoning already governs /tools (only shipped calculators are listed) and
 * Related.astro (every card is a page that exists). This file now agrees with both.
 */
export const NAV: NavGroup[] = [
  {
    title: "Markets",
    items: [
      { label: "Overview", href: "/", icon: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9.5Z" },
      { label: "Funding", href: "/funding", icon: "M3 14.5 7 9l3.5 3.5L17 5M17 5h-4.5M17 5v4.5" },
      { label: "Liquidations", href: "/liquidations", icon: "M10 3v6m0 0 3-2m-3 2L7 7m3 10a5 5 0 0 0 5-5c0-2-1.5-3.5-2.5-5" },
      { label: "Unlocks", href: "/unlocks", icon: "M6 9V6.5a4 4 0 0 1 8 0M5 9h10v8H5z" },
      { label: "Coins", href: "/coins", icon: "M10 4c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3 2.7-3 6-3Zm6 3v6c0 1.7-2.7 3-6 3s-6-1.3-6-3V7" },
      /* Open interest sat under "Reference" only because that group needed a real entry beside
         three unbuilt ones. With those gone it belongs here, with the rest of the market data.
         There is no longer a "does it fit the mobile bar" question to answer: the bar is gone
         and mobile gets the whole rail in a drawer, which is the point of the change. */
      { label: "Open interest", href: "/open-interest", icon: "M4 16V8m4 8V5m4 11v-6m4 6V7" },
    ],
  },
  {
    title: "Saved",
    items: [{ label: "Watchlist", href: "/watchlist", icon: "M10 3.5 12 8l4.8.4-3.6 3.1 1.1 4.7L10 13.7l-4.3 2.5 1.1-4.7L3.2 8.4 8 8l2-4.5Z" }],
  },
  {
    title: "Tools & docs",
    items: [
      /* LEARN SITS ABOVE TOOLS, not below Methodology, and the order is the argument. A reader
         who does not yet know what a funding rate is cannot evaluate a calculator that computes
         one, and the rail is read top to bottom. Methodology answers "how did you get this
         number"; Learn answers "what is this number" — the second question comes first for
         everyone arriving from a search engine, which is everyone. */
      { label: "Learn", href: "/learn", icon: "M10 6.5S8.5 5 6 5H3v9h3c2.5 0 4 1.5 4 1.5m0-9S11.5 5 14 5h3v9h-3c-2.5 0-4 1.5-4 1.5m0-9v9" },
      { label: "Tools", href: "/tools", icon: "M12.5 3a4.5 4.5 0 0 0-4.2 6.1L3 14.4V17h2.6l5.3-5.3A4.5 4.5 0 1 0 12.5 3Z" },
      { label: "Methodology", href: "/methodology", icon: "M4 4h12v12H4zM4 8h12M8 8v8" },
      { label: "Data sources", href: "/data-sources", icon: "M10 3c3.9 0 7 1.1 7 2.5S13.9 8 10 8 3 6.9 3 5.5 6.1 3 10 3Zm7 5.5c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5m14 4c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5" },
    ],
  },
];

/** Footer carries every built destination, so nothing is reachable only at desktop widths. */
/**
 * THE TWO DISCLOSURES A RECOMMENDATION HAS TO CARRY, kept here rather than as copy in five
 * templates, so they cannot drift page to page.
 *
 * WHY THEY EXIST. A compliance audit asked whether the funding-arbitrage calculator — a tool
 * that names two venues, quantifies the spread between them and prints what the trade would
 * pay — is an "investment recommendation" under MAR Article 20. That question is genuinely
 * open and a lawyer has to answer it. But the two duties it would impose cost two sentences,
 * and the site is better with them under either answer: a reader is entitled to know who
 * produced a figure and whether the producer has a stake in it. So they ship now, and the
 * classification question stops being load-bearing.
 *
 * THE POSITION SENTENCE IS DELIBERATELY "MAY HOLD". Everything else on this site is written
 * to be checkable and "holds nothing" would be the one claim here that a reader could not
 * check and this file could not verify. Disclosing a possible interest is the conservative
 * direction and the standard one. If the operator wants the stronger sentence, it is one edit
 * — but only if it is true, and it has to STAY true, which is the harder half.
 *
 * The commercial half is not hedged, because it is structural: there are no affiliate links
 * in this codebase, no advertising, no sponsored placement, and coverage is decided by an
 * open-interest floor published on /data-sources. A check can and does read that.
 */
export const PRODUCER = IDENTITY.founder
  ? `Produced and published by ${IDENTITY.founder.name} as ${SITE.name}, an independent project with no legal entity.`
  : `Produced and published by ${SITE.name}, an independent project with no legal entity.`;

export const INTERESTS =
  "No payment, sponsorship, affiliate or referral arrangement exists with any venue named here, " +
  "and nothing paid influences which coins or venues appear — coverage is decided by the open-interest " +
  "floor stated on Data sources. The operator may hold positions in coins covered here; nothing " +
  "published is timed, ordered or selected around one.";

export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/coins", label: "Coins" },
  { href: "/liquidations", label: "Liquidation map" },
  { href: "/unlocks", label: "Token unlocks" },
  { href: "/funding", label: "Funding" },
  { href: "/open-interest", label: "Open interest" },
  { href: "/learn", label: "Learn" },
  { href: "/learn/funding-rate", label: "Funding rate explained" },
  { href: "/learn/liquidation-heatmap", label: "Liquidation heatmaps explained" },
  { href: "/learn/liquidation-price", label: "Liquidation price explained" },
  { href: "/learn/open-interest", label: "Open interest explained" },
  { href: "/tools", label: "Tools" },
  { href: "/methodology", label: "Methodology" },
  { href: "/methodology/liquidations", label: "Why no liquidation totals" },
  { href: "/data-sources", label: "Data sources" },
  { href: "/privacy", label: "Privacy" },
  /* TERMS WAS MISSING FROM THIS LIST, which is how the site's disclaimer ended up reachable
     from /about and nowhere else. The footer said the words "Not investment advice" as plain
     text on every page while the page that means it was unlinked from all of them. */
  { href: "/terms", label: "Terms" },
];
