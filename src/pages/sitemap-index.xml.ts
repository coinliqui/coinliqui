import type { APIRoute } from "astro";
import { SITE } from "../lib/site.ts";
const FILES = ["pages", "funding-hub", "funding-symbols", "open-interest", "tools"];
export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      FILES.map((f) => `  <sitemap><loc>${SITE.url}/sitemaps/${f}.xml</loc></sitemap>`).join("\n") +
      `\n</sitemapindex>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
