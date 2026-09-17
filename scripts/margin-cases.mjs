#!/usr/bin/env node
/**
 * THE LIQUIDATION ARITHMETIC, AGAINST THE TWO WAYS ITS SENTENCES WENT WRONG.
 *
 * liquidationPrice() had no suite of its own. It was correct; what shipped wrong was the use of two
 * figures it returned, and both were confirmed by the claim-vs-table audit on 16 September 2026:
 *
 *   A GAP WITH NO STATED BASE. `differencePct` was the naive–correct gap as a share of the CORRECT
 *   price, and three pages printed it as "1.25% ($864.93) away from what the common formula returns"
 *   — naming the formula's price as the reference. It is renamed differenceOfCorrectPct, and pages now
 *   compare distancePct with naiveDistancePct, which share a base: entry.
 *
 *   A NAIVE FORMULA THAT KNEW ABOUT THE CLAMP. The "formula in circulation" was fed the tier-clamped
 *   leverage, so /learn/liquidation-price printed "Leverage requested 10× … Common formula says $80" —
 *   the formula at 5×, the cap the same page says the formula cannot see. It now takes the leverage
 *   the reader asked for.
 *
 *   node --experimental-strip-types scripts/margin-cases.mjs
 *   node --experimental-strip-types scripts/margin-cases.mjs --blind
 *
 * --blind reproduces both old behaviours and must fail.
 */
import { liquidationPrice, naiveLiquidationPrice, maintenanceMarginFraction, roomVerdict } from "../src/lib/margin.ts";

const blind = process.argv.includes("--blind");
let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* A two-tier table with a boundary a reader can hold in their head: 10× up to $3M, 5× above. */
const table = { description: "fixture", marginTiers: [{ lowerBound: 0, maxLeverage: 10 }, { lowerBound: 3_000_000, maxLeverage: 5 }] };

/** THE OLD BEHAVIOUR, reproduced for --blind: naive at the clamped leverage, gap on the correct price. */
const oldResult = (input) => {
  const r = liquidationPrice(input);
  const naive = naiveLiquidationPrice(input.entryPrice, r.effectiveLeverage, input.side);
  return { ...r, naivePrice: naive, naiveDistancePct: Math.abs(naive - input.entryPrice) / input.entryPrice };
};
const run = blind ? oldResult : liquidationPrice;

console.log(`\nthe formula in circulation${blind ? "  [BLIND: clamped leverage]" : ""}\n`);
{
  const small = run({ entryPrice: 100, positionSize: 10_000, leverage: 10, side: "long", table });
  const large = run({ entryPrice: 100, positionSize: 40_000, leverage: 10, side: "long", table });

  ok(!small.leverageClamped && close(small.naivePrice, 90), "unclamped: the common formula at 10× gives $90", `naive=${small.naivePrice}`);
  ok(large.leverageClamped && large.effectiveLeverage === 5, "the $4M position is clamped to the tier's 5×");
  /* THE ONE THAT SHIPPED. */
  ok(close(large.naivePrice, 90), "clamped: the common formula still gives $90, because its user asked for 10× and cannot see the cap",
     `naive=${large.naivePrice}`);
  ok(close(large.liquidationPrice, 80 / (1 - maintenanceMarginFraction(5))), "while the venue liquidates at the 5× price, $88.89",
     `correct=${large.liquidationPrice.toFixed(2)}`);
}

console.log("\nroom from entry, on one base\n");
{
  const r = run({ entryPrice: 75_000, positionSize: 0.13, leverage: 10, side: "long", table: { marginTiers: [{ lowerBound: 0, maxLeverage: 40 }] } });
  /* Both distances are shares of ENTRY, so they can sit in one sentence. */
  ok(close(r.naiveDistancePct, 0.10), "the formula's room at 10× is exactly 10.00% of entry", `${(r.naiveDistancePct * 100).toFixed(4)}%`);
  ok(close(r.distancePct, Math.abs(r.liquidationPrice - 75_000) / 75_000), "the venue's room is a share of the same entry");
  ok(r.distancePct < r.naiveDistancePct, "and inside a tier the venue gives less room than the formula promises",
     `${(r.distancePct * 100).toFixed(2)}% < ${(r.naiveDistancePct * 100).toFixed(2)}%`);
  /* The difference in room, in price, is exactly the dollar gap the sentence prints. */
  ok(close((r.naiveDistancePct - r.distancePct) * 75_000, r.differenceAbs, 1e-6), "the difference in room, in dollars, is the printed gap");
  /* The renamed field keeps its old meaning under a name that says what it is a share of. */
  if (!blind) ok(close(r.differenceOfCorrectPct, r.differenceAbs / r.liquidationPrice), "differenceOfCorrectPct is a share of the correct price, as its name says");

  /* A clamped position can have MORE room than the naive formula at the requested leverage — the
     sentence on the contract page and the calculator has to be able to say so. */
  const big = run({ entryPrice: 100, positionSize: 40_000, leverage: 10, side: "long", table });
  ok(big.distancePct > big.naiveDistancePct, "a clamped position sits further from liquidation than the formula at the requested leverage",
     `${(big.distancePct * 100).toFixed(2)}% > ${(big.naiveDistancePct * 100).toFixed(2)}%`);
}

console.log("\nthe sentence that compares the two rooms\n");
if (!blind) {
  const t40 = { marginTiers: [{ lowerBound: 0, maxLeverage: 40 }] };
  /* THE ONE THAT SHIPPED: 1×, nothing capped, both rooms 100.00% — and the page said the tier capped it. */
  const one = liquidationPrice({ entryPrice: 76_000, positionSize: 5_000 / 76_000, leverage: 1, side: "long", table: t40 });
  ok(roomVerdict(one) === "same", "at 1× the two rooms are equal, and the verdict says so", `verdict=${roomVerdict(one)}`);
  const ten = liquidationPrice({ entryPrice: 76_000, positionSize: 0.13, leverage: 10, side: "long", table: t40 });
  ok(roomVerdict(ten) === "less", "inside a tier the venue gives less room", `verdict=${roomVerdict(ten)}`);
  const capped = liquidationPrice({ entryPrice: 100, positionSize: 40_000, leverage: 10, side: "long", table });
  ok(roomVerdict(capped) === "more-capped", "a clamped position has more room, and the cap is the stated reason", `verdict=${roomVerdict(capped)}`);
  /* "because the tier caps" must never be the verdict when nothing was capped. */
  let lies = 0;
  for (const L of [1, 2, 3, 5, 10, 20, 40]) for (const size of [0.01, 0.13, 2, 50]) {
    const r = liquidationPrice({ entryPrice: 76_000, positionSize: size, leverage: L, side: "long", table: t40 });
    if (roomVerdict(r) === "more-capped" && !r.leverageClamped) lies++;
  }
  ok(lies === 0, "across leverages and sizes, the cap is named only when it applied");
}

if (blind) {
  if (!bad) { console.error("\nBLIND: the old behaviour satisfied every assertion. This suite cannot see the defect it exists for."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against the clamped naive formula`);
  process.exit(0);
}
if (bad) { console.error(`\nmargin cases FAILED: ${bad}`); process.exit(1); }
console.log("\nmargin cases: the formula in circulation is the one a reader would use, and room is measured from entry");
