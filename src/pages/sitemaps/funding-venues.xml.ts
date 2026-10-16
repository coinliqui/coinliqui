import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getVenueAgreement } from "../../lib/venue-agreement.ts";

/* Dated by the day's comparison, which is the page's dateModified. */
export const GET: APIRoute = async ({ locals, site }) => {
  const a = await getVenueAgreement((locals as any)?.runtime?.env?.SNAPSHOT);
  return xml(a ? [{ path: "/funding/venues", lastmod: dataStamp(a.at) }] : [], origin(site));
};
