import { defineMiddleware } from "astro:middleware";

/**
 * Two jobs, both about what the edge is allowed to tell the outside world.
 *
 * 1. HOST GUARD. Cloudflare Pages always serves the project on <project>.pages.dev and
 *    on <commit>.<project>.pages.dev in addition to the custom domain. Those hostnames
 *    are real, reachable and indexable. A canonical tag is only a hint, so any request
 *    arriving on a non-canonical host gets X-Robots-Tag: noindex, nofollow — the one
 *    signal Google treats as binding. This is what keeps indexing from starting on a
 *    URL we intend to migrate away from.
 *
 * 2. EDGE CACHE. Pages render from KV, so they are cheap but not free. A short shared
 *    cache with a long stale window means an upstream or origin problem shows up as an
 *    older timestamp rather than a failed request.
 */
export const onRequest = defineMiddleware(async (ctx, next) => {
  /* ONE URL PER PAGE.
     Every path was answering 200 both bare and with a trailing slash, and because the
     canonical is built from the REQUESTED pathname, /funding/btc/ declared itself canonical
     rather than pointing at /funding/btc. That is a duplicate-content split across all 42
     URLs, and it is the same failure the www redirect exists to prevent, one level down.
     Caught while diagnosing something else; a canonical tag cannot fix it because both
     copies were self-referencing. */
  const p = ctx.url.pathname;
  if (p.length > 1 && p.endsWith("/")) {
    return new Response(null, {
      status: 301,
      headers: { location: p.replace(/\/+$/, "") + ctx.url.search, "cache-control": "public, max-age=86400" },
    });
  }

  const res = await next();
  const canonical = ctx.site?.origin;
  const onCanonicalHost = !canonical || ctx.url.origin === canonical;

  if (!onCanonicalHost) {
    res.headers.set("x-robots-tag", "noindex, nofollow");
  }

  const type = res.headers.get("content-type") ?? "";
  const isDocument = type.includes("text/html");
  const cacheable = ctx.request.method === "GET" && res.status === 200;

  // Astro emits `text/html` bare here. Not fatal — every page carries <meta charset> — but a
  // declared charset outranks the meta tag and costs nothing.
  if (isDocument && !type.includes("charset")) {
    res.headers.set("content-type", "text/html; charset=utf-8");
  }

  if (isDocument && cacheable && !res.headers.has("cache-control")) {
    /* NO `Vary: Cookie`, BECAUSE THE DOCUMENT NO LONGER DEPENDS ON ONE.
       This block used to split every response in two: a request carrying the `rail` cookie got
       `private, no-store`, everything else got the shared-cacheable variant, and both carried
       `Vary: Cookie` so a shared cache could not mix them up.

       That was correct and it was a trap. `Vary: Cookie` keys a shared cache on the ENTIRE
       Cookie header. With `rail` as the only cookie that is two variants. Add any analytics
       cookie and every returning visitor carries a unique value, so every visitor becomes their
       own cache entry — a shared cache with a ~100% miss rate, which is worse than no cache
       because the lookup still costs. It would have fired silently, months later, on whoever
       enabled caching or analytics first.

       It is fixed at the source instead of worked around: the rail's collapsed state is no
       longer read during server rendering, so the HTML is byte-identical for every visitor and
       there is nothing to vary on. Base.astro applies the class before first paint from the
       cookie, and /rail toggles server-side so the button's markup carries no state either.

       One consequence worth naming: responses are now cacheable for visitors who have cookies,
       which they were not before. That is the point, and it is only safe because the document
       genuinely does not depend on them. Anything added later that DOES depend on a cookie must
       either go client-side the same way or bring `Vary` back with its cost understood. */
    /* =====================================================================================
       DYNAMIC IS THE RIGHT ANSWER FOR THIS SITE, DECIDED ON MEASUREMENT — DO NOT "OPTIMISE" IT.

       Measured 18-19 August: Cloudflare returns `dynamic` for 73% of requests and the edge hit
       rate is 3.5%, so the origin serves 96.5% of traffic. HTML is not cached by default and
       would need an explicit Cache Rule. Every render-cost model on this project had assumed
       the opposite, and the meter corrected it.

       WHAT A CACHE RULE WOULD SAVE: nothing that is scarce. 13,897 requests/day is 422,000 a
       month against an allowance of 10,000,000 — 4.22%. Pages CPU is bounded well under the
       allowance, and Cloudflare egress is unmetered. There is no resource here under pressure.

       WHAT IT WOULD COST: the site's central claim. The freshness pill renders its age STRING
       at render time — "1 min ago" — and JavaScript recomputes it from the absolute timestamp
       in the same element. A reader running JS always sees the truth. Anything that does not
       run JS reads the baked string, and that is exactly the audience this project cares most
       about: crawlers, answer engines, reader-mode views. A 120-second shared cache would serve
       them an age understated by up to 120 seconds, and `stale-while-revalidate=600` would
       stretch that to twelve minutes. A site whose entire argument is that every figure states
       its own age cannot afford to understate the age specifically to machines.

       So the previous header was a latent version of that hazard rather than a benefit: it
       promised 120 seconds of shared caching plus ten minutes of stale-while-revalidate to any
       intermediary that honours it. Cloudflare does not, which is why nothing has gone wrong —
       but a corporate proxy, a CDN in front of a reader, or a future Cache Rule added by
       someone reading only the header would all have served an understated age. The declaration
       is now what we actually want and what we actually get.

       IF THIS IS EVER REVISITED, the change that makes caching safe is not a longer TTL: it is
       rendering an ABSOLUTE time as the pill's text and letting JS produce the relative form —
       the same shape as the "Not updating" fix, where the server states what it knows and the
       client states what depends on now. Do that first, then cache freely. Caching first would
       be trading the site's one distinguishing claim for 4% of an allowance nobody is near.
       ===================================================================================== */
    res.headers.set("cache-control", "public, max-age=0, must-revalidate");
  }

  // The rail toggle sets a cookie and redirects; a shared cache must never hold that.
  if (ctx.url.pathname === "/rail") {
    res.headers.set("cache-control", "no-store");
  }

  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");

  /* HSTS. Measured absent on 19 August: the site was already HTTPS-only in practice, with
     always_use_https redirecting, but nothing told a browser to REFUSE http next time — so the
     first request of every session was still a redirect a network could intercept.

     Two years, subdomains included, and deliberately NOT `preload`. Preload is a one-way door:
     it commits every present and future subdomain to HTTPS in a list baked into browsers, and
     removal takes months. On a domain five days old, with img. already in use and no certainty
     about what else this project will need, that commitment is not one to make casually. The
     header delivers the security benefit; preload only removes the very first request's
     exposure, at a cost that cannot be undone in a hurry. */
  res.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");

  /* Nothing here uses a camera, a microphone, geolocation or a payment handler, and a site
     whose central claim is that it cannot take a payment should say so to the browser too. */
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");

  /* THE CSP, WHICH NO LONGER DEFENDS A MARKETING CLAIM AND STILL EARNS ITS PLACE.
   *
   * It used to exist to make "no third-party scripts" true by force — script-src 'self',
   * nothing else, so an injected analytics beacon could not run. That policy is retired: this
   * site runs Google Analytics 4 deliberately, and the CSP now names the hosts GA needs and
   * refuses everything else.
   *
   * Which is the part worth keeping. The threat a CSP is actually for is an origin nobody
   * chose — a compromised dependency, an injected tag, a rewriting proxy.
   *
   * BUT NOT "EXACTLY AS WELL AS 'self' ALONE", which is what this comment claimed and is not
   * true. script-src gains ONE named host; connect-src and img-src gain wildcards on three
   * Google domains. And www.googletagmanager.com will serve any GTM container to anyone who
   * asks for it by ID, so allowlisting it is strictly weaker than 'self' — it is a deliberate
   * trade for the analytics, not a free one. What carries the anti-injection weight is the set
   * NOT relaxed: object-src 'none', base-uri 'self', frame-ancestors 'none', form-action
   * 'self', default-src 'self'. None of those moved.
   *
   * The rule for editing this: name hosts, never a scheme and never a wildcard. `https:` or
   * `*` in script-src would permit every origin on the internet and read, at a glance, like a
   * tightened policy. scripts/verify-live.mjs fails on either.
   *
   * 'unsafe-inline' permits EVERY inline script in the document — ours and anyone else's. CSP
   * has no notion of authorship, and an earlier version of this comment claimed it did, which
   * was flattering and false. It is here because the calculators' `define:vars` blocks and the
   * GA config call are inline, and it is a real weakening of the inline-injection defence.
   * What it does not do is admit an off-origin ORIGIN; that is the allowlist above, and that
   * is the half this file guards. Removing it means hashing or noncing every inline block,
   * which is worth doing and is not done.
   */
  if (isDocument) {
    res.headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        /* Google Tag Manager serves gtag.js and nothing else is permitted to serve a script.
           Named hosts, never a scheme or a wildcard: `https:` or `*` here would turn the
           policy into decoration, which is the failure mode this directive exists to prevent. */
        "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline'",
        /* GA falls back to a pixel when sendBeacon and fetch are both unavailable. */
        "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com",
        "font-src 'self'",
        /* Where GA4 actually sends the hits. The regional endpoints are separate hosts and
           omitting them drops data silently from whole continents rather than failing loudly. */
        "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
        "form-action 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join("; "),
    );
  }
  return res;
});
