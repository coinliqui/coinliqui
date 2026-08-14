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
  /** Built sections have an href and render as <a>. Unbuilt entries have none. */
  href?: string;
  icon: string;
  /** Appears in the mobile bottom bar. Others live in the footer at mobile widths. */
  mobile?: boolean;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * The full end-state architecture, in one array, rendered once and re-laid-out by CSS.
 *
 * Unbuilt sections carry NO href: they render as <span>, never <a>. They create no URL,
 * are not crawlable destinations and cannot be clicked into an empty page — so the
 * no-thin-pages rule holds while the shape of the product is still legible.
 */
export const NAV: NavGroup[] = [
  {
    title: "Markets",
    items: [
      { label: "Overview", href: "/", mobile: true, icon: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9.5Z" },
      { label: "Funding", href: "/funding", mobile: true, icon: "M3 14.5 7 9l3.5 3.5L17 5M17 5h-4.5M17 5v4.5" },
      { label: "Liquidations", href: "/liquidations", icon: "M10 3v6m0 0 3-2m-3 2L7 7m3 10a5 5 0 0 0 5-5c0-2-1.5-3.5-2.5-5" },
      { label: "Unlocks", href: "/unlocks", icon: "M6 9V6.5a4 4 0 0 1 8 0M5 9h10v8H5z" },
      { label: "Coins", href: "/coins", mobile: true, icon: "M10 4c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3 2.7-3 6-3Zm6 3v6c0 1.7-2.7 3-6 3s-6-1.3-6-3V7" },
    ],
  },
  {
    title: "Saved",
    items: [{ label: "Watchlist", href: "/watchlist", mobile: true, icon: "M10 3.5 12 8l4.8.4-3.6 3.1 1.1 4.7L10 13.7l-4.3 2.5 1.1-4.7L3.2 8.4 8 8l2-4.5Z" }],
  },
  {
    title: "Reference",
    items: [
      /* Not in the mobile bar. Adding Coins made six tabs, and at 375px "Open interest"
         wrapped to two lines and pushed its own label out of alignment with the other five.
         Five is what the bar fits; open interest keeps its rail entry, its footer link and a
         card on every page that leads to it. */
      { label: "Open interest", href: "/open-interest", icon: "M4 16V8m4 8V5m4 11v-6m4 6V7" },
      { label: "Chains", icon: "M8 12a3 3 0 0 1 0-4l2-2a3 3 0 0 1 4 4l-1 1m-1 1a3 3 0 0 1 0 4l-2 2a3 3 0 0 1-4-4l1-1" },
      { label: "Seasonality", icon: "M4 16h12M4 16V8m4 8V5m4 11v-6m4 6V9" },
      { label: "Metrics", icon: "M4 10h3l2-5 2 10 2-5h3" },
    ],
  },
  {
    title: "Tools & docs",
    items: [
      { label: "Tools", href: "/tools", mobile: true, icon: "M12.5 3a4.5 4.5 0 0 0-4.2 6.1L3 14.4V17h2.6l5.3-5.3A4.5 4.5 0 1 0 12.5 3Z" },
      { label: "Research", icon: "M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 8h6M7 14h6" },
      { label: "Methodology", href: "/methodology", icon: "M4 4h12v12H4zM4 8h12M8 8v8" },
      { label: "Data sources", href: "/data-sources", icon: "M10 3c3.9 0 7 1.1 7 2.5S13.9 8 10 8 3 6.9 3 5.5 6.1 3 10 3Zm7 5.5c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5m14 4c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5" },
    ],
  },
];

/** Footer carries every built destination, so nothing is reachable only at desktop widths. */
export const FOOTER_LINKS = [
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
