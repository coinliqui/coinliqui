#!/usr/bin/env node
/**
 * WHO DECIDES WHETHER A SERIES IS DEEP ENOUGH — and it was being decided twice.
 *
 * src/lib/candles.ts read a series out of KV and refused to return it below its own floor: 20
 * daily bars, 24 fifteen-minute, 24 hourly, 24 funding. Every consumer of those series also has
 * a floor, and every one is more precise about its own need:
 *
 *   charts               MIN_CHART_BARS = 6, on the AGGREGATED bar count
 *   liquidation density  series.length > 40 after aggregation into the window
 *   survival backtest    closedDays.length > hold + 12
 *
 * Two floors for one decision, and the blunt one won. A contract listed four hours ago holds 20
 * fifteen-minute bars — 20 at 15m, 10 at 30m, both far above MIN_CHART_BARS — and the reader
 * saw "Candles not collected yet" about candles that were collected. Reachable by any contract
 * crossing the open-interest floor within hours of listing, which is when a new listing's open
 * interest is at its most violent.
 *
 * These cases run the REAL readers against a stubbed KV, and the real availability rule against
 * what comes back, so the two layers cannot drift apart again without this going red.
 *
 *   node --experimental-strip-types scripts/read-floor-cases.mjs
 */
import { getCandles, getM15, getHourly, getFunding } from "../src/lib/candles.ts";
import { TIMEFRAMES, MIN_CHART_BARS, aggregate } from "../src/lib/series.ts";

/** A KV that holds exactly what it is given. */
const kvWith = (entries) => ({
  async get(key) { return key in entries ? entries[key] : null; },
  async put() {},
});
/** n plausible bars: [openTime, open, high, low, close, volume]. */
const bars = (n, stepMs) => Array.from({ length: n }, (_, i) => {
  const t = 1_760_000_000_000 + i * stepMs;
  return [t, 100 + i, 101 + i, 99 + i, 100.5 + i, 10];
});
const M15 = 900_000, H1 = 3_600_000, D1 = 86_400_000;

let bad = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  FAIL  ${name}: ${JSON.stringify(got)} wanted ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${name}`);
};

console.log("\n  the reader returns what is there, and judges only its shape");
t("a 20-bar m15 series is returned, not withheld",
  (await getM15(kvWith({ "m15:BTC": { u: 1, d: bars(20, M15) } }), "BTC"))?.d.length, 20);
t("a 3-bar daily series is returned too — sufficiency is not its call",
  (await getCandles(kvWith({ "candles:BTC": { u: 1, d: bars(3, D1) } }), "BTC"))?.d.length, 3);
t("a 5-point funding series is returned",
  (await getFunding(kvWith({ "funding:BTC": bars(5, H1).map((b) => [b[0], 0.0001]) }), "BTC"))?.length, 5);
t("an EMPTY array is not a series", await getHourly(kvWith({ "hourly:BTC": { u: 1, d: [] } }), "BTC"), null);
t("a record whose d is not an array is not a series", await getHourly(kvWith({ "hourly:BTC": { u: 1, d: "nope" } }), "BTC"), null);
t("an absent key is null", await getHourly(kvWith({}), "BTC"), null);
t("no binding at all is null", await getHourly(undefined, "BTC"), null);

console.log("\n  and the chart layer decides availability, on the aggregated count");
{
  /* The template's rule, verbatim: aggregate to the timeframe, cap to its window, count. */
  const offered = (base, factor) => aggregate(base, factor).length >= MIN_CHART_BARS;
  const m15of = (n) => bars(n, M15);
  t("20 m15 bars -> 15m is offered", offered(m15of(20), 1), true);
  t("20 m15 bars -> 30m is offered (10 aggregated)", offered(m15of(20), 2), true);
  t("20 m15 bars -> 1h is NOT offered (5 aggregated, under 6)", offered(m15of(20), 4), false);
  t("24 m15 bars -> 1h is offered (6 aggregated, exactly the floor)", offered(m15of(24), 4), true);
  t("5 m15 bars -> 15m is NOT offered", offered(m15of(5), 1), false);
  /* THE CASE THE OLD FLOOR ATE. Both layers now agree that this is a chart. */
  t("the contract listed four hours ago has a 15m chart", offered(m15of(20), 1) && offered(m15of(20), 2), true);
}

console.log("\n  the consumers that need depth still refuse what is too short");
{
  /* Their rules, from src/pages/liquidations.astro and liquidations/survival.astro. */
  const heatmapDraws = (hourlyBars, factor, cols) => {
    const series = aggregate(bars(hourlyBars, H1), factor);
    return series.length - cols > 4 && series.length > 40;
  };
  const backtestRuns = (dailyBars, hold) => bars(dailyBars, D1).length > hold + 12;
  t("the density map refuses 30 hourly bars", heatmapDraws(30, 1, 24), false);
  t("the density map draws 200 hourly bars", heatmapDraws(200, 1, 24), true);
  t("the backtest refuses 20 daily bars on a 30-day hold", backtestRuns(20, 30), false);
  t("the backtest runs on 200 daily bars", backtestRuns(200, 30), true);
}

/* AND THE FLOOR MUST NOT COME BACK. A depth policy in the reader is invisible to every one of
   the consumers above, so it cannot be argued with — it can only be discovered. */
const raw = await (await import("node:fs/promises")).readFile("src/lib/candles.ts", "utf8");
/* COMMENTS ARE NOT CODE, and the first version of this guard did not know that: it read the
   paragraph above quoting `series.length > 40` — the consumer's rule, named as the reason this
   file holds none — and reported the file had re-grown a floor. The same mistake check-inventory
   made and fixed. Strip them first, and look only at the four readers rather than the whole
   file, so an internal that legitimately counts something is not mistaken for a policy. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const readers = [...src.matchAll(/export async function (getCandles|getM15|getHourly|getFunding)\b([\s\S]*?)\n}/g)];
if (readers.length !== 4) { bad++; console.log(`\n  FAIL  found ${readers.length} readers, expected 4 — this guard is looking at the wrong thing`); }
const floors = readers.flatMap(([, name, body]) =>
  [...body.matchAll(/\.length\s*>\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0).map((n) => `${name}: > ${n}`));
if (floors.length) { bad++; console.log(`\n  FAIL  a reader has re-grown a depth floor (${floors.join("; ")}) — sufficiency belongs to the consumer, which knows how much it needs`); }
else console.log("\n  ok    none of the four readers holds a depth policy of its own");

if (bad) { console.error(`\n  ${bad} case(s) wrong\n`); process.exit(1); }
console.log("\n  one decision, one place: the reader judges shape, the consumer judges sufficiency\n");
