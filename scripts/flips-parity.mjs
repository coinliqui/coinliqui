/**
 * DOES THE STORED FEED SAY EXACTLY WHAT THE QUERY WOULD HAVE SAID?
 *
 * The flip feed moved from "computed by the page on every render" to "computed by the worker
 * once per pass and stored in KV". The computation did not change — same function, same SQL —
 * but "should be identical" is a claim, and this is the thing that measures it: recompute from
 * production D1 right now, read what the worker stored, and compare row for row, in order,
 * including the fields nobody looks at.
 *
 * Ordering and dedupe are checked explicitly rather than implied by a set comparison, because
 * both have been defects here before: the feed once listed every flip event in the window, so
 * one contract appeared four times under a column headed "Now (APR)", and the fix was a
 * ROW_NUMBER dedupe that a careless refactor could silently drop while every row still looked
 * plausible.
 *
 *   node --experimental-strip-types scripts/flips-parity.mjs
 *
 * Requires wrangler auth; run `npm run preflight` first if anything looks like a permission
 * problem, because three times on this project it was an expired token instead.
 */
import { execFileSync } from "node:child_process";
import { readFlips, FLIPS_KEY } from "../src/lib/flips.ts";

const NS = "09d5ddc598f34f36b11d367aac0aad87";
const DB = "coinliqui";

const sh = (args) => execFileSync("npx", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** A D1Like that goes through wrangler, so the SQL executed is the SQL the worker executes. */
const remoteD1 = {
  prepare(sql) {
    const run = (binds) => {
      let bound = sql;
      binds.forEach((b, i) => { bound = bound.replaceAll(`?${i + 1}`, typeof b === "number" ? String(b) : `'${String(b).replace(/'/g, "''")}'`); });
      const out = sh(["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", bound]);
      const j = JSON.parse(out.slice(out.indexOf("[")));
      return j[0]?.results ?? [];
    };
    const api = {
      bind: (...binds) => ({ all: async () => ({ results: run(binds) }), first: async () => run(binds)[0] ?? null }),
      all: async () => ({ results: run([]) }),
      first: async () => run([])[0] ?? null,
    };
    return api;
  },
};

console.log("recomputing the flip feed from production D1 …");
const live = await readFlips(remoteD1, 24);

console.log("reading what the worker stored …");
const raw = sh(["wrangler", "kv", "key", "get", "--remote", "--namespace-id", NS, FLIPS_KEY]);
const stored = JSON.parse(raw);

const fail = [];
const ageMin = Math.round((Date.now() - stored.computedAt) / 60000);
console.log(`  stored feed computed ${ageMin} min ago`);

if (live.status !== stored.result.status) fail.push(`status: live "${live.status}" vs stored "${stored.result.status}"`);

if (live.status === "ready" && stored.result.status === "ready") {
  const a = live.rows, b = stored.result.rows;
  if (a.length !== b.length) fail.push(`row count: live ${a.length} vs stored ${b.length}`);
  if (live.total !== stored.result.total) fail.push(`total: live ${live.total} vs stored ${stored.result.total}`);

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (const f of ["symbol", "venue", "prevApr", "apr", "at", "gapMin"]) {
      if (a[i][f] !== b[i][f]) fail.push(`row ${i} field ${f}: live ${a[i][f]} vs stored ${b[i][f]}`);
    }
  }

  /* ORDERING — the query says ORDER BY at DESC, and a set comparison would not notice if it
     stopped doing so. */
  for (const [name, rows] of [["live", a], ["stored", b]]) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].at > rows[i - 1].at) { fail.push(`${name} rows are not in descending time order at index ${i}`); break; }
    }
  }

  /* DEDUPE — one row per symbol+venue. This is the invariant that was violated in production. */
  for (const [name, rows] of [["live", a], ["stored", b]]) {
    const seen = new Set();
    for (const r of rows) {
      const k = `${r.symbol}|${r.venue}`;
      if (seen.has(k)) { fail.push(`${name} feed lists ${k} more than once — the dedupe is gone`); break; }
      seen.add(k);
    }
  }

  console.log(`  compared ${n} row(s); total live ${live.total} / stored ${stored.result.total}`);
}

if (fail.length) {
  console.error("\nflip parity FAILED:");
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log("\n  the stored feed is identical to a live recomputation — same rows, same order, one row per contract");
