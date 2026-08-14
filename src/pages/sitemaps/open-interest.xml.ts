import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
export const GET: APIRoute = ({ site }) => xml(["/open-interest"], origin(site));
