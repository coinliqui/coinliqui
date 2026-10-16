#!/usr/bin/env node
/**
 * FREEZE ONE FUNDING EVENT: 19–23 AUGUST 2026.
 *
 * Measured on 16 October 2026 across the 5,200 hours of settled funding this site holds per
 * contract: 26 of 55 contracts had their steepest hour of the whole span on 21 or 22 August, and at
 * 05:00 UTC on 22 August 42 of them were paying more than five times the base rate at once. The
 * stored series roll forward an hour at a time and will drop those days in a few months, so the
 * window is written here, with its provenance, and committed — the way scripts/fetch-sweep.mjs
 * froze the February crash.
 *
 * SOURCES. The funding rates are Hyperliquid's settled hourly rates as this site stores them
 * (KV `funding:{SYM}`, read through wrangler's login, as scripts/gsc.mjs reads its record), and the
 * steepest-hour comparison is made against the whole stored series. Daily prices are the stored
 * daily candles (KV `candles:{SYM}`). Hourly prices for the chart are two candleSnapshot calls to
 * Hyperliquid, BTC and ETH, a second apart.
 *
 *   node scripts/freeze-funding-event.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const NS = "09d5ddc598f34f36b11d367aac0aad87";
const FROM = Date.parse("2026-08-19T00:00:00Z");
const TO = Date.parse("2026-08-24T00:00:00Z"); // exclusive
const H = 3_600_000;
const BASE = 0.0001 / 8;

const kv = (key) => {
  const raw = execFileSync("npx", ["wrangler", "kv", "key", "get", "--namespace-id", NS, "--remote", key], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const i = raw.search(/[[{]/);
  return i < 0 ? null : JSON.parse(raw.slice(i));
};

const snap = kv("snapshot");
const symbols = (snap?.perps ?? []).map((p) => p.symbol);
if (!symbols.length) { console.error("no snapshot in KV — nothing to freeze"); process.exit(1); }

const hours = (TO - FROM) / H;
const contracts = {};
for (const s of symbols) {
  const series = kv(`funding:${s}`) ?? [];
  if (!series.length) continue;
  const rates = Array(hours).fill(null);
  for (const [t, v] of series) {
    const i = Math.floor((t - FROM) / H);
    if (i >= 0 && i < hours) rates[i] = v;
  }
  if (rates.every((v) => v === null)) continue;
  let steep = series[0];
  for (const x of series) if (Math.abs(x[1]) > Math.abs(steep[1])) steep = x;
  const day = kv(`candles:${s}`)?.d ?? [];
  const open = day.find((c) => c[0] === Date.parse("2026-08-18T00:00:00Z"));
  const close = day.find((c) => c[0] === Date.parse("2026-08-23T00:00:00Z"));
  contracts[s] = {
    rates,
    /* The whole stored series, so "the steepest of the span" is a statement about a stated span. */
    seriesFrom: series[0][0], seriesTo: series[series.length - 1][0], seriesHours: series.length,
    steepest: steep[1], steepestAt: steep[0],
    /* Close of 18 August to close of 23 August, the days either side of the window. */
    px0: open ? open[4] : null, px1: close ? close[4] : null,
  };
}

const INFO = "https://api.hyperliquid.xyz/info";
const hourly = {};
for (const coin of ["BTC", "ETH"]) {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: FROM, endTime: TO - 1 } }) });
  if (!r.ok) { console.error(`candleSnapshot ${coin}: ${r.status}`); process.exit(1); }
  hourly[coin] = (await r.json()).map((c) => [c.t, +c.c]);
  await new Promise((res) => setTimeout(res, 1000));
}

const out = {
  window: { from: FROM, to: TO, hours, base: BASE },
  source: "Hyperliquid settled hourly funding as stored by coinliqui (KV funding:{SYM}); daily candles as stored (KV candles:{SYM}); hourly closes from Hyperliquid POST /info candleSnapshot",
  fetchedAt: Date.now(),
  contracts,
  hourly,
};
writeFileSync(new URL("../src/data/funding-event-2026-08.json", import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(contracts).length} contracts, ${hours} hours, hourly closes for ${Object.keys(hourly).join(" ")}`);
