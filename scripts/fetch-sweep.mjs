#!/usr/bin/env node
/**
 * Freeze the candles for the showcase window.
 *
 * The liquidation map on /liquidations rolls forward on a 45-day KV window, so a February
 * event cannot be served from it. A past event is also not live data: it does not change,
 * and a page about it should not depend on an upstream call at request time. So the window
 * is fetched once, written here with its provenance, and committed.
 *
 * Rerun:  node scripts/fetch-sweep.mjs
 */
import { writeFileSync } from "node:fs";

const INFO = "https://api.hyperliquid.xyz/info";
const post = async (body) => {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

const COIN = "BTC";
const FROM = Date.parse("2026-01-17T23:00:00Z");
const TO = Date.parse("2026-02-14T00:00:00Z");

const raw = await post({ type: "candleSnapshot", req: { coin: COIN, interval: "1h", startTime: FROM, endTime: TO } });
const candles = raw
  .filter((c) => Number(c.v) > 0)
  .map((c) => [c.t, +c.o, +c.h, +c.l, +c.c, +c.v]);

const [meta, ctxs] = await post({ type: "metaAndAssetCtxs" });
const i = meta.universe.findIndex((u) => u.name === COIN);
const oiNotional = Number(ctxs[i].openInterest) * Number(ctxs[i].markPx);

const out = {
  coin: COIN,
  interval: "1h",
  source: "Hyperliquid POST /info candleSnapshot",
  fetchedAt: Date.now(),
  from: candles[0][0],
  to: candles[candles.length - 1][0],
  maxLeverage: meta.universe[i].maxLeverage,
  /* Open interest is not published historically. The value frozen here is the level at the
     moment this file was written, and it sets the SCALE of the model, not its shape. The
     page says so where the number appears. */
  oiNotional: Math.round(oiNotional),
  oiAt: Date.now(),
  candles,
};
writeFileSync(new URL("../src/data/sweep-2026-02.json", import.meta.url), JSON.stringify(out));
console.log(
  `${candles.length} hourly candles ${new Date(out.from).toISOString()} → ${new Date(out.to).toISOString()}\n` +
  `maxLeverage ${out.maxLeverage}  OI $${(oiNotional / 1e9).toFixed(2)}B`,
);
