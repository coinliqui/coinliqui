import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// The canonical origin is supplied at BUILD time and never hardcoded. Canonicals,
// sitemaps, robots and JSON-LD all derive from Astro.site, so the domain is one
// dashboard variable rather than a code change.
//
// Fail closed: a Cloudflare build without SITE_URL would silently emit canonicals and
// a sitemap pointing at a placeholder while the site is reachable on *.pages.dev — the
// exact way indexing starts on a hostname we intend to migrate away from.
const SITE_URL = process.env.SITE_URL;
if (process.env.CF_PAGES && !SITE_URL) {
  throw new Error(
    "SITE_URL is not set. Set it to the canonical origin (e.g. https://example.com) " +
      "in the Pages project's environment variables before deploying.",
  );
}

/**
 * And validate its SHAPE, because a malformed one is the most expensive silent failure in
 * the whole deploy. A trailing slash, an http:// scheme or a www. host all build cleanly
 * and produce a site that looks perfect — while the host guard decides the live domain is
 * NOT canonical and serves `noindex, nofollow` on every page. The symptom is "nothing is
 * indexed", three weeks later, with nothing on the site to see. Twenty seconds of build
 * failure is the cheaper outcome.
 */
if (SITE_URL) {
  const fail = (why) => {
    throw new Error(`SITE_URL is "${SITE_URL}" — ${why}. Expected exactly https://example.com`);
  };
  let u;
  try {
    u = new URL(SITE_URL);
  } catch {
    fail("that is not a URL");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (!local) {
    if (u.protocol !== "https:") fail("it must use https");
    if (u.hostname.endsWith(".pages.dev")) fail("that is a preview hostname, not the canonical domain");
    if (u.hostname.startsWith("www.")) fail("the canonical origin is the apex; www redirects to it");
  }
  if (SITE_URL.endsWith("/")) fail("it must not end in a slash");
  if (u.pathname !== "/" || u.search || u.hash) fail("it must be an origin only, with no path, query or fragment");
}

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // Local placeholder only. Never a *.pages.dev origin: a preview hostname in a
  // canonical is how the wrong URL gets indexed.
  site: SITE_URL || "http://localhost:4321",
  devToolbar: { enabled: false },
});
