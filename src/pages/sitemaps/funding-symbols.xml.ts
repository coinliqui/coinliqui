import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";
// Emitted only for contracts above the coverage floor: the sitemap is a function of the
// data, not of the template list. A cold snapshot yields an EMPTY urlset rather than a
// 500 — an empty sitemap is a valid document and crawlers retry it.
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const lastmod = dataStamp(snap.fetchedAt);
  return xml(snap.perps.map((p) => ({ path: `/funding/${p.symbol.toLowerCase()}`, lastmod })), origin(site));
};
