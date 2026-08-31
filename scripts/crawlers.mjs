#!/usr/bin/env node
/**
 * WHO IS ACTUALLY FETCHING THIS SITE — and which of them are wearing somebody else's name.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A WORKER SECRET. The weekly report has a crawler section
 * that has never run once: it wants CF_ANALYTICS_TOKEN, and the operator's position — correct,
 * and the reason this file exists instead — is that a long-lived credential sitting inside a
 * service that runs unattended every five minutes is a key being carried around for no good
 * reason. The zone analytics are readable from this machine with the wrangler OAuth token that
 * is already here, so nothing new has to be created and nothing has to be handed to the worker.
 *
 * WHAT IT FOUND ON THE FIRST RUN, 31 August 2026, and why it changed the site's strategy.
 * Twenty-three and a half hours, VERIFIED by Cloudflare:
 *
 *     ChatGPT-User   416   AI Assistant             <- a person asked, ChatGPT fetched
 *     Applebot       205   AI Search
 *     Amazonbot      132   AI Crawler
 *     bingbot         99   Search Engine Crawler
 *     ClaudeBot       43   AI Crawler
 *     OAI-SearchBot   23   Search Engine Crawler
 *     Googlebot       19   Search Engine Crawler
 *
 * Roughly 819 verified AI-side fetches a day against Googlebot's 19 — forty-three to one — on a
 * site whose Search Console shows four clicks a week. None of it appears in Search Console, GA4
 * or the Cloudflare pageview counter, because a crawler does not run JavaScript and therefore
 * never triggers any of the three. The audience was invisible to every instrument the site had.
 *
 * VERIFICATION IS THE POINT, NOT A DETAIL. The same window carried 446 requests claiming to be
 * GPTBot of which TWO were verified, and 178 claiming PerplexityBot of which NONE were. Reading
 * the user-agent alone would have reported "GPTBot is our largest crawler" — a scraper in a
 * costume, presented as OpenAI. Cloudflare's verifiedBotCategory is what separates them, and
 * this script never prints a name without saying which side of that line it fell on.
 *
 *   node scripts/crawlers.mjs
 *
 * ONE DAY, AND THAT IS THE PLAN'S LIMIT RATHER THAN A CHOICE: httpRequestsAdaptiveGroups on the
 * free plan refuses any range wider than 24 hours. The weekly report exists to accumulate what
 * this can only sample.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const HOST = "coinliqui.com";
/* 23.5h, not 24. The API compares against the request instant, so asking for exactly 24 hours
   is a range of "1d and a few hundred microseconds" and is rejected as too wide. Measured. */
const WINDOW_H = 23.5;

const cfg = `${homedir()}/.wrangler/config/default.toml`;
let src = "";
try { src = readFileSync(cfg, "utf8"); } catch {
  console.error(`no ${cfg} — run: npx wrangler login`);
  process.exit(1);
}
const token = (src.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
const expiry = (src.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1];
if (!token) { console.error("no oauth_token in the wrangler config — run: npx wrangler login"); process.exit(1); }
/* The lesson this project learned three times: check the timestamp before concluding anything
   from an API error. An expired token returns a permissions-shaped failure. */
if (expiry && Date.parse(expiry) < Date.now()) {
  console.error(`the wrangler token lapsed ${Math.round((Date.now() - Date.parse(expiry)) / 1000)}s ago.`);
  console.error("wrangler refreshes on LAPSE, so `npx wrangler whoami` will renew it now.");
  process.exit(1);
}

const api = async (url, init = {}) =>
  (await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } })).json();

/* THE ZONE IS RESOLVED BY HOSTNAME, never pasted. A zone id in a script is a value nobody can
   check by reading it, and this project has already shipped one measurement that filtered on
   the wrong opaque identifier and reported an empty result as "nobody visited". */
const zones = await api("https://api.cloudflare.com/client/v4/zones?per_page=50");
const zone = (zones.result || []).find((z) => z.name === HOST);
if (!zone) {
  console.error(`no zone named ${HOST} is visible to this token: ${JSON.stringify(zones.errors || []).slice(0, 200)}`);
  process.exit(1);
}

const since = new Date(Date.now() - WINDOW_H * 3_600_000).toISOString();
const gql = `{viewer{zones(filter:{zoneTag:"${zone.id}"}){httpRequestsAdaptiveGroups(limit:500,filter:{datetime_geq:"${since}"},orderBy:[count_DESC]){count dimensions{userAgent verifiedBotCategory}}}}}`;
const res = await api("https://api.cloudflare.com/client/v4/graphql", { method: "POST", body: JSON.stringify({ query: gql }) });
const groups = res?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
if (!groups) {
  console.error(`no analytics returned: ${JSON.stringify(res.errors || res).slice(0, 300)}`);
  process.exit(1);
}

/* Named so the output is readable, but the LIST IS NOT THE FILTER — everything is counted, and
   anything unnamed lands in "other" rather than vanishing. A crawler this project has not heard
   of is exactly the one worth noticing. */
const NAMED = [
  ["ChatGPT-User", "asks on a person's behalf"], ["GPTBot", "OpenAI training crawl"],
  ["OAI-SearchBot", "OpenAI search index"], ["ClaudeBot", "Anthropic crawl"],
  ["anthropic-ai", "Anthropic crawl"], ["PerplexityBot", "Perplexity"],
  ["Applebot", "Apple"], ["Amazonbot", "Amazon"], ["Bytespider", "ByteDance"],
  ["CCBot", "Common Crawl"], ["meta-external", "Meta"],
  ["Googlebot", "Google search"], ["Google-Extended", "Google AI"],
  ["bingbot", "Bing search"], ["YandexBot", "Yandex"], ["Seznam", "Seznam"],
];
const tally = new Map();
let all = 0, verifiedAll = 0;
for (const g of groups) {
  const ua = g.dimensions.userAgent || "";
  const cat = g.dimensions.verifiedBotCategory || "";
  all += g.count;
  if (cat) verifiedAll += g.count;
  const hit = NAMED.find(([n]) => ua.toLowerCase().includes(n.toLowerCase()));
  const key = hit ? hit[0] : null;
  if (!key) continue;
  const row = tally.get(key) || { verified: 0, unverified: 0, cats: new Set(), note: hit[1] };
  if (cat) { row.verified += g.count; row.cats.add(cat); } else row.unverified += g.count;
  tally.set(key, row);
}

console.log(`\n=== Crawlers · ${HOST} · last ${WINDOW_H}h ===\n`);
console.log(`   ${String(all).padStart(6)}  requests across the top ${groups.length} user agents`);
console.log(`   ${String(verifiedAll).padStart(6)}  of them from a bot Cloudflare could verify\n`);
const rows = [...tally].sort((a, b) => (b[1].verified + b[1].unverified) - (a[1].verified + a[1].unverified));
console.log("   name             verified  claimed only   what it is");
for (const [name, r] of rows) {
  const flag = r.verified === 0 && r.unverified > 0 ? "  <- nothing verified: this is a costume" : "";
  console.log(`   ${name.padEnd(16)} ${String(r.verified).padStart(8)}  ${String(r.unverified).padStart(12)}   ${r.note}${flag}`);
}
const spoofed = rows.reduce((a, [, r]) => a + r.unverified, 0);
console.log(`\n   ${spoofed} request(s) claimed one of these names and could not be verified — ${(100 * spoofed / Math.max(1, all)).toFixed(1)}% of everything.`);
console.log(`   Read the verified column only. A user-agent string is a claim, not a fact.\n`);
console.log(`   Zone resolved by hostname, read with the wrangler OAuth token on this machine.`);
console.log(`   No dashboard, no API token, and nothing handed to the worker.\n`);
