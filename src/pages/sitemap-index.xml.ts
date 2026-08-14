import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";
import { dataStamp, codeStamp, newest } from "../lib/sitemap.ts";
import { getSnapshot } from "../lib/hyperliquid.ts";

/**
 * The index carries a lastmod per child sitemap, because that is what a crawler reads to
 * decide which of the seven to fetch at all. Getting it wrong here is more expensive than
 * getting it wrong on a single URL: it decides whether a whole template is looked at.
 *
 * Each child reports the newest lastmod among its own URLs — the market templates move with
 * the data, the code templates sit still until we touch them.
 */
const CODE_ROUTES: Record<string, string[]> = {
  tools: ["/tools", "/tools/liquidation-price", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"],
  unlocks: ["/unlocks"],
};

export const GET: APIRoute = async ({ locals, site }) => {
  const base = origin(site);
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const data = dataStamp(snap.fetchedAt);

  const files: { name: string; lastmod?: string }[] = [
    // mixed: the homepage moves with the market, the prose does not
    { name: "pages", lastmod: newest([data, ...["/methodology", "/methodology/liquidations", "/data-sources", "/privacy"].map(codeStamp)]) },
    { name: "funding-hub", lastmod: data },
    { name: "funding-symbols", lastmod: data },
    { name: "open-interest", lastmod: data },
    { name: "tools", lastmod: newest(CODE_ROUTES.tools.map(codeStamp)) },
    { name: "liquidations", lastmod: newest([data, codeStamp("/liquidations/sweep")]) },
    { name: "unlocks", lastmod: newest(CODE_ROUTES.unlocks.map(codeStamp)) },
  ];

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      files
        .map((f) => `  <sitemap><loc>${base}/sitemaps/${f.name}.xml</loc>${f.lastmod ? `<lastmod>${f.lastmod}</lastmod>` : ""}</sitemap>`)
        .join("\n") +
      `\n</sitemapindex>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" } },
  );
};
