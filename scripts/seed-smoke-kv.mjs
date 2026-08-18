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
db.close();
console.log(wrote ? `seeded ${wrote} m15 series into the gate's fixture` : "nothing written");
process.exit(wrote ? 0 : 1);
