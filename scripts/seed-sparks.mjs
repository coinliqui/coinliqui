#!/usr/bin/env node
/**
 * THE ONE-OFF BACKFILL FOR THE FUNDING SHAPE COLUMN.
 *
 * The worker maintains spark:funding by appending one four-hour bucket per boundary, which reads
 * about 4,900 rows of D1. It can also cold-start itself from nothing — but that path reads
 * 201,599 rows in a single tick, inside the same invocation that writes the snapshot every page
 * on the site depends on. Doing it from here instead means the first reader sees seven days of
 * history rather than four hours of it, and the worker never has to take that read at all.
 *
 * RUN IT ONCE, DELIBERATELY. It is not part of any gate and nothing calls it automatically:
 *
 *   node scripts/seed-sparks.mjs            # build and show what it would write
 *   node scripts/seed-sparks.mjs --write    # and put it in KV
 *
 * The bucket arithmetic is imported rather than restated — the worker, the pages and this script
 * disagreeing about where a bucket starts would put one contract's newest point in a different
 * column from its neighbour's, which is the shared-axis fault in the other dimension.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { SPARK_KEY, SPARK_POINTS, SPARK_STEP_MS, bucketOf } from "../src/lib/sparks.ts";

const write = process.argv.includes("--write");
const KV_ID = "09d5ddc598f34f36b11d367aac0aad87";

const d1 = (sql) => {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "coinliqui", "--remote", "--command", sql, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("[")))[0];
};

/* The symbols the site actually publishes, from the live snapshot rather than from the table:
   funding_snapshot retains 30 days and therefore still holds contracts that have since left
   coverage, and seeding a shape for a URL that no longer exists is a row nothing will ever read. */
const published = await fetch("https://coinliqui.com/api/live.json", { headers: { "user-agent": "coinliqui-seed" } })
  .then((r) => r.json())
  .then((j) => Object.keys(j?.mark ?? {}))
  .catch(() => []);
if (!published.length) {
  console.error("could not read the published set from /api/live.json — refusing to guess it from the table");
  process.exit(1);
}

const lastDone = bucketOf(Date.now()) - 1;
const from = (lastDone - SPARK_POINTS + 1) * SPARK_STEP_MS;
const inList = published.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
const res = d1(
  `SELECT symbol, CAST(at / ${SPARK_STEP_MS} AS INTEGER) AS b, AVG(apr) AS apr
     FROM funding_snapshot
    WHERE symbol IN (${inList}) AND venue = 'HlPerp' AND at >= ${from} AND at < ${(lastDone + 1) * SPARK_STEP_MS}
    GROUP BY symbol, b`,
);

const by = new Map();
for (const r of res.results ?? []) {
  if (!Number.isFinite(r.apr)) continue;
  if (!by.has(r.symbol)) by.set(r.symbol, new Map());
  by.get(r.symbol).set(r.b, r.apr);
}

/* DENSE AND ENDING AT THE SAME BUCKET FOR EVERY CONTRACT, carrying the previous reading across a
   missed bucket. A contract with no reading at all is left out of the map rather than given a
   line of zeros — the page renders that as a dash, which is the honest statement. */
const series = {};
for (const sym of published) {
  const got = by.get(sym);
  if (!got) continue;
  const out = [];
  let carry = NaN;
  for (let b = lastDone - SPARK_POINTS + 1; b <= lastDone; b++) {
    const v = got.get(b);
    if (Number.isFinite(v)) carry = v;
    if (Number.isFinite(carry)) out.push(Number(carry.toFixed(5)));
  }
  if (out.length > 1) series[sym] = out;
}

const map = { v: 1, bucket: lastDone, at: Date.now(), series };
const json = JSON.stringify(map);
const lens = Object.values(series).map((s) => s.length);
console.log(`published ${published.length} · rows read ${res.meta?.rows_read} · symbols with a shape ${Object.keys(series).length}`);
console.log(`points per symbol: min ${Math.min(...lens)} max ${Math.max(...lens)} of ${SPARK_POINTS}`);
console.log(`payload ${json.length} bytes · newest bucket ${lastDone} (${new Date(lastDone * SPARK_STEP_MS).toISOString()})`);
console.log(`missing a shape: ${published.filter((s) => !series[s]).join(", ") || "none"}`);

if (!write) { console.log("\ndry run — pass --write to put it in KV"); process.exit(0); }
const tmp = `/tmp/spark-seed-${Date.now()}.json`;
writeFileSync(tmp, json);
try {
  execFileSync("npx", ["wrangler", "kv", "key", "put", SPARK_KEY, "--path", tmp, "--namespace-id", KV_ID, "--remote"],
    { stdio: "inherit" });
  console.log(`\nwrote ${SPARK_KEY}`);
} finally { unlinkSync(tmp); }
