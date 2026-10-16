import type { APIRoute } from "astro";
import { xml, codeStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { FUNDING_EVENTS } from "../../lib/routes.ts";

/* FROZEN, like /liquidations/sweep: the window never moves, so the commit date is the true lastmod. */
export const GET: APIRoute = async ({ site }) =>
  xml(FUNDING_EVENTS.map((path) => ({ path, lastmod: codeStamp(path) })), origin(site));
