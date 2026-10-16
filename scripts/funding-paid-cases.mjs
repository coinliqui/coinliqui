#!/usr/bin/env node
/**
 * FUNDING PAID, AGAINST SUMS WORKED BY HAND.
 *
 * /funding/paid prints one figure built to be quoted, so the arithmetic behind it is held to
 * cases whose answers were worked out before the code ran: a sign that flips, an hour with no
 * rate, a duplicate store write, a contract with no history, the window's edges. `--blind` swaps
 * in the two mistakes this kind of sum invites, counting a duplicate write twice and filling a
 * missing hour with the last rate, and the cases must fail against both.
 *
 *   node --experimental-strip-types scripts/funding-paid-cases.mjs [--blind]
 */
import { fundingPaid, HL_BASE_HOURLY } from "../src/lib/funding-paid.ts";
import { fundingHistory, median } from "../src/lib/funding-history.ts";

const BLIND = process.argv.includes("--blind");
const H = 3_600_000;
const T = 1_790_000_000_000 - (1_790_000_000_000 % H); // an hour boundary

/* The two mistakes, written out so the cases can be run against them. */
function naive(oi, rates, from, to) {
  const h0 = Math.ceil(from / H), h1 = Math.floor(to / H);
  const rows = [];
  const syms = [...new Set(oi.map((r) => r.symbol))];
  for (const s of syms) {
    const rate = new Map((rates.get(s) ?? []).map(([t, v]) => [Math.floor(t / H), v]));
    let longsPaid = 0, shortsPaid = 0, hours = 0, last;
    for (const r of oi.filter((x) => x.symbol === s)) {
      const h = Math.floor(r.at / H);
      if (h < h0 || h >= h1) continue;
      const f = rate.has(h) ? rate.get(h) : last; // fills the gap
      if (f === undefined) continue;
      last = f;
      const p = r.oi * f; // and counts a duplicate write twice
      if (p > 0) longsPaid += p; else shortsPaid -= p;
      hours++;
    }
    if (hours) rows.push({ symbol: s, longsPaid, shortsPaid, net: longsPaid - shortsPaid, hours });
  }
  const net = rows.reduce((a, r) => a + r.net, 0);
  return { rows, net, unjoined: syms.filter((s) => !rows.some((r) => r.symbol === s)) };
}
const subject = BLIND ? naive : fundingPaid;

let bad = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const B = HL_BASE_HOURLY;
const oi = [
  // AAA: three hours, one at the base rate, one above, one negative; the 2nd hour written twice
  { symbol: "AAA", oi: 1_000_000, at: T + 60_000 },
  { symbol: "AAA", oi: 1_000_000, at: T + H + 60_000 },
  { symbol: "AAA", oi: 9_999_999, at: T + H + 120_000 }, // duplicate write in the same hour
  { symbol: "AAA", oi: 2_000_000, at: T + 2 * H + 60_000 },
  { symbol: "AAA", oi: 2_000_000, at: T + 3 * H + 60_000 }, // no settled rate for this hour
  // BBB: open interest, no history at all
  { symbol: "BBB", oi: 5_000_000, at: T + 60_000 },
  // outside the window on both sides
  { symbol: "AAA", oi: 1e12, at: T - H + 60_000 },
  { symbol: "AAA", oi: 1e12, at: T + 5 * H + 60_000 },
];
const rates = new Map([["AAA", [[T, B], [T + H, 3 * B], [T + 2 * H, -B], [T + 5 * H, B]]]]);
const r = subject(oi, rates, T, T + 5 * H);
const a = r.rows.find((x) => x.symbol === "AAA");

// By hand: 1e6·B + 1e6·3B paid by longs = 4e6·B; 2e6·B paid by shorts. Hour 4 has no rate.
ok(a && near(a.longsPaid, 4e6 * B), "longs paid 1M at the base rate plus 1M at three times it, and the duplicate write is not counted again");
ok(a && near(a.shortsPaid, 2e6 * B), "a negative rate is paid by shorts, counted on its own side");
ok(a && near(a.net, 2e6 * B), "net is the difference, 2M × base");
ok(a && a.hours === 3, "an hour with no settled rate is left out, not filled from the hour before");
ok(near(r.net, 2e6 * B), "hours outside the window contribute nothing");
ok(r.unjoined?.includes("BBB") && !r.rows.some((x) => x.symbol === "BBB"), "a contract with open interest and no history is named, not summed as zero");
if (!BLIND) {
  ok(near(a.base, 4e6 * B) && a.baseHours === 1, "the base-rate counterfactual covers the joined hours only, and one of them settled at exactly the base");
  ok(r.span === 5 && r.last === T + 2 * H, "the window is five hours and the newest joined hour is the third");
}

/* THE SEVEN-MONTH TABLE. 48 hours: 24 at the base rate, 12 at −base, 12 at 3×base. By hand:
   Σ = 24B − 12B + 36B = 48B; base-only 48B; at base 50%; shorts paid 25% of hours. Candles open
   at 100 on the first day and close at 110: +10%. The naive version takes the price from the first
   candle in the set rather than the first day of funding, which is what the blind run swaps in. */
{
  const D = 86_400_000, t0 = T - (T % D);
  const hist = [];
  for (let i = 0; i < 48; i++) hist.push([t0 + i * H, i < 24 ? B : i < 36 ? -B : 3 * B]);
  const candles = [[t0 - 5 * D, 50, 50, 50, 50, 1], [t0, 100, 100, 100, 100, 1], [t0 + D, 105, 110, 104, 110, 1]];
  const fh = BLIND
    ? { ...fundingHistory("AAA", hist, candles), price: candles[candles.length - 1][4] / candles[0][1] - 1 }
    : fundingHistory("AAA", hist, candles);
  ok(near(fh.paid, 48 * B) && near(fh.base, 48 * B), "a long's sum is Σ rate over the stored hours, and the base-only sum is hours × base");
  ok(fh.atBase === 0.5 && fh.shortsHours === 0.25, "half the hours at exactly the base rate, a quarter with shorts paying");
  ok(near(fh.price, 0.1), "the price runs from the open of the first funding day, not from the oldest candle stored");
  ok(Number.isNaN(fundingHistory("AAA", hist, [[t0 + 3 * D, 1, 1, 1, 1, 1]]).price), "candles that start after the funding series give no price change, not a shorter one");
  ok(fundingHistory("AAA", hist.slice(0, 10), candles) === null, "under a day of hours is no row");
  /* Hours 24–35 are the twelve negative ones, contiguous: a run of 12 ending at hour 35. A gap
     inside a run must break it — the second series drops hour 30. */
  ok(fh.shortsRun === 12 && fh.shortsRunEnd === t0 + 35 * H, "the longest run of shorts paying is twelve hours, ending at the twelfth");
  ok(fundingHistory("AAA", hist.filter((_, i) => i !== 30), candles).shortsRun === 6, "a missing hour breaks a run rather than being assumed to continue it");
  ok(near(fh.steepest, 3 * B) && fh.steepestAt === t0 + 36 * H, "the steepest hour is the first at three times the base, either sign considered");
  ok(median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5 && Number.isNaN(median([])), "the median of odd, even and empty sets");
}

if (BLIND) {
  if (!bad) { console.error("\nBLIND: the cases passed against a sum that double-counts and fills gaps"); process.exit(1); }
  console.log(`\nblind run red as required — ${bad} case(s) caught the double count and the filled hour`);
  process.exit(0);
}
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\nfunding paid: every case matches the sum worked by hand");
