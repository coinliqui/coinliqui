import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { liveCoins } from "../../lib/coins.ts";
import { getLive, getSnapshot, oldestStamp } from "../../lib/hyperliquid.ts";

/**
 * Only coins whose publication date has passed. The 25-30 new URLs a week rule is enforced
 * here, in the file a crawler reads, rather than by anyone remembering to add a line.
 *
 * lastmod is the LIVE timestamp — the one-minute Hyperliquid tick — because these pages move
 * with the market on every tick. It was the spot timestamp until 19 August 2026; that source is
 * gone and the tick that replaced it runs on the same cadence, so the meaning of the field is
 * unchanged even though the clock behind it is a different one.
 *
 * AND IT IS THE OLDER OF THE TWO CLOCKS, NOT THE LIVE ONE ALONE. The coin pages publish
 * `oldestStamp(snap.fetchedAt, live?.at)` — deliberately conservative, because a page is only as
 * fresh as its stalest number — while this file published `live.at` by itself. Same URL, two
 * public answers, and the sitemap's was always the fresher: it told a crawler the document had
 * changed more recently than the document itself claimed. Read off the same expression the page
 * uses, so the two cannot part company again; stampSurfacesAgree fails the gate if they do.
 */
export const GET: APIRoute = async ({ locals, site }) => {
  const env = (locals as any)?.runtime?.env;
  const [live, snap] = await Promise.all([getLive(env?.SNAPSHOT), getSnapshot(env?.SNAPSHOT, import.meta.env.DEV)]);
  const lastmod = dataStamp(oldestStamp(snap.fetchedAt, live?.at));
  return xml(
    [{ path: "/coins", lastmod }, ...liveCoins().map((c) => ({ path: `/coins/${c.slug}`, lastmod }))],
    origin(site),
  );
};
