import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
/* Driven by a committed register, so its git date is exactly right. */
export const GET: APIRoute = ({ site }) => xml(["/unlocks"], origin(site));
