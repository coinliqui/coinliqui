import type { APIRoute } from "astro";
import { xml, dataStamp, codeStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/* Mixed: the homepage is a market page, the rest are prose. Each takes the stamp that is
   true of it rather than one shared date. */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  return xml(
    [
      { path: "/", lastmod: dataStamp(snap.fetchedAt) },
      ...["/methodology", "/methodology/liquidations", "/data-sources", "/privacy"].map((p) => ({ path: p, lastmod: codeStamp(p) })),
    ],
    origin(site),
  );
};
