import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/* THESE WERE FILED AS CODE ROUTES ON A PREMISE THAT TURNED OUT TO BE FALSE.
 *
 * The note here used to read "calculators compute in the page: they change when their code
 * changes, never on their own", and every one of them carried a git date four days stale
 * while the market moved underneath. Tested by fetching all five, waiting out a snapshot
 * rotation and diffing the bodies with every freshness element stripped out: all five had
 * changed. Two print the snapshot's mark verbatim as their default entry price, /tools leads
 * with a live APR, and funding-arbitrage's headline spread is computed from rates that settle
 * hourly. The premise was not slightly wrong, it was wrong for every URL it covered.
 *
 * So they are DATA routes, and take the same hour-truncated snapshot stamp the rest of the
 * market surface takes. /tools/liquidation-price stays absent: it serves 410 Gone. */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const at = dataStamp(snap.fetchedAt);
  return xml(
    ["/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"]
      .map((path) => ({ path, lastmod: at })),
    origin(site),
  );
};
