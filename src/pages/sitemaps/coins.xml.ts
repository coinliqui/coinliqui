import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { liveCoins } from "../../lib/coins.ts";
import { getLive } from "../../lib/hyperliquid.ts";

/**
 * Only coins whose publication date has passed. The 25-30 new URLs a week rule is enforced
 * here, in the file a crawler reads, rather than by anyone remembering to add a line.
 *
 * lastmod is the LIVE timestamp — the one-minute Hyperliquid tick — because these pages move
 * with the market on every tick. It was the spot timestamp until 19 August 2026; that source is
 * gone and the tick that replaced it runs on the same cadence, so the meaning of the field is
 * unchanged even though the clock behind it is a different one.
 */
export const GET: APIRoute = async ({ locals, site }) => {
  const live = await getLive((locals as any)?.runtime?.env?.SNAPSHOT);
  const lastmod = dataStamp(live?.at);
  return xml(
    [{ path: "/coins", lastmod }, ...liveCoins().map((c) => ({ path: `/coins/${c.slug}`, lastmod }))],
    origin(site),
  );
};
