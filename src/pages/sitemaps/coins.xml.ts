import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSpot, liveCoins } from "../../lib/coins.ts";

/**
 * Only coins whose publication date has passed. The 25-30 new URLs a week rule is enforced
 * here, in the file a crawler reads, rather than by anyone remembering to add a line.
 *
 * lastmod is the spot timestamp: these pages move with the market on every tick.
 */
export const GET: APIRoute = async ({ locals, site }) => {
  const spot = await getSpot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const lastmod = dataStamp(spot?.at);
  return xml(
    [{ path: "/coins", lastmod }, ...liveCoins().map((c) => ({ path: `/coins/${c.slug}`, lastmod }))],
    origin(site),
  );
};
