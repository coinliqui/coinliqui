import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// The canonical origin is supplied at BUILD time and never hardcoded. Canonicals,
// sitemaps, robots and JSON-LD all derive from Astro.site, so the domain is one
// dashboard variable rather than a code change.
//
// THE FALLBACK IS THE CANONICAL ORIGIN, BECAUSE THERE IS NO CASE WHERE THIS SITE SHOULD
// PUBLISH ANYTHING ELSE.
//
// This used to fall back to http://localhost:4321, guarded by `if (process.env.CF_PAGES &&
// !SITE_URL) throw` — fail closed, but only on Cloudflare, which was the only build path when
// it was written. Moving deployment to direct upload moved the build onto a laptop, where
// CF_PAGES is unset, the guard is inert BY DESIGN, and the fallback is silent. The site then
// served http://localhost:4321 as the canonical on every page for about eight hours, along
// with og:url, the JSON-LD @id, every URL in /llms.txt, the Canonical line of security.txt and
// — worst — sitemap-index.xml, which is how a crawler reaches all 78 URLs.
//
// A guard whose precondition is an ENVIRONMENT protects a hypothesis about where the build
// runs. The artifact is what ships. So the failure mode is removed rather than guarded: the
// default is the real origin, SITE_URL remains an override for anyone who needs one, and
// scripts/no-localhost.mjs refuses to deploy a dist/ carrying a placeholder either way.
//
// Dev is unaffected in the way that matters — `astro dev` output is never indexed, and an
// absolute URL pointing at production during local development is harmless and more honest
// than one pointing at a port.
const CANONICAL_ORIGIN = "https://coinliqui.com";
const SITE_URL = process.env.SITE_URL || CANONICAL_ORIGIN;

// A preview hostname in a canonical is how indexing starts on a host we intend to migrate away
// from, so it is refused explicitly rather than trusted not to be passed.
if (/\.pages\.dev$/.test(new URL(SITE_URL).host)) {
  throw new Error(
    `SITE_URL is ${SITE_URL}. A *.pages.dev origin must never reach a canonical; ` +
      `use the custom domain (${CANONICAL_ORIGIN}) or leave SITE_URL unset.`,
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
  site: SITE_URL,
  devToolbar: { enabled: false },
});
