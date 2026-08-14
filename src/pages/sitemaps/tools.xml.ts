import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
/* Calculators compute in the page: they change when their code changes, never on their own,
   so every one of these takes a git date. */
export const GET: APIRoute = ({ site }) =>
  xml(
    // /tools/liquidation-price is deliberately absent: it now serves 410 Gone.
    ["/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"],
    origin(site),
  );
