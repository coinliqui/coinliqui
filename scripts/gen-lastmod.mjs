#!/usr/bin/env node
/**
 * Real last-modified dates for the routes whose content is CODE, not data.
 *
 * Taken from git: the commit that last touched the page's own source, or the data file it
 * is built from. Written to src/data/lastmod.json and committed, rather than computed at
 * build time — Cloudflare Pages does a shallow clone, so `git log` on a build machine is
 * not reliably able to answer this.
 *
 * DELIBERATELY NOT INCLUDED: the layout. A change to Base.astro touches every page's
 * markup, but a chrome tweak is not a content change and stamping forty-two URLs as
 * modified because a gridline moved is the fake signal this file exists to avoid.
 *
 *   node scripts/gen-lastmod.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** route -> the sources that genuinely determine what a reader sees on it */
const ROUTES = {
  "/methodology": ["src/pages/methodology/index.astro"],
  "/methodology/liquidations": ["src/pages/methodology/liquidations.astro"],
  "/data-sources": ["src/pages/data-sources.astro"],
  "/privacy": ["src/pages/privacy.astro"],
  "/tools": ["src/pages/tools/index.astro"],
  "/tools/liquidation-price": ["src/pages/tools/liquidation-price.astro", "src/lib/margin.ts"],
  "/tools/position-size": ["src/pages/tools/position-size.astro", "src/lib/margin.ts"],
  "/tools/leverage": ["src/pages/tools/leverage.astro", "src/lib/margin.ts"],
  "/tools/funding-cost": ["src/pages/tools/funding-cost.astro", "src/lib/funding.ts"],
  "/tools/funding-arbitrage": ["src/pages/tools/funding-arbitrage.astro", "src/lib/funding.ts"],
  "/unlocks": ["src/pages/unlocks.astro", "src/data/vesting-contracts.json"],
  // Frozen by design: the window never moves, so this date is the truest lastmod on the site.
  "/liquidations/sweep": ["src/pages/liquidations/sweep.astro", "src/data/sweep-2026-02.json"],
};

const dateOf = (files) => {
  let newest = 0;
  for (const f of files) {
    try {
      const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", f], { encoding: "utf8" }).trim();
      if (iso) newest = Math.max(newest, Date.parse(iso));
    } catch { /* a file with no history yet contributes nothing */ }
  }
  return newest || null;
};

const out = {};
for (const [route, files] of Object.entries(ROUTES)) {
  const t = dateOf(files);
  if (t) out[route] = new Date(t).toISOString();
}
writeFileSync("src/data/lastmod.json", JSON.stringify(out, null, 2) + "\n");
for (const [r, d] of Object.entries(out)) console.log(`  ${d.slice(0, 10)}  ${r}`);
console.log(`\n${Object.keys(out).length} routes written to src/data/lastmod.json`);
