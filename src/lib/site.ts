/**
 * Site config and the single navigation source of truth.
 *
 * BRAND. "Coinliqui" matches the domain, coinliqui.com. It is set once here and reaches
 * every title, the rail wordmark and the JSON-LD — pages pass a bare title and the layout
 * appends the suffix, so renaming again is one line rather than twenty-four.
 * The site is in ENGLISH; every target query is English.
 */
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
  founder: null as { name: string } | null,
  /** What it is, in one sentence a machine can lift verbatim. */
  summary:
    "An independent, free, read-only reference site for crypto derivatives data: perpetual " +
    "funding rates across venues, open interest, modelled liquidation levels, on-chain token " +
    "vesting contracts and spot prices. It is published as ordinary web pages.",
  /** What it is NOT. This is the sentence the mistaken answer needed and could not find. */
  notThis:
    "Coinliqui is not an exchange, a broker, a wallet or a custodian. It has no accounts, no " +
    "sign-up, no deposits, no withdrawals, no wallet connection, no token and no referral " +
    "programme. It never asks for money, keys, seed phrases or personal details, and it has no " +
    "mechanism to accept them.",
  /** Named because the confusion is specific, and denying it vaguely would not help. */
  notAffiliated: ["Liqui", "liqui.io", "Coinliqui.io", "LiquiTrade", "any exchange or broker"],
  /**
   * EMPTY ON PURPOSE. This listed a personal code-hosting account. A repository is good
   * corroboration for a project, but that one is tied to an individual's profile, so linking it
   * from every page published the person as surely as printing their name did.
   *
   * Anything added here later must be an account that belongs to the PROJECT, not to a person.
   * Base.astro already omits sameAs entirely when this is empty, so no empty property is
   * emitted into the structured data.
   */
  sameAs: [
    /* ONE LINE, WHEN THE PROJECT ORG EXISTS. Put the ORG repository here —
       https://github.com/coinliqui/coinliqui — never a personal account. A public repository is
       genuine third-party corroboration: it is the actual source of this site, independently
       hosted, with a commit history that cannot be back-dated. That argument holds for a project
       account and collapses into a privacy problem for a personal one, which is why this is
       empty rather than pointing at the repo that exists today.
       Base.astro omits sameAs entirely while this is empty, so no hollow property is emitted. */
  ] as string[],
} as const;

/**
 * GOOGLE ANALYTICS 4. The measurement ID, and the only thing that has to be filled in.
 *
 * Empty string means GA does not render at all — no tag, no request, no cookie — so the site
 * is correct and shippable before the ID exists, and a bad paste degrades to "no analytics"
 * rather than to a broken page. Everything else (the loader, the CSP allowances, the privacy
 * copy) is already in place and keyed off this one value.
 *
 * A measurement ID is public by design: it ships in the HTML of every page and identifies a
 * property, not an account. It is not a credential and does not belong in a secret store.
 *
 * GA_ENABLED is a SHAPE check, not a truthiness check, so a placeholder left in by accident
 * cannot emit a live tag pointing at nothing. It is deliberately loose about length — real IDs
 * are G- plus ten characters, but a regex tightened to exactly ten would silently disable
 * analytics if Google ever issues another width, and "silently off" is the worst failure this
 * value has. Loose enough to accept anything Google plausibly issues, strict enough to reject
 * an empty string or a leftover placeholder.
 */
export const GA_MEASUREMENT_ID = "G-5Y4ZENWMQJ";
export const GA_ENABLED = /^G-[A-Z0-9]{6,15}$/.test(GA_MEASUREMENT_ID);

/**
 * LOAD gtag.js AFTER THE PAGE HAS SETTLED, rather than in parallel with it. Measured, not
 * assumed — /funding/btc on the local warm build, GA off then on:
 *
 *                       GA off      GA on
 *   long tasks          none        119 ms + 66 ms
 *   total blocking      0 ms        85 ms
 *   load event          133 ms      668 ms
 *   off-origin hosts    0           2
 *   transfer            —           +145.8 KB brotli (the whole page is 69 KB)
 *   JS to parse         ~0          +419 KB decoded
 *
 * This site ships almost no JavaScript, so gtag.js is not an increment on the main thread —
 * it IS the main-thread work. 419 KB to parse and execute, on a page whose own budget is a
 * search index and a price ticker. On mid-range mobile hardware that block is typically
 * several times longer than the 185 ms measured on a fast laptop, and INP is scored on the
 * interactions that land while it runs.
 *
 * Deferring keeps the data and removes the contention. The pageview still fires; it fires a
 * moment later. What is genuinely lost is the visitor who leaves before the trigger, which is
 * the shortest and least informative session there is.
 *
 * THE TRIGGER IS WHICHEVER COMES FIRST of: the browser going idle after load, the first real
 * interaction (a scroll, tap, key or pointer), or a 3-second backstop. The interaction case
 * matters most — a reader who is doing something is a reader worth counting, and they arm the
 * loader before the timer would.
 *
 * Set to false to get Google's stock `async`-in-head behaviour back. The numbers above are the
 * argument for the default; if they change, change the default.
 */
export const GA_DEFER = true;

/** Namespace for anything this site writes to a visitor's own browser. One constant, so
 *  /privacy can document the exact key rather than a copy of it that drifts. */
export const STORE_NS = "coinliqui";
export const PINNED_KEY = `${STORE_NS}.pinned`;

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
      { label: "Tools", href: "/tools", icon: "M12.5 3a4.5 4.5 0 0 0-4.2 6.1L3 14.4V17h2.6l5.3-5.3A4.5 4.5 0 1 0 12.5 3Z" },
      { label: "Methodology", href: "/methodology", icon: "M4 4h12v12H4zM4 8h12M8 8v8" },
      { label: "Data sources", href: "/data-sources", icon: "M10 3c3.9 0 7 1.1 7 2.5S13.9 8 10 8 3 6.9 3 5.5 6.1 3 10 3Zm7 5.5c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5m14 4c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5" },
    ],
  },
];

/** Footer carries every built destination, so nothing is reachable only at desktop widths. */
export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/coins", label: "Coins" },
  { href: "/liquidations", label: "Liquidation map" },
  { href: "/unlocks", label: "Token unlocks" },
  { href: "/funding", label: "Funding" },
  { href: "/open-interest", label: "Open interest" },
  { href: "/tools", label: "Tools" },
  { href: "/methodology", label: "Methodology" },
  { href: "/methodology/liquidations", label: "Why no liquidation totals" },
  { href: "/data-sources", label: "Data sources" },
  { href: "/privacy", label: "Privacy" },
];
