import type { APIRoute } from "astro";
import { xml, dataStamp, codeStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { LEARN_DATA, LEARN_CODE } from "../../lib/routes.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/* Mixed, for the reason stated where the two lists are declared: the funding and open-interest
   explainers print today's numbers, so they move with the market; the heatmap and margin
   explainers describe a model and a formula, so they move only when we edit them. */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  return xml(
    [
      ...LEARN_DATA.map((p) => ({ path: p, lastmod: dataStamp(snap.fetchedAt) })),
      ...LEARN_CODE.map((p) => ({ path: p, lastmod: codeStamp(p) })),
    ],
    origin(site),
  );
};
