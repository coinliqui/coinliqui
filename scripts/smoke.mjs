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

const PORT = 8791;
const ROUTES = [
  "/", "/coins", "/coins/bitcoin", "/funding", "/funding/btc", "/funding/kpepe",
  "/open-interest", "/liquidations", "/liquidations/survival", "/liquidations/sweep",
  "/unlocks", "/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost",
  "/tools/funding-arbitrage", "/tools/liquidation-price", "/methodology",
  "/methodology/liquidations", "/data-sources", "/privacy", "/watchlist", "/status",
  "/status/indexation", "/404", "/api/live.json", "/robots.txt", "/sitemap-index.xml",
  "/sitemaps/coins.xml", "/sitemaps/funding-symbols.xml", "/search-index.json",
];
/** Routes whose correct answer is not 200. */
const EXPECT = { "/tools/liquidation-price": 410, "/404": 404 };

const warmDir = process.argv.includes("--warm") ? process.argv[process.argv.indexOf("--warm") + 1] : null;
const MODES = warmDir ? [{ name: "cold", args: [] }, { name: "warm", args: ["--kv", "SNAPSHOT", "--d1", "DB", "--persist-to", warmDir] }]
                      : [{ name: "cold", args: [] }];

let failures = 0;
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
  const ok = okStatus && !empty && !crashed && !err;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${String(status || err).padEnd(4)} ${String(body.length).padStart(7)}b  ${path}` +
      (crashed ? "   <- runtime error in the body" : empty ? "   <- EMPTY BODY" : ""),
  );
}

  kill();
  // Give the port back before the next mode binds it.
  await new Promise((s) => setTimeout(s, 1500));
  return bad;
}
