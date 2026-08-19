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

  /* THE CSP, BACK TO `script-src 'self'` — the strongest form it has ever had here.
   *
   * It began as script-src 'self' and nothing else, to make "no third-party scripts" true by
   * force. That was relaxed to run Google Analytics 4: one named host in script-src, and
   * wildcards on three Google domains across img-src and connect-src. GA4 is gone, so the
   * seven allowances it bought are gone with it, and nothing off-origin can serve a script,
   * receive a fetch, or load a pixel on this site any more.
   *
   * NARROWING IS THE WHOLE POINT, not a tidy-up after the fact. A CSP defends against an
   * origin nobody chose — a compromised dependency, an injected tag, a rewriting proxy — and
   * every named host is a hole punched in that defence for something we decided we wanted.
   * www.googletagmanager.com in particular will serve any GTM container to anyone who asks for
   * it by ID, so allowlisting it was strictly weaker than 'self'. It was a deliberate trade
   * for the analytics. With the analytics gone, keeping it would be a trade for nothing.
   *
   * THE CLOUDFLARE RUM BEACON IS DELIBERATELY NOT ALLOWED. Cloudflare injects
   * static.cloudflareinsights.com into every response after this Worker is finished, and this
   * policy blocks it — verified in a browser console, not assumed. Allowing it would buy real
   * Core Web Vitals field data for about 11 KB. That is a genuine offer and it is declined for
   * now: the beacon's cookielessness has not been confirmed against Cloudflare's current
   * terms, and this is the wrong week to add a third-party script back on trust. The tag
   * itself is being turned off at the dashboard so the page stops carrying an inert script it
   * cannot run. Revisit when the confirmation is in — see /privacy, which describes exactly
   * this state rather than a tidier version of it.
   *
   * The rule for editing this: name hosts, never a scheme and never a wildcard. `https:` or
   * `*` in script-src would permit every origin on the internet and read, at a glance, like a
   * tightened policy. scripts/verify-live.mjs fails on either.
   *
   * 'unsafe-inline' PERMITS EVERY INLINE SCRIPT in the document — ours and anyone else's. CSP
   * has no notion of authorship, and an earlier version of this comment claimed it did, which
   * was flattering and false. It is here because the calculators' `define:vars` blocks are
   * inline. It survives GA's removal because those blocks do; what it does not do is admit an
   * off-origin ORIGIN, and that half is now as tight as it can be. Removing it means hashing
   * or noncing every inline block, which is worth doing and is still not done — and it is now
   * the single largest remaining weakness in this header.
   */
  if (isDocument) {
    res.headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        /* NO NAMED HOST. Not one, in any directive. If a host ever needs adding here again,
           the question to answer first is the one GA4 failed: what decision will be made with
           what it returns, that cannot be made without it. */
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        /* Same origin only. The one fetch this site makes is /api/live.json, to itself. */
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join("; "),
    );
  }
  return res;
});
