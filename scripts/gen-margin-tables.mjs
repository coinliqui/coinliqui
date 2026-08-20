// Build-time: margin tiers change rarely, so they are fetched once and committed.
// Keeps them off the 5-minute cron and out of the 10 ms CPU budget.
//
// AND THERE IS A --check MODE, because "rarely" is not "never" and nothing was watching.
//
// Five templates compute liquidation prices from src/data/margin-tables.json. tierFor() and
// liquidationPrice() both read `table.marginTiers` unguarded, so a contract whose tier table is
// not in that file used to throw a TypeError at render — 500 on an indexed URL. The worker
// publishes a new contract the moment it crosses the open-interest floor, with no redeploy
// involved, so the window between upstream adding a tier table and this file being regenerated
// is a window in which those pages are broken.
//
// The pages now decline such a contract rather than throwing (see pickPerp in
// src/lib/hyperliquid.ts), which turns a 500 into a page that is missing — better, and still
// not what anyone wants. This mode is what catches it first: one request, at deploy time,
// naming the command that fixes it.
//
//   node scripts/gen-margin-tables.mjs           # regenerate and write
//   node scripts/gen-margin-tables.mjs --check   # fail if the committed file has drifted
import { writeFile, readFile } from "node:fs/promises";
const CHECK = process.argv.includes("--check");
const OUT = "src/data/margin-tables.json";
const INFO = "https://api.hyperliquid.xyz/info";
const post = async (b) => {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const [meta] = await post({ type: "metaAndAssetCtxs" });
const ids = [...new Set(meta.universe.map((u) => u.marginTableId))];

if (CHECK) {
  /* ONLY THE ID SET IS COMPARED, not the tier contents. A tier boundary moving is a data change
     the pages absorb correctly; an id that has no entry at all is the one that breaks them. One
     request rather than one per table, so this stays cheap enough to run on every deploy. */
  const have = JSON.parse(await readFile(OUT, "utf8"));
  const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(have, String(id)));
  const orphan = Object.keys(have).filter((k) => !ids.includes(Number(k)));
  const named = (id) => meta.universe.filter((u) => u.marginTableId === id).map((u) => u.name);
  if (missing.length) {
    for (const id of missing) console.error(`  FAIL  upstream tier table ${id} is not committed — affects ${named(id).join(", ")}`);
    console.error(`\n  ${missing.length} tier table(s) missing. Run: npm run gen:margin\n`);
    process.exit(1);
  }
  if (orphan.length) console.log(`  note  ${orphan.length} committed table(s) upstream no longer uses: ${orphan.join(", ")} — harmless, cleared by npm run gen:margin`);
  console.log(`  ok    margin tables cover all ${ids.length} tier tables in the live universe (${ids.join(", ")})`);
  process.exit(0);
}

const out = {};
for (const id of ids) {
  const t = await post({ type: "marginTable", id });
  out[id] = { description: t.description, marginTiers: t.marginTiers.map((x) => ({ lowerBound: Number(x.lowerBound), maxLeverage: x.maxLeverage })) };
}
await writeFile(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${ids.length} margin tables: ${ids.join(", ")}`);
