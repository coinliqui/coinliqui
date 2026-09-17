#!/usr/bin/env node
/**
 * SUPERLATIVES, AGAINST THE BOOK THAT BROKE THEM.
 *
 * The front page published "Hyperliquid funding is most expensive on BTC at 10.95% a year" while
 * 38 of the 50 contracts held exactly 10.95% — the venue's base rate, the reading a contract
 * carries when the market has no view about it. The claim was a sort-and-take-first over a set
 * where 38 rows were indistinguishable, so the "winner" was whichever row the sort left in front.
 *
 * These cases assert the PROPERTY that makes that unpublishable rather than any particular
 * wording: over a tied set there is no unique item to name, and the count of the tie is available
 * instead. The shape of the real book — a mass at one value, a handful of priced contracts, one
 * extreme — is handed in directly, because that is the distribution every scale and every
 * superlative on this site actually meets and the one imagined data never has.
 *
 *   node --experimental-strip-types scripts/extreme-cases.mjs
 *
 * The blind run replaces extremeBy() with the sort-and-take-first it replaced, and must fail:
 * --blind proves these assertions can see the defect they exist for.
 *
 *   node --experimental-strip-types scripts/extreme-cases.mjs --blind
 */
import { extremeBy, pluralityOf, standing } from "../src/lib/extreme.ts";

const blind = process.argv.includes("--blind");

/** THE OLD SHAPE, reproduced exactly: sort descending, take the first, call it the winner. */
const sortAndTakeFirst = (items, value, dir = "max") => {
  const finite = items.filter((i) => Number.isFinite(value(i)));
  if (!finite.length) return { kind: "none" };
  const sorted = [...finite].sort((a, b) => (dir === "max" ? value(b) - value(a) : value(a) - value(b)));
  return { kind: "unique", item: sorted[0], value: value(sorted[0]), of: finite.length };
};
const subject = blind ? sortAndTakeFirst : extremeBy;

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};

/* Hyperliquid's base rate, written the way the venue produces it rather than as 0.1095, so the
   float these cases compare is the float the site compares. */
const BASE = 0.0000125 * 8760;

/* THE BOOK, AS MEASURED. 38 contracts resting on the base, 7 priced below it, 3 above zero but
   still under it, one absent rate. The absent one is here because a missing rate is not a small
   rate and must not become the minimum. */
const book = [
  ...["BTC", "ETH", "SOL", "XRP", "DOGE", "CHIP", "VIRTUAL", "ONDO", "INJ", "LDO", "NEAR", "AAVE",
      "LINK", "BNB", "ADA", "SUI", "TAO", "ARB", "LTC", "PAXG", "ENA", "XPL", "UNI", "WLD",
      "ZRO", "MON", "GRAM", "ASTER", "FARTCOIN", "PUMP", "XMR", "ZEC", "HYPE", "LIT", "VVV",
      "PONS", "KPEPE", "OP"].map((symbol) => ({ symbol, apr: BASE })),
  { symbol: "TRUMP", apr: -0.4579 },
  { symbol: "XLM", apr: -0.3648 },
  { symbol: "AVAX", apr: -0.2042 },
  { symbol: "TRX", apr: -0.0285 },
  { symbol: "BNB2", apr: -0.0157 },
  { symbol: "LINK2", apr: -0.0103 },
  { symbol: "AAVE2", apr: -0.0638 },
  { symbol: "SOL2", apr: 0.0667 },
  { symbol: "ADA2", apr: 0.0190 },
  { symbol: "ETH2", apr: 0.0104 },
  { symbol: "DELISTED", apr: NaN },
];

console.log(`\nsuperlatives over the real book${blind ? "  [BLIND: sort-and-take-first]" : ""}\n`);
{
  const dearest = subject(book, (p) => p.apr, "max");

  /* THE ONE THAT SHIPPED. 38 contracts hold the maximum, so there is no dearest contract to name
     and the type must not offer one. */
  ok(dearest.kind === "tied", "the dearest rate is reported as a tie, not as a winner", `kind=${dearest.kind}`);
  ok(dearest.kind === "tied" && dearest.items.length === 38, "and the tie carries all 38 contracts sitting on it",
     dearest.kind === "tied" ? `items=${dearest.items.length}` : "no items at all");
  ok(dearest.kind !== "unique", "no single symbol is nameable as the most expensive",
     dearest.kind === "unique" ? `it named ${dearest.item.symbol}` : "");

  /* THE DENOMINATOR IS THE FINITE SET, not the array length: the delisted contract has no rate
     and must not inflate "of 49" into "of 50". */
  ok(dearest.of === 48, "the denominator counts contracts with a rate, not rows", `of=${dearest.of}`);

  /* THE MINIMUM IS GENUINELY UNIQUE on this book, so the union must reach it — a type that can
     never name anything is as useless as one that always does. */
  const cheapest = subject(book, (p) => p.apr, "min");
  ok(cheapest.kind === "unique", "the cheapest rate IS unique here and is reported as such", `kind=${cheapest.kind}`);
  ok(cheapest.kind === "unique" && cheapest.item.symbol === "TRUMP", "and it is TRUMP",
     cheapest.kind === "unique" ? cheapest.item.symbol : "");

  /* A MISSING RATE IS NOT A SMALL RATE. If NaN sorted to an end this would name DELISTED. */
  ok(cheapest.kind !== "unique" || cheapest.item.symbol !== "DELISTED",
     "an absent rate never becomes the minimum");
}

console.log("\nthe shapes that are not the real book\n");
{
  const two = [{ s: "A", v: 1 }, { s: "B", v: 2 }];
  const u = subject(two, (x) => x.v, "max");
  ok(u.kind === "unique" && u.item.s === "B", "a clean maximum over two distinct values is named");

  const allSame = [{ s: "A", v: 5 }, { s: "B", v: 5 }, { s: "C", v: 5 }];
  const t = subject(allSame, (x) => x.v, "max");
  ok(t.kind === "tied" && t.items.length === 3, "three identical values are three tied items", `kind=${t.kind}`);

  const one = subject([{ s: "A", v: 7 }], (x) => x.v, "max");
  ok(one.kind === "unique", "a single candidate is unique, not tied");

  ok(subject([], (x) => x.v, "max").kind === "none", "an empty set yields none rather than throwing");
  ok(subject([{ s: "A", v: NaN }], (x) => x.v, "max").kind === "none", "a set with no finite value yields none");

  /* Equality to a stated precision, for callers comparing what they print rather than what they
     hold. 6.940% and 6.9400000001% are the same number in a sentence that prints two decimals. */
  const near = [{ s: "A", v: 0.069400000001 }, { s: "B", v: 0.0694 }];
  ok(subject(near, (x) => x.v, "max", 1e-6).kind === "tied", "values equal to the printed precision tie");
  ok(subject(near, (x) => x.v, "max", 1e-15).kind === "unique", "and are distinct when the tolerance is tighter than they are");
}

/* pluralityOf is not part of the blind comparison: the old code had no such concept, which is
   precisely why the home page could not say what /funding said. Always run the real one. */
console.log("\nthe mass the book rests on\n");
{
  const mode = pluralityOf(book.map((p) => p.apr));
  ok(mode !== null && mode.count === 38, "38 of the book share one value", `count=${mode?.count}`);
  ok(mode !== null && Math.abs(mode.value - BASE) < 1e-12, "and that value is the venue's base rate");
  ok(mode !== null && mode.of === 48, "measured over the contracts that have a rate", `of=${mode?.of}`);
  ok(pluralityOf([]) === null, "an empty column has no plurality rather than throwing");
  ok(pluralityOf([NaN, NaN]) === null, "and neither does a column of absences");
  const distinct = pluralityOf([1, 2, 3, 4]);
  ok(distinct !== null && distinct.count === 1, "a column of distinct values reports a plurality of one, for the caller to judge");
}

console.log("\nwhere one reading sits in its own history\n");
{
  const hist = [...Array(600).fill(BASE), ...Array(100).fill(0.02), ...Array(20).fill(0.40), ...Array(20).fill(-0.30)];
  const high = standing(hist, 0.45);
  ok(high !== null && high.below === 740 && high.equal === 0 && high.above === 0, "a rate above everything is above all 740 readings");
  const low = standing(hist, -0.5);
  ok(low !== null && low.below === 0 && low.above === 740, "a rate below everything is below all of them");

  /* SIGNED, NOT BY MAGNITUDE. */
  const neg = standing(hist, -0.40), pos = standing(hist, 0.40);
  ok(neg !== null && pos !== null && neg.below < pos.below, "a deeply negative rate ranks below a high one, not beside it");

  /* THE ONE THAT SHIPPED. A contract resting on the base rate EQUALS 600 of these readings; the old
     function reported only the 120 below it, and the page printed that as a rank. All three counts
     must come back and must account for every reading. */
  const atBase = standing(hist, BASE);
  ok(atBase !== null && atBase.equal === 600, "a contract on the base rate equals the 600 readings resting there", `equal=${atBase?.equal}`);
  ok(atBase !== null && atBase.below === 120 && atBase.above === 20, "and is above the quiet 120 and below the 20 spikes", `below=${atBase?.below} above=${atBase?.above}`);
  ok(atBase !== null && atBase.below + atBase.equal + atBase.above === atBase.of, "the three counts account for every reading");

  /* BLIND: the old strict-below share, reproduced, reads this contract as sitting in its lower sixth. */
  const oldShare = hist.filter((v) => v < BASE).length / hist.length;
  ok(oldShare < 0.2 && atBase.equal / atBase.of > 0.8, "the share the old version printed hid that the rate IS the month's usual reading — the case can see the defect",
     `old share=${oldShare.toFixed(3)} tied=${(atBase.equal / atBase.of).toFixed(3)}`);

  ok(standing([], 0.1) === null, "an empty history yields null rather than a share of zero");
  ok(standing([NaN, NaN], 0.1) === null, "and so does a history of absences");
  ok(standing(hist, NaN) === null, "an absent reading has no standing");
}

if (blind) {
  if (!bad) {
    console.error("\nBLIND: sort-and-take-first satisfied every assertion. This suite cannot detect the defect it exists for.");
    process.exit(1);
  }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against sort-and-take-first`);
  process.exit(0);
}
if (bad) { console.error(`\nextreme cases FAILED: ${bad}`); process.exit(1); }
console.log("\nextreme cases: a tied superlative has no winner to name");
