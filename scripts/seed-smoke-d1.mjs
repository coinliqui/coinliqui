#!/usr/bin/env node
/**
 * SEED THE GATE'S D1 SO THE BRANCHES THAT ONLY EXIST IN PRODUCTION GET RENDERED.
 *
 * `npm run check` runs warm against .wrangler/smoke, and that store had a KV snapshot and an
 * EMPTY funding_snapshot table. So readFlips() returned "warming" on every gate run since the
 * flip feed was built, and the gate has never once rendered the flip table — not the join to
 * the live snapshot, not the em-dash for a delisted contract, not the truncation count, not the
 * wide-window cell. Every defect ever found in that table was found in production.
 *
 * Same shape as the /404 defect found the same day: asking for one URL per template renders one
 * path through it, and the untaken path is where things rot. There the fix was to request the
 * other URL. Here the template has one URL and the branch is chosen by DATA, so the fix is to
 * give the gate data that reaches it.
 *
 * The fixture is adversarial rather than tidy — it contains the shapes that have actually
 * broken this feed:
 *   - a contract flipping MORE THAN ONCE, so the dedupe is exercised (it once printed four
 *     mutually exclusive "now" values for one contract);
 *   - a flip detected across a 14-hour sampling hole, so the wide-window cell renders;
 *   - a flip on a contract absent from the KV snapshot, so the "no longer published" em-dash
 *     renders rather than a stale rate being borrowed;
 *   - more than 25 flipped contracts, so `total` differs from the row count and the truncation
 *     sentence has work to do;
 *   - minute-tick rows with both ok=1 and ok=0, so /status renders its counted card.
 *
 * WHY IT WRITES SQLITE DIRECTLY instead of calling `wrangler d1 execute --local`.
 * The two disagree about which file is the database. `wrangler pages dev --d1 DB` keys the
 * miniflare object on the BINDING name; `wrangler d1 execute --local` keys it on the configured
 * database. Both write under the same --persist-to and produce two different .sqlite files, so
 * the first version of this seeder filled one while the gate's server read the other — 71 rows
 * present on disk and the page still rendering "flip feed unavailable". The target is therefore
 * chosen by inspecting the directory rather than by trusting either tool's naming, and the
 * check at the end fails loudly if no file was written.
 *
 * Timestamps are relative to now, so the 24-hour window is always covered. Idempotent.
 *
 *   node scripts/seed-smoke-d1.mjs [--dir .wrangler/smoke]
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : ".wrangler/smoke";
const d1dir = join(dir, "v3/d1/miniflare-D1DatabaseObject");
/* Exits 0 when there is nothing to seed, because on a fresh clone the store does not exist until
   the warm gate has run once and this must not block that first run. The coverage cannot lapse
   quietly as a result: smoke.mjs FAILS if the flip feed renders no table, so an unseeded fixture
   is reported by the gate rather than shrugged off here. */
if (!existsSync(d1dir)) {
  console.log(`no D1 store at ${d1dir} yet — nothing to seed (the warm gate creates it on first run)`);
  process.exit(0);
}

const now = Date.now();
const min = (n) => now - n * 60_000;

const fs = [];
const push = (symbol, venue, apr, atMin) => fs.push([symbol, venue, apr, min(atMin)]);

/* Venue keys and APR units are the WRITER'S, not invented: worker/ingest.ts stores the three
   venues as HlPerp / BinPerp / BybitPerp and the rate as a fraction, so 0.062 renders "6.20%".
   The first fixture used "hyperliquid" and -4.2 and produced a table of "-420.00%" under a
   venue column falling through VENUE_LABEL to a raw key — a fixture that renders is not the
   same as a fixture that renders what production renders. Checked against production D1:
   venues exactly these three, apr spanning -4.997 to 2.874. */
const HL = "HlPerp", BIN = "BinPerp", BYB = "BybitPerp";

/* 30 contracts flipping once, recently, a minute apart — enough to exceed LIMIT 25 so the
   truncation sentence must say a number other than the row count. */
const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "SUI", "TIA", "ARB",
  "OP", "APT", "INJ", "SEI", "NEAR", "LTC", "BCH", "ENA", "JUP", "PENDLE",
  "AAVE", "TRX", "WLD", "TAO", "PUMP", "ZEC", "XMR", "HYPE", "LIT", "JTO"];
COINS.forEach((c, i) => {
  push(c, HL, -0.042 - i * 0.001, 45 + i);
  push(c, HL, 0.061 + i * 0.001, 40 + i);
});

/* Flips three times in the window, with its LATEST inside the visible 25: exactly one row may
   appear for it, and it must be the last flip rather than the first. */
push("ETH", BYB, -0.030, 900); push("ETH", BYB, 0.025, 895);
push("ETH", BYB, -0.018, 400); push("ETH", BYB, 0.033, 395);
push("ETH", BYB, -0.022, 20);  push("ETH", BYB, 0.044, 15);

/* Detected across a 14-hour hole, and recent, so it lands inside the visible 25: this row must
   print a window rather than a minute. Both samples sit inside the 24 h cutoff or LAG cannot
   see the earlier one — the first fixture put it at 26 h and the row silently vanished. */
push("BCH", BIN, -0.055, 845);
push("BCH", BIN, 0.077, 5);

/* Flipped, and absent from the KV snapshot: the "Now" cell must be an em-dash rather than a
   borrowed historical rate. */
push("DELISTEDX", HL, -0.020, 30);
push("DELISTEDX", HL, 0.020, 25);

/* Puts the window floor beyond 24 h so readFlips() leaves "warming". */
push("BTC", HL, -0.040, 26 * 60);

const uc = [];
for (let i = 1; i <= 60; i++) {
  uc.push([min(i), "minute", i % 12 === 0 ? 429 : 200, 120, i % 12 === 0 ? 0 : 1, "{}"]);
}
for (let i = 1; i <= 24; i++) {
  uc.push([min(i * 5), "hyperliquid", 200, 900, 1,
    JSON.stringify({ venues: { hyperliquid: 50 }, sweepAgeMin: { hourly: 30, daily: 300, funding: 120 } })]);
}

/* OPEN INTEREST OVER TIME, so the gate renders the branch production will show TOMORROW. The
   table is new: on the live database it holds nothing until the worker's first hourly write, so
   /open-interest takes the "collecting" branch for a day and then switches to a change column
   that has never been rendered anywhere. That is the exact shape this fixture directory exists
   to prevent — see the identity:reach and published:retired notes in the KV seeder.

   Two symbols move and one does not, so the sign, the colour and a genuine zero are all on the
   page; DOGE is deliberately ABSENT so the "listed since the stored reading" branch — an em dash
   rather than a change of zero — is rendered too. */
const oiAgo = (h) => now - h * 3_600_000;
const oiRows = [];
for (let h = 26; h >= 1; h--) {
  oiRows.push(["BTC", 2_600_000_000 * (1 + (26 - h) * 0.002), oiAgo(h)]);
  oiRows.push(["ETH", 1_100_000_000 * (1 - (26 - h) * 0.001), oiAgo(h)]);
  oiRows.push(["SOL", 420_000_000, oiAgo(h)]);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS oi_snapshot (symbol TEXT NOT NULL, oi REAL NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS funding_snapshot (symbol TEXT NOT NULL, venue TEXT NOT NULL, apr REAL NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS upstream_check (at INTEGER NOT NULL, source TEXT NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, note TEXT)`,
];

/* EVERY candidate file, because the two wrangler entry points disagree about which one is the
   database and the fixture directory holds nothing else worth protecting. Seeding all of them
   makes the fixture correct whichever tool the gate happens to invoke. */
const files = readdirSync(d1dir).filter((f) => f.endsWith(".sqlite"));
if (!files.length) {
  console.error(`no .sqlite files in ${d1dir} — run the warm gate once so wrangler creates one`);
  process.exit(1);
}

let written = 0;
for (const f of files) {
  const db = new DatabaseSync(join(d1dir, f));
  try {
    for (const s of SCHEMA) db.exec(s);
    db.exec("DELETE FROM funding_snapshot");
    db.exec("DELETE FROM oi_snapshot");
    db.exec("DELETE FROM upstream_check");
    const insF = db.prepare("INSERT INTO funding_snapshot (symbol,venue,apr,at) VALUES (?,?,?,?)");
    for (const r of fs) insF.run(...r);
    const insO = db.prepare("INSERT INTO oi_snapshot (symbol,oi,at) VALUES (?,?,?)");
    for (const r of oiRows) insO.run(...r);
    const insU = db.prepare("INSERT INTO upstream_check (at,source,status,ms,ok,note) VALUES (?,?,?,?,?,?)");
    for (const r of uc) insU.run(...r);
    const n = db.prepare("SELECT count(*) n FROM funding_snapshot").get().n;
    if (n !== fs.length) throw new Error(`wrote ${fs.length} rows, read back ${n}`);
    written++;
  } finally {
    db.close();
  }
}

console.log(`seeded ${written}/${files.length} store(s) in ${d1dir}: ${fs.length} funding_snapshot rows across ${COINS.length + 3} contracts, ${uc.length} upstream_check rows, ${oiRows.length} oi_snapshot rows over 26h — the gate renders the change column production only shows after a day`);
if (!written) process.exit(1);
