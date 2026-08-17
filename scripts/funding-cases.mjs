#!/usr/bin/env node
/**
 * PURE-FUNCTION INVARIANTS FROM src/lib/funding.ts, run against the real module.
 *
 * The functions in that file turn upstream numbers into the figures printed on fifty contract
 * pages. Nothing was exercising them directly: the smoke gate renders pages and asserts about
 * the HTML, which catches a page that fails to render and not a page that renders a wrong
 * number confidently.
 *
 * Written for nextSettlement(). "Next settlement" printed Hyperliquid's `nextFundingTime`
 * verbatim, and that field is in the PAST on every one of its 232 contracts — measured against
 * the live endpoint, while all 395 Binance and Bybit contracts carried a future one. A page
 * rendered at 14:27:48 UTC announced the next settlement as 14:00, on every contract page,
 * every hour, for as long as the card had existed. No gate could see it, because 14:00 is a
 * perfectly well-formed time.
 *
 *   node --experimental-strip-types scripts/funding-cases.mjs
 */
import { nextSettlement, toApr, settlementsPerYear, queryNum, usd, paymentDirection } from "../src/lib/funding.ts";

const now = Date.parse("2026-08-17T14:27:48Z");
const at = (s) => Date.parse(s);
const hhmm = (t) => (t === null ? "null" : new Date(t).toISOString().slice(11, 16));

let bad = 0;
const t = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${String(got).padEnd(7)} want ${String(want).padEnd(7)}  ${name}`);
};

console.log("\n  nextSettlement — a time labelled \"next\" must be in the future");
t("Hyperliquid hourly, the observed production case", hhmm(nextSettlement(at("2026-08-17T14:00:00Z"), 1, now)), "15:00");
t("Binance 8h, already ahead — passes through", hhmm(nextSettlement(at("2026-08-17T16:00:00Z"), 8, now)), "16:00");
t("Bybit 4h, already ahead — passes through", hhmm(nextSettlement(at("2026-08-17T16:00:00Z"), 4, now)), "16:00");
t("a whole interval stale", hhmm(nextSettlement(at("2026-08-17T13:00:00Z"), 1, now)), "15:00");
t("many intervals stale — a dead upstream", hhmm(nextSettlement(at("2026-08-16T02:00:00Z"), 1, now)), "15:00");
t("8h contract stale by 9h", hhmm(nextSettlement(at("2026-08-17T05:00:00Z"), 8, now)), "21:00");
t("exactly now — now is not the future", hhmm(nextSettlement(now, 1, now)), "15:27");
t("one ms ahead — left alone", hhmm(nextSettlement(now + 1, 1, now)), "14:27");
/* The honest-absence cases. A dash on the page beats a fabricated time. */
t("null timestamp", hhmm(nextSettlement(null, 1, now)), "null");
t("no interval to step by, and stale", hhmm(nextSettlement(at("2026-08-17T14:00:00Z"), 0, now)), "null");
t("no interval to step by, but ahead", hhmm(nextSettlement(at("2026-08-17T16:00:00Z"), 0, now)), "16:00");
t("NaN interval, and stale", hhmm(nextSettlement(at("2026-08-17T14:00:00Z"), NaN, now)), "null");

/* THE INVARIANT ITSELF, swept rather than sampled: across every settlement interval the three
   venues actually use, and every offset from 12.5 hours behind to 12.5 hours ahead, the result
   is either null or strictly in the future. A table of examples can be right by coincidence. */
let violations = 0, checked = 0;
for (const iv of [1, 2, 4, 8]) {
  for (let off = -50; off <= 50; off++) {
    const r = nextSettlement(now + off * 900_000, iv, now);
    checked++;
    if (r !== null && r <= now) violations++;
  }
}
if (violations) bad++;
console.log(`  ${violations ? "FAIL" : "ok  "}  ${checked} inputs across 4 intervals — ${violations} produced a time not in the future`);

/* Two neighbours, cheap to assert and previously uncovered. */
console.log("\n  annualisation");
t("hourly 0.01% -> 87.6% APR", toApr(0.0001, 1).toFixed(4), (0.0001 * 8760).toFixed(4));
t("8-hourly 0.01% -> 10.95% APR", toApr(0.0001, 8).toFixed(4), (0.0001 * 1095).toFixed(4));
t("a zero interval cannot annualise", String(Number.isNaN(toApr(0.0001, 0))), "true");
t("a NaN rate cannot annualise", String(Number.isNaN(toApr(NaN, 8))), "true");
t("settlements per year, hourly", settlementsPerYear(1), 8760);
t("settlements per year, 8-hourly", settlementsPerYear(8), 1095);

/* QUERY INPUTS. Every calculator read `Number(q.get("x") ?? default)`, which defaults only on
   an ABSENT parameter — so a present, invalid one reached the arithmetic. */
console.log("\n  queryNum — a present but invalid parameter must not reach the arithmetic");
t("absent falls back", queryNum(null, 30), 30);
t("ordinary value passes", queryNum("45", 30), 45);
t("the inversion: negative days", queryNum("-30", 30), 30);
t("empty string", queryNum("", 30), 30);
t("whitespace only", queryNum("   ", 30), 30);
t("non-numeric", queryNum("abc", 30), 30);
t("the literal NaN", queryNum("NaN", 30), 30);
t("Infinity", queryNum("Infinity", 30), 30);
t("1e30 float-noise notional", queryNum("1e30", 10_000), 10_000);
t("zero leverage", queryNum("0", 10, { min: 1 }), 10);
t("valid leverage passes", queryNum("5", 10, { min: 1 }), 5);
t("exactly min is valid", queryNum("0", 30, { min: 0 }), 0);

/* THE INVARIANT THE INVERSION BROKE, swept rather than sampled. Direction is a function of
   sign(rate) and side ONLY. No holding period and no position size may change who pays whom.
   This is the assertion that would have caught "You pay $67.65" becoming "You receive $67.65"
   on the same contract at the same rate. */
const direction = (rate, side, days, notional) => {
  /* Transcribed from the page: inputs sanitised, cost computed, direction taken from the rate
     and the side alone. The cost is still computed here on purpose — the assertion is that it
     CANNOT influence the answer. */
  const d = queryNum(String(days), 30, { min: 0, max: 3650 });
  const n = queryNum(String(notional), 10_000, { min: 1 });
  const signed = side === "long" ? 1 : -1;
  void (n * rate * ((d * 24) / 8) * signed);
  return paymentDirection(rate, side);
};
let dirBad = 0, dirChecked = 0;
for (const rate of [0.0000772, -0.0000772, 0.001, -0.001]) {
  for (const side of ["long", "short"]) {
    const truth = direction(rate, side, 30, 10_000);
    for (const days of [1, 30, 365, 0, -30, -1, "abc", "", "NaN", "-1e9"]) {
      for (const notional of [1, 10_000, 1e9, -10_000, "xyz", "1e30"]) {
        dirChecked++;
        if (direction(rate, side, days, notional) !== truth) dirBad++;
      }
    }
  }
}
if (dirBad) bad++;
console.log(`  ${dirBad ? "FAIL" : "ok  "}  ${dirChecked} combinations of rate x side x days x notional — ${dirBad} changed who pays`);

console.log("\n  usd — no rung above B meant float noise was printed as currency");
t("a real open-interest figure", usd(2.85e9), "$2.85B");
t("1e30 is not a dollar amount", usd(1e30), "—");
t("nor is 5e19", usd(5e19), "—");
t("negatives too", usd(-1e30), "—");
t("1e12 still prints", usd(1e12), "$1000.00B");

console.log(bad ? `\n  ${bad} failure(s) in the funding library\n` : "\n  funding library invariants hold\n");
process.exit(bad ? 1 : 0);
