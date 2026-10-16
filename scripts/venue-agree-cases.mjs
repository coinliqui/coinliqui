#!/usr/bin/env node
/**
 * THE CROSS-VENUE COMPARISON, RUN ON A REAL SQLITE FILE.
 *
 * The statement is executed here, not described: worker/venue-agreement.ts's SQL against rows
 * whose answer was worked out by hand — hours averaged before signs are compared, a zero that is
 * not a disagreement, a venue hour with no Hyperliquid hour beside it. `--blind` runs a version
 * that compares five-minute rows instead of hourly means and counts a zero as opposite; the cases
 * must fail against it. The cadence is pinned too: once in twenty hours, a failure included.
 *
 *   node --experimental-strip-types scripts/venue-agree-cases.mjs [--blind]
 */
import { DatabaseSync } from "node:sqlite";
import { VENUE_AGREE_SQL, stepVenueAgreement, venueAgreeDue } from "../worker/venue-agreement.ts";
import { VENUE_AGREE_KEY, agreementFor } from "../src/lib/venue-agreement.ts";

const BLIND = process.argv.includes("--blind");
const H = 3_600_000, M = 60_000;
const NOW = 1_790_000_000_000 - (1_790_000_000_000 % H);
const T = NOW - 10 * H;

let bad = 0;
const ok = (c, what) => { if (c) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };

const NAIVE_SQL = `
  SELECT a.symbol AS symbol, b.venue AS venue, COUNT(*) AS n,
         SUM(CASE WHEN (a.apr >= 0 AND b.apr <= 0) OR (a.apr <= 0 AND b.apr >= 0) THEN 1 ELSE 0 END) AS opp,
         AVG(ABS(a.apr - b.apr)) AS gap, MIN(a.at / ${H}) AS first
    FROM funding_snapshot a JOIN funding_snapshot b ON a.symbol = b.symbol AND a.at = b.at
   WHERE a.venue = 'HlPerp' AND b.venue != 'HlPerp' AND a.at >= ?1
   GROUP BY a.symbol, b.venue`;

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE funding_snapshot (symbol TEXT, venue TEXT, apr REAL, at INTEGER)");
const ins = db.prepare("INSERT INTO funding_snapshot VALUES (?, ?, ?, ?)");
/* AAA, hour 0: HL +0.10, +0.10; Binance −0.05, +0.15 → means +0.10 vs +0.05: AGREE (the
   five-minute rows disagree once, which is what the naive version counts).
   AAA, hour 1: HL +0.10; Binance −0.20 → opposite.
   AAA, hour 2: HL 0; Binance −0.10 → a zero, not a disagreement.
   AAA, hour 3: Binance only, no HL hour → not compared. */
const row = (s, v, apr, h, m = 0) => ins.run(s, v, apr, T + h * H + m * M);
row("AAA", "HlPerp", 0.10, 0, 0); row("AAA", "HlPerp", 0.10, 0, 5);
row("AAA", "BinPerp", -0.05, 0, 0); row("AAA", "BinPerp", 0.15, 0, 5);
row("AAA", "HlPerp", 0.10, 1); row("AAA", "BinPerp", -0.20, 1);
row("AAA", "HlPerp", 0, 2); row("AAA", "BinPerp", -0.10, 2);
row("AAA", "BinPerp", 0.30, 3);
row("OLD", "HlPerp", 1, -800); row("OLD", "BinPerp", -1, -800); // outside the 30-day window

const store = new Map();
const env = {
  SNAPSHOT: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); } },
  DB: {
    prepare: (sql) => ({
      bind: (...a) => ({ all: async () => ({ results: db.prepare(BLIND ? NAIVE_SQL : sql).all(...a) }) }),
    }),
  },
};

const label = await stepVenueAgreement(env, NOW);
const doc = JSON.parse(store.get(VENUE_AGREE_KEY) ?? "null");
const a = agreementFor(doc, "AAA").find((r) => r.venue === "BinPerp");
ok(typeof label === "string" && doc?.v === 1, "the step writes one record");
ok(a && a.hours === 3, "three hours are compared: a venue hour with no Hyperliquid hour beside it is not");
ok(a && a.opposite === 1, "one disagreement: hourly means are compared, and a zero is not a side");
ok(a && Math.abs(a.gap - (0.05 + 0.30 + 0.10) / 3) < 1e-9, "the gap is the mean absolute difference of the hourly means");
ok(!agreementFor(doc, "OLD").length, "rows older than 30 days are outside the window");
if (!BLIND) {
  ok(VENUE_AGREE_SQL.includes("GROUP BY symbol, venue, hr"), "the statement averages per hour before comparing");
  ok(!venueAgreeDue({ attemptAt: NOW }, NOW + 19 * H) && venueAgreeDue({ attemptAt: NOW }, NOW + 20 * H) && venueAgreeDue(null, NOW), "once in twenty hours, and at once when there is no record");
  ok((await stepVenueAgreement(env, NOW + H)) === null, "a second tick inside the window does nothing");
  const broken = { ...env, DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("no such table"); }, first: async () => null }), all: async () => ({ results: [] }), first: async () => null }) } };
  const before = JSON.parse(store.get(VENUE_AGREE_KEY));
  await stepVenueAgreement(broken, NOW + 21 * H);
  const after = JSON.parse(store.get(VENUE_AGREE_KEY));
  ok(after.rows.length === before.rows.length && after.error && after.attemptAt === NOW + 21 * H, "a failed day keeps yesterday's rows, names the error, and waits for tomorrow");
}

if (BLIND) {
  if (!bad) { console.error("\nBLIND: the cases passed against five-minute rows and zero-as-opposite"); process.exit(1); }
  console.log(`\nblind run red as required — ${bad} case(s) caught the five-minute comparison`);
  process.exit(0);
}
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\nvenue agreement: every case matches the count worked by hand");
