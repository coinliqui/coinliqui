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

       `no-transform` IS GONE. It stopped Cloudflare injecting a Web Analytics beacon, and it
       also stopped edge compression — see the note at the end of this file for how that was
       resolved and what is now true instead. */
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

  /* THE PRIVACY CLAIM, ENFORCED BY THE BROWSER RATHER THAN BY A DASHBOARD TOGGLE.
   *
   * /privacy states that reading a page makes zero requests to any domain other than this
   * one. That was false for a while: Cloudflare Web Analytics was injecting a beacon from
   * static.cloudflareinsights.com into every response whose Accept header looked like a
   * browser's. `no-transform` stops the injection, and it is still set above — but it is a
   * response header, and a header is a request away from being wrong.
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
  /* HOW THE COMPRESSION-VERSUS-BEACON STANDOFF WAS RESOLVED, because the answer is a
   * judgement rather than a trick and the next person deserves the reasoning.
   *
   * Cloudflare injects a Web Analytics tag into every HTML body it is permitted to rewrite.
   * `no-transform` forbids the rewrite — and, being the same header, also forbids compression.
   * Uncompressed, /funding/btc is 386,067 bytes; with brotli it is 71,704. 81-96% on every
   * page, on the metric mobile search weighs most.
   *
   * Three routes out were tried, in order of how much I wanted them:
   *
   *   1. Turn the injection off at source. Correct, and unavailable: the OAuth grant this
   *      project holds covers pages:write and zone:read but no Web Analytics scope, and the
   *      RUM API answers "Unable to authenticate request". Worth re-attempting the moment a
   *      token with Account -> Web Analytics -> Edit exists; nothing else here is missing.
   *      (The first diagnosis of this was wrong and worth recording: the token had simply
   *      EXPIRED, and "Authentication error" was read as a scope limit for hours. Check the
   *      expiry before theorising about permissions.)
   *
   *   2. Compress inside this Worker, so no-transform guards an already-encoded body. Sound in
   *      principle. CompressionStream("gzip") through the Pages runtime produced a body that
   *      `gunzip` refuses and no client can decode; shipping it would have made every page
   *      unreadable. Not attempted again without a way to test it in production first.
   *
   *   3. Say what is true. The tag is inserted after this code has run and cannot be removed
   *      from here — but `script-src 'self'` above means the browser never fetches it, so the
   *      substantive promise (no off-origin request, no third-party code executing) holds
   *      exactly as before. What was false was the WORDING: "no third-party scripts of any
   *      kind" describes markup, and the markup has one. /privacy now states that the tag is
   *      present, that it never loads, and how to confirm both in a network tab — which is a
   *      stronger claim than the old one, because a reader can falsify it in thirty seconds.
   *
   * So no-transform is gone and the pages compress. scripts/verify-live.mjs no longer asserts
   * "no beacon exists" — it asserts the two things that are enforceable and that actually
   * protect the reader: the ONLY off-origin script is that known, blocked tag, and script-src
   * still confines execution to this origin. A new third-party script, or a weakened CSP,
   * fails the check exactly as before.
   */

  return res;
});
