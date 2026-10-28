#!/usr/bin/env node
/**
 * ARRIVALS, BY DAY — read from entry_day, the server-side count src/lib/entries.ts keeps.
 *
 * Every navigation a browser makes to a page is counted once, without JavaScript and without
 * sampling, split by how it arrived (direct: typed, bookmarked or from an app; external: from
 * another site; internal: from a page of this one) and by source host. The deploy's own live
 * check arrives as utm_source=coinliqui-selfcheck and is left out of every figure here.
 *
 * The operator reads the site from Georgia; --exclude=GE (the default) leaves those rows out, and
 * --exclude= with nothing keeps everything.
 *
 *   node scripts/entries.mjs [--days=14] [--exclude=GE,..]
 */
import { execFileSync } from "node:child_process";

const DAYS = Math.max(1, Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 14);
const since = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
const sql = (q) => {
  const raw = execFileSync("npx", ["wrangler", "d1", "execute", "coinliqui", "--remote", "--json", "--command", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
};
const EXCL = ((process.argv.find((a) => a.startsWith("--exclude=")) ?? "--exclude=GE").split("=")[1] || "").split(",").filter((c) => /^[A-Z]{2}$/.test(c));
const SELF = "src <> 'coinliqui-selfcheck'" + (EXCL.length ? ` AND country NOT IN (${EXCL.map((c) => `'${c}'`).join(",")})` : "");
const fam = (p) => (p === "/" ? "/" : p.split("/").length > 2 ? `/${p.split("/")[1]}/{x}` : p);

const days = sql(`SELECT day, how, SUM(n) AS n FROM entry_day WHERE day >= '${since}' AND ${SELF} GROUP BY day, how ORDER BY day`);
console.log(`\n=== Arrivals · coinliqui.com · since ${since} · server-side, unsampled${EXCL.length ? ` · without ${EXCL.join(", ")}` : ""} ===\n`);
console.log("   day          direct  external  internal");
const byDay = {};
for (const r of days) (byDay[r.day] ??= { direct: 0, external: 0, internal: 0 })[r.how] = r.n;
for (const [d, v] of Object.entries(byDay)) console.log(`   ${d}  ${String(v.direct).padStart(6)}  ${String(v.external).padStart(8)}  ${String(v.internal).padStart(8)}`);

console.log("\n   sources of arrivals from outside (direct + external)");
for (const r of sql(`SELECT src, SUM(n) AS n FROM entry_day WHERE day >= '${since}' AND how <> 'internal' AND ${SELF} GROUP BY src ORDER BY n DESC LIMIT 15`))
  console.log(`   ${String(r.n).padStart(6)}  ${r.src}`);

console.log("\n   countries of arrivals from outside");
for (const r of sql(`SELECT country, SUM(n) AS n FROM entry_day WHERE day >= '${since}' AND how <> 'internal' AND ${SELF} GROUP BY country ORDER BY n DESC LIMIT 10`))
  console.log(`   ${String(r.n).padStart(6)}  ${r.country}`);

console.log("\n   landing pages, by family (direct + external)");
const fams = {};
for (const r of sql(`SELECT path, device, SUM(n) AS n FROM entry_day WHERE day >= '${since}' AND how <> 'internal' AND ${SELF} GROUP BY path, device`)) {
  const f = (fams[fam(r.path)] ??= { desktop: 0, mobile: 0 }); f[r.device] += r.n;
}
for (const [f, v] of Object.entries(fams).sort((a, b) => b[1].desktop + b[1].mobile - a[1].desktop - a[1].mobile))
  console.log(`   ${String(v.desktop + v.mobile).padStart(6)}  ${f.padEnd(22)} desktop ${v.desktop}, mobile ${v.mobile}`);
console.log("");
