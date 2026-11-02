#!/usr/bin/env node
/**
 * FIXTURE DATA FOR KV KEYS THE CODE READS BUT THE CAPTURE PREDATES.
 *
 * The warm store is a snapshot taken at a point in time. Every feature added after it reads a
 * key that is simply not there, so the gate renders the "no data" branch and reports green —
 * and every defect in the new feature is found in production instead. That has now happened
 * twice: the flip feed rendered its placeholder on every gate run for as long as it existed,
 * and then the 15-minute series did the same, so `npm run check` never once drew a 15m panel.
 *
 * WHY IT WRITES SQLITE DIRECTLY rather than calling `wrangler kv key put --local`. The same
 * trap as the D1 seeder, and it cost the same half hour to see: `--binding SNAPSHOT` resolves
 * to the namespace id in wrangler.toml and writes to v3/kv/09d5ddc5…/, while
 * `wrangler pages dev --kv SNAPSHOT` keys its store on the BINDING NAME and reads
 * v3/kv/SNAPSHOT/. Both are real, both persist, and only one is the fixture. The first version
 * of this script wrote a key, read it back successfully, and seeded nothing the gate could see.
 *
 * SYNTHETIC, DERIVED FROM THE FIXTURE'S OWN HOURLY BARS. A second capture would age into this
 * problem again; bars derived from what is already there cannot drift away from it. Each hourly
 * bar becomes four 15-minute bars whose opens and closes chain, whose extremes stay inside the
 * hour, and whose volume is split — so the aggregate of the four IS the hour, and a chart drawn
 * from them cannot look right while the aggregation is wrong.
 *
 *   node scripts/seed-smoke-kv.mjs [--dir .wrangler/smoke]
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const dir = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : ".wrangler/smoke";
const objDir = join(dir, "v3/kv/miniflare-KVNamespaceObject");
const blobDir = join(dir, "v3/kv/SNAPSHOT/blobs");
if (!existsSync(objDir)) { console.log(`no KV store at ${objDir} yet — the warm gate creates it on first run`); process.exit(0); }
mkdirSync(blobDir, { recursive: true });

/* The fixture is the store that already holds the snapshot key — identified by content, never
   by filename, because the filename is a hash of something this script must not have to know. */
let dbPath = null;
for (const f of readdirSync(objDir).filter((f) => f.endsWith(".sqlite"))) {
  const db = new DatabaseSync(join(objDir, f));
  try {
    const row = db.prepare("SELECT count(*) n FROM _mf_entries WHERE key = 'snapshot'").get();
    if (row?.n) dbPath = join(objDir, f);
  } catch { /* not a KV store */ } finally { db.close(); }
  if (dbPath) break;
}
if (!dbPath) { console.error("could not find the KV fixture (no store holds a 'snapshot' key)"); process.exit(1); }

const db = new DatabaseSync(dbPath);
const readBlob = (id) => {
  const p = join(blobDir, id);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

const rows = db.prepare("SELECT key, blob_id FROM _mf_entries WHERE key LIKE 'hourly:%'").all();
if (!rows.length) { console.error("no hourly:* keys in the fixture — nothing to derive from"); process.exit(1); }

const put = db.prepare("INSERT OR REPLACE INTO _mf_entries (key, blob_id, expiration, metadata) VALUES (?, ?, NULL, NULL)");
let wrote = 0;
for (const { key, blob_id } of rows) {
  const sym = key.slice("hourly:".length);
  const hourly = readBlob(blob_id);
  const src = (hourly?.d ?? []).slice(-400);
  if (src.length < 20) continue;

  const d = [];
  for (const [t, o, h, l, c, v] of src) {
    const step = (c - o) / 4;
    for (let i = 0; i < 4; i++) {
      const bo = o + step * i, bc = o + step * (i + 1);
      d.push([
        t + i * 900_000,
        +bo.toFixed(6),
        +Math.min(h, Math.max(bo, bc) + (h - l) * 0.12).toFixed(6),
        +Math.max(l, Math.min(bo, bc) - (h - l) * 0.12).toFixed(6),
        +bc.toFixed(6),
        +(v / 4).toFixed(6),
      ]);
    }
  }
  const id = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, id), JSON.stringify({ u: Date.now(), d }));
  put.run(`m15:${sym}`, id);
  wrote++;
  console.log(`  m15:${sym}  ${d.length} bars derived from ${src.length} hourly`);
}
/* THE FLIP FEED IS READ FROM KV NOW, SO THE FIXTURE HAS TO CARRY IT.
   The homepage used to compute this from D1 on every render; the ingest worker computes it
   once per pass and stores it here. The gate caught the gap the moment the read moved — the
   homepage rendered its "warming" branch and the flip table went untested, which is exactly
   what fixtureGaps exists to prevent.

   These rows exercise the RENDER path: a mix of directions so the colour rule has both cases
   to get wrong, a wide gapMin so the detection-window caveat has something to print, and a
   `total` larger than `rows.length` so the truncation sentence is exercised rather than
   trivially true. The SQL's correctness is not what this proves and does not pretend to be —
   that is covered by scripts/flips-parity.mjs, which compares the stored feed against a live
   recomputation from D1. */
{
  const now = Date.now();
  const flips = {
    computedAt: now,
    result: {
      status: "ready",
      since: now - 24 * 3600_000,
      total: 33,
      /* THE DENOMINATOR, WITHOUT WHICH THE GATE RENDERS ONLY THE DEGRADED SENTENCE. The home
         page prints "33 of the 144 coin-venue pairs flipped" when legs is present and drops the
         ratio when it is not — and the fixture had no legs, so the branch production actually
         takes would have shipped never once rendered here. 144 is 48 coins on three venues,
         which is the shape of a real window and larger than total, as it must be. */
      legs: 144,
      rows: [
        { symbol: "BTC", venue: "HlPerp", prevApr: -0.0412, apr: 0.0231, at: now - 12 * 60_000, gapMin: 5 },
        { symbol: "ETH", venue: "BinPerp", prevApr: 0.0187, apr: -0.0094, at: now - 47 * 60_000, gapMin: 5 },
        { symbol: "kPEPE", venue: "BybitPerp", prevApr: -0.1103, apr: 0.0552, at: now - 96 * 60_000, gapMin: 890 },
      ],
    },
  };
  put.run("flips:24h", (() => { const id = randomBytes(40).toString("hex"); writeFileSync(join(blobDir, id), JSON.stringify(flips)); return id; })());
  console.log(`  flips:24h  ${flips.result.rows.length} rows of ${flips.result.total} across ${flips.result.legs} pairs, one with a 890-minute detection gap`);
}

/* THE RESTORED BRANCH, WHICH PRODUCTION CANNOT EXERCISE.
   The site publishes its external corroboration only while a daily worker probe says a
   signed-out reader can reach it. In production that probe currently says 404, so every render
   takes the withheld branch — and the branch that emits sameAs, the /about paragraph with the
   link in it and the llms.txt provenance clause would go to production having never once been
   rendered by the gate. That is the "branch that says not yet and has never run" shape this
   fixture exists to prevent, and it is worse here than usual because the branch only turns on
   when nobody is watching for it.
   Reachable and one hour old, so it passes both the ok test and the freshness test. */
{
  const rec = [{ url: "https://github.com/coinliqui/coinliqui", ok: true, status: 200, at: Date.now() - 3_600_000 }];
  const id = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, id), JSON.stringify(rec));
  put.run("identity:reach", id);
  console.log(`  identity:reach  ${rec[0].url} reachable — the gate renders the branch production cannot`);
}

/* THREE MORE KEYS THE FIXTURE HAD NEVER HELD, and nothing said so.
   fixtureGaps() matched only `kv.get(\`prefix:${sym}\`)` while printing "the warm fixture covers
   every KV series the code reads". Once it could also see literal and constant keys, and once
   its input covered src/pages and src/layouts rather than src/lib alone, three more turned up:
   `live` (the one-minute overlay's source), `report:latest` (everything /status/indexation
   renders) and `worker:build` (the stamp row on /status). Every one of those pages had only ever
   been gated in its empty state. */
{
  const snapBlob = (() => {
    const row = db.prepare("SELECT blob_id FROM _mf_entries WHERE key = 'snapshot'").get();
    return row ? readBlob(row.blob_id) : null;
  })();
  const perps = (snapBlob?.perps ?? []).slice(0, 40);

  /* Derived from the fixture's own snapshot, so the overlay's numbers cannot drift away from
     the page they repaint — the same rule the m15 bars above are built by. Nudged by a tenth of
     a percent so a check that compares rendered against live sees a real difference rather than
     two copies of one number. */
  const live = { at: Date.now(), mark: {}, apr: {} };
  for (const p of perps) {
    if (typeof p?.markPx === "number") live.mark[p.symbol] = +(p.markPx * 1.001).toFixed(8);
    const venues = {};
    for (const v of p?.venues ?? []) if (Number.isFinite(v?.apr)) venues[v.venue] = v.apr;
    if (Object.keys(venues).length) live.apr[p.symbol] = venues;
  }
  if (Object.keys(live.mark).length) {
    const id = randomBytes(40).toString("hex");
    writeFileSync(join(blobDir, id), JSON.stringify(live));
    put.run("live", id);
    console.log(`  live  ${Object.keys(live.mark).length} marks, ${Object.keys(live.apr).length} apr sets, derived from the fixture's snapshot`);
  }

  /* Small but structurally complete: a heading, a table with a header row, a bold run and a
     list, because the markdown renderer on /status/indexation handles exactly those and a
     fixture that exercises none of them proves nothing about it. */
  const md = [
    "# Indexation — 2026-W00",
    "",
    "https://coinliqui.com · started 2026-01-01 07:00 UTC",
    "",
    "## A. Coverage",
    "",
    "| Template | URLs | Fetchable as GPTBot |",
    "|---|---:|---:|",
    "| `pages` | 7 | 7/7 |",
    "| **total** | **79** | **79/79** |",
    "",
    "**A fixture, not a reading.** Seeded by scripts/seed-smoke-kv.mjs so the populated branch",
    "of this page is rendered by the gate at all. Nothing here is a measurement.",
    "",
    "- one list item",
    "- and a second",
    "",
    /* THE PASSAGE REPORTS STORED BEFORE 16 SEPTEMBER CARRY. It pointed readers at a series that
       was never printed; /status/indexation now splices the series in from index:history, and
       without this sentence and that key the gate would only ever render the page without it. */
    "## B. Not indexed",
    "",
    "**Deferred or rejected.** A single reading cannot tell them apart, so watch the series below.",
    "",
    "| URL | State |",
    "|---|---|",
    "| `/funding/btc` | Discovered |",
    "",
  ].join("\n");
  const id = randomBytes(40).toString("hex");
  const reportAt = Date.now();
  writeFileSync(join(blobDir, id), JSON.stringify({ week: "2026-W00", at: reportAt, tookMs: 61_000, md }));
  put.run("report:latest", id);
  console.log(`  report:latest  ${md.split("\n").length} lines of markdown — /status/indexation's populated branch`);

  /* Three readings a week apart, all before the report, with one change of covered set, so the
     spliced table renders an "unchanged" row, a change row and the earliest row. */
  const week = 7 * 24 * 3_600_000;
  const history = [
    { at: reportAt - week, total: 79, indexed: 41, byTemplate: [["pages", 7, 7]] },
    { at: reportAt - 2 * week, total: 79, indexed: 41, byTemplate: [["pages", 7, 7]] },
    { at: reportAt - 3 * week, total: 77, indexed: 38, byTemplate: [["pages", 7, 7]] },
  ];
  const hid = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, hid), JSON.stringify(history));
  put.run("index:history", hid);
  console.log(`  index:history  ${history.length} readings — the series /status/indexation splices under a legacy report`);

  /* The stamp the site expects, read from the source of truth rather than typed here, so the
     row renders "current" instead of a false staleness alarm. */
  const stamp = /"([0-9a-f]{12})"/.exec(readFileSync("worker/build-stamp.ts", "utf8"))?.[1];
  if (stamp) {
    const wid = randomBytes(40).toString("hex");
    writeFileSync(join(blobDir, wid), JSON.stringify({ build: stamp, at: Date.now() }));
    put.run("worker:build", wid);
    console.log(`  worker:build  ${stamp} — matches build-stamp.ts, so /status renders the current row`);
  }
}

/* THE 410 BRANCH, WHICH PRODUCTION SHOWS ONLY WHEN A CONTRACT HAS JUST LEFT.
   /funding/{symbol} rewrites a miss to /404, and that page answers 410 with a "was published
   until" explanation when the symbol is in this map. In the fixture the map is empty, so the
   gate would render only the never-published branch and the retirement wording would ship
   having never been rendered here — the same shape as the corroboration link above, and the
   reason fixtureGaps flagged this key the moment 404.astro started reading it.
   A symbol that is NOT in the fixture's snapshot, so it exercises retirement rather than
   colliding with a live contract. */
{
  const rec = { FET: Date.now() - 6 * 3_600_000 };
  const id = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, id), JSON.stringify(rec));
  put.run("published:retired", id);
  console.log(`  published:retired  FET left 6h ago — the gate renders the 410 branch production shows only after a real retirement`);
}

/* THE BRANCH /status SHOWS WHEN AN ENDPOINT IS REFUSING, which is the branch that matters and
   the one production hides.

   The announcer's state is the site's record of what it has told the non-Google indexes about.
   Measured 27 August 2026: the two Microsoft-run IndexNow endpoints had refused the Worker 21
   consecutive times and were sitting on 58 URLs each — the 49 liquidation maps that shipped
   that morning and the five /learn explainers — while every surface on the site was green. The
   only way to find that out was to read the KV value by hand, so /status gained a section for
   it; and a section whose interesting branch has never been rendered by the gate is a section
   that ships untested. The healthy shape renders in production every day. This is the other.

   The state seeded here deliberately carries a backlog, a refusal count and a live backoff on
   ONE endpoint pair, and nothing on the other three — so the row colouring, the "held until"
   cell and the warning verdict are all exercised, next to three quiet rows that must not be. */
{
  const now = Date.now();
  const rec = {
    known: ["https://coinliqui.com/", "https://coinliqui.com/liquidations", "https://coinliqui.com/liquidations/eth"],
    pending: {
      "api.indexnow.org": ["https://coinliqui.com/liquidations/eth"],
      "bing.com": ["https://coinliqui.com/liquidations/eth"],
    },
    backoff: {
      "api.indexnow.org": { fails: 21, nextAt: now + 6 * 3_600_000 },
      "bing.com": { fails: 21, nextAt: now + 6 * 3_600_000 },
    },
    sentAt: now - 26 * 3_600_000,
  };
  const id = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, id), JSON.stringify(rec));
  put.run("indexnow:state", id);
  console.log(`  indexnow:state  2 endpoints refusing, 21x, 1 URL owed each — /status renders the branch production hides`);
}

/* =========================================================================================
   THE FUNDING SHAPE COLUMN, IN THE SHAPE THAT WOULD BREAK ITS SCALE.

   check-inventory caught this before the feature shipped: spark:* is read by src/lib/sparks.ts
   and was absent from the fixture, so every gate rendered the empty branch and the column itself
   was never drawn by anything but a browser I happened to be looking at.

   SEEDED AS THE REAL BOOK, NOT AS TIDY DATA. The whole argument for a shared axis is what happens
   when one contract prints −60% a year while thirty-six rest on a venue constant: pinned to that
   maximum the column is forty-nine flat lines, and scaled per row the flat ones become amplified
   noise. So the fixture carries a mass on the base rate, a handful of priced contracts, one
   extreme that must be clipped and counted, a series that crosses zero — the case where a single
   hue over the whole row would be a lie — and one published contract with NO series at all, which
   must render a dash rather than a flat line at zero. */
{
  const STEP = 4 * 3_600_000, N = 42;
  const BASE = 0.0000125 * 8760;
  const bucket = Math.floor(Date.now() / STEP) - 1;
  const flat = (v) => Array.from({ length: N }, () => Number(v.toFixed(5)));
  const series = {};
  for (const sym of ["CHIP", "VIRTUAL", "ONDO", "INJ", "LDO", "NEAR", "XRP", "DOGE", "SUI", "TAO"]) series[sym] = flat(BASE);
  series.BTC = flat(BASE);
  series.ETH = Array.from({ length: N }, (_, i) => Number((0.02 * Math.sin(i / 4)).toFixed(5)));
  series.SOL = flat(0.0671);
  series.LINK = flat(-0.0103);
  series.AAVE = Array.from({ length: N }, (_, i) => Number((-0.02 - i * 0.002).toFixed(5)));
  series.TRUMP = Array.from({ length: N }, (_, i) => Number((i < 30 ? BASE : -0.60).toFixed(5)));
  /* Two points only: above the floor that draws a mark, below anything that looks like a shape. */
  series.PONS = [Number(BASE.toFixed(5)), Number((BASE * 1.4).toFixed(5))];
  const rec = { v: 1, bucket, at: Date.now(), series };
  const id = randomBytes(40).toString("hex");
  writeFileSync(join(blobDir, id), JSON.stringify(rec));
  put.run("spark:funding", id);
  console.log(`  spark:funding  ${Object.keys(series).length} series incl. a -60% outlier to clip, a zero-crossing row and a 2-point row; published contracts without one render a dash`);
}

db.close();
console.log(wrote ? `seeded ${wrote} m15 series into the gate's fixture` : "nothing written");
process.exit(wrote ? 0 : 1);
