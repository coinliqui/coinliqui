import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";

// Named allowlist for citation and agent crawlers. Blocking the wrong bot makes the site
// uncitable.
//
// /watchlist is NO LONGER disallowed here. It is now linked from the primary action on
// every page, and a robots.txt-disallowed URL with many internal links is exactly the case
// Google indexes as a bare URL with no snippet — the crawler is forbidden from fetching the
// page, so it never sees a noindex. The page now sends `noindex, follow` in its own head
// instead, which requires crawlability to work at all. The earlier crawl-budget argument
// does not apply to a 38-page site.
//
// /status stays disallowed: it is operational, changes every five minutes, and has no
// inbound links worth preserving.
const CITATION_BOTS = [
  "Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot", "Applebot-Extended", "Amazonbot", "DuckAssistBot",
  "Bytespider", "YouBot", "cohere-training-data-crawler", "TavilyBot", "kagi-fetcher",
];
const BLOCKED = ["CCBot", "Omgilibot", "Omgili", "Diffbot", "ImagesiftBot", "PetalBot", "MJ12bot", "DotBot"];

export const GET: APIRoute = ({ site, url }) => {
  const canonical = origin(site);

  // Any host that is not the canonical one — every *.pages.dev preview and production
  // subdomain, and the raw origin before the domain is attached — refuses indexing
  // outright. Canonical tags are a hint; this is not. Indexing that starts on a
  // hostname we intend to migrate away from cannot be undone cheaply.
  if (url.origin !== canonical) {
    return new Response(`User-agent: *\nDisallow: /\n`, {
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
    });
  }

  return new Response(
    [
      ...CITATION_BOTS.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /status\n`),
      `User-agent: *\nAllow: /\nDisallow: /status\n`,
      ...BLOCKED.map((b) => `User-agent: ${b}\nDisallow: /\n`),
      `Sitemap: ${canonical}/sitemap-index.xml\n`,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } },
  );
};
