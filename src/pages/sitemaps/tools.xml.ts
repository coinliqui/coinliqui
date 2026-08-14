import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
export const GET: APIRoute = ({ site }) =>
  xml(
    [
      "/tools",
      "/tools/liquidation-price",
      "/tools/position-size",
      "/tools/leverage",
      "/tools/funding-cost",
      "/tools/funding-arbitrage",
    ],
    origin(site),
  );
