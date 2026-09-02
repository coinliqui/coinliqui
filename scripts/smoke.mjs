#!/usr/bin/env node
/**
 * Render every route template once, against the built worker, before anything is pushed.
 *
 * WHY THIS EXISTS. `astro build` for an SSR target compiles the worker; it does not render a
 * single page. So a ReferenceError inside a chart builder — an identifier used but never
 * imported — compiles perfectly and 500s on every page that draws a chart. That shipped: all
 * fifty contract pages and all four coin pages returned an empty body for fourteen minutes,
 * and the thing that caught it was a browser reporting document.body.innerHTML.length === 0,
 * not any check in this repository.
 *
 * The build cannot catch it and the live verifier catches it only after it is live. This runs
 * in between: boot the built worker locally, ask for one URL per template, and fail loudly.
 *
 *   npm run smoke
 *
 * TWO RUNS, because the two 500s that made this necessary needed different stores to appear.
 *
 *   COLD   no KV binding. Pages that read the snapshot return their 503 cold-start notice,
 *          which is a PASS — it means the guard rendered. This is the run that found
 *          /data-sources calling coldStart() without importing it: a ReferenceError that can
 *          only fire when the store is empty, which is exactly when someone opens that page.
 *
 *   WARM   a seeded KV, so every page renders its real content. This is the run that would
 *          have caught the missing MONO import, because a cold page never reaches the chart
 *          builder at all.
 *
 * Neither is optional. A page can be clean in one and 500 in the other, and today both
 * happened. What is never a pass in either run is a 500, an empty body, or a runtime error
 * in the body.
 *
 *   npm run smoke              cold only (no fixture needed)
 *   npm run smoke -- --warm DIR   also run warm against a wrangler --persist-to directory
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
/* Source is read as CODE by default — see scripts/lib/source.mjs. The two checks below that
   want the prose say so at their call site, with the reason. */
import { readSource, readRaw } from "./lib/source.mjs";
import { cssFor, undefinedClasses, undefinedVars, rawEnums, searchIndexGaps, unnamedUpstreams, duplicateRuleImplementations, uncoveredRoutes, unreadableText, chartAgreement, requestedLeverageLabels, inlineScriptSyntax, flipTableColour, colourPalettes, colourLanguageDrift, colourLegend, publishesAPerson, fixtureGaps, staleDerivedCells, basisSelfConsistent, sitemapLastmodHonesty, breadcrumbAgreement, founderAgreement, readmeCounts, botPolicyReasons, contradictoryStates, hiddenFromEveryone, pageWeight, weightFaults, dateModifiedAgreement, phantomInlineElements, malformedAttributes, uncitedPermissionClaims, unconditionalCadenceClaims, staleCalculatorFigures, controlGroupOverflow, stampSurfacesAgree, symbolAddressing, computedFigureFloor, COMPUTED_FIGURES, openingFigure, PROSE_ROUTES, handRolledLegends, collapsedStateEscapesMobile} from "./checks.mjs";

/* The SERVER side of each duplicated formatter, transcribed from the file that owns it and
   named here so the pairing is explicit. Transcription is the honest cost of having no bundler:
   these are the only lines in the repo that exist to be compared rather than to run, and the
   ladder sweep is what stops them from becoming a third divergent copy.
     qty        <- src/pages/funding/[symbol].astro `compact` (token quantities, no currency)
     compactUsd <- src/lib/chart.ts `compact`        (money at chart scale) */
/* SERVER_FORMATTERS WAS DELETED, AND THAT DELETION IS THE POINT. It held hand-written copies of
   the quantity and money rules so formatterDrift could sweep a ladder through them against
   public/interact.js — which meant the harness compared the client against a FOURTH copy rather
   than against the server's. Three implementations kept in step by comparing two of them to a
   fourth. The rules now live once, in public/shared.js, read by the Astro build, the worker
   bundle and the browser; duplicateRuleImplementations asserts they stay singular. */

/* Read out of the source, never transcribed here — see colourPalettes(). */
const PALETTE = colourPalettes(readSource("src/lib/chart.ts"), readSource("src/layouts/Base.astro"));

const PORT = 8791;
/* WHAT EACH RENDERED PAGE SAID ABOUT ITS OWN LAST CHANGE, kept so it can be compared with what
   the SITEMAP says about the same URL further down. The two claims are made in different files
   by different code and had never been put side by side — see stampSurfacesAgree(). */
const PAGE_STAMPS = new Map();

const ROUTES = [
  "/", "/coins", "/coins/bitcoin", "/funding", "/funding/btc", "/funding/kpepe",
  "/open-interest", "/liquidations", "/liquidations/survival", "/liquidations/sweep",
  /* THE PER-CONTRACT MAPS, both branches. /liquidations/eth is the template; /liquidations/btc
     is the pinned default's alias and must answer 301 to /liquidations, because the default
     keeps the URL Google already indexed. A template covered only by its happy path is how the
     404-vs-410 pair went unnoticed. */
  "/liquidations/eth", "/liquidations/btc", "/liquidations/notacoin",
  "/unlocks", "/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost",
  "/tools/funding-arbitrage", "/tools/liquidation-price", "/methodology",
  "/methodology/liquidations", "/data-sources", "/privacy", "/about", "/terms", "/llms.txt",
  /* THE EXPLAINERS. Two of them read the live store and return 503 on a cold one, which is the
     behaviour every market page here has; the warm fixture covers that. The other two are prose
     over committed data and cannot 503, so a failure in either is a real render fault. */
  "/learn", "/learn/funding-rate", "/learn/liquidation-heatmap", "/learn/liquidation-price",
  "/learn/open-interest",
  "/.well-known/security.txt", "/watchlist", "/status",
  "/status/indexation", "/404",
  /* THE RETIREMENT PAGE, AND THE STATUS IS THE POINT OF IT. A contract that leaves coverage
     used to answer the same 404 as a URL that never existed; /retired answers 410. The first
     attempt put that wording on 404.astro, where Astro reserves the route and the adapter
     forces a 404 — so the page rendered "this URL answers 410 Gone" under an HTTP 404, which
     is a page asserting a status it does not have. EXPECT pins the code, so that cannot come
     back quietly. The warm fixture carries a retired FET; see seed-smoke-kv.mjs. */
  "/retired?symbol=FET&at=1787500000000",
  "/funding/fet",
  /* AN UNKNOWN SYMBOL ON A PARAMETERISED ROUTE. All four of these returned 200 with a complete
     BTC page for any string at all — an unbounded set of URLs anyone can mint, each a full copy
     of the default. Pinned here so the 404 cannot quietly become a 200 again. */
  "/liquidations?symbol=NOTACOIN",
  "/liquidations/survival?symbol=NOTACOIN",
  "/tools/leverage?symbol=NOTACOIN",
  "/tools/position-size?symbol=NOTACOIN",
  /* THE OTHER BRANCH OF /404, which is the one real people reach.
     404.astro renders two different pages: a generic "that page does not exist" when nothing
     rewrote to it, and "X is not published" when a contract or coin page did. The gate asked
     for /404 — the generic branch — and so rendered green for as long as the other branch
     threw. Route coverage could not help: both branches live in one template, and the template
     was covered. A gate that asks for one URL per template sees one path through it. */
  "/funding/notacoin", "/coins/notacoin",
  "/api/live.json", "/robots.txt", "/sitemap-index.xml", "/sitemap.xml",
  "/search-index.json", "/rail",
  /* EVERY sitemap, not a sample. Six of these were never requested by anything until the
     coverage check below started comparing this list against the build manifest — so a 500 in
     one of them would have shipped green and been served to Googlebot. */
  "/sitemaps/coins.xml", "/sitemaps/funding-symbols.xml", "/sitemaps/funding-hub.xml",
  "/sitemaps/liquidations.xml", "/sitemaps/open-interest.xml", "/sitemaps/pages.xml",
  "/sitemaps/tools.xml", "/sitemaps/unlocks.xml", "/sitemaps/learn.xml",
  "/sitemaps/liquidation-symbols.xml",
];
/** Routes whose correct answer is not 200.
 *  /rail exports POST only — the rail's collapsed state is decided server-side so there is no
 *  flash — so a GET is correctly 404. That proves the route exists and does not crash on an
 *  unexpected method; it does NOT exercise the POST handler, and this comment says so rather
 *  than letting a green line imply otherwise. */
const EXPECT = { "/tools/liquidation-price": 410, "/404": 404, "/rail": 404, "/sitemap.xml": 301,
  "/funding/notacoin": 404, "/coins/notacoin": 404,
  /* 410 for a contract this site published and retired; 404 for one it never did. The pair is
     listed together because the whole defect was that they returned the same code. */
  "/retired?symbol=FET&at=1787500000000": 410, "/funding/fet": 410,
  "/liquidations?symbol=NOTACOIN": 404, "/liquidations/survival?symbol=NOTACOIN": 404,
  "/tools/leverage?symbol=NOTACOIN": 404, "/tools/position-size?symbol=NOTACOIN": 404,
  /* The default's map is at /liquidations, so its own slug is an alias and answers 301.
     A contract that was never covered answers 404, the same as /funding/notacoin. */
  "/liquidations/btc": 301, "/liquidations/notacoin": 404 };

const warmDir = process.argv.includes("--warm") ? process.argv[process.argv.indexOf("--warm") + 1] : null;
const MODES = warmDir ? [{ name: "cold", args: [] }, { name: "warm", args: ["--kv", "SNAPSHOT", "--d1", "DB", "--persist-to", warmDir] }]
                      : [{ name: "cold", args: [] }];

/* DOES THIS LIST STILL DESCRIBE THE SITE? "31 routes rendered" reads like a statement about
   the site and is only a statement about ROUTES. Compare it to what the build actually
   produced, before rendering anything — a gate that cannot see a new template is the failure
   this file exists to prevent, one level up. */
let failures = 0;
try {
  const dir = "dist/_worker.js";
  const manifest = readdirSync(dir).find((f) => /^manifest_.*\.mjs$/.test(f));
  if (!manifest) throw new Error(`no manifest_*.mjs in ${dir} — was the build run?`);
  /* Source invariant, checked before anything renders: no page may compute a tier-correct
     liquidation price while displaying the leverage the reader requested. That mislabelling
     shipped twice — twenty contract pages, then the position-size calculator. */
  const lev = requestedLeverageLabels(
    readdirSync("src/pages/tools").filter((f) => f.endsWith(".astro")).map((f) => `src/pages/tools/${f}`)
      .concat(["src/pages/funding/[symbol].astro", "src/pages/liquidations/index.astro", "src/pages/liquidations/survival.astro"]),
    (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } },
  );
  if (lev.length) { failures++; console.log(`\n  FAIL  ${lev.length} page(s) mislabel a clamped leverage:`); for (const l of lev) console.log(`          ${l}`); }

  /* THE ROOT-PROBED ICON, AS AN ARTIFACT RATHER THAN A LINK TAG. The head carries
     <link rel="icon" href="/icon.svg"> and always did, so nothing looked wrong — but
     /favicon.ico is fetched at the root without reading any HTML by Google's favicon fetcher,
     DuckDuckBot and the source cards in AI answers, and it was the 14KB HTML 404 page. Checked
     as bytes, not presence: an ICO that is really an HTML error page still has a filename. */
  try {
    const ico = readFileSync("dist/favicon.ico");
    const sig = ico.length >= 6 && ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) >= 1;
    if (!sig) { failures++; console.log(`\n  FAIL  dist/favicon.ico is ${ico.length} bytes and is not an ICO`); }
  } catch { failures++; console.log("\n  FAIL  dist/favicon.ico is missing — run scripts/gen-favicon.mjs"); }

  /* EVERY inline island must PARSE. A SyntaxError kills the whole island and every handler in
     it, while the server render stays perfect — so this is the one class the rest of the gate
     is structurally unable to see. */
  const walkAstro = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkAstro(`${d}/${e.name}`) : e.name.endsWith(".astro") ? [`${d}/${e.name}`] : []);
  const walkTs = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkTs(`${d}/${e.name}`) : /\.(ts|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".astro") ? [`${d}/${e.name}`] : []);
  const syn = walk("src/pages").concat(["src/layouts/Base.astro"])
    /* NOT stripped: this hands the body to new Function(), and a comment is legal input there.
       Stripping would parse something the browser never sees. */
    .flatMap((p) => { try { return inlineScriptSyntax(readRaw(p, "the parser must see exactly what the browser will"), p); } catch { return []; } });
  if (syn.length) { failures++; console.log(`\n  FAIL  ${syn.length} inline script(s) do not parse:`); for (const l of syn) console.log(`          ${l}`); }

  /* THE TWO PALETTES MUST NOT COLLIDE, checked before a single page renders — a shared hue is
     wrong on every page at once, so it is a source invariant rather than a per-route one. */
  const pdrift = colourLanguageDrift(PALETTE);
  if (pdrift.length) { failures++; console.log(`\n  FAIL  colour languages have collided:`); for (const d of pdrift) console.log(`          ${d}`); }

  /* WARM ONLY, and a hard failure: a fixture that cannot render a feature makes every check
     downstream of it meaningless for that feature, so it must not be a warning. */
  if (warmDir) {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const objDir = `${warmDir}/v3/kv/miniflare-KVNamespaceObject`;
      let keys = [];
      for (const f of readdirSync(objDir).filter((x) => x.endsWith(".sqlite"))) {
        const db = new DatabaseSync(`${objDir}/${f}`);
        try {
          const rows = db.prepare("SELECT key FROM _mf_entries").all();
          if (rows.some((r) => r.key === "snapshot")) keys = rows.map((r) => r.key);
        } catch { /* not a KV store */ } finally { db.close(); }
        if (keys.length) break;
      }
      /* THE RENDER PATH, not just src/lib. This read only src/lib, so a key a page or the layout
         reads directly was outside the input and the check said nothing about it while its
         success line claimed to cover "every KV series the code reads". */
      const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : (/\.(ts|astro)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
      const rendered = [...walk("src/lib"), ...walk("src/pages"), ...walk("src/layouts")].map((f) => [f, readSource(f)]);
      /* worker/ IS PASSED SEPARATELY, and not because the worker renders anything. It declares
         key constants that pages import — /status reads `indexnow:state` as STATE_KEY from
         worker/indexnow.ts — and fixtureGaps can resolve an imported constant only if the file
         that exports it is in front of it. Passing it as `sources` instead would also collect
         every key the CRON reads and demand them of a fixture built to render pages. */
      const declarers = walk("worker").map((f) => [f, readSource(f)]);
      const { gaps, searched } = fixtureGaps(rendered, keys, declarers);
      if (gaps.length) { failures++; console.log(`\n  FAIL  the warm fixture cannot render ${gaps.length} feature(s):`); for (const g of gaps) console.log(`          ${g}`); }
      else console.log(`\n  ok    ${searched} KV key prefix(es) read anywhere in the render path are all present in the warm fixture (${keys.length} keys)`);
    } catch (e) {
      failures++;
      console.log(`\n  FAIL  fixture coverage could not be checked: ${e.message}`);
    }
  }

  /* Source invariant: a cell computed from a live rate must be repainted with it. The overlay
     shipped this defect once and a rendered page cannot reveal a MISSING attribute. */
  const stale = staleDerivedCells(walkAstro("src/pages").map((f) => [f, readSource(f)]));
  if (stale.length) { failures++; console.log(`\n  FAIL  ${stale.length} cell(s) derived from a live rate are never repainted:`); for (const l of stale) console.log(`          ${l}`); }

  /* The same shape one mechanism over: a calculator repaints its cards from the form and leaves
     the sentence explaining them at its first-byte value. Source invariant for the same reason —
     a rendered page shows the two agreeing until somebody types. */
  /* Which containers hold a GENERATED list of controls is a fact about the templates; whether
     each one wraps is a fact about the stylesheet. Both are passed in, and components are
     included because a container can be declared in one. */
  const overflow = controlGroupOverflow(
    readSource("src/layouts/Base.astro"),
    [...walkAstro("src/pages"), ...walkAstro("src/components")].map((f) => [f, readSource(f)]),
  );
  if (overflow.length) { failures++; console.log(`\n  FAIL  ${overflow.length} control group(s) can run off a narrow screen:`); for (const l of overflow) console.log(`          ${l}`); }
  else console.log("  ok            every segmented control group wraps or scrolls rather than leaving the page");

  const frozen = staleCalculatorFigures(walkAstro("src/pages").map((f) => [f, readSource(f)]));
  if (frozen.length) { failures++; console.log(`\n  FAIL  ${frozen.length} figure(s) in a verdict never repaint:`); for (const l of frozen) console.log(`          ${l}`); }
  else console.log("  ok            every figure inside a verdict branch is repainted with its cards");

  /* Source invariant, and a wider net than the pages: an uncited claim about what an upstream
     permits regrew on /coins after being deleted from /data-sources, because the root copy was a
     comment in src/lib/coins.ts. Deleting instances of a sentence that has a root gets you the
     sentence twice, so this reads the library and the docs as well as the templates. */
  const perm = uncitedPermissionClaims(
    [...walkAstro("src/pages"), ...walkTs("src/lib"), ...walkTs("worker"), "README.md", "DEPLOY.md"]
      .map((f) => [f, readRaw(f, "the claim this hunts regrew inside a comment — prose is the point")]));
  if (perm.length) { failures++; console.log(`\n  FAIL  ${perm.length} uncited claim(s) about what a third party permits:`); for (const l of perm) console.log(`          ${l}`); }

  /* Source invariant, and it exists because the site is single-sourced: every way Hyperliquid can
     fail reaches the reader as quietly stale data, so a sentence promising a cadence is the one
     thing on the page that can be flatly false while everything around it is honest. */
  const cad = unconditionalCadenceClaims(
    [...walkAstro("src/pages"), "src/layouts/Base.astro"].map((f) => [f, readSource(f)]));
  if (cad.length) { failures++; console.log(`\n  FAIL  ${cad.length} unconditional cadence claim(s):`); for (const l of cad) console.log(`          ${l}`); }

  const un = uncoveredRoutes(await readFile(`${dir}/${manifest}`, "utf8"), ROUTES);
  if (un.length) {
    failures++;
    console.log(`\n── route coverage ──`);
    console.log(`  FAIL  ${un.length} route(s) the build produces that this gate never asks for:`);
    for (const r of un) console.log(`          ${r}`);
  }
} catch (e) {
  failures++;
  console.log(`\n  FAIL  route coverage could not be checked: ${e.message}`);
}

for (const mode of MODES) {
  console.log(`\n── ${mode.name} store ──`);
  failures += await runMode(mode.args, mode.name);
}
console.log(failures ? `\n${failures} failure(s) across ${MODES.length} run(s) — do not push\n`
                     : `\n${ROUTES.length} routes rendered in ${MODES.map((m) => m.name).join(" and ")}\n`);
process.exit(failures ? 1 : 0);

async function runMode(extraArgs, name) {
/* THE PORT MUST BE OURS BEFORE ANYTHING IS BELIEVED, and for one evening it was not. A stray
   `python -m http.server 8791` — nothing to do with this project, reparented to init and
   forgotten — was listening on the smoke port. wrangler failed to bind and exited; `up()` then
   asked for /robots.txt, got an answer from the SQUATTER, and declared the worker ready. The run
   proceeded to test a directory listing: "/" came back 200 with 48KB of file index, every other
   route came back 404, and the gate reported 104 failures against a site that was in fact
   correct — verified by serving the same dist by hand, where every route answered 503 exactly as
   the cold pass expects.

   A gate that reports someone else's server as this site's failures is worse than one that does
   not run, because the failures look real and cost an evening. `up()` cannot tell the difference
   — anything that answers 200 looks alive — so the check happens BEFORE the spawn, where the
   question is simply whether the port is free. */
{
  const busy = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
    .then(() => true)
    .catch(() => false);
  if (busy) {
    console.error(`smoke: port ${PORT} is already answering before wrangler was started.`);
    console.error(`       Something else is listening there, and every route this run reports`);
    console.error(`       would be that server's answer rather than the site's. Free it first:`);
    console.error(`         lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    process.exit(1);
  }
}
const srv = spawn("npx", ["wrangler", "pages", "dev", "dist", "--port", String(PORT), "--ip", "127.0.0.1", ...extraArgs], {
  stdio: ["ignore", "pipe", "pipe"],
});
const kill = () => { try { srv.kill("SIGTERM"); } catch { /* already gone */ } };
process.on("exit", kill);
process.on("SIGINT", () => { kill(); process.exit(130); });

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/robots.txt`);
      if (r.status) return true;
    } catch { /* not yet */ }
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
};

if (!(await up())) {
  console.error(`smoke: the worker never came up (${name})`);
  kill();
  return 1;
}

let bad = 0;
for (const path of ROUTES) {
  const want = EXPECT[path] ?? 200;
  let status = 0, body = "", err = "";
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "coinliqui-smoke" },
      redirect: "manual",
    });
    status = r.status;
    body = await r.text();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  // 503 is the cold-start guard rendering correctly — a pass cold, a failure warm.
  const okStatus = status === want || (name === "cold" && status === 503);
  /* A REDIRECT HAS NO BODY, AND THAT IS THE POINT OF ONE.
     This rule exists because a 200 with nothing in it shipped once and looked fine in the
     status column. A 3xx is the opposite case: RFC 9110 makes the body optional and every
     client follows the Location header instead, so demanding one would be demanding padding. */
  const empty = body.length === 0 && !(status >= 300 && status < 400);
  const crashed = /ReferenceError|is not defined|Cannot read propert|Internal Server Error/i.test(body);

  /* DID THE DOCUMENT FINISH?
     Astro streams an SSR response, so a throw partway through a template flushes the status
     and everything rendered up to that point, then simply stops. The status is already
     committed and correct, the body is not empty, and the error text goes to the log rather
     than into the stream — so `empty` and `crashed` above are both structurally blind to it.
     /404 served a truncated 9,159-byte body on every mistyped or below-floor coin URL for as
     long as SYMBOL_CAP went unimported, and this gate printed `ok 404` at it. */
  const isDoc = /^\s*<!doctype html/i.test(body);
  const truncated = isDoc && !/<\/html>\s*$/i.test(body);

  /* CONTENT CHECKS. A 200 with a body is not the same as a correct page: today's three
     silent defects all rendered 200 and lost a colour or leaked an identifier. These run
     only on HTML, and only warm — a cold page is the 503 notice and has nothing to check. */
  let content = [];
  if (name === "warm" && body.startsWith("<!DOCTYPE") ) {
    const css = await cssFor(body, `http://127.0.0.1:${PORT}`);
    const c = undefinedClasses(body, css);
    const v = undefinedVars(body, css);
    const e = rawEnums(body);
    for (const d of chartAgreement(body)) content.push(`chart disagrees with the page: ${d}`);
    /* THE OPENING MUST CARRY A FIGURE, asked of every warm route rather than of the three the
       crawler log happened to name. Query strings are stripped first: /liquidations?symbol=BTC
       and /liquidations are the same template and the same lede, and an exemption keyed on the
       decorated path would silently stop applying the day a control was added. */
    {
      const route = path.split("?")[0];
      if (status === 200 && !(route in PROSE_ROUTES) && !openingFigure(body)) {
        content.push("the opening 700 characters carry no figure — a page reading the live store that describes its method instead of stating a reading");
      }
    }
    /* Warm only, and only the homepage — the flip feed exists nowhere else. This is also the
       assertion that keeps the D1 fixture honest: if it is empty the feed renders a placeholder
       and this fails, rather than every check on that table silently having nothing to look at. */
    if (path === "/") content.push(...flipTableColour(body));
    /* ONE ROUTE IS ENOUGH: the layout stylesheet is the same document on every page, and this
       asks a question about that stylesheet rather than about the page. See the function for
       the phone that opened the drawer as eleven unlabelled icons. */
    if (path === "/") content.push(...collapsedStateEscapesMobile(css));
    /* Two colour languages now exist. A page may speak either, and must name whichever it
       speaks — a rule that only means anything if it is asserted per page rather than once. */
    content.push(...colourLegend(body, PALETTE));
    for (const d of basisSelfConsistent(body)) content.push(`a page contradicts its own arithmetic: ${d}`);
    for (const d of breadcrumbAgreement(body)) content.push(`breadcrumb: ${d}`);
    for (const d of founderAgreement(body)) content.push(`the founder claim disagrees with itself: ${d}`);
    for (const d of contradictoryStates(body)) content.push(`two states, one hidden: ${d}`);
    for (const d of hiddenFromEveryone(body)) content.push(`text nobody receives: ${d}`);
    for (const d of dateModifiedAgreement(body)) content.push(`the stated age disagrees with itself: ${d}`);
    /* Recorded, not asserted here: the counterpart claim lives in a sitemap this loop has not
       fetched yet. Query strings are stripped because a sitemap lists the bare URL. */
    {
      const ld = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      let stamp = null;
      for (const m of ld) {
        let j; try { j = JSON.parse(m[1]); } catch { continue; }
        const walk = (n) => {
          if (Array.isArray(n)) return n.forEach(walk);
          if (!n || typeof n !== "object") return;
          if (n.dateModified) stamp = n.dateModified;
          Object.values(n).forEach(walk);
        };
        walk(j);
      }
      if (stamp) PAGE_STAMPS.set(path.split("?")[0], stamp);
    }
    /* MARKUP WE DID NOT WRITE. Every other check here asks whether the templates are right; this
       asks whether the compiler agreed. It has to run on every page, because the defect it was
       written for was invisible on the two pages that had it and absent from the twenty-two that
       did not — nothing about the source distinguished them. */
    for (const d of phantomInlineElements(body)) content.push(`the compiler invented markup: ${d}`);
    /* Same family, different author: the compiler invents markup, and we mis-write it. Both are
       invisible in the rendered result, and both are only ever seen in a console nobody opens. */
    for (const d of malformedAttributes(body)) content.push(`invalid attribute: ${d}`);
    /* No individual may be published by this site — checked on EVERY page, because the
       structured data is emitted by the shared layout and one page is every page. */
    content.push(...publishesAPerson(body));
    if (c.length) content.push(`class defined nowhere: ${c.join(", ")}`);
    if (v.length) content.push(`custom property never declared: ${v.join(", ")}`);
    if (e.length) content.push(`internal enum rendered as text: ${e.join(", ")}`);
  }

  const ok = okStatus && !empty && !crashed && !truncated && !err && !content.length;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${String(status || err).padEnd(4)} ${String(body.length).padStart(7)}b  ${path}` +
      (crashed ? "   <- runtime error in the body" : empty ? "   <- EMPTY BODY"
       : truncated ? "   <- TRUNCATED, no </html> — the render threw mid-stream" : ""),
  );
  for (const c of content) console.log(`          ${c}`);
}

  /* SITE-WIDE, not per-route: is every URL we tell a crawler about reachable from the search
     box, and does /data-sources name every upstream the code actually calls? Warm only — the
     cold sitemaps are empty by design, so there is nothing to compare. */
  if (name === "warm") {
    try {
      /* CODE WHOSE OUTPUT REACHES A READER, which is the only code /data-sources owes an
         attribution for. src/lib and worker render and ingest. From scripts/ only the three
         that GENERATE COMMITTED DATA count — probe-vesting writes the vesting register,
         fetch-sweep writes the February crash series, gen-margin-tables writes the tiers.
         The verifiers and build helpers are excluded on purpose: verify-live.mjs mentions
         schema.org in an exclusion list and "https://www." in a string replace, and neither
         is a vendor this site depends on. Listing the three by name rather than globbing
         means adding a fourth data generator is a decision someone makes on purpose. */
      const files = [
        ...["src/lib", "worker"].flatMap((dir) => {
          try { return readdirSync(dir).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => `${dir}/${f}`); }
          catch { return []; }
        }),
        "scripts/probe-vesting.mjs", "scripts/fetch-sweep.mjs", "scripts/gen-margin-tables.mjs",
      ];
      const ds = await (await fetch(`http://127.0.0.1:${PORT}/data-sources`)).text();
      const un = await unnamedUpstreams(ds, (f) => readFile(f, "utf8"), files);
      if (un.length) {
        bad++;
        console.log(`  FAIL  ${String(un.length).padStart(4)}         upstream fetched but not named on /data-sources`);
        for (const h of un) console.log(`          ${h}`);
      } else {
        console.log(`  ok            every upstream host is named on /data-sources`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          upstream comparison failed: ${e.message}`);
    }
    try {
      /* ======================================================================================
         A TEMPLATE THAT MINTS MANY URLS AND COMPUTES NOTHING ON EACH OF THEM.

         Scoped by the SHAPE of the route rather than by a list: `[param].astro` is what makes a
         template multi-instance, so a new one is held to the floor the day it ships without
         anybody remembering to enrol it. A singleton cannot be a scaled-content problem.

         COMPONENTS ARE READ WITH THE TEMPLATE, one level deep. /liquidations/[symbol] delegates
         its entire body to LiqMap.astro; counting only the route file would score the page that
         does the most computation on this site at zero.

         THE EXPORT SCAN HANDLES RE-EXPORTS, and the first version did not. src/lib/funding.ts
         re-exports carryCost and fifteen others from public/shared.js with `export { … } from`,
         so a scan matching only `export function|const` reported carryCost as missing and the
         check correctly refused to trust its own registry. That refusal is the point of it —
         a registry entry naming a function that no longer exists counts nothing on every page
         and says nothing, which is how a floor quietly stops being a floor. */
      const walkAstro = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walkAstro(`${d}/${e.name}`) : [`${d}/${e.name}`]);
      const resolveRel = (from, rel) => {
        const parts = from.split("/").slice(0, -1);
        for (const seg of rel.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
        return parts.join("/");
      };
      const multi = walkAstro("src/pages").filter((f) => /\[[^\]]+\]\.astro$/.test(f));
      const templates = multi.map((f) => {
        const src = readFileSync(f, "utf8");
        const kids = [...src.matchAll(/import\s+\w+\s+from\s+"([^"]*\.astro)"/g)]
          .map((m) => { try { return readFileSync(resolveRel(f, m[1]), "utf8"); } catch { return ""; } });
        return { route: f.replace("src/pages", ""), sources: [src, ...kids] };
      });
      const exportsByFile = Object.fromEntries(readdirSync("src/lib").filter((f) => f.endsWith(".ts")).map((f) => {
        const src = readFileSync(`src/lib/${f}`, "utf8");
        const direct = [...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
        /* `export { a, b } from "…"` and `export { a }` — both bind the name for an importer. */
        const braced = [...src.matchAll(/^export \{([^}]*)\}/gm)]
          .flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
        return [f, [...direct, ...braced]];
      }));
      const thinT = computedFigureFloor(templates, exportsByFile);
      if (thinT.length) {
        bad++;
        console.log(`  FAIL  ${String(thinT.length).padStart(4)}         a multi-URL template does not earn its URLs`);
        for (const l of thinT) console.log(`          ${l}`);
      } else {
        console.log(`  ok            all ${templates.length} multi-URL template(s) publish at least 3 figures this site computes, from a registry of ${COMPUTED_FIGURES.length} checked against src/lib`);
      }

      /* THE SHARED LEGEND VOCABULARY, over every page and component rather than the templates
         above: /coins hand-typed the funding-direction sentence and thereby kept the arrows the
         library had deliberately removed, on a page whose arrows are price. src/lib/funding.ts
         is excluded because it is where the constants are defined. */
      const legendSources = [...walkAstro("src/pages"), ...walkAstro("src/components")]
        .filter((f) => f.endsWith(".astro"))
        .map((f) => ({ path: f, src: readFileSync(f, "utf8") }));
      const rolled = handRolledLegends(legendSources);
      if (rolled.length) {
        bad++;
        console.log(`  FAIL  ${String(rolled.length).padStart(4)}         a page writes the shared funding legend by hand`);
        for (const l of rolled) console.log(`          ${l}`);
      } else {
        console.log(`  ok            none of the ${legendSources.length} page/component source(s) retype the funding-direction legend; it has one source`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          computed-figure floor could not be checked: ${e.message}`);
    }
    try {
      /* ======================================================================================
         A PAGE THAT CHANGES WHEN A PARAMETER CHANGES, AT A URL THAT SAYS IT DOES NOT.

         /liquidations rendered fifty complete contract pages — its own <title>, <h1>, chart
         and every figure — and published all fifty at one URL. Base builds the canonical tag
         from the pathname alone, which is right everywhere else and was, here, forty-nine
         finished pages instructing every crawler to discard them. They were in no sitemap and
         announced to no index, because nothing that crawls submits a <select>. The demand was
         in Search Console the whole time: seven coin-named liquidation-map queries in the
         week to 22 August 2026, against a template with one URL.

         THIS PROBES RATHER THAN READS THE SOURCE. A static scan would have to decide, from
         the text of a .astro file, whether `title` transitively depends on a search parameter
         — which is the kind of question that is answered wrongly once and then trusted. Two
         GETs answer it exactly: fetch the bare route, fetch it with a second real contract
         named, and see whether the document changed its own name.

         THE CHECK DOES NOT DECIDE THE VERDICT. Whether fifty renderings deserve fifty URLs is
         a judgement about whether the content earns an index entry, and the tools deliberately
         say no — see SYMBOL_PARAMETERISED in src/lib/routes.ts. What fails here is a route
         that varies and has NO recorded verdict, which is how /liquidations spent its whole
         life, and a recorded verdict that no longer matches what the route does.
         ====================================================================================== */
      const { SYMBOL_PARAMETERISED } = await import("../src/lib/routes.ts");
      const fundingSitemap = await (await fetch(`http://127.0.0.1:${PORT}/sitemaps/funding-symbols.xml`)).text();
      const contracts = [...fundingSitemap.matchAll(/<loc>[^<]*\/funding\/([^<]+)<\/loc>/g)].map((m) => m[1]);
      /* A SECOND real contract, taken from what the site itself publishes. A hardcoded "ETH"
         would silently stop testing anything the day ETH left coverage — the probe would ask
         for an unknown symbol, every route would answer 404, and every route would then look
         unparameterised. */
      const other = contracts.find((c) => c.toUpperCase() !== "BTC");
      if (!other) throw new Error("no second contract in the funding sitemap to probe with");
      const titleOf = (html) => (html.match(/<title>([\s\S]*?)<\/title>/) ?? [, ""])[1].trim();
      /* THE DESCRIPTION COUNTS, AND LEAVING IT OUT MISSED A ROUTE. /tools/position-size has a
         fixed <title> and a meta description that names the contract, so a title-only probe
         reported it as unparameterised — and the entry recording the deliberate decision not
         to give it fifty URLs would have been deleted as stale. Both tags are what a search
         result is built from, so both are claims the canonical URL is making. The <h1> is
         deliberately NOT counted: a calculator naming the selected contract in its heading is
         the page talking to the reader in front of it, not to an index. */
      const descOf = (html) => (html.match(/<meta name="description" content="([^"]*)"/) ?? [, ""])[1].trim();
      const canonOf = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/) ?? [, ""])[1];
      const observed = [];
      for (const path of ROUTES) {
        if (path.startsWith("/sitemaps/") || path.startsWith("/api/") || /\.(xml|json|txt)$/.test(path)) continue;
        /* MANUAL, and the first version of this was not. A bare fetch FOLLOWS redirects, so
           /liquidations/btc — which 301s to /liquidations because the default keeps that URL —
           came back 200 carrying /liquidations' body, was probed, redirected again, and was
           reported as an undeclared addressed route. The bug was in the instrument, and the
           only reason it was visible is that it named a route nobody had declared. */
        const bare = await fetch(`http://127.0.0.1:${PORT}${path}`, { redirect: "manual" });
        if (bare.status !== 200) continue;
        const bareBody = await bare.text();
        const t0 = titleOf(bareBody), d0 = descOf(bareBody);
        const probed = await fetch(
          `http://127.0.0.1:${PORT}${path}${path.includes("?") ? "&" : "?"}symbol=${encodeURIComponent(other.toUpperCase())}`,
          { redirect: "manual" });
        if (probed.status >= 300 && probed.status < 400) {
          observed.push({ path, redirect: probed.headers.get("location"), identityVaries: false, canonicalQuery: "" });
          continue;
        }
        if (probed.status !== 200) continue;
        const body = await probed.text();
        const canon = canonOf(body);
        observed.push({
          path, redirect: null, identityVaries: titleOf(body) !== t0 || descOf(body) !== d0,
          canonicalQuery: canon ? new URL(canon).search : "",
        });
      }
      const problems = symbolAddressing(observed, SYMBOL_PARAMETERISED);
      if (problems.length) {
        bad++;
        console.log(`  FAIL  ${String(problems.length).padStart(4)}         a route varies by ?symbol= without a recorded verdict, or contradicts the one it has`);
        for (const l of problems) console.log(`          ${l}`);
      } else {
        console.log(`  ok            every ?symbol=-parameterised route has a verdict that matches what it does (probed with ${other.toUpperCase()}, ${observed.length} route(s))`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          ?symbol= addressing check failed: ${e.message}`);
    }
    try {
      const css = await cssFor(await (await fetch(`http://127.0.0.1:${PORT}/`)).text(), `http://127.0.0.1:${PORT}`);
      const un = unreadableText(css);
      if (un.length) {
        bad++;
        /* "ON A SURFACE IT IS USED ON" WAS A CLAIM ABOUT THE STYLESHEET, AND NOTHING READ IT.
           unreadableText() is an unconditional cross-product of three text tokens against four
           surface tokens; no rule, no element and no cascade is consulted, so it cannot know
           whether any pairing is rendered anywhere. It fires on nothing today, which is why the
           wording has never cost anything — but the message is what a maintainer would act on,
           and "it is used on" sends them hunting for an element that may not exist, or worse,
           tempts a global token change to satisfy a pairing nothing renders.

           The cross-product is deliberately kept: it is a SUPERSET of real usage, so twelve
           passes means every actual pairing passes, and the alternative — deciding which text
           token lands on which surface — is a full cascade analysis and a far better place to
           be wrong. The message says superset now, which is the property the code has. */
        console.log(`  FAIL  ${String(un.length).padStart(4)}         text/surface token pairing below WCAG AA — every combination is checked, whether or not the stylesheet renders it, so confirm the pairing is reachable before changing a token`);
        for (const l of un) console.log(`          ${l}`);
      } else {
        console.log(`  ok            every text token clears 4.5:1 on every surface`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          contrast check failed: ${e.message}`);
    }
    try {
      /* The repository is a published surface too, once it is public. */
      for (const l of botPolicyReasons(await readFile("src/pages/robots.txt.ts", "utf8"))) {
        bad++;
        console.log(`  FAIL          bot policy: ${l}`);
      }
      const stale = readmeCounts(await readFile("README.md", "utf8"));
      if (stale.length) {
        bad++;
        console.log(`  FAIL  ${String(stale.length).padStart(4)}         the README names a count the code sizes`);
        for (const l of stale) console.log(`          ${l}`);
      } else {
        console.log(`  ok            the README names no count that can go stale`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          README audit failed: ${e.message}`);
    }
    try {
      const walkAll = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "node_modules" ? [] : walkAll(`${d}/${e.name}`))
          : /\.(astro|ts|js)$/.test(e.name) ? [`${d}/${e.name}`] : []);
      const dup = duplicateRuleImplementations(
        ["src", "public", "worker"].flatMap(walkAll).map((f) => [f, readSource(f)]));
      if (dup.length) {
        bad++;
        console.log(`  FAIL  ${String(dup.length).padStart(4)}         a shared rule is implemented more than once`);
        for (const line of dup) console.log(`          ${line}`);
      } else {
        console.log(`  ok            every shared rule is implemented exactly once`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          formatter comparison failed: ${e.message}`);
    }
    try {
      /* Every URL that claims a COMMIT date must be a URL only a commit changes. Read off the
         rendered XML rather than the generators: a git date is byte-for-byte the string in
         lastmod.json and a data stamp is truncated to the hour, so the two never collide.
         Five tool URLs shipped for days claiming 14 August while the market moved under them. */
      const table = JSON.parse(await readFile("src/data/lastmod.json", "utf8"));
      const { pagesReadingLiveStores } = await import("./sitemap-honesty.mjs");
      const lies = [];
      for (const path of ROUTES.filter((r) => r.startsWith("/sitemaps/"))) {
        const body = await (await fetch(`http://127.0.0.1:${PORT}${path}`)).text();
        /* The origin is consumed explicitly. As a lazy prefix this captured "//127.0.0.1:8788/tools"
           — the first slash of the scheme — so every lookup missed and the audit passed while blind. */
        const routes = [...body.matchAll(/<loc>(?:https?:\/\/[^/<]+)?([^<]*)<\/loc>/g)].map((m) => m[1]);
        for (const l of sitemapLastmodHonesty(body, table, pagesReadingLiveStores(routes))) lies.push(`${path}: ${l}`);
      }
      /* THE OTHER HALF OF THE SAME QUESTION, and the half nothing was asking: does the date a
         URL publishes in its sitemap agree with the date the PAGE publishes about itself. Two
         surfaces, two generators, one fact. Built from the same fetched XML so no extra
         requests, and from what the warm pass already recorded off each rendered page. */
      const stampRows = [];
      for (const path of ROUTES.filter((r) => r.startsWith("/sitemaps/"))) {
        const body = await (await fetch(`http://127.0.0.1:${PORT}${path}`)).text();
        for (const m of body.matchAll(/<loc>(?:https?:\/\/[^/<]+)?([^<]*)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
          const url = m[1] || "/";
          if (PAGE_STAMPS.has(url)) stampRows.push({ path: url, lastmod: m[2], dateModified: PAGE_STAMPS.get(url) });
        }
      }
      const split = stampSurfacesAgree(stampRows, table);
      if (split.length) {
        bad++;
        console.log(`  FAIL  ${String(split.length).padStart(4)}         a URL's sitemap date and its own page date disagree`);
        for (const l of split) console.log(`          ${l}`);
      } else {
        console.log(`  ok            ${stampRows.length} URL(s) publish the same change date in the sitemap and on the page`);
      }
      if (lies.length) {
        bad++;
        console.log(`  FAIL  ${String(lies.length).padStart(4)}         URLs claim a commit date they cannot keep`);
        for (const l of lies) console.log(`          ${l}`);
      } else {
        console.log(`  ok            every commit-dated URL is one only a commit changes`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          sitemap lastmod audit failed: ${e.message}`);
    }
    if (warmDir) try {
      /* THE THREE SURFACES THAT CARRY ONE CLAIM, AND THE BRANCH PRODUCTION CANNOT REACH.
         The site's external corroboration is published only while a daily worker probe says a
         signed-out reader can reach it. In production that probe says 404, so every render takes
         the withheld branch — and the branch that emits it would ship having never been rendered
         here. seed-smoke-kv.mjs writes a reachable record precisely so this run exercises it.

         Two assertions, and the second is why this is not satisfied by "the link is never there":
           1. the three surfaces AGREE — JSON-LD sameAs, the visible /about link, and the
              llms.txt provenance clause are one fact rendered three ways, and this project has
              already shipped that shape drifting apart more than once;
           2. on the warm run the link is PRESENT. If the seed is ever dropped, the branch goes
              back to being untested and this says so instead of quietly passing. */
      const { CANDIDATES } = await import("../src/lib/corroboration.ts");
      const url = CANDIDATES[0];
      const about = await (await fetch(`http://127.0.0.1:${PORT}/about`)).text();
      const llms = await (await fetch(`http://127.0.0.1:${PORT}/llms.txt`)).text();
      const graph = /"sameAs":\s*\[([^\]]*)\]/.exec(about);
      const surfaces = {
        "JSON-LD sameAs": !!graph && graph[1].includes(url),
        "the /about link": new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(about),
        "the llms.txt provenance clause": llms.includes(url),
      };
      const on = Object.entries(surfaces).filter(([, v]) => v).map(([k]) => k);
      const off = Object.entries(surfaces).filter(([, v]) => !v).map(([k]) => k);
      if (on.length && off.length) {
        bad++;
        console.log(`  FAIL          the corroboration link is on ${on.join(" and ")} but not on ${off.join(" or ")} — one fact, three surfaces, disagreeing`);
      } else if (!on.length) {
        bad++;
        console.log(`  FAIL          the corroboration link renders on none of the three surfaces, though the warm fixture says it is reachable — the restored branch is untested again (check seed-smoke-kv.mjs)`);
      } else {
        console.log(`  ok            the corroboration link renders on all three surfaces when the probe says it resolves`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          corroboration surface audit failed: ${e.message}`);
    }
    try {
      /* PAGE WEIGHT, REPORTED EVERY RUN AND GATED ONLY ON BREAKAGE.
         checks.mjs exported extractionRatio, the comment above it called it the authority on
         payload size, and nothing in this repository ever invoked it — so the number it produced
         had never been seen. It was also counting <script> on a site whose weight is <svg>:
         /liquidations/survival is 91% inline svg and 0.8% script. pageWeight counts every kind
         and names the dominant one; the ratio is printed because there is no defensible
         threshold for it, and only two conditions fail — see WEIGHT_LIMITS. */
      const weights = [];
      for (const path of ROUTES.filter((r) => !/\.(xml|json|txt|ico)$/.test(r) && !EXPECT[r])) {
        const body = await (await fetch(`http://127.0.0.1:${PORT}${path}`)).text();
        weights.push([path, pageWeight(body)]);
      }
      const faults = weights.flatMap(([path, w]) => weightFaults(w).map((f) => `${path}: ${f}`));
      const heaviest = [...weights].sort((a, b) => b[1].bytesPerWord - a[1].bytesPerWord).slice(0, 4);
      if (faults.length) {
        bad++;
        console.log(`  FAIL  ${String(faults.length).padStart(4)}         page weight breaches a limit`);
        for (const f of faults) console.log(`          ${f}`);
      } else {
        console.log(`  ok            page weight within limits across ${weights.length} routes`);
      }
      /* The distribution, not a verdict on it — a 2x drift in this list is the thing to notice. */
      for (const [path, w] of heaviest) {
        /* THE TRANSFERRED FIGURE LEADS. This line used to print only the uncompressed size —
           "523,042B, svg 91.4%" — and anybody reading it would conclude the page was half a
           megabyte. Over the wire it is 24 KB. Both are printed because the uncompressed
           number still says something about parse cost; the one a reader pays goes first. */
        console.log(`                ${String(w.wireBytes === null ? "?" : Math.round(w.wireBytes / 1024) + "KB").padStart(6)} wire  ${String(w.bytesPerWord).padStart(4)} bytes/word  ${path}  (${w.total.toLocaleString()}B raw, ${w.words}w, ${w.dominant.kind} ${w.dominant.pct}%)`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          page weight audit failed: ${e.message}`);
    }
    try {
      /* EVERY URL IN A SITEMAP MUST BE A URL WE ANNOUNCE, AND VICE VERSA.
         worker/indexnow.ts built its own list of static routes, independent of the four lists
         the sitemap generators carried. Measured against the live site on 19 August, 22 of 79
         URLs were in the sitemaps and outside the announced set: every prose page, every
         calculator, both /liquidations sub-pages, and all ten coin pages — the last because the
         call site passed a literal `[]` where the live coin slugs belonged. IndexNow is the only
         account-free route into the indexes that are not Google, so for 28% of the site it had
         never fired and never could.
         COMPARED AGAINST THE RENDERED XML, not against src/lib/routes.ts. Both sides now read
         that module, so a check that read it too would agree with itself and prove nothing. And
         BOTH directions: a URL announced but absent from every sitemap is the same defect
         mirrored — /watchlist carries noindex and must never be announced. */
      const { publishedUrls } = await import("../worker/indexnow.ts");
      const listed = new Set();
      for (const path of ROUTES.filter((r) => r.startsWith("/sitemaps/"))) {
        const body = await (await fetch(`http://127.0.0.1:${PORT}${path}`)).text();
        for (const m of body.matchAll(/<loc>(?:https?:\/\/[^/<]+)?([^<]*)<\/loc>/g)) listed.add(m[1] || "/");
      }
      /* The symbols come from what the sitemap itself published, so this tests the STATIC half
         and the wiring rather than re-deriving the contract set from the same snapshot twice. */
      const symbols = [...listed].filter((u) => u.startsWith("/funding/")).map((u) => u.slice("/funding/".length));
      /* Called exactly as the worker calls it — two arguments, no third to get wrong. The
         first version of this check passed the coin slugs itself, so it validated the function
         while the CALL SITE stayed broken, and fault-injecting the original `[]` did not fail
         it. The parameter is gone now; this line and the worker's are the same line. */
      const announced = new Set(publishedUrls("", symbols).map((u) => u || "/"));
      const unannounced = [...listed].filter((u) => !announced.has(u)).sort();
      const unlisted = [...announced].filter((u) => !listed.has(u)).sort();
      if (unannounced.length || unlisted.length) {
        bad++;
        console.log(`  FAIL  ${String(unannounced.length + unlisted.length).padStart(4)}         the sitemaps and IndexNow disagree about what is published`);
        for (const u of unannounced) console.log(`          in a sitemap, never announced: ${u}`);
        for (const u of unlisted) console.log(`          announced, in no sitemap:      ${u}`);
      } else {
        console.log(`  ok            every sitemap URL is announced, and nothing else is`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          sitemap/IndexNow agreement check failed: ${e.message}`);
    }
    try {
      const gaps = await searchIndexGaps(`http://127.0.0.1:${PORT}`);
      if (gaps.length) {
        bad++;
        console.log(`  FAIL  ${String(gaps.length).padStart(4)}         in the sitemaps, absent from search`);
        for (const g of gaps) console.log(`          ${g}`);
      } else {
        console.log(`  ok            every sitemap URL is reachable from search`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          search-index comparison failed: ${e.message}`);
    }
  }

  kill();
  // Give the port back before the next mode binds it.
  await new Promise((s) => setTimeout(s, 1500));
  return bad;
}
