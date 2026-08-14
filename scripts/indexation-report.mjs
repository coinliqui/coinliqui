#!/usr/bin/env node
/**
 * Weekly indexation report.
 *
 * Three sections, deliberately independent: each degrades to a stated reason rather than
 * failing the run, because the useful property of a weekly instrument is that it always
 * produces something readable on the day, not that it is complete.
 *
 *   A. COVERAGE      no credentials. The denominator: what exists, per template, and
 *                    whether a crawler can still fetch all of it.
 *   B. SEARCH        GSC service account. Indexed share per template, position, impressions.
 *   C. CRAWLERS      Cloudflare token with Analytics:Read. Who actually fetched.
 *
 *   node scripts/indexation-report.mjs [--out reports/]
 *
 * Credentials, both optional:
 *   GSC_SA_KEY   the service account JSON, verbatim (one line is fine)
 *   CF_ANALYTICS_TOKEN + CF_ZONE_ID
 *
 * The sitemaps ARE the template split — one file per template by construction — so the
 * grouping here is not a second definition that can drift from the site's own.
 */
import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const ORIGIN = process.env.SITE_ORIGIN || "https://coinliqui.com";
const SITE = `sc-domain:${new URL(ORIGIN).hostname}`;
const OUT = (process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "reports").replace(/\/$/, "");
const UA = "GPTBot/1.1";
const now = new Date();
const stamp = `${now.getUTCFullYear()}-W${String(Math.ceil(((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)).padStart(2, "0")}`;

const out = [];
const say = (s = "") => out.push(s);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");

/* ------------------------------------------------------------------ A. coverage */
async function get(path, ua = UA) {
  const r = await fetch(ORIGIN + path, { headers: { "user-agent": ua } });
  return { status: r.status, body: await r.text() };
}
const templates = [];
{
  const idx = await get("/sitemap-index.xml");
  const maps = [...idx.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  for (const m of maps) {
    const b = await get(m);
    const urls = [...b.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => new URL(x[1]).pathname);
    templates.push({ name: m.replace("/sitemaps/", "").replace(".xml", ""), urls });
  }
}
say(`# Indexation — ${stamp}`);
say(`\n${ORIGIN} · generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC\n`);
say("## A. Coverage\n");
say("What exists, and whether a crawler can still fetch it. No credentials — this section always runs.\n");
say("| Template | URLs | Fetchable as GPTBot | Median numbers in HTML |");
say("|---|---:|---:|---:|");
let totalUrls = 0, totalOk = 0;
for (const t of templates) {
  let ok = 0; const nums = [];
  for (const u of t.urls) {
    const r = await get(u || "/");
    if (r.status === 200) { ok++; nums.push((r.body.match(/[$][0-9][0-9,]*\.?[0-9]*|\d+\.\d+%/g) || []).length); }
  }
  nums.sort((a, b) => a - b);
  totalUrls += t.urls.length; totalOk += ok;
  t.ok = ok;
  say(`| \`${t.name}\` | ${t.urls.length} | ${ok}/${t.urls.length} | ${nums.length ? nums[nums.length >> 1] : 0} |`);
}
say(`| **total** | **${totalUrls}** | **${totalOk}/${totalUrls}** | |`);
if (totalOk < totalUrls) say(`\n**${totalUrls - totalOk} URLs are not fetchable by a crawler.** Nothing below matters until that is zero.`);

/* ------------------------------------------------------------------ B. search console */
say("\n## B. Search Console\n");
async function gscToken() {
  const raw = process.env.GSC_SA_KEY;
  if (!raw) throw new Error("GSC_SA_KEY is not set");
  const key = JSON.parse(raw);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: iat + 3600, iat,
  };
  const body = `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claim)}`;
  const sig = createSign("RSA-SHA256").update(body).end().sign(key.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token exchange failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}
try {
  const tok = await gscToken();
  const api = async (url, payload) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  };

  // Indexed share per template, from URL Inspection — 42 URLs is well inside the 2000/day quota.
  say("### Indexed share, per template\n");
  say("| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Other |");
  say("|---|---:|---:|---:|---:|");
  for (const t of templates) {
    const tally = { PASS: 0, NEUTRAL: 0, FAIL: 0, other: 0 };
    const verdictOf = (v) => (v === "PASS" ? "PASS" : v === "NEUTRAL" ? "NEUTRAL" : v === "FAIL" ? "FAIL" : "other");
    for (const u of t.urls) {
      const j = await api("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        { inspectionUrl: ORIGIN + u, siteUrl: SITE });
      const st = j?.inspectionResult?.indexStatusResult;
      tally[verdictOf(st?.verdict)]++;
      t.state = t.state || {};
      const c = st?.coverageState || "unknown";
      t.state[c] = (t.state[c] || 0) + 1;
    }
    t.indexed = tally.PASS;
    say(`| \`${t.name}\` | ${tally.PASS}/${t.urls.length} (${pct(tally.PASS, t.urls.length)}) | ${tally.NEUTRAL} | ${tally.FAIL} | ${tally.other} |`);
  }
  say("\nCoverage states seen:\n");
  for (const t of templates) if (t.state) say(`- \`${t.name}\`: ${Object.entries(t.state).map(([k, v]) => `${k} ×${v}`).join(", ")}`);

  // Position and impressions, last 7 days, grouped by the same template split.
  const end = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);   // GSC lags ~2 days
  const start = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  const sa = await api(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
    { startDate: start, endDate: end, dimensions: ["page"], rowLimit: 500 });
  const rows = sa.rows || [];
  say(`\n### Search performance, ${start} to ${end}\n`);
  if (!rows.length) {
    say("No impressions yet. Expected before roughly week 4 — a new domain has no history for Google to weigh.");
  } else {
    say("| Template | Impressions | Clicks | Avg position | Pages with impressions |");
    say("|---|---:|---:|---:|---:|");
    for (const t of templates) {
      const set = new Set(t.urls.map((u) => ORIGIN + (u || "/")));
      const r = rows.filter((x) => set.has(x.keys[0]));
      const imp = r.reduce((a, x) => a + x.impressions, 0);
      const clk = r.reduce((a, x) => a + x.clicks, 0);
      const pos = imp ? r.reduce((a, x) => a + x.position * x.impressions, 0) / imp : 0;
      say(`| \`${t.name}\` | ${imp} | ${clk} | ${pos ? pos.toFixed(1) : "—"} | ${r.length}/${t.urls.length} |`);
    }
    const q = await api(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
      { startDate: start, endDate: end, dimensions: ["query"], rowLimit: 25 });
    if (q.rows?.length) {
      say("\n### Top queries\n");
      say("| Query | Impressions | Clicks | Position |");
      say("|---|---:|---:|---:|");
      for (const r of q.rows.slice(0, 15)) say(`| ${r.keys[0]} | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);
    }
  }
} catch (e) {
  say(`Not available: ${e.message}.\n`);
  say("To enable: create a Google Cloud service account, enable the Search Console API, then add the");
  say("service account's email as a **full user** on the `coinliqui.com` Domain property in Search");
  say("Console. Put the JSON key in the `GSC_SA_KEY` secret. Nothing about the site changes.");
}

/* ------------------------------------------------------------------ C. crawlers */
say("\n## C. Crawler fetches\n");
try {
  const tok = process.env.CF_ANALYTICS_TOKEN, zone = process.env.CF_ZONE_ID;
  if (!tok || !zone) throw new Error("CF_ANALYTICS_TOKEN or CF_ZONE_ID is not set");
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const q = {
    query: `query($zone:String!,$since:Time!){viewer{zones(filter:{zoneTag:$zone}){
      httpRequestsAdaptiveGroups(limit:200, filter:{datetime_geq:$since}, orderBy:[count_DESC]){
        count dimensions{userAgent} }}}}`,
    variables: { zone, since },
  };
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify(q),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  const groups = j.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
  const WANT = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
    "PerplexityBot", "Perplexity-User", "Googlebot", "bingbot", "Applebot", "Amazonbot"];
  say("Last 7 days, from Cloudflare's edge. Aggregate request metrics the host already keeps —");
  say("no script, no cookie, nothing added to the page.\n");
  say("| Crawler | Requests |");
  say("|---|---:|");
  let any = false;
  for (const w of WANT) {
    const n = groups.filter((g) => (g.dimensions?.userAgent || "").includes(w)).reduce((a, g) => a + g.count, 0);
    if (n) any = true;
    say(`| ${w} | ${n || "—"} |`);
  }
  if (!any) say("\nNo named crawler seen yet. Normal in the first fortnight; if it persists past week 3, re-run `verify-live.mjs` before assuming it is a ranking problem.");
} catch (e) {
  say(`Not available: ${e.message}.\n`);
  say("To enable: a Cloudflare token scoped to this zone with **Analytics → Read**, in the");
  say("`CF_ANALYTICS_TOKEN` secret, plus `CF_ZONE_ID`. If the free plan does not expose a");
  say("user-agent dimension, the same numbers are readable by eye in the dashboard under");
  say("**AI Crawl Control**, which is per-crawler and free.");
}

/* ------------------------------------------------------------------ what to look at */
say("\n## What to read first\n");
say("1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.");
say("2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently");
say("   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.");
say("3. **Position before impressions.** Impressions on a new domain arrive late and jump around;");
say("   average position per template moves earlier and more honestly.");
say("4. **Crawler fetches are the leading indicator of all of it.** If they are zero, nothing");
say("   downstream can move, and the cause is access rather than quality.");

mkdirSync(OUT, { recursive: true });
const file = `${OUT}/indexation-${stamp}.md`;
writeFileSync(file, out.join("\n") + "\n");
console.log(out.join("\n"));
console.error(`\nwritten: ${file}`);
