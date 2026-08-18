/**
 * A GIT DATE ON A PAGE THAT MOVES BY ITSELF IS A FALSE SIGNAL, NOT A MISSING ONE.
 *
 * src/lib/sitemap.ts draws the right distinction — DATA routes take the timestamp of the data
 * they display, CODE routes take the commit date of their own source — and then five URLs were
 * filed on the wrong side of it. /tools and its four calculators carried a git date four days
 * stale while the market moved underneath them. The premise in the generator's own comment was
 * "they change when their code changes, never on their own", and it was false for every URL it
 * covered: fetched, left through a snapshot rotation, refetched and diffed with every freshness
 * element stripped, all five bodies had changed.
 *
 * The cost is not one bad date. Google learns whether a host's lastmod can be trusted, and a
 * template that lies about it spends the credibility of the templates that do not.
 *
 * THIS CHECK READS THE RENDERED XML, NOT THE SOURCE. Two earlier versions tried to infer the
 * classification from how the generator was written, and both were wrong: the first missed
 * `{ path, lastmod }` shorthand and flagged every coin URL, the second could not tell
 * `.map(p => ({ path: p, lastmod: codeStamp(p) }))` from the same shape carrying a data stamp.
 * The emitted date settles it with no parsing at all — a git date is exactly the string in
 * lastmod.json, and a data stamp is truncated to the hour, so the two are never confusable.
 *
 * Run standalone for the blind case; the gate calls sitemapLastmodHonesty from the smoke pass,
 * where every sitemap body has already been rendered.
 */
import { readFileSync, existsSync } from "node:fs";
import { sitemapLastmodHonesty } from "./checks.mjs";

const LASTMOD = JSON.parse(readFileSync("src/data/lastmod.json", "utf8"));

/** A route whose page reads a live store cannot honestly claim a commit date. */
export function pagesReadingLiveStores(routes) {
  const out = new Set();
  for (const route of routes) {
    for (const c of [`src/pages${route === "/" ? "/index" : route}.astro`, `src/pages${route}/index.astro`]) {
      if (existsSync(c) && /\bget(Snapshot|Spot|Live)\s*\(/.test(readFileSync(c, "utf8"))) out.add(route);
    }
  }
  return out;
}

const xmlFor = (rows) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n` +
  rows.map(([p, m]) => `  <url><loc>https://coinliqui.com${p}</loc>${m ? `<lastmod>${m}</lastmod>` : ""}</url>`).join("\n") +
  `\n</urlset>\n`;

/* Each route carries its OWN committed date; stamping them all with one route's date
   would test nothing but the table lookup. */
const git = (p) => LASTMOD[p];
const cases = [
  [
    "the defect exactly as it shipped: five live pages on a git date",
    xmlFor(["/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"].map((p) => [p, git(p)])),
    5,
  ],
  ["the same five on an hour-truncated data stamp", xmlFor([["/tools", "2026-08-18T12:00:00.000Z"], ["/tools/position-size", "2026-08-18T12:00:00.000Z"]]), 0],
  ["prose on a git date, which is what git dates are for", xmlFor([["/privacy", git("/privacy")]]), 0],
  ["a live page with no lastmod at all — silence is not a lie", xmlFor([["/tools", null]]), 0],
  ["a sitemap with no URLs", xmlFor([]), 0],
];

/* Importable by the gate for pagesReadingLiveStores without running the cases. */
if (process.argv[1] && process.argv[1].endsWith("sitemap-honesty.mjs")) {
let bad = 0;
for (const [name, body, want] of cases) {
  const routes = [...body.matchAll(/<loc>https:\/\/coinliqui\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
  const got = sitemapLastmodHonesty(body, LASTMOD, pagesReadingLiveStores(routes)).length;
  if (got !== want) bad++;
  console.log(`  ${got === want ? "ok  " : "MISS"}  ${name.padEnd(56)} ${got} flagged, want ${want}`);
}
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  sitemap lastmod: every case behaves, including the two that must stay silent");
}
