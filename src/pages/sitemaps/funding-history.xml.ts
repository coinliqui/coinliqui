import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";
import { historyStamp } from "../../lib/funding-history.ts";

/* Dated by the newest settled hour the page sums, which is its dateModified. */
export const GET: APIRoute = async ({ locals, site }) => {
  const env = (locals as any)?.runtime?.env;
  const snap = await getSnapshot(env?.SNAPSHOT, import.meta.env.DEV);
  const lastmod = snap.available ? await historyStamp(env?.SNAPSHOT, snap.perps.map((p) => p.symbol)) : undefined;
  return xml(lastmod ? [{ path: "/funding/history", lastmod }] : [], origin(site));
};
