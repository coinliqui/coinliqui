// Build-time: margin tiers change rarely, so they are fetched once and committed.
// Keeps them off the 5-minute cron and out of the 10 ms CPU budget.
import { writeFile } from "node:fs/promises";
const INFO = "https://api.hyperliquid.xyz/info";
const post = async (b) => {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const [meta] = await post({ type: "metaAndAssetCtxs" });
const ids = [...new Set(meta.universe.map((u) => u.marginTableId))];
const out = {};
for (const id of ids) {
  const t = await post({ type: "marginTable", id });
  out[id] = { description: t.description, marginTiers: t.marginTiers.map((x) => ({ lowerBound: Number(x.lowerBound), maxLeverage: x.maxLeverage })) };
}
await writeFile("src/data/margin-tables.json", JSON.stringify(out, null, 2));
console.log(`wrote ${ids.length} margin tables: ${ids.join(", ")}`);
