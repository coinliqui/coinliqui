import type { APIRoute } from "astro";
import { xml, dataStamp, codeStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/* Mixed: the homepage is a market page, the rest are prose. Each takes the stamp that is
   true of it rather than one shared date.

   /methodology moved across the line after being measured. Its worked example is built from
   `snap.perps.find(...)` - the comment in that file says "uses TODAY'S real rates, so the
   explanation is never abstract" - so the page changes whenever the rates do. Captured under
   one snapshot, polled until the store rotated 260s later and diffed with every freshness
   element stripped, a rate in the example table had moved from -0.000005 to -0.0000045. A
   commit date on that is a false claim.

   /data-sources was measured the same way in the same window and did NOT change: it reads the
   snapshot only for coverage counts, which move when a coin crosses the floor and not other-
   wise. It keeps its git date, and giving it an hourly one would be the same error inverted. */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  return xml(
    [
      { path: "/", lastmod: dataStamp(snap.fetchedAt) },
      { path: "/methodology", lastmod: dataStamp(snap.fetchedAt) },
      ...["/about", "/methodology/liquidations", "/data-sources", "/privacy"].map((p) => ({ path: p, lastmod: codeStamp(p) })),
    ],
    origin(site),
  );
};
