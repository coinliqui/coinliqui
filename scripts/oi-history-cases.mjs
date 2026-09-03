#!/usr/bin/env node
/**
 * THE OPEN-INTEREST DELTA, AGAINST THE STATES IT WILL ACTUALLY BE IN.
 *
 * This reading is a state before it is a number, and the states are the part that goes wrong.
 * For the first day after migrations/0003 lands the live table holds nothing to compare against;
 * for the day after that it holds some symbols and not others; and a contract listed since the
 * stored reading has no history at all. Each of those must produce a DIFFERENT output, and the
 * one thing none of them may produce is a change of 0.00% — which is what every naive
 * implementation prints, and which claims the market did not move when the truth is that nobody
 * was watching.
 *
 * The reader runs against a real SQLite file here, through the same D1Like shape the worker and
 * the pages use, so the SQL is executed rather than described.
 *
 *   node --experimental-strip-types scripts/oi-history-cases.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readOiHistory, oiChange } from "../src/lib/oi-history.ts";

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};

/** A D1Like over an in-memory database, so the statements are the ones production runs. */
const dbWith = (rows, withTable = true) => {
  const db = new DatabaseSync(":memory:");
  if (withTable) {
    db.exec("CREATE TABLE oi_snapshot (symbol TEXT NOT NULL, oi REAL NOT NULL, at INTEGER NOT NULL)");
    const ins = db.prepare("INSERT INTO oi_snapshot (symbol,oi,at) VALUES (?,?,?)");
    for (const r of rows) ins.run(...r);
  }
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      const run = (args) => ({
        all: () => Promise.resolve({ results: st.all(...args) }),
        first: () => Promise.resolve(st.get(...args) ?? null),
      });
      return { bind: (...a) => run(a), ...run([]) };
    },
  };
};

const now = Date.now();
const hoursAgo = (h) => now - h * 3_600_000;

console.log("\nopen-interest history — the states before the number\n");

{
  const h = await readOiHistory(undefined, now);
  ok(h.status === "no-store", "no binding says nothing rather than guessing", h.status);
}
{
  /* THE TABLE DOES NOT EXIST YET, which is every request between deploying the page and running
     the migration. The page must render without a delta column, not 500. */
  const h = await readOiHistory(dbWith([], false), now);
  ok(h.status === "no-store", "a missing table degrades to no-store rather than throwing", h.status);
}
{
  /* DAY ONE. Rows exist but none reach back 24 hours: the honest answer is how much IS held. */
  const rows = [["BTC", 1e9, hoursAgo(3)], ["BTC", 1.01e9, hoursAgo(2)]];
  const h = await readOiHistory(dbWith(rows), now);
  ok(h.status === "warming", "history shorter than the window reports warming, not a zero change", h.status);
  ok(h.status === "warming" && h.covered >= 2.9 && h.covered <= 3.1, "and says how many hours it does hold", `covered=${h.status === "warming" ? h.covered.toFixed(1) : "?"}`);
  ok(oiChange(h, "BTC", 2e9) === null, "a change cannot be computed from a warming history");
}
{
  /* THE NORMAL CASE, and the delta must come from the reading nearest the cutoff rather than the
     oldest row in the table — an easy mistake that quietly measures over the whole retention. */
  const rows = [
    ["BTC", 1.0e9, hoursAgo(72)],
    ["BTC", 2.0e9, hoursAgo(25)],
    ["BTC", 2.5e9, hoursAgo(1)],
  ];
  const h = await readOiHistory(dbWith(rows), now);
  ok(h.status === "ready", "a table reaching past the window is ready", h.status);
  const d = oiChange(h, "BTC", 3.0e9);
  ok(d !== null && Math.abs(d - 0.5) < 1e-9, "the delta is measured from the reading nearest the cutoff", `${((d ?? 0) * 100).toFixed(1)}%`);
}
{
  /* A MISSED HOUR must not blank the column: the band reaches further back and takes the nearest
     earlier row, which is the same rule the freshness clock uses. */
  const rows = [["ETH", 8e8, hoursAgo(26)], ["ETH", 9e8, hoursAgo(2)]];
  const h = await readOiHistory(dbWith(rows), now);
  ok(h.status === "ready", "a gap at the exact cutoff still yields a comparison", h.status);
  ok(oiChange(h, "ETH", 9e8) !== null, "and the symbol has a change");
}
{
  /* THE ABSENCE THAT MATTERS. A contract listed since the stored reading has no history, and the
     page must show an em dash. Printing 0.00% would claim it had not moved. */
  const rows = [["BTC", 1e9, hoursAgo(25)]];
  const h = await readOiHistory(dbWith(rows), now);
  ok(oiChange(h, "NEWCOIN", 5e8) === null, "a symbol with no stored reading has no change, not zero");
  ok(oiChange(h, "BTC", 1e9) === 0, "and a symbol that genuinely did not move reports exactly zero");
}
{
  /* A STORED ZERO OR NEGATIVE cannot be a denominator. Division would give Infinity and the page
     would print it. */
  const rows = [["BAD", 0, hoursAgo(25)], ["NEG", -5, hoursAgo(25)]];
  const h = await readOiHistory(dbWith(rows), now);
  ok(oiChange(h, "BAD", 1e9) === null, "a stored zero is not used as a denominator");
  ok(oiChange(h, "NEG", 1e9) === null, "nor is a negative one");
}
{
  /* THE WINDOW IS REPORTED, not assumed. A delta labelled 24h that was measured over 26 is the
     defect this codebase keeps finding. */
  const rows = [["BTC", 1e9, hoursAgo(26)]];
  const h = await readOiHistory(dbWith(rows), now);
  ok(h.status === "ready" && h.since <= hoursAgo(25.9), "the reading's own timestamp comes back with it", h.status === "ready" ? new Date(h.since).toISOString().slice(11, 16) : "?");
}

console.log(bad ? `\n${bad} failure(s)\n` : "\nevery state the delta can be in is distinct, and none of them is a fabricated zero\n");
process.exit(bad ? 1 : 0);
