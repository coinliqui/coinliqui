#!/usr/bin/env node
/**
 * THE DAILY SERIES OF WHO FETCHES THIS SITE ON A PERSON'S BEHALF — KEPT, BECAUSE CLOUDFLARE
 * FORGETS IT.
 *
 * The one channel with volume (measured 15 October 2026) is AI assistants answering from these
 * pages: ChatGPT-User, verified by Cloudflare, 200–800 fetches a day. The free plan keeps that
 * dataset for 31 days ("cannot request data older than 4w3d"), so a trend that is not written
 * down somewhere is a trend that disappears. This writes it to KV as `ai:series`, one row per
 * closed UTC day, and every run backfills any day still inside the 31 that the series lacks —
 * so a missed day costs nothing as long as somebody runs this within the month.
 *
 * NOT A WORKER JOB, BY DECISION. Reading zone analytics from the worker would need a long-lived
 * Cloudflare token inside it, which the operator ruled out. This uses the wrangler OAuth login
 * already on this machine, as crawlers.mjs and readers.mjs do.
 *
 * VERIFIED ONLY. A user-agent is a claim: on 31 August 446 requests claimed GPTBot and two were
 * verified. Every count here is Cloudflare's verifiedBotCategory, with the agent name read from
 * the user-agent of a verified request.
 *
 *   node scripts/ai-series.mjs           backfill, write, print the series
 *   node scripts/ai-series.mjs --dry     print what would be written, write nothing
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NS = "09d5ddc598f34f36b11d367aac0aad87";
const KEY = "ai:series";
const RETAIN_DAYS = 30; // 31 by the API's own words; one day of margin
const dry = process.argv.includes("--dry");

const src = readFileSync(`${homedir()}/.wrangler/config/default.toml`, "utf8");
const token = (src.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
const expiry = (src.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1];
if (!token || (expiry && Date.parse(expiry) < Date.now())) {
  console.error("the wrangler token is missing or lapsed — run: npx wrangler whoami, then this again");
  process.exit(1);
}
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const zone = (await fetch("https://api.cloudflare.com/client/v4/zones?name=coinliqui.com", { headers: H }).then((r) => r.json())).result?.[0]?.id;
if (!zone) { console.error("could not resolve the coinliqui.com zone"); process.exit(1); }

/* The agents worth a column. Anything else verified still lands in its category total. */
const AGENTS = [["chatgptUser", /ChatGPT-User/i], ["oaiSearch", /OAI-SearchBot/i], ["perplexityUser", /Perplexity-User/i],
  ["claudeUser", /Claude-User/i], ["gptBot", /GPTBot/i], ["googlebot", /Googlebot/i], ["bingbot", /bingbot/i]];

/* Twelve hours at a time: the dataset refuses a range wider than a day. */
async function day(d) {
  const row = { d, aiAssistant: 0, aiCrawler: 0, aiSearch: 0, searchCrawler: 0, otherVerified: 0 };
  for (const k of AGENTS) row[k[0]] = 0;
  for (const [a, b] of [["00:00:00", "12:00:00"], ["12:00:00", null]]) {
    const start = `${d}T${a}Z`;
    const end = b ? `${d}T${b}Z` : new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString();
    const query = `{viewer{zones(filter:{zoneTag:"${zone}"}){httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:"${start}",datetime_lt:"${end}",verifiedBotCategory_neq:""}){count dimensions{userAgent verifiedBotCategory}}}}}`;
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: H, body: JSON.stringify({ query }) }).then((x) => x.json());
    if (r.errors) throw new Error(`${d}: ${r.errors[0].message.slice(0, 160)}`);
    for (const g of r.data.viewer.zones[0].httpRequestsAdaptiveGroups) {
      const cat = g.dimensions.verifiedBotCategory;
      const field = { "AI Assistant": "aiAssistant", "AI Crawler": "aiCrawler", "AI Search": "aiSearch", "Search Engine Crawler": "searchCrawler" }[cat] ?? "otherVerified";
      row[field] += g.count;
      const hit = AGENTS.find(([, re]) => re.test(g.dimensions.userAgent || ""));
      if (hit) row[hit[0]] += g.count;
    }
  }
  return row;
}

const kv = (args) => execFileSync("npx", ["wrangler", "kv", "key", ...args, "--namespace-id", NS, "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let series = [];
try { const raw = kv(["get", KEY]); const i = raw.indexOf("["); if (i >= 0) series = JSON.parse(raw.slice(i)); } catch { /* no series yet */ }
const have = new Set(series.map((r) => r.d));

const today = new Date().toISOString().slice(0, 10);
const want = [];
for (let k = RETAIN_DAYS; k >= 1; k--) {
  const d = new Date(Date.parse(`${today}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
  if (!have.has(d)) want.push(d);
}
for (const d of want) series.push(await day(d));
series.sort((a, b) => a.d.localeCompare(b.d));

if (want.length && !dry) {
  const dir = mkdtempSync(join(tmpdir(), "ai-series-"));
  const file = join(dir, "series.json");
  writeFileSync(file, JSON.stringify(series));
  kv(["put", KEY, "--path", file]);
}
console.log(`\n=== ${KEY}: ${series.length} days, ${want.length} added${dry ? " (dry run, nothing written)" : ""} ===\n`);
console.log("   day         ChatGPT-User  OAI-Search  AI-Assistant(all)  Googlebot  bingbot");
for (const r of series.slice(-35)) {
  console.log(`   ${r.d}  ${String(r.chatgptUser).padStart(12)}  ${String(r.oaiSearch).padStart(10)}  ${String(r.aiAssistant).padStart(17)}  ${String(r.googlebot).padStart(9)}  ${String(r.bingbot).padStart(7)}`);
}
console.log("");
