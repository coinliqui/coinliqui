import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";
const FILES = ["pages", "funding-hub", "funding-symbols", "open-interest", "tools", "liquidations", "unlocks"];
export const GET: APIRoute = ({ site }) => {
  const base = origin(site);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      FILES.map((f) => `  <sitemap><loc>${base}/sitemaps/${f}.xml</loc></sitemap>`).join("\n") +
      `\n</sitemapindex>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" } },
  );
};
