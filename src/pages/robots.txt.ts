import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";

// Named allowlist for citation and agent crawlers. Blocking the wrong bot makes the site
// uncitable; /watchlist is disallowed because it is a personal view of data already
// published on /funding, and robots.txt is the right tool for that rather than noindex —
// Google's crawl-budget guidance says noindex still costs a fetch. /status is operational.
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
      ...CITATION_BOTS.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /watchlist\nDisallow: /status\n`),
      `User-agent: *\nAllow: /\nDisallow: /watchlist\nDisallow: /status\n`,
      ...BLOCKED.map((b) => `User-agent: ${b}\nDisallow: /\n`),
      `Sitemap: ${canonical}/sitemap-index.xml\n`,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } },
  );
};
