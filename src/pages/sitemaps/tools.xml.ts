import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
export const GET: APIRoute = () =>
  xml([
    "/tools",
    "/tools/liquidation-price",
    "/tools/position-size",
    "/tools/leverage",
    "/tools/funding-cost",
    "/tools/funding-arbitrage",
  ]);
