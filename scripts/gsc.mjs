#!/usr/bin/env node
/**
 * SEARCH CONSOLE ON THIS MACHINE, WITH THE KEY NOWHERE NEAR IT.
 *
 * The worker reads Search Console once a day with the key only it holds and writes the result
 * to KV as `gsc:export` (worker/gsc-export.ts). This reads that record through wrangler, whose
 * OAuth login is already here, short-lived, and scoped to the Cloudflare account. There is no
 * URL that serves the record and no secret to export into a shell — the predecessor of this
 * file, gsc-report.mjs, asked for exactly that, and was removed on 15 October 2026 when the
 * operator ruled that the key does not go on the laptop.
 *
 *   node scripts/gsc.mjs                 daily series, weeks, pages and queries that moved
 *   node scripts/gsc.mjs --json out.json the raw record, for a question this summary does not ask
 *
 * READ THE DAILY TABLE FIRST. The weekly report once printed a one-night cliff as a two-week
 * decay; the step marker here is the reading that settled what caused it.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dailyLines } from "../worker/report.ts";

const NS = "09d5ddc598f34f36b11d367aac0aad87";
const KEY = "gsc:export";

let raw;
try {
  raw = execFileSync("npx", ["wrangler", "kv", "key", "get", "--namespace-id", NS, "--remote", KEY], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.error(`could not read ${KEY} through wrangler — run: npx wrangler whoami, then this again\n${String(e.stderr || e.message).slice(0, 300)}`);
  process.exit(1);
}
/* wrangler prints a proxy notice above the value on some networks; the record starts at "{". */
const start = raw.indexOf("{");
if (start < 0) {
  console.error(`${KEY} is not in KV yet. The worker writes it once a day after 06:00 UTC, and only with GSC_SA_KEY set.`);
  process.exit(1);
}
const doc = JSON.parse(raw.slice(start));

const out = process.argv.indexOf("--json");
if (out > 0) {
  writeFileSync(process.argv[out + 1], JSON.stringify(doc, null, 2));
  console.log(`wrote ${process.argv[out + 1]}`);
  process.exit(0);
}

const hours = (ms) => `${Math.round((Date.now() - ms) / 3_600_000)}h ago`;
console.log(`\n=== Search Console · ${doc.site} · exported ${doc.at ? new Date(doc.at).toISOString().slice(0, 16).replace("T", " ") + " UTC, " + hours(doc.at) : "never"} ===`);
if (doc.error) console.log(`   LAST ATTEMPT FAILED ${hours(doc.attemptAt)}: ${doc.error}\n   (the data below is from the last success)`);
for (const k of ["pageDate", "queryDate", "queryPage"]) if (doc[k]?.truncated) console.log(`   ${k} hit the 25,000-row limit — its totals are a floor`);
if (!doc.series?.rows?.length) { console.log("   no rows"); process.exit(0); }

/* 1. Every day, oldest first. dataState "all": the last two days are still filling in. */
const asApi = (rows) => rows.map(([k, c, i, p]) => ({ keys: [k], clicks: c, impressions: i, position: p }));
const series = doc.series.rows;
console.log(`\n1. by day, last 56 of ${series.length} (the newest two are still filling in)\n`);
for (const l of dailyLines(asApi(series.slice(-56)))) console.log("   " + l);

/* 2. Monday weeks, so they line up with the weekly report's ISO weeks. */
const monday = (d) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const weeks = new Map();
for (const [d, c, i] of series) { const w = monday(d); const a = weeks.get(w) ?? { c: 0, i: 0, n: 0 }; a.c += c; a.i += i; a.n++; weeks.set(w, a); }
console.log("\n2. by week (Monday start; a week with fewer than 7 days says so)\n");
for (const [w, a] of [...weeks].slice(-12)) console.log(`   ${w}  ${String(a.i).padStart(5)} imp  ${String(a.c).padStart(3)} clk${a.n < 7 ? `   (${a.n} days)` : ""}`);

/* 3. Pages and queries: the last 28 days against the 28 before. */
const lastDay = series.at(-1)[0];
const cut = new Date(Date.parse(lastDay) - 27 * 86_400_000).toISOString().slice(0, 10);
const cmp = (rows) => {
  const m = new Map();
  for (const [k, d, , i] of rows) { const a = m.get(k) ?? { now: 0, before: 0 }; if (d >= cut) a.now += i; else a.before += i; m.set(k, a); }
  return [...m].map(([k, a]) => ({ k, ...a, d: a.now - a.before }));
};
const show = (title, rows) => {
  const all = cmp(rows);
  const tot = all.reduce((s, r) => ({ now: s.now + r.now, before: s.before + r.before }), { now: 0, before: 0 });
  console.log(`\n${title} — impressions from ${cut} against the 28 days before (${tot.before} → ${tot.now}; named only)\n`);
  for (const r of [...all].sort((a, b) => a.d - b.d).slice(0, 10)) console.log(`   ${String(r.before).padStart(5)} → ${String(r.now).padEnd(5)} ${r.k}`);
  const up = [...all].sort((a, b) => b.d - a.d).filter((r) => r.d > 0).slice(0, 5);
  if (up.length) { console.log("   gained:"); for (const r of up) console.log(`   ${String(r.before).padStart(5)} → ${String(r.now).padEnd(5)} ${r.k}`); }
};
show("3. pages", doc.pageDate.rows);
show("4. queries", doc.queryDate.rows);
console.log("");
