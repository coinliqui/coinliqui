import type { APIRoute } from "astro";
import { getSnapshot } from "../lib/hyperliquid.ts";
import { liveCoins } from "../lib/coins.ts";

/**
 * The typeahead index. Every entry is a real page, and every real page should be here.
 *
 * WHY THIS FILE HAS A CHECK ATTACHED TO IT. On 15 August this list had fallen eighteen URLs
 * behind the sitemaps: the entire coins section, three of the four calculators, both
 * liquidation studies and the unlock calendar were all live, indexed for Google, linked in the
 * nav — and invisible to the site's own search. Typing "solana" returned nothing. The failure
 * was silent in the worst way: search still worked, still returned results, and simply could
 * not see whole sections.
 *
 * A hand-maintained list next to a generated sitemap will always drift, because the sitemap is
 * enforced by a crawler and this is enforced by memory. So the gate now asserts that every URL
 * in the sitemaps appears here (scripts/checks.mjs, searchIndexGaps). Drift can happen once;
 * it cannot ship.
 *
 * Coins come from liveCoins() rather than a literal, so the publication staging that governs
 * the sitemap governs search too — an unpublished coin must not be findable before its date.
 */
export const GET: APIRoute = async ({ locals }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT);
  const rows = [
    // Contracts. The bulk of the index and the reason it exists.
    ...snap.perps.map((p) => ({ label: p.symbol, href: `/funding/${p.symbol.toLowerCase()}`, kind: "funding" })),

    // Coins. `alt` is matched but never shown: people type "solana" and they type "sol", and
    // both must reach the page — but as one row, not the same destination offered twice.
    ...liveCoins().map((c) => ({ label: c.name, alt: c.symbol, href: `/coins/${c.slug}`, kind: "coin" })),

    // Calculators.
    { label: "Position size", href: "/tools/position-size", kind: "tool" },
    { label: "Leverage", href: "/tools/leverage", kind: "tool" },
    { label: "Funding cost", href: "/tools/funding-cost", kind: "tool" },
    { label: "Funding arbitrage", href: "/tools/funding-arbitrage", kind: "tool" },

    // Sections.
    { label: "Overview", href: "/", kind: "section" },
    { label: "Funding rates", href: "/funding", kind: "section" },
    { label: "Open interest", href: "/open-interest", kind: "section" },
    { label: "Liquidation map", href: "/liquidations", kind: "section" },
    { label: "Token unlocks", href: "/unlocks", kind: "section" },
    { label: "Coins", href: "/coins", kind: "section" },
    { label: "Calculators", href: "/tools", kind: "section" },

    // Studies and reference.
    { label: "The 5 February 2026 crash", href: "/liquidations/sweep", kind: "reference" },
    { label: "Leverage survival backtest", href: "/liquidations/survival", kind: "reference" },
    { label: "Methodology", href: "/methodology", kind: "reference" },
    { label: "Why we don't publish liquidation totals", href: "/methodology/liquidations", kind: "reference" },
    { label: "Data sources", href: "/data-sources", kind: "reference" },
    { label: "About", alt: "who runs this", href: "/about", kind: "reference" },
    { label: "Privacy", href: "/privacy", kind: "reference" },
    { label: "Terms and disclaimer", alt: "no financial service, no custody, no advice", href: "/terms", kind: "reference" },
  ];
  return new Response(JSON.stringify(rows), {
    headers: { "content-type": "application/json", "cache-control": "public, s-maxage=300" },
  });
};
