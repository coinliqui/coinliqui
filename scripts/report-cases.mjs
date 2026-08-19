#!/usr/bin/env node
/**
 * THE SECTION THAT HAD NEVER RUN, AND WOULD HAVE BEEN WRONG WHEN IT DID.
 *
 * Section C of the weekly indexation report counts crawler fetches, and the report's own
 * closing advice calls it the leading indicator: "if they are zero, nothing downstream can
 * move." It had produced no number at all, for two reasons that only measurement found.
 *
 *   1. It asked Cloudflare for a seven-day window. This zone is on the Free plan, which
 *      refuses any range wider than a day. The first credential to arrive would have produced
 *      an error about time ranges, on the section whose failure message is about credentials.
 *
 *   2. It counted user-agent STRINGS. Measured over five days on the live zone: 13,314
 *      requests arrived carrying a named crawler's user-agent, and Cloudflare verified 1,205
 *      of them — 9.1%. Of the rest, 11,882 came from the IP address of the laptop
 *      scripts/verify-live.mjs runs on, which impersonates thirteen crawlers on purpose. The
 *      instrument would have reported this project's own test suite as crawler interest.
 *
 * The first case below is the second defect exactly as it shipped: every request wears a
 * crawler's name, none is verified. An implementation that trusts the string reports 13,330
 * and looks healthy; the correct one reports zero. No test that merely asserted "a table is
 * produced" would separate them, which is why this file exists.
 */
import { tallyCrawlers } from "../worker/report.ts";

const g = (userAgent, count, verifiedBotCategory = "") => ({ count, dimensions: { userAgent, verifiedBotCategory } });

const cases = [
  {
    name: "the defect as it shipped: every name claimed, nothing verified",
    groups: [
      g("GPTBot/1.1", 7507), g("Googlebot/2.1 (+http://www.google.com/bot.html)", 883),
      g("ClaudeBot/1.0", 420), g("PerplexityBot/1.0", 384), g("Claude-SearchBot/1.0", 329),
    ],
    verified: 0,
    claimed: 9523,
  },
  {
    name: "our own harness, wearing the suffix, is still not verified",
    groups: [g("GPTBot/1.1 (+https://coinliqui.com/about; coinliqui-selfcheck)", 79)],
    verified: 0,
    claimed: 79,
  },
  {
    name: "the real shape: a verified minority inside a claimed majority",
    groups: [g("GPTBot/1.1", 7507), g("GPTBot/1.1", 141, "AI Crawler"),
             g("ClaudeBot/1.0", 420), g("ClaudeBot/1.0", 379, "AI Crawler")],
    verified: 520,
    claimed: 8447,
  },
  {
    name: "everything verified — the number the report is built to show",
    groups: [g("Googlebot/2.1", 279, "Search Engine Crawler"), g("bingbot/2.0", 17, "Search Engine Crawler")],
    verified: 296,
    claimed: 296,
  },
  {
    name: "a category string that is falsy-looking but present",
    groups: [g("Applebot/0.1", 32, "AI Search")],
    verified: 32,
    claimed: 32,
  },
  { name: "no traffic at all", groups: [], verified: 0, claimed: 0 },
  {
    name: "unnamed agents are counted in neither column",
    groups: [g("curl/8.7.1", 3378), g("nginx-ssl early hints", 2833), g("Mozilla/5.0", 895)],
    verified: 0,
    claimed: 0,
  },
  {
    /* Documented rather than fixed: Googlebot-Image IS Googlebot for this purpose, and a
       substring match is the reason the table has one row instead of six. */
    name: "Googlebot-Image counts under Googlebot, deliberately",
    groups: [g("Googlebot-Image/1.0", 5, "Search Engine Crawler")],
    verified: 5,
    claimed: 5,
  },
];

let bad = 0;
for (const c of cases) {
  const t = tallyCrawlers(c.groups);
  const okV = t.verifiedTotal === c.verified, okC = t.claimedTotal === c.claimed;
  if (!okV || !okC) bad++;
  console.log(`  ${okV && okC ? "ok  " : "MISS"}  ${c.name.padEnd(58)} verified ${t.verifiedTotal}/${c.verified}  claimed ${t.claimedTotal}/${c.claimed}`);
}

/* THE ROWS MUST AGREE WITH THE TOTALS. A table whose columns do not sum to the printed total
   is the kind of thing a reader trusts and should not. */
const t = tallyCrawlers(cases[2].groups);
if (t.rows.reduce((a, r) => a + r.verified, 0) !== t.verifiedTotal) { console.log("  MISS  rows do not sum to verifiedTotal"); bad++; }
if (t.rows.reduce((a, r) => a + r.claimed, 0) !== t.claimedTotal) { console.log("  MISS  rows do not sum to claimedTotal"); bad++; }

if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  crawler tally: verified is counted, claimed is only reported, and the gap survives every case");
