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
    /* THE RAIL COOKIE MAKES THE RESPONSE PERSONAL.
       Every page reads the `rail` cookie on the server to decide whether the navigation is
       collapsed, and every page was being sent `public, s-maxage=120` with no Vary. Nothing
       broke, because Cloudflare does not cache HTML unless a Cache Rule says so — which is
       precisely what makes it dangerous: the bug is armed and waiting for whoever adds that
       rule, and the symptom would be visitors seeing each other's navigation state.

       So the two cases are separated at the source. A request carrying the cookie gets a
       response nothing may share. A request without it — every crawler, and every first-time
       visitor — gets the cacheable one.

       `no-transform` is not set and must not be: it forbids edge compression, and brotli is
       worth 81-96% on every page here. It was once set to stop an injected analytics beacon,
       back when this site claimed to load no third-party scripts. That claim is retired. */
    const personal = ctx.cookies.has("rail");
    res.headers.set(
      "cache-control",
      personal ? "private, no-store" : "public, s-maxage=120, stale-while-revalidate=600",
    );
    res.headers.append("vary", "cookie");
  }

  // The rail toggle sets a cookie and redirects; a shared cache must never hold that.
  if (ctx.url.pathname === "/rail") {
    res.headers.set("cache-control", "no-store");
  }

  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");

  /* THE CSP, WHICH NO LONGER DEFENDS A MARKETING CLAIM AND STILL EARNS ITS PLACE.
   *
   * It used to exist to make "no third-party scripts" true by force — script-src 'self',
   * nothing else, so an injected analytics beacon could not run. That policy is retired: this
   * site runs Google Analytics 4 deliberately, and the CSP now names the hosts GA needs and
   * refuses everything else.
   *
   * Which is the part worth keeping. The threat a CSP is actually for is an origin nobody
   * chose — a compromised dependency, an injected tag, a rewriting proxy. An allowlist of two
   * named Google hosts stops all of that exactly as well as 'self' alone did; what it does not
   * do is stop the analytics we asked for. The directives that carry that weight are the ones
   * NOT relaxed: object-src 'none', base-uri 'self', frame-ancestors 'none', form-action
   * 'self', default-src 'self'. Those are the anti-injection half and none of them moved.
   *
   * The rule for editing this: name hosts, never a scheme and never a wildcard. `https:` or
   * `*` in script-src would permit every origin on the internet and read, at a glance, like a
   * tightened policy. scripts/verify-live.mjs fails on either.
   *
   * 'unsafe-inline' is required and is not the hole it looks like: the calculators ship their
   * inputs as inline `define:vars` scripts, Astro emits scoped CSS inline, and the GA config
   * call is inline. It permits inline code we authored, not off-origin code we did not.
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
