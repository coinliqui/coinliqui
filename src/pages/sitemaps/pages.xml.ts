import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
export const GET: APIRoute = () => xml(["/", "/methodology", "/methodology/liquidations", "/data-sources"]);
