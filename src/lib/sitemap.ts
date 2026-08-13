import { SITE } from "./site.ts";
/** One sitemap file per page template — the per-template indexation-rate instrument in Search Console. */
export function xml(paths: string[], lastmod?: number): Response {
  const mod = new Date(lastmod ?? Date.now()).toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${SITE.url}${p}</loc><lastmod>${mod}</lastmod></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
