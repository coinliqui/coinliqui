#!/usr/bin/env node
/**
 * THE SEARCH CONSOLE EXPORT RUNS ONCE A DAY, NEVER CARRIES THE KEY, AND SURVIVES A BAD DAY.
 *
 * The step is run for real against a fake Google and a fake KV: a real RSA key is generated
 * here so the worker's own WebCrypto signing path executes. What must hold:
 *   - the record in KV never contains the private key — the whole point is that the key stays
 *     in the worker and only data leaves it;
 *   - a failed call is stamped, so the next five-minute tick does NOT retry (no burst at Google);
 *   - the data already there survives a failure;
 *   - a table that fills the row limit says so;
 *   - the daily table marks a one-night step, the reading the weekly windows lost.
 *
 *   node --experimental-strip-types scripts/gsc-export-cases.mjs
 *   node --experimental-strip-types scripts/gsc-export-cases.mjs --blind   a step with none of that, which must fail
 */
import { generateKeyPairSync } from "node:crypto";
import { stepGscExport, GSC_EXPORT_KEY, GSC_ROW_LIMIT } from "../worker/gsc-export.ts";
import { dailyLines } from "../worker/report.ts";

const blind = process.argv.includes("--blind");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const SA_KEY = JSON.stringify({ client_email: "cases@example.iam.gserviceaccount.com", private_key: pem });
const PEM_BODY = pem.split("\n")[1];

/* THE OLD SHAPE, reproduced: export on every tick, overwrite on failure, never flag a cut. */
const naive = async (env, now) => {
  if (!env.GSC_SA_KEY) return null;
  try {
    const r = await fetch("https://www.googleapis.com/webmasters/v3/sites/x/searchAnalytics/query", { method: "POST", body: JSON.stringify({ dimensions: ["date"] }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    await env.SNAPSHOT.put(GSC_EXPORT_KEY, JSON.stringify({ v: 1, at: now, attemptAt: now, key: env.GSC_SA_KEY, series: { rows: j.rows }, pageDate: { rows: [], truncated: false } }));
    return "ran";
  } catch { await env.SNAPSHOT.put(GSC_EXPORT_KEY, JSON.stringify({ v: 1, at: now, series: { rows: [] } })); return "failed"; }
};
const step = blind ? naive : stepGscExport;
const days = blind ? (rows) => rows.map((r) => `| ${r.keys[0]} | ${r.impressions} |`) : dailyLines;

let calls = 0, mode = "ok", pageRows = 3;
globalThis.fetch = async (url, init) => {
  calls++;
  if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "t" }));
  if (mode === "error") return new Response(JSON.stringify({ error: { code: 403, message: "User does not have sufficient permission" } }));
  const dims = JSON.parse(init.body).dimensions;
  const rows = dims[0] === "date"
    ? [{ keys: ["2026-08-31"], clicks: 0, impressions: 70, position: 62.7 }, { keys: ["2026-09-01"], clicks: 0, impressions: 26, position: 14.2 }]
    : Array.from({ length: dims[0] === "page" ? pageRows : 2 }, (_, i) => ({ keys: [dims[0] === "page" ? `https://coinliqui.com/funding/c${i}` : `q${i}`, "2026-09-01"], clicks: 0, impressions: 1, position: 9 }));
  return new Response(JSON.stringify({ rows }));
};
const kv = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => { m.set(k, v); } }; };

let bad = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };
const T = Date.parse("2026-10-15T07:00:00Z");

console.log(`\nthe Search Console export${blind ? "  [BLIND: every tick, overwrite on failure]" : ""}\n`);
{
  const S = kv(); calls = 0;
  ok((await step({ SNAPSHOT: S }, T)) === null && S.m.size === 0 && calls === 0, "no key in the worker: nothing runs, nothing is written");
}
{
  const S = kv(); calls = 0;
  await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, T);
  const rec = S.m.get(GSC_EXPORT_KEY) || "";
  ok(rec.length > 0 && !rec.includes(PEM_BODY) && !rec.includes("PRIVATE KEY"), "the record in KV carries data and never the key");
  const doc = JSON.parse(rec || "{}");
  ok(doc.pageDate?.rows?.[0]?.[0] === "/funding/c0", "pages are stored as paths, not as full URLs");
  calls = 0;
  ok((await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, T + 5 * 60_000)) === null && calls === 0, "the next five-minute tick does not run again");
  mode = "error"; calls = 0;
  await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, T + 23 * 3_600_000);
  const after = JSON.parse(S.m.get(GSC_EXPORT_KEY));
  ok(after.series?.rows?.length === 2 && /permission/.test(after.error || ""), "a failed day keeps yesterday's data and says why");
  calls = 0;
  ok((await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, T + 23 * 3_600_000 + 5 * 60_000)) === null && calls === 0, "a failure is not retried on the next tick — no burst at Google");
  mode = "ok";
}
{
  const S = kv(); pageRows = GSC_ROW_LIMIT;
  await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, T);
  ok(JSON.parse(S.m.get(GSC_EXPORT_KEY)).pageDate?.truncated === true, "a table that fills the row limit is flagged as a floor");
  pageRows = 3;
}
{
  const S = kv(); calls = 0;
  ok((await step({ SNAPSHOT: S, GSC_SA_KEY: SA_KEY }, Date.parse("2026-10-15T03:00:00Z"))) === null && calls === 0, "before 06:00 UTC it waits for Google's daily data");
}
{
  const cliff = [{ keys: ["2026-08-31"], clicks: 0, impressions: 70, position: 62.7 }, { keys: ["2026-09-01"], clicks: 0, impressions: 26, position: 14.2 }];
  ok(days(cliff).join("\n").includes("← step"), "70 → 26 overnight is marked as a step in the daily table");
  const calm = [{ keys: ["2026-09-30"], clicks: 0, impressions: 13, position: 27 }, { keys: ["2026-10-01"], clicks: 0, impressions: 5, position: 50 }];
  ok(!dailyLines(calm).join("\n").includes("← step"), "13 → 5 is noise at this size, not a step");
}

{
  /* WHERE IT RUNS IN THE TICK. It ends the tick when it works, so it must come after the flip
     feed: placed before it on 15.10.2026, the first live run left D1 holding a pass the feed
     never read. The real file must pass, and the shipped mistake must be caught. */
  const { readFileSync } = await import("node:fs");
  const after = (src, call = "await stepGscExport(") => { const g = src.indexOf(call), f = src.lastIndexOf("result.flips ="); return g > 0 && f > 0 && g > f; };
  const orderOk = blind ? () => true : after;
  const real = readFileSync(new URL("../worker/ingest.ts", import.meta.url), "utf8");
  ok(after(real), "worker/ingest.ts runs the export after the flip feed is written");
  ok(after(real, "await stepReport(env)"), "and the weekly report, which takes the tick the same way, after it too");
  const shipped = "const gsc = await stepGscExport(env);\n...\nresult.flips = feed.status;";
  ok(!orderOk(shipped), "the order that shipped first — export before the flip feed — is caught");
}

if (blind) {
  if (!bad) { console.error("\nBLIND: the naive export satisfied every assertion. This suite cannot see a key leak or a retry storm."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against the naive export`);
  process.exit(0);
}
if (bad) { console.error(`\ngsc export cases FAILED: ${bad}`); process.exit(1); }
console.log("\ngsc export cases: once a day, data without the key, a bad day kept and not retried, a step marked");
