import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";
// Emitted only for contracts above the coverage floor: the sitemap is a function of the
// data, not of the template list.
export const GET: APIRoute = async ({ locals }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT);
  return xml(snap.perps.map((p) => `/funding/${p.symbol.toLowerCase()}`), snap.fetchedAt);
};
