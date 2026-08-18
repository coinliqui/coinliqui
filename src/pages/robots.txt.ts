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
// /status USED TO BE DISALLOWED HERE, justified by "no inbound links worth preserving".
// That premise stopped being true the moment /about and /data-sources started linking to it —
// three inbound links from indexed pages — and the paragraph above says exactly what happens
// then: a Disallow'd URL can still be indexed FROM those links, with no snippet, because the
// crawler is never permitted to fetch the page and discover a directive. The site was doing
// the one thing its own comment says not to do, to the one page that reports whether the data
// is healthy. It now carries `noindex, follow` in its head like every other excluded page,
// which is the mechanism that actually works.
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
      ...CITATION_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`),
      `User-agent: *\nAllow: /\n`,
      ...BLOCKED.map((b) => `User-agent: ${b}\nDisallow: /\n`),
      `Sitemap: ${canonical}/sitemap-index.xml\n`,
    ].join("\n"),
/* 14400, NOT 300, BECAUSE 300 WAS NEVER WHAT ANYONE RECEIVED.
       Measured on the wire: this file declared `public, max-age=300` and was served
       `public, max-age=14400` — a 48x drift, every request, for as long as it has existed.
       The mechanism is Cloudflare's, not ours: this is the only endpoint here that comes back
       `cf-cache-status: HIT`, and every response that comes back DYNAMIC (the sitemaps, the
       search index, /api/live.json, every HTML page) has its header passed through untouched.
       So whatever rewrites it only rewrites what the edge actually caches.

       WHAT I COULD NOT ESTABLISH, stated rather than guessed: which setting does it. Reading
       zone settings needs a scope this project's OAuth grant does not carry — `zone (read)`
       covers listing zones, and /zones/:id/settings/browser_cache_ttl answers
       "Authentication error". So the cause is inferred from the wire, not confirmed at source.

       Four hours is a fine cache for a file that changes a few times a year, so the number is
       adopted rather than fought. What was not fine was source code stating a figure no client
       was ever sent. scripts/verify-live.mjs now compares declared against served for every
       endpoint that sets this header, so the next drift is caught instead of discovered. */
      { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=14400" } },
  );
};
