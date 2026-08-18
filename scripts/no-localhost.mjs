/**
 * NOTHING WITH A LOCALHOST ORIGIN MAY BE DEPLOYED.
 *
 * astro.config fails closed when a CLOUDFLARE build has no SITE_URL — `if (process.env.CF_PAGES
 * && !SITE_URL) throw`. That guard was written for the only build path that existed at the time.
 * Moving deployment to direct upload moved the build onto a laptop, where CF_PAGES is unset, the
 * guard is inert by design, and `site` silently falls back to http://localhost:4321.
 *
 * The result shipped and stayed live for about eight hours: EVERY canonical on the site said
 * http://localhost:4321, and so did og:url, the JSON-LD @id, every URL in /llms.txt, the
 * Canonical and Policy lines of security.txt, and — worst of the set — sitemap-index.xml, which
 * is how a crawler reaches all 78 URLs. A canonical pointing at an unfetchable host is the most
 * damaging single line this site can publish, and it was published by the change that was
 * supposed to keep deployment working.
 *
 * So the check is on the ARTIFACT rather than on the environment, because the artifact is the
 * thing that gets deployed and it cannot lie about what it contains.
 *
 *   node scripts/no-localhost.mjs          check dist/
 *   node scripts/no-localhost.mjs --blind  prove it catches the build that shipped
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BAD = /(localhost|127\.0\.0\.1)(:\d+)?/;
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

if (process.argv.includes("--blind")) {
  const cases = [
    ['<link rel="canonical" href="http://localhost:4321/">', true, "the canonical that shipped"],
    ['<loc>http://localhost:4321/sitemaps/pages.xml</loc>', true, "the sitemap index that shipped"],
    ['Canonical: http://127.0.0.1:8788/.well-known/security.txt', true, "an IP form"],
    ['<link rel="canonical" href="https://coinliqui.com/">', false, "the correct canonical"],
    ['const dev = import.meta.env.DEV;', false, "ordinary code with no origin"],
  ];
  let bad = 0;
  for (const [text, want, name] of cases) {
    const got = BAD.test(text);
    if (got !== want) bad++;
    console.log(`  ${got === want ? "ok  " : "MISS"}  ${name.padEnd(34)} ${got ? "flagged" : "clean"}`);
  }
  console.log(bad ? `\n  ${bad} wrong` : "\n  the artifact check sees the exact bytes that shipped");
  process.exit(bad ? 1 : 0);
}

const files = walk("dist");
const hits = [];
for (const f of files) {
  if (!/\.(js|mjs|html|xml|txt|json)$/.test(f)) continue;
  const src = readFileSync(f, "utf8");
  const m = src.match(BAD);
  if (m) hits.push(`${f}: ${src.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}`);
}
if (hits.length) {
  console.error(`REFUSING TO DEPLOY — ${hits.length} file(s) in dist/ carry a localhost origin.`);
  console.error("Build with SITE_URL set: SITE_URL=https://coinliqui.com npm run build");
  for (const h of hits.slice(0, 5)) console.error("  " + h);
  process.exit(1);
}
console.log(`no-localhost: ${files.length} built file(s), none carrying a localhost origin`);
