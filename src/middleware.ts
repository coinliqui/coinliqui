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

       `no-transform` is on both: this site publishes that it loads no third-party scripts,
       and no-transform is the standard way to tell an intermediary not to rewrite the body,
       which is how injected analytics beacons arrive. */
    const personal = ctx.cookies.has("rail");
    res.headers.set(
      "cache-control",
      personal ? "private, no-store, no-transform" : "public, s-maxage=120, stale-while-revalidate=600, no-transform",
    );
    res.headers.append("vary", "cookie");
  }

  // The rail toggle sets a cookie and redirects; a shared cache must never hold that.
  if (ctx.url.pathname === "/rail") {
    res.headers.set("cache-control", "no-store");
  }

  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");

  /* THE PRIVACY CLAIM, ENFORCED BY THE BROWSER RATHER THAN BY A DASHBOARD TOGGLE.
   *
   * /privacy states that reading a page makes zero requests to any domain other than this
   * one. That was false for a while: Cloudflare Web Analytics was injecting a beacon from
   * static.cloudflareinsights.com into every response whose Accept header looked like a
   * browser's. `no-transform` stops the injection, and the RUM API cannot be reached with
   * the credentials available here — so the toggle is still on at the zone, and the claim
   * currently rests on one response header nobody would think to protect.
   *
   * A CSP makes it structural instead. `script-src 'self'` means an injected third-party
   * script is never fetched and never runs, whoever turns what on. The claim then holds
   * because the browser enforces it, not because a setting happens to be in the right state.
   *
   * 'unsafe-inline' is required and is NOT a hole here: the calculators ship their inputs as
   * inline `define:vars` scripts, and Astro emits scoped CSS inline. What matters for the
   * claim is the ORIGIN allowlist, and no external origin is permitted at all.
   */
  if (isDocument) {
    res.headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
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
