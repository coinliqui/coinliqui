import type { APIRoute } from "astro";
import { xml, dataStamp, codeStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/* The sweep case is FROZEN — its window never moves, so its git date is the truest lastmod
   on the site. The other two are market pages. */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const d = dataStamp(snap.fetchedAt);
  return xml(
    [
      { path: "/liquidations", lastmod: d },
      { path: "/liquidations/sweep", lastmod: codeStamp("/liquidations/sweep") },
      { path: "/liquidations/survival", lastmod: d },
    ],
    origin(site),
  );
};
