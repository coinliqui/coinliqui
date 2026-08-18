import type { APIRoute } from "astro";
import { origin } from "../lib/site.ts";

/**
 * THE CONVENTIONAL PATH WAS A 404 CARRYING noindex.
 *
 * This site publishes one sitemap per template — the per-template indexation instrument — so
 * the real entry point is /sitemap-index.xml, and that is what robots.txt advertises. But
 * /sitemap.xml is the path crawlers and webmaster tools probe BY DEFAULT when no directive has
 * been read yet, and Bing Webmaster Tools in particular checks it. Here it returned a 404 HTML
 * error page, 14KB of it, carrying `noindex, follow` — so the first thing a tool looking for
 * this site's sitemap in the conventional place found was a dead end.
 *
 * A 301 rather than serving the index at both paths: two URLs answering with the same document
 * is the duplicate the rest of this codebase spends its time avoiding, and a redirect tells a
 * crawler where the real one lives rather than quietly having two.
 */
export const GET: APIRoute = ({ site }) =>
  new Response(null, {
    status: 301,
    headers: {
      location: `${origin(site)}/sitemap-index.xml`,
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
