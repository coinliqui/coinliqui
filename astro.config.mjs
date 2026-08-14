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

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // Local placeholder only. Never a *.pages.dev origin: a preview hostname in a
  // canonical is how the wrong URL gets indexed.
  site: SITE_URL || "http://localhost:4321",
  devToolbar: { enabled: false },
});
