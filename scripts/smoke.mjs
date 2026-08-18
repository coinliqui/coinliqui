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
import { cssFor, undefinedClasses, undefinedVars, rawEnums, searchIndexGaps, unnamedUpstreams, formatterDrift, uncoveredRoutes, unreadableText, chartAgreement, requestedLeverageLabels, inlineScriptSyntax, flipTableColour, colourPalettes, colourLanguageDrift, colourLegend, publishesAPerson, fixtureGaps, staleDerivedCells } from "./checks.mjs";

/* The SERVER side of each duplicated formatter, transcribed from the file that owns it and
   named here so the pairing is explicit. Transcription is the honest cost of having no bundler:
   these are the only lines in the repo that exist to be compared rather than to run, and the
   ladder sweep is what stops them from becoming a third divergent copy.
     qty        <- src/pages/funding/[symbol].astro `compact` (token quantities, no currency)
     compactUsd <- src/lib/chart.ts `compact`        (money at chart scale) */
const SERVER_FORMATTERS = {
  qty: (n) => (Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + "B" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(2) + "K" : n.toFixed(2)),
  compactUsd: (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${Math.round(v)}`;
  },
};

/* Read out of the source, never transcribed here — see colourPalettes(). */
const PALETTE = colourPalettes(readFileSync("src/lib/chart.ts", "utf8"), readFileSync("src/layouts/Base.astro", "utf8"));

const PORT = 8791;
const ROUTES = [
  "/", "/coins", "/coins/bitcoin", "/funding", "/funding/btc", "/funding/kpepe",
  "/open-interest", "/liquidations", "/liquidations/survival", "/liquidations/sweep",
  "/unlocks", "/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost",
  "/tools/funding-arbitrage", "/tools/liquidation-price", "/methodology",
  "/methodology/liquidations", "/data-sources", "/privacy", "/about", "/llms.txt",
  "/.well-known/security.txt", "/watchlist", "/status",
  "/status/indexation", "/404",
  /* THE OTHER BRANCH OF /404, which is the one real people reach.
     404.astro renders two different pages: a generic "that page does not exist" when nothing
     rewrote to it, and "X is not published" when a contract or coin page did. The gate asked
     for /404 — the generic branch — and so rendered green for as long as the other branch
     threw. Route coverage could not help: both branches live in one template, and the template
     was covered. A gate that asks for one URL per template sees one path through it. */
  "/funding/notacoin", "/coins/notacoin",
  "/api/live.json", "/robots.txt", "/sitemap-index.xml",
  "/search-index.json", "/rail",
  /* EVERY sitemap, not a sample. Six of these were never requested by anything until the
     coverage check below started comparing this list against the build manifest — so a 500 in
     one of them would have shipped green and been served to Googlebot. */
  "/sitemaps/coins.xml", "/sitemaps/funding-symbols.xml", "/sitemaps/funding-hub.xml",
  "/sitemaps/liquidations.xml", "/sitemaps/open-interest.xml", "/sitemaps/pages.xml",
  "/sitemaps/tools.xml", "/sitemaps/unlocks.xml",
];
/** Routes whose correct answer is not 200.
 *  /rail exports POST only — the rail's collapsed state is decided server-side so there is no
 *  flash — so a GET is correctly 404. That proves the route exists and does not crash on an
 *  unexpected method; it does NOT exercise the POST handler, and this comment says so rather
 *  than letting a green line imply otherwise. */
const EXPECT = { "/tools/liquidation-price": 410, "/404": 404, "/rail": 404,
  "/funding/notacoin": 404, "/coins/notacoin": 404 };

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

  /* EVERY inline island must PARSE. A SyntaxError kills the whole island and every handler in
     it, while the server render stays perfect — so this is the one class the rest of the gate
     is structurally unable to see. */
  const walkAstro = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkAstro(`${d}/${e.name}`) : e.name.endsWith(".astro") ? [`${d}/${e.name}`] : []);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".astro") ? [`${d}/${e.name}`] : []);
  const syn = walk("src/pages").concat(["src/layouts/Base.astro"])
    .flatMap((p) => { try { return inlineScriptSyntax(readFileSync(p, "utf8"), p); } catch { return []; } });
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
      const libs = readdirSync("src/lib").filter((f) => f.endsWith(".ts")).map((f) => [`src/lib/${f}`, readFileSync(`src/lib/${f}`, "utf8")]);
      const gaps = fixtureGaps(libs, keys);
      if (gaps.length) { failures++; console.log(`\n  FAIL  the warm fixture cannot render ${gaps.length} feature(s):`); for (const g of gaps) console.log(`          ${g}`); }
      else console.log(`\n  ok    the warm fixture covers every KV series the code reads (${keys.length} keys)`);
    } catch (e) {
      failures++;
      console.log(`\n  FAIL  fixture coverage could not be checked: ${e.message}`);
    }
  }

  /* Source invariant: a cell computed from a live rate must be repainted with it. The overlay
     shipped this defect once and a rendered page cannot reveal a MISSING attribute. */
  const stale = staleDerivedCells(walkAstro("src/pages").map((f) => [f, readFileSync(f, "utf8")]));
  if (stale.length) { failures++; console.log(`\n  FAIL  ${stale.length} cell(s) derived from a live rate are never repainted:`); for (const l of stale) console.log(`          ${l}`); }

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
  const empty = body.length === 0;
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
    /* Warm only, and only the homepage — the flip feed exists nowhere else. This is also the
       assertion that keeps the D1 fixture honest: if it is empty the feed renders a placeholder
       and this fails, rather than every check on that table silently having nothing to look at. */
    if (path === "/") content.push(...flipTableColour(body));
    /* Two colour languages now exist. A page may speak either, and must name whichever it
       speaks — a rule that only means anything if it is asserted per page rather than once. */
    content.push(...colourLegend(body, PALETTE));
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
      const css = await cssFor(await (await fetch(`http://127.0.0.1:${PORT}/`)).text(), `http://127.0.0.1:${PORT}`);
      const un = unreadableText(css);
      if (un.length) {
        bad++;
        console.log(`  FAIL  ${String(un.length).padStart(4)}         text colour below WCAG AA on a surface it is used on`);
        for (const l of un) console.log(`          ${l}`);
      } else {
        console.log(`  ok            every text token clears 4.5:1 on every surface`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          contrast check failed: ${e.message}`);
    }
    try {
      const drift = formatterDrift(await readFile("public/interact.js", "utf8"), SERVER_FORMATTERS);
      if (drift.length) {
        bad++;
        console.log(`  FAIL  ${String(drift.length).padStart(4)}         server and client format the same number differently`);
        for (const line of drift) console.log(`          ${line}`);
      } else {
        console.log(`  ok            server and client formatters agree across the ladder`);
      }
    } catch (e) {
      bad++;
      console.log(`  FAIL          formatter comparison failed: ${e.message}`);
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
