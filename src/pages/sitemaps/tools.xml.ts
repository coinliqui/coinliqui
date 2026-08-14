import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
/* Calculators compute in the page: they change when their code changes, never on their own,
   so every one of these takes a git date. */
export const GET: APIRoute = ({ site }) =>
  xml(
    ["/tools", "/tools/liquidation-price", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"],
    origin(site),
  );
