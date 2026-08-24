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

/* ============================================================================================
 * THE STEP THAT COULD HOLD THE INGEST FOREVER.
 *
 * stepReport returns a label when it did work, and worker/ingest.ts reads a label as "the
 * report has this tick": it throws SKIP_SWEEPS, so the flip precompute, the IndexNow step and
 * all four candle sweeps stand aside. That is correct for the twenty minutes a run takes.
 *
 * The coverage phase decided "the sitemaps have not been fetched yet" by asking whether the
 * template list was empty. A sitemap-index answering with anything that is not parseable XML —
 * a 5xx HTML error page, a challenge interstitial, an empty body — matches no <loc>, so the
 * list stays empty, so the next tick asks again. Truthy every time. One bad response from our
 * own edge stopped chart ingest until the following Monday, with /status showing a healthy
 * report in progress and every page ageing quietly.
 *
 * Exercised against the real stepReport with a stubbed KV and a stubbed edge, because the
 * defect is in the loop and not in any single call.
 * ========================================================================================== */
/* ===================================================================================
   THE SUMMARY TABLE AND THE DETAIL TABLE BENEATH IT DISAGREED, AND THE SUMMARY WAS WRONG.

   Section B counted Google's VERDICT enum into columns headed "Crawled, not indexed" and
   "Discovered, not crawled". The verdict says whether indexing succeeded; it carries nothing
   about crawling. Taken from the live 2026-W34 report: the `funding-symbols` row read
   "8 crawled, not indexed" while the per-URL table under it — which prints coverageState
   verbatim — showed seven Discovered and one unknown. Zero crawled.

   Those three states prescribe opposite work, so this is not a cosmetic mislabel: acting on
   the summary meant rewriting fifty pages Google had never fetched.

   The first case is that row exactly as it shipped. An implementation reading the verdict puts
   all eight in "crawled"; the correct one puts none there.
   =================================================================================== */
import { coverageBucket } from "../worker/report.ts";
{
  const W34 = [
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "Discovered - currently not indexed", "discovered"],
    ["NEUTRAL", "URL is unknown to Google", "unknown"],
  ];
  const other = [
    ["PASS", "Submitted and indexed", "indexed"],
    ["PASS", "Indexed, not submitted in sitemap", "indexed"],
    ["NEUTRAL", "Crawled - currently not indexed", "crawled"],
    ["NEUTRAL", "Excluded by 'noindex' tag", "other"],
    ["FAIL", "Server error (5xx)", "other"],
    ["NEUTRAL", "Page with redirect", "other"],
    ["VERDICT_UNSPECIFIED", undefined, "other"],
    [undefined, undefined, "other"],
  ];
  let bad = 0;
  console.log("\n  section B buckets a URL by what Google says about it, not by its verdict\n");
  for (const [v, c, want] of [...W34, ...other]) {
    const got = coverageBucket(v, c);
    const label = `${String(v ?? "(none)").padEnd(20)} ${String(c ?? "(none)").padEnd(36)}`;
    got === want ? console.log(`  ok    ${label} -> ${got}`) : (bad++, console.log(`  FAIL  ${label} -> ${got}, want ${want}`));
  }
  /* THE BLIND CASE. A verdict-reading implementation is the defect; if it agrees with the
     correct one on the shipped row, this file proves nothing. */
  const asShipped = (v) => (v === "PASS" ? "indexed" : v === "NEUTRAL" ? "crawled" : v === "FAIL" ? "discovered" : "other");
  const shippedCrawled = W34.filter(([v]) => asShipped(v) === "crawled").length;
  const nowCrawled = W34.filter(([v, c]) => coverageBucket(v, c) === "crawled").length;
  shippedCrawled === 8 && nowCrawled === 0
    ? console.log(`\n  ok    the shipped rule puts ${shippedCrawled}/8 of that row in "crawled" and this one puts ${nowCrawled} — the two are distinguishable`)
    : (bad++, console.log(`\n  FAIL  the old rule and the new one agree on the row that caused this (${shippedCrawled} vs ${nowCrawled}) — this case cannot fire`));
  if (bad) { console.log(`\n  ${bad} case(s) wrong\n`); process.exit(1); }
  console.log("");
}

import { stepReport, isoWeek } from "../worker/report.ts";

const kv = () => {
  const m = new Map();
  return {
    store: m,
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
};

/** Drive stepReport until it stops asking for ticks, with a hard cap that IS the assertion. */
const drive = async (env, cap = 40) => {
  const steps = [];
  for (let n = 0; n < cap; n++) {
    const s = await stepReport(env, n === 0);
    if (!s) break;
    steps.push(s);
    if (s.startsWith("report: complete") || s.startsWith("report: abandoned")) break;
  }
  return steps;
};

const withFetch = async (handler, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => handler(new URL(u).pathname);
  try { return await fn(); } finally { globalThis.fetch = real; }
};

const ok200 = (body) => new Response(body, { status: 200 });

let rbad = 0;
const claim = (cond, msg) => { if (!cond) { console.log(`  MISS  ${msg}`); rbad++; } else console.log(`  ok    ${msg}`); };

console.log("\n  the weekly report holding the ingest tick:");

/* 1. THE DEFECT'S EXACT CONDITION. */
{
  const env = { SNAPSHOT: kv(), SITE_ORIGIN: "https://coinliqui.com" };
  const steps = await withFetch(
    (p) => p === "/sitemap-index.xml"
      ? new Response("<!doctype html><title>500</title>edge is unhappy", { status: 500 })
      : ok200("<urlset></urlset>"),
    () => drive(env),
  );
  const spins = steps.filter((s) => s === "report: sitemaps").length;
  claim(spins <= 1, `an unparseable sitemap index is fetched once, not every tick (asked ${spins}x)`);
  claim(steps.length < 40, `the run ends instead of holding the tick forever (${steps.length} steps)`);
  claim(!env.SNAPSHOT.store.has("report:state"), "and it clears its state, so the sweeps resume");
  const md = JSON.parse(env.SNAPSHOT.store.get("report:latest") ?? "{}").md ?? "";
  claim(md.includes("produced no templates"), "section A says why it is empty rather than printing a bare header");
  claim(md.includes("500"), "and names the status it got");
}

/* 2. THE CONTROL. The same machine on a well-formed index must still walk its URLs. */
{
  const env = { SNAPSHOT: kv(), SITE_ORIGIN: "https://coinliqui.com" };
  const index = "<sitemapindex><sitemap><loc>https://coinliqui.com/sitemaps/core.xml</loc></sitemap></sitemapindex>";
  const core = "<urlset><url><loc>https://coinliqui.com/</loc></url><url><loc>https://coinliqui.com/funding</loc></url></urlset>";
  const steps = await withFetch(
    (p) => p === "/sitemap-index.xml" ? ok200(index) : p === "/sitemaps/core.xml" ? ok200(core) : ok200("hello"),
    () => drive(env),
  );
  const md = JSON.parse(env.SNAPSHOT.store.get("report:latest") ?? "{}").md ?? "";
  claim(steps.some((s) => s.startsWith("report: complete")), "a healthy index still produces a complete report");
  claim(md.includes("| `core` | 2 | 2/2 |"), "with the coverage table it always had");
  claim(!md.includes("produced no templates"), "and no failure text");
}

/* 3. A TEMPLATE WHOSE OWN SITEMAP FAILED. `0 | 0/0` read as full marks. */
{
  const env = { SNAPSHOT: kv(), SITE_ORIGIN: "https://coinliqui.com" };
  const index = "<sitemapindex><sitemap><loc>https://coinliqui.com/sitemaps/contracts.xml</loc></sitemap></sitemapindex>";
  await withFetch(
    (p) => p === "/sitemap-index.xml" ? ok200(index)
      : p === "/sitemaps/contracts.xml" ? new Response("nope", { status: 503 })
      : ok200("hello"),
    () => drive(env),
  );
  const md = JSON.parse(env.SNAPSHOT.store.get("report:latest") ?? "{}").md ?? "";
  claim(md.includes("sitemap returned 503"), "an unreadable child sitemap is unmeasured, not empty");
}

/* 4. THE CEILING, which is the bound on the class rather than on this one stall.
      The week must match the current one or the state is discarded as last week's, which is
      the stall's real condition: a run that dies mid-week holds every tick until the next
      Monday, and `st.week !== week` never fires to rescue it. */
{
  const env = { SNAPSHOT: kv(), SITE_ORIGIN: "https://coinliqui.com" };
  await env.SNAPSHOT.put("report:state", JSON.stringify({
    week: isoWeek(new Date()), phase: "inspect", i: 3,
    lines: ["# stuck"], templates: [], startedAt: Date.now() - 3 * 3_600_000,
  }));
  const step = await withFetch(() => ok200("x"), () => stepReport(env));
  claim(String(step).startsWith("report: abandoned"), `a run past the ceiling ends itself (${step})`);
  claim(!env.SNAPSHOT.store.has("report:state"), "and releases the tick");
  const md = JSON.parse(env.SNAPSHOT.store.get("report:latest") ?? "{}").md ?? "";
  claim(md.includes("Abandoned after") && md.includes("inspect"), "naming the phase it died in");
}

/* 5. AND NOT A MINUTE BEFORE. A ceiling that trips early would abandon healthy runs, which is
      the same outage wearing the guard's clothes. */
{
  const env = { SNAPSHOT: kv(), SITE_ORIGIN: "https://coinliqui.com" };
  await env.SNAPSHOT.put("report:state", JSON.stringify({
    week: isoWeek(new Date()), phase: "inspect", i: 3,
    lines: ["# in progress"], templates: [], startedAt: Date.now() - 25 * 60_000,
  }));
  const step = await withFetch(() => ok200("x"), () => stepReport(env));
  claim(!String(step).startsWith("report: abandoned"), `a 25-minute run is not abandoned (${step})`);
}

/* =====================================================================================
   TWO READINGS BOTH SAID "50 funding-symbols" WHILE THE SET UNDERNEATH HAD ROTATED.

   MORPHO crossed the open-interest floor on 21 August and something else fell below it, and
   neither report could name either one — section A stored counts, and a count is stable
   exactly when churn is invisible. A page then appears in the unindexed list reading like a
   page that lost ground when it may simply be three days old.

   The set is stored on the doc and diffed against the previous one. Three outcomes, and the
   first is the one that matters: a previous reading with no list must NOT be reported as
   "nothing changed", which is what an empty diff would say.
   ===================================================================================== */
{
  const SITE = "https://coinliqui.com";
  const sitemap = (paths) => ok200(`<urlset>${paths.map((x) => `<url><loc>${SITE}${x}</loc></url>`).join("")}</urlset>`);
  const runWith = async (env, paths) => withFetch(
    (pth) => pth === "/sitemap-index.xml"
      ? ok200(`<sitemapindex><sitemap><loc>${SITE}/sitemaps/funding-symbols.xml</loc></sitemap></sitemapindex>`)
      : pth === "/sitemaps/funding-symbols.xml" ? sitemap(paths) : ok200("<!doctype html><html><body>x</body></html>"),
    () => drive(env),
  );
  const mdOf = (env) => JSON.parse(env.SNAPSHOT.store.get("report:latest")).md;
  const A = ["/funding/btc", "/funding/eth", "/funding/ltc"];

  const e1 = { SNAPSHOT: kv(), SITE_ORIGIN: SITE };
  await runWith(e1, A);
  const md1 = mdOf(e1);
  claim(/carries no URL list, so there is nothing to compare/.test(md1) && !/No change against/.test(md1),
    'a previous reading with no list says so, and does not report "no change"');

  const e2 = { SNAPSHOT: kv(), SITE_ORIGIN: SITE };
  await e2.SNAPSHOT.put("report:latest", JSON.stringify({ week: "2026-W01", urls: [...A].sort() }));
  await runWith(e2, A);
  claim(/No change against 2026-W01: the same 3 URLs, not merely the same count/.test(mdOf(e2)),
    "an identical set is reported as the same URLs rather than the same count");

  const e3 = { SNAPSHOT: kv(), SITE_ORIGIN: SITE };
  await e3.SNAPSHOT.put("report:latest", JSON.stringify({ week: "2026-W34", urls: ["/funding/btc", "/funding/eth", "/funding/gone"].sort() }));
  await runWith(e3, A);
  const md3 = mdOf(e3);
  claim(/\*\*Joined \(1\):\*\* `\/funding\/ltc`/.test(md3) && /\*\*Left \(1\):\*\* `\/funding\/gone`/.test(md3),
    "a rotation at a constant count names both sides");
  claim(/has not had time to be indexed/.test(md3),
    "and says why a joiner shows as Discovered, so it is not read as a loss");
  claim(JSON.parse(e3.SNAPSHOT.store.get("report:latest")).urls?.length === 3,
    "the covered set is stored on the doc, so the next reading has something to compare");
}

if (rbad) { console.error(`\n  ${rbad} case(s) wrong`); process.exit(1); }
console.log("\n  the report can no longer hold the ingest tick: not on a bad sitemap, not on anything else");
