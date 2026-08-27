import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";
import { dataStamp, codeStamp, newest } from "../lib/sitemap.ts";
import { getSnapshot } from "../lib/hyperliquid.ts";
import register from "../data/vesting-contracts.json";

/**
 * The index carries a lastmod per child sitemap, because that is what a crawler reads to
 * decide which of the seven to fetch at all. Getting it wrong here is more expensive than
 * getting it wrong on a single URL: it decides whether a whole template is looked at.
 *
 * Each child reports the newest lastmod among its own URLs — the market templates move with
 * the data, the code templates sit still until we touch them.
 */
/* The two entries that used to live here, `tools` and `unlocks`, were both misfiled, and the
   index is where that costs most: a crawler reads these dates to decide whether to open a
   child sitemap at all, so a stale one here can hide a whole template. Both are now dated the
   same way their child sitemaps date themselves - see those files for the evidence. Keeping
   the two in step is not optional: an index and a child disagreeing about the same URL set is
   a worse signal than either date alone. */

export const GET: APIRoute = async ({ locals, site }) => {
  const base = origin(site);
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const data = dataStamp(snap.fetchedAt);

  const files: { name: string; lastmod?: string }[] = [
    // mixed: the homepage moves with the market, the prose does not
    { name: "pages", lastmod: newest([data, ...["/methodology", "/methodology/liquidations", "/data-sources", "/privacy"].map(codeStamp)]) },
    { name: "coins", lastmod: data },
    { name: "funding-hub", lastmod: data },
    { name: "funding-symbols", lastmod: data },
    { name: "open-interest", lastmod: data },
    { name: "tools", lastmod: data },
    { name: "liquidations", lastmod: newest([data, codeStamp("/liquidations/sweep")]) },
    { name: "unlocks", lastmod: new Date((register as { verifiedAt: string }).verifiedAt).toISOString() },
    // mixed, same split as `pages`: two explainers print live figures, two describe a method
    { name: "learn", lastmod: newest([data, ...["/learn/liquidation-heatmap", "/learn/liquidation-price"].map(codeStamp)]) },
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
