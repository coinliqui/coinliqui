#!/usr/bin/env node
/**
 * A SWEEP SLICE GOES OUT IN SMALL GROUPS, STOPS AT THE FIRST 429, AND ROTATES ITS RETRIES.
 *
 * Measured 15 October 2026: whole candle cycles came back 429 from Hyperliquid, and WLFI sat
 * last in the retry list and lost every retry, so /funding/wlfi served an 11.6-hour-old 1h chart.
 * See src/lib/sweep-run.ts.
 *
 *   node --experimental-strip-types scripts/sweep-run-cases.mjs
 *   node --experimental-strip-types scripts/sweep-run-cases.mjs --blind   the old burst and fixed order, which must fail
 */
import { runSlice, rotateRetries, SLICE_GROUP } from "../src/lib/sweep-run.ts";

const blind = process.argv.includes("--blind");
/* THE OLD SHAPE: one Promise.all over the slice, and the retry list in a fixed order. */
const burst = async (slice, write) => {
  let firstErr = ""; const done = [];
  const oks = await Promise.all(slice.map((s) => write(s).catch((e) => { if (!firstErr) firstErr = `${s}: ${e.message}`; return false; })));
  oks.forEach((ok, i) => { if (ok) done.push(slice[i]); });
  return { done, firstErr, throttled: false };
};
const run = blind ? burst : runSlice;
const rotate = blind ? (holes, stale) => [...holes, ...stale.filter((s) => !holes.includes(s))] : rotateRetries;

let bad = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };
const SYMS = Array.from({ length: 12 }, (_, i) => `S${i}`);

console.log(`\nthe sweep slice${blind ? "  [BLIND: one burst, fixed retry order]" : ""}\n`);
{
  let inFlight = 0, peak = 0;
  const write = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return true; };
  const r = await run(SYMS, write);
  ok(r.done.length === 12, "a healthy slice writes every symbol");
  ok(peak <= SLICE_GROUP, `never more than ${SLICE_GROUP} requests in flight (peak ${peak})`);
}
{
  const tried = [];
  /* The limit answers 429 from the sixth request on, as a shared IP's budget runs out. */
  const write = async (s) => { tried.push(s); if (tried.length > 5) throw new Error(`hourly ${s} 429`); return true; };
  const r = await run(SYMS, write);
  ok(r.throttled === true, "a 429 is recognised as the rate limit");
  ok(tried.length <= 8, `after the first 429 no new group is sent (${tried.length} of 12 tried)`);
  ok(r.done.length === 5 && /429/.test(r.firstErr), "what was written is kept and the error is named");
}
{
  const write = async (s) => { if (s === "S3") throw new Error("hourly S3 500"); return true; };
  const r = await run(SYMS, write);
  ok(r.done.length === 11 && r.throttled === false, "an ordinary error skips one symbol and the slice carries on");
}
{
  /* WLFI's position: last of twelve stale symbols, and a budget that covers five per tick. */
  const stale = ["LTC", "AVAX", "CRV", "ARB", "XLM", "TRX", "HBAR", "FET", "ETHFI", "JUP", "PURR", "WLFI"];
  let reached = 0;
  for (let tick = 0; tick < 12; tick++) if (rotate([], stale, tick).slice(0, 5).includes("WLFI")) reached++;
  ok(reached >= 4, `the last symbol of the retry list gets a turn within a short budget (${reached} of 12 ticks)`);
  ok(rotate(["NEW"], stale, 7)[0] === "NEW", "a symbol with no data at all still goes first");
}

if (blind) {
  if (!bad) { console.error("\nBLIND: the old burst satisfied every assertion. This suite cannot see a rate limit."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against the old burst`);
  process.exit(0);
}
if (bad) { console.error(`\nsweep run cases FAILED: ${bad}`); process.exit(1); }
console.log("\nsweep run cases: groups of four, a 429 stops the slice, the retry list rotates");
