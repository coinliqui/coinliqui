#!/usr/bin/env node
/**
 * WHAT SEARCH CONSOLE ACTUALLY SAYS — the only feedback loop on whether any of this reaches
 * anyone. Everything else in this repository measures what we SERVE; this measures what was
 * received, indexed and queried.
 *
 * Auth is a signed JWT exchanged for an access token, using node:crypto — no dependency, and
 * no OAuth dance, because a service account does not need one.
 *
 * THE KEY IS NEVER READ FROM THE REPOSITORY. It comes from GSC_SA_KEY in the environment
 * (the same JSON that is stored as the worker secret). A key committed anywhere is a key that
 * has to be rotated, and this project has already had one address harvested out of git.
 *
 *   GSC_SA_KEY="$(cat key.json)" node scripts/gsc-report.mjs
 */
import { createSign } from "node:crypto";

const raw = process.env.GSC_SA_KEY;
if (!raw) { console.error("GSC_SA_KEY is not set — export the service-account JSON into it."); process.exit(1); }
const key = JSON.parse(raw);
const SITE = "sc-domain:coinliqui.com";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

async function token(scope = "https://www.googleapis.com/auth/webmasters") {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope, aud: key.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).end().sign(key.private_key, "base64url");
  const r = await fetch(key.token_uri, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token exchange failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const t = await token();
const api = (url, body) => fetch(url, {
  method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
  body: JSON.stringify(body),
}).then((r) => r.json());

const sa = (body) => api(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, body);
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const RANGE = { startDate: day(28), endDate: day(1) };

console.log(`\n=== Search Console · ${SITE} · ${RANGE.startDate} to ${RANGE.endDate} ===\n`);

/* 1. Is there any search presence at all? */
const totals = await sa({ ...RANGE, rowLimit: 1 });
if (totals.error) { console.error(`  API error: ${totals.error.code} ${totals.error.message}`); process.exit(1); }
const T = totals.rows?.[0];
console.log("1. totals");
console.log(T
  ? `   impressions ${T.impressions}  clicks ${T.clicks}  ctr ${(T.ctr * 100).toFixed(2)}%  avg position ${T.position.toFixed(1)}`
  : "   no search data in this window — the property is verified but nothing has been served in results yet");

/* 2. Which queries do we appear for AT ALL. The site is four days old, so the honest
      expectation is few or none; printing zero is a finding, not a failure. */
const q = await sa({ ...RANGE, dimensions: ["query"], rowLimit: 25 });
console.log("\n2. queries we appear for");
if (!q.rows?.length) console.log("   none yet");
else for (const r of q.rows) console.log(`   ${String(r.impressions).padStart(5)} imp  ${String(r.clicks).padStart(3)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`);

/* 3. Which PAGES are getting impressions, grouped by template — the number that says whether
      the fifty contract pages are earning anything or whether one page carries the site. */
const pages = await sa({ ...RANGE, dimensions: ["page"], rowLimit: 200 });
const tpl = (u) => {
  const p = new URL(u).pathname;
  if (/^\/funding\/[^/]+$/.test(p)) return "/funding/{symbol}";
  if (/^\/coins\/[^/]+$/.test(p)) return "/coins/{coin}";
  return p;
};
console.log("\n3. impressions by template");
if (!pages.rows?.length) console.log("   none yet");
else {
  const agg = new Map();
  for (const r of pages.rows) {
    const k = tpl(r.keys[0]);
    const a = agg.get(k) ?? { imp: 0, clk: 0, n: 0 };
    a.imp += r.impressions; a.clk += r.clicks; a.n++;
    agg.set(k, a);
  }
  for (const [k, a] of [...agg].sort((x, y) => y[1].imp - x[1].imp)) {
    console.log(`   ${String(a.imp).padStart(5)} imp  ${String(a.clk).padStart(3)} clk  ${String(a.n).padStart(3)} url(s)  ${k}`);
  }
}

/* 4. IS THERE RUSSIAN-LANGUAGE DEMAND, AND HOW MUCH — the number a second locale has to be
      decided on, and the one this report could not answer for its whole life.

      TWO INSTRUMENTS, BECAUSE ONE OF THEM IS ONLY A PROXY AND SAYING SO IS THE POINT.

      Search Console has no language dimension. It has `country`, which is where the reader
      was, not what they speak: a Russian speaker in Berlin is `deu` and an English speaker in
      Moscow is `rus`. Aggregating the CIS therefore UNDERSTATES the diaspora and OVERSTATES
      the domestic English reader, in unknown proportions, and a single number carrying both
      errors under a label saying "Russian" would be exactly the defect this codebase keeps
      finding in itself — a name asserting something its expression does not compute.

      So the query text is read first, because it is direct evidence rather than a proxy: a
      query containing Cyrillic was typed by someone writing Russian, wherever they sat. The
      country split is printed after it as context, labelled as the proxy it is.

      WHAT THE ZERO CASE MEANS, and it is the likely one. This site publishes nothing in
      Russian, so Google has almost nothing to match a Russian query against. A near-zero
      reading here is therefore NOT evidence that the demand is absent — it is evidence that
      we do not serve it. What it does establish is a BASELINE: run this before the /ru/ tree
      exists, and the same figure a month after it ships is the only honest measure of whether
      the second locale earned its maintenance cost. That is the reason to record it now. */
const CYR = /[Ѐ-ӿ]/;
/* Where Russian is a primary or widely-used language of search. Deliberately the narrow list:
   adding every country with a Russian-speaking minority would inflate the number with readers
   who searched in something else. ISO-3166-1 alpha-3, which is what the API returns. */
const RU_MARKETS = new Set(["rus", "ukr", "blr", "kaz", "uzb", "kgz", "tjk", "tkm", "aze", "arm", "geo", "mda", "isr", "lva", "est", "ltu"]);

const qAll = await sa({ ...RANGE, dimensions: ["query"], rowLimit: 1000 });
console.log("\n4. Russian-language demand");
{
  const rows = qAll.rows ?? [];
  const cyr = rows.filter((r) => CYR.test(r.keys[0]));
  const impAll = rows.reduce((n, r) => n + r.impressions, 0);
  const impCyr = cyr.reduce((n, r) => n + r.impressions, 0);
  const clkCyr = cyr.reduce((n, r) => n + r.clicks, 0);
  if (!rows.length) console.log("   no query data in this window — nothing to read either way");
  else {
    const share = impAll ? ((impCyr / impAll) * 100).toFixed(1) : "0.0";
    console.log(`   queries in Cyrillic: ${cyr.length} of ${rows.length} returned  ·  ${impCyr} imp (${share}% of ${impAll})  ·  ${clkCyr} clk`);
    if (!cyr.length) console.log("   BASELINE ZERO — expected while the site publishes no Russian. Re-read this line a month after /ru/ ships.");
    for (const r of cyr.slice(0, 15)) console.log(`   ${String(r.impressions).padStart(5)} imp  ${String(r.clicks).padStart(3)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`);
  }
}

/* The proxy, printed second and labelled. */
const geo = await sa({ ...RANGE, dimensions: ["country"], rowLimit: 50 });
console.log("\n   by country — a PROXY for language, not a measure of it");
if (!geo.rows?.length) console.log("   none yet");
else {
  const impAll = geo.rows.reduce((n, r) => n + r.impressions, 0);
  const ru = geo.rows.filter((r) => RU_MARKETS.has(r.keys[0]));
  const impRu = ru.reduce((n, r) => n + r.impressions, 0);
  for (const r of geo.rows.slice(0, 12)) {
    const mark = RU_MARKETS.has(r.keys[0]) ? "*" : " ";
    console.log(`  ${mark}${String(r.impressions).padStart(5)} imp  ${String(r.clicks).padStart(3)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`);
  }
  console.log(`   * Russian-language markets: ${impRu} imp of ${impAll} (${impAll ? ((impRu / impAll) * 100).toFixed(1) : "0.0"}%) across ${ru.length} countries`);
}

/* 5. INDEXED SHARE PER TEMPLATE, by inspecting a sample of each. URL Inspection is quota-
      limited (2000/day, 600/min), so this samples rather than sweeps — and SAYS it samples,
      because "5 of 5 indexed" read as a statement about fifty pages would be a lie. */
const sitemapUrls = await fetch("https://coinliqui.com/sitemap-index.xml").then((r) => r.text())
  .then(async (idx) => {
    const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const out = [];
    for (const m of maps) {
      const b = await fetch(m).then((r) => r.text());
      out.push(...[...b.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]));
    }
    return out;
  });

const byTpl = new Map();
for (const u of sitemapUrls) {
  const k = tpl(u);
  if (!byTpl.has(k)) byTpl.set(k, []);
  byTpl.get(k).push(u);
}
const SAMPLE = Number(process.argv[process.argv.indexOf("--sample") + 1]) || 3;
console.log(`\n5. index status — sampling up to ${SAMPLE} URL(s) per template of ${sitemapUrls.length} in the sitemaps`);
for (const [k, urls] of [...byTpl].sort((a, b) => b[1].length - a[1].length)) {
  const pick = urls.slice(0, SAMPLE);
  const states = [];
  for (const u of pick) {
    const r = await api("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: u, siteUrl: SITE });
    if (r.error) { states.push(`ERR ${r.error.code}`); continue; }
    const s = r.inspectionResult?.indexStatusResult ?? {};
    states.push(s.coverageState ?? s.verdict ?? "?");
  }
  const indexed = states.filter((s) => /indexed/i.test(s) && !/not indexed/i.test(s)).length;
  console.log(`   ${String(indexed).padStart(2)}/${String(pick.length).padEnd(2)} indexed  ${String(urls.length).padStart(3)} url(s) total  ${k}`);
  const distinct = [...new Set(states)];
  if (distinct.some((s) => !/^Submitted and indexed$/.test(s))) console.log(`        states: ${distinct.join(" · ")}`);
}
console.log("");
