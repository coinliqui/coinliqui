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
/* EVERY EXCLUSION STATES WHY, BECAUSE THIS LIST USED TO BE EIGHT BARE STRINGS.
 *
 * The comment at the top of this file says blocking the wrong bot makes the site uncitable, and
 * then the list underneath it blocked CCBot — Common Crawl — on a site whose entire problem is
 * that it exists nowhere but itself. Five of the eight were wrong on their own terms, and a
 * sixth was not even doing what it looked like it was doing.
 *
 * Audited crawler by crawler on 18 August 2026. What changed and why:
 *
 *   CCBot     UNBLOCKED. Common Crawl is a genuine training-corpus input, and its URL index and
 *             host-level web graph are a free, permanent, independently addressable record of
 *             this domain — a corroborating archive rather than a resale. Honest caveats kept
 *             in view: the payoff is 12–24 months out, and it is one-way, since captured WARCs
 *             are never retracted. Allowing the proprietary training crawlers above while
 *             blocking the open public one was incoherent whichever way the trade is judged.
 *   Diffbot   UNBLOCKED, and the strongest of the eight for this site's actual problem. It is
 *             the only one that mints an ENTITY record rather than a copy of our bytes: a
 *             structured third-party Organization node with a stable identifier. "No entity
 *             record exists anywhere" is the literal shape of the failure being fixed.
 *   PetalBot  UNBLOCKED, rate-limited. The only one that puts this domain into a second
 *             publicly queryable consumer search index that is neither Google nor Bing, so a
 *             person or an agent can corroborate it somewhere independent — in weeks, not
 *             years. It crawls hard, hence the delay rather than a block.
 *   MJ12bot   UNBLOCKED, rate-limited. Modest and specific: it does not create inbound links,
 *             it records ours, so third-party lookups return data instead of "blocked". A site
 *             asking to be believed should not be the one blocking the most-blocked SEO bot.
 *   DotBot    UNBLOCKED. Moz's metric is the one mirrored by the free "is this domain safe"
 *             pages an assistant actually lands on when asked exactly the question this site
 *             keeps being asked wrongly. Turning those from "no data" into data is on-target.
 *
 * WHAT STAYS BLOCKED, and why it is not the same case:
 *
 *   Webzio    The Omgilibot/Omgili entries were THEATRE. Webz.io retired those tokens; the live
 *   webzio-   ones ran straight through the wildcard Allow above, so the site believed it was
 *   extended  blocking a reseller it was in fact serving. The intent was right and is now
 *             enforced against the tokens that exist. Webz.io is a pure reseller: content goes
 *             into a paid API and produces NO public record that this domain exists, so there
 *             is no discoverability upside to trade against republication without provenance —
 *             and per-figure provenance is the one thing this site sells.
 *   Imagesift Acquisition only. It creates no textual or entity record, the images here are
 *             charts and a logo, and nobody deciding whether this site is legitimate arrives
 *             by image similarity. Kept as an explicit rule rather than deleted, because
 *             deleting it would silently inherit the blanket Allow above.
 *
 * AND THE PART THAT MATTERS MORE THAN THIS FILE: every system named here is discovery-driven
 * and shares one input. Common Crawl's frontier comes from links on pages it has already
 * crawled; Majestic and Moz build our record from other people's pages; Diffbot resolves
 * entities from mentions. This domain has zero inbound links, so unblocking widens the pipe and
 * puts nothing into it. The first-order work is creating the independent records these crawlers
 * would otherwise have to find. Do not book this edit as the fix.
 */
const BLOCKED: { ua: string; why: string }[] = [
  { ua: "Webzio", why: "reseller: paid API, no public record of this domain" },
  { ua: "webzio-extended", why: "same operator, the token that actually crawls" },
  { ua: "ImagesiftBot", why: "image acquisition only; no textual or entity record" },
];

/* Allowed, but told to slow down. Crawl-delay is not in the standard and Google ignores it;
   these two honour it, which is exactly why they are here rather than in the list above. */
const RATE_LIMITED: { ua: string; delay: number; why: string }[] = [
  { ua: "PetalBot", delay: 2, why: "second consumer index, crawls aggressively" },
  { ua: "MJ12bot", delay: 2, why: "volunteer distributed crawler" },
];
const NEWLY_ALLOWED = ["CCBot", "Diffbot", "DotBot"];

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
      ...[...CITATION_BOTS, ...NEWLY_ALLOWED].map((b) => `User-agent: ${b}\nAllow: /\n`),
      `User-agent: *\nAllow: /\n`,
      ...RATE_LIMITED.map((b) => `User-agent: ${b.ua}\nAllow: /\nCrawl-delay: ${b.delay}\n`),
      ...BLOCKED.map((b) => `User-agent: ${b.ua}\nDisallow: /\n`),
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
