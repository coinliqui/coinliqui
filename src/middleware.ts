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

  /* THE CSP, WITH TWO NAMED SCRIPT HOSTS: static.cloudflareinsights.com and
   * www.googletagmanager.com.
   *
   * THIS SECTION HAS NOW BEEN REWRITTEN FOUR TIMES AND THE HISTORY IS THE USEFUL PART. It
   * began as `script-src 'self'` and nothing else, to make "no third-party scripts" true by
   * force. It was relaxed to run Google Analytics 4 — one named host plus wildcards on three
   * Google domains across img-src and connect-src. GA4 was removed and it went back to 'self'.
   * It was relaxed again, by one host, for the Cloudflare Web Analytics beacon. And on
   * 27 August 2026 the operator asked for GA4 back, so the Google entries are back with it.
   *
   * WHAT THE TWO COUNTERS ANSWER, because running both is otherwise just two tags. Cloudflare
   * Web Analytics answers "did anybody load a page", cheaply and without a cookie, and stops
   * there. Search Console answers "who clicked from Google" and nothing about what happened
   * next. GA4 is here for the question neither can answer: which page a reader went to after
   * the one they landed on, and which of the fifty contract pages is worth writing more about.
   * If that stops being the reason, this is the paragraph to reread before keeping it.
   *
   * WHY THE PREVIOUS VERSION OF THIS COMMENT WAS WRONG ABOUT THE STATE OF THE WORLD. It said
   * "the tag itself is being turned off at the dashboard so the page stops carrying an inert
   * script it cannot run". That never happened. Measured on 27 August 2026: the beacon is
   * injected into every HTML response, our own policy blocks it, and the account's Web
   * Analytics has recorded ZERO pageloads in 31 days while the same account's other site
   * records normally. So the site was paying for the tag — 359 bytes and a CSP violation in
   * every reader's console — and receiving nothing at all for it. That is the worst of the
   * three available states and it held for eight days because a comment described an intention
   * as though it were a configuration.
   *
   * WHY IT IS ALLOWED NOW, AND WHAT WAS ACTUALLY CHECKED. The earlier refusal turned on one
   * open question: whether the beacon is cookieless. Cloudflare's documentation does not answer
   * it in those words, so it is not claimed in those words. What the documentation does say is
   * quoted on /privacy with its URL, and what the beacon does on THIS site is measured rather
   * than trusted — see the measurement recorded there. The operator's decision, 27 August 2026,
   * was to allow it: the alternative left us with no reader-side measurement of any kind, on a
   * site whose only feedback loop is Search Console clicks in the single digits.
   *
   * connect-src IS DELIBERATELY UNCHANGED. Cloudflare's own documentation says beacon data goes
   * to `https://<yourdomain>/cdn-cgi/rum` for a site proxied through Cloudflare, and this site
   * is proxied — so the POST is SAME-ORIGIN and 'self' already permits it. Adding
   * cloudflareinsights.com to connect-src would be punching a second hole for a request that
   * does not need one. If that ever stops being true the beacon will fail in the console and
   * the check in scripts/verify-live.mjs will say so.
   *
   * The rule for editing this: name hosts, never a scheme and never a wildcard. `https:` or
   * `*` in script-src would permit every origin on the internet and read, at a glance, like a
   * tightened policy. scripts/verify-live.mjs fails on either, and it also fails on a host that
   * is in the header but not on its own allowlist — so widening this file alone does not widen
   * the site.
   *
   * 'unsafe-inline' PERMITS EVERY INLINE SCRIPT in the document — ours and anyone else's. CSP
   * has no notion of authorship, and an earlier version of this comment claimed it did, which
   * was flattering and false. It is here because the calculators' `define:vars` blocks are
   * inline. Removing it means hashing or noncing every inline block, which is worth doing and
   * is still not done — and it remains the single largest weakness in this header, larger than
   * the one named host below.
   */
  if (isDocument) {
    res.headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        /* ONE NAMED HOST, and the question GA4 failed is answered for it: the decision this
           returns is whether anybody reads the site. Search Console counts clicks from Google
           and nothing else — not a direct visit, not a link followed, not which page was read.
           Every client-side counter this site has had was off, and the number the operator was
           looking at was zero because nothing was counting. */
        /* TWO NAMED HOSTS SERVE SCRIPTS HERE, and the second one is back by decision rather
           than by drift. www.googletagmanager.com will serve any GTM container to anyone who
           asks for one, so naming it does not permit "our tag" — CSP has no notion of whose
           tag it is. It permits that host. The narrower alternative is a hash or a nonce per
           inline block, which is the same work 'unsafe-inline' above is still owed. */
        "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline'",
        /* GA4 falls back to a pixel where fetch/beacon is unavailable, so the image hosts are
           the same two families the connect hosts are. */
        "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com",
        "font-src 'self'",
        /* THE CLOUDFLARE BEACON STILL NEEDS NOTHING HERE. Its data goes to
           `https://<yourdomain>/cdn-cgi/rum` for a proxied site, which is this origin, so
           'self' already covers it and naming cloudflareinsights.com would be a hole punched
           for a request nobody makes. The Google entries are for GA4, which does post
           off-origin: region1.google-analytics.com and analytics.google.com among others,
           which is why these are host wildcards rather than three named hosts that would fail
           the first time Google added a region. */
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
