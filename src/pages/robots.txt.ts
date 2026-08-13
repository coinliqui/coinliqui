import type { APIRoute } from "astro";
import { SITE } from "../lib/site.ts";

// Named allowlist for citation and agent crawlers. Blocking the wrong bot makes the site
// uncitable; /watchlist is disallowed because it is a personal view of data already
// published on /funding, and robots.txt is the right tool for that rather than noindex —
// Google's crawl-budget guidance says noindex still costs a fetch.
const CITATION_BOTS = [
  "Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot", "Applebot-Extended", "Amazonbot", "DuckAssistBot",
  "Bytespider", "YouBot", "cohere-training-data-crawler", "TavilyBot", "kagi-fetcher",
];
const BLOCKED = ["CCBot", "Omgilibot", "Omgili", "Diffbot", "ImagesiftBot", "PetalBot", "MJ12bot", "DotBot"];

export const GET: APIRoute = () =>
  new Response(
    [
      ...CITATION_BOTS.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /watchlist\nDisallow: /ui/\n`),
      `User-agent: *\nAllow: /\nDisallow: /watchlist\nDisallow: /ui/\n`,
      ...BLOCKED.map((b) => `User-agent: ${b}\nDisallow: /\n`),
      `Sitemap: ${SITE.url}/sitemap-index.xml\n`,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
