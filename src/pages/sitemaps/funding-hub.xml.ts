import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  return xml([{ path: "/funding", lastmod: dataStamp(snap.fetchedAt) }], origin(site));
};
