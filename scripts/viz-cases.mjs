#!/usr/bin/env node
/**
 * THE FIGURES, AGAINST THE SHAPES THAT BROKE THEM.
 *
 * Every visual defect this site has shipped came from the same place: a scale that is obviously
 * right on imagined data and wrong on the data it actually meets. Three of them, in four days,
 * all found by looking at production rather than by any test:
 *
 *   the distribution's axis ran to −50% for a column whose median was 11%, because it rounded
 *   each bound up to the next tidy ceiling;
 *   the same figure drew no cyan under a caption reading "4 pay shorts to longs", because the
 *   tenth percentile of a mostly-positive column is itself positive;
 *   the heat field put 109 of 140 cells on the top step, because a percentile of the MAGNITUDE
 *   lands on the pile when the values pile up.
 *
 * None of them were arithmetic mistakes. Each was a correct formula meeting a real distribution
 * — mass at one value, one enormous outlier, a sign that exists but is rare — and each was
 * invisible until it was drawn. So these cases hand the scales those shapes directly and assert
 * the PROPERTIES a figure must have to be worth drawing, rather than comparing pixels:
 *
 *   a scale must not saturate: identical values get no tint at all, not full tint;
 *   an axis must contain zero when the data has a sign;
 *   a side that exists must have room to be drawn;
 *   an outlier must be counted, not allowed to set the scale;
 *   nothing may throw on empty, single-valued, or non-finite input.
 *
 *   node --experimental-strip-types scripts/viz-cases.mjs
 */
import { distribution, heatScale, heatStep, signedBar, MIN_BAR } from "../src/lib/viz.ts";

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};

/* ---------------------------------------------------------------- the heat scale */
console.log("\nheat scale — how hot a cell is, against the columns that exist\n");
{
  /* THE ONE THAT SHIPPED. A column where every value is identical is the normal case on this
     site: 43 of 50 contracts sit on Hyperliquid's base rate. If that column tints at all, the
     field glows everywhere and says nothing. */
  const flat = heatScale(Array(43).fill(0.1095));
  ok(flat !== null && flat.scale === 0, "43 identical rates produce no scale at all", `scale=${flat?.scale}`);
  ok(heatStep(flat, 0.1095) === 0, "and therefore no tint on any of them");

  /* A COLUMN WITH REAL SPREAD PLUS AN OUTLIER, which is the /funding shape: a mass, a handful of
     priced contracts, and one extreme. The middle of the spread must still tint, or the outlier
     has washed the field out — the mirror of the saturation bug.

     THE FIRST VERSION OF THIS CASE ASSERTED THE WRONG THING. It used 40 identical values and one
     outlier and demanded that a rate two points off the mass be visible. With a column that
     shape, the only unusual thing IS the outlier, and step 0 for everything else is the honest
     answer — the expectation was wrong, not the code. A case that fails on correct behaviour
     gets the code changed to satisfy it, which is how a test suite makes a codebase worse. */
  const spread = [0.10, 0.12, 0.13, 0.15, 0.16, 0.18, 0.19, 0.21, 0.23, 0.26];
  const spiky = heatScale([...Array(20).fill(0.11), ...spread, 0.96]);
  ok(spiky !== null && spiky.scale > 0, "a column with real spread produces a scale");
  ok(heatStep(spiky, 0.23) > 0, "a rate in the middle of that spread still tints", `step=${heatStep(spiky, 0.23)}`);
  ok(heatStep(spiky, 0.96) === 6, "and the outlier is at the top step, not beyond it");
  /* The pure mass-plus-outlier column, where step 0 for the near-typical value is CORRECT. */
  const lone = heatScale([...Array(40).fill(0.11), 0.96]);
  ok(heatStep(lone, 0.13) === 0, "with one outlier and nothing else, a near-typical rate stays plain");
  ok(heatStep(lone, 0.96) === 6, "and the outlier is the only thing lit");

  /* The value AT the median is by definition typical, whatever the column looks like. */
  ok(heatStep(spiky, spiky.mid) === 0, "a rate sitting on the column's typical value is never tinted");

  /* THE COLUMN THAT SHIPPED WRONG, and the reason `mid` is a resting rate rather than a median.
     Binance on 16 September: 13 of 47 contracts resting on 10.95% — the interest component a quiet
     contract sits on — and the rest priced below it with a median near 2.57%. Measured from the
     median, all thirteen resting cells were tinted as hot as ETH at −5.22% while four priced
     contracts near 2.57% stayed plain: the legend says the opposite. */
  const BASE = 0.0000125 * 8760;
  const binance = [
    ...Array(13).fill(BASE),
    0.0218, 0.0242, 0.0251, 0.0257, 0.0257, 0.0260, 0.0265, 0.0270, 0.0281, 0.0290,
    0.0301, 0.0199, 0.0188, 0.0175, 0.0150, 0.0120, 0.0101, 0.0080, 0.0045, 0.0020,
    -0.0022, -0.0060, -0.0105, -0.0180, -0.0240, -0.0310, -0.0420, -0.0441, -0.0522,
    -0.0858, -0.0858, -0.1200, -0.1600, -0.2100,
  ];
  const bh = heatScale(binance);
  ok(bh !== null && Math.abs(bh.mid - BASE) < 1e-12, "a column where a fifth of the venue rests on one rate measures from that rate", `mid=${bh?.mid}`);
  ok(heatStep(bh, BASE) === 0, "so a contract resting on the venue's usual rate stays plain, as the legend promises");
  ok(heatStep(bh, 0.0257) > 0, "and a priced contract that merely sits near the median is tinted", `step=${heatStep(bh, 0.0257)}`);

  /* THE FALLBACK. Two contracts coinciding on a rate is a coincidence, not a regime; a column with
     no resting rate is measured from its median exactly as before. */
  const noRest = heatScale([0.01, 0.02, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11]);
  ok(noRest !== null && noRest.mid === 0.06, "a column whose largest shared value is a pair falls back to the median", `mid=${noRest?.mid}`);

  /* BLIND: the median rule, reproduced, must fail the Binance column. */
  {
    const col = [...binance].sort((a, b) => a - b);
    const medMid = col[Math.floor(col.length / 2)];
    const devs = col.map((v) => Math.abs(v - medMid)).sort((a, b) => a - b);
    const medScale = devs[Math.floor(devs.length * 0.9)];
    const medStep = (v) => Math.min(6, Math.round(Math.min(1, Math.abs(v - medMid) / medScale) * 6));
    ok(medStep(BASE) > 0, "and the median rule it replaces does tint the resting cells — the case can see the defect", `old step=${medStep(BASE)}`);
  }

  ok(heatScale([]) === null, "an empty column produces no scale rather than throwing");
  ok(heatStep(null, 0.5) === 0, "and a missing scale tints nothing");
  ok(heatScale([Number.NaN, Number.POSITIVE_INFINITY])?.scale === undefined || true, "non-finite input does not throw");
  ok(heatStep(heatScale([0.1]), 0.1) === 0, "a single-value column is flat, so nothing is tinted");

  /* Steps are a closed set: a reader counting six shades must never meet a seventh. */
  const s = heatScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  const steps = [-99, 0, 0.5, 4, 9, 100, 1e9].map((v) => heatStep(s, v));
  ok(steps.every((x) => Number.isInteger(x) && x >= 0 && x <= 6), "every step is an integer in 0..6", steps.join(","));
}

/* ------------------------------------------------------------- the distribution */
console.log("\ndistribution — the axis, against the columns that exist\n");
const barsIn = (svg) => (svg.match(/<rect/g) ?? []).length - 1; // less the well

{
  /* THE SHAPE THIS FIGURE MEETS EVERY DAY on the funding hub: a mass at one value with a short
     tail. It must still draw, and it must not claim an axis it did not measure. */
  const d = distribution([...Array(43).fill(0.1095), 0.96, -0.28, -0.15, 0.05, 0.02, 0.4, 0.31], { title: "t" });
  ok(d !== null, "a mass at one value with a tail still produces a figure");
  ok(d.lo < d.hi, "the axis is not degenerate", `${d.lo} … ${d.hi}`);
  ok(d.lo < 0, "a negative side exists, so the axis leaves room for it", `lo=${d.lo}`);
  ok(d.zeroAt !== null && d.zeroAt > 0 && d.zeroAt < 100, "zero has a position inside the axis", `${d.zeroAt?.toFixed(1)}%`);
  ok(d.over > 0, "the outlier is counted as clamped rather than stretching the axis", `over=${d.over}`);
  ok(barsIn(d.svg) > 1, "more than one bucket is drawn", `${barsIn(d.svg)} bars`);
}
{
  /* ALL IDENTICAL. One bucket holding everything is the honest answer; a crash or an axis of
     zero width is not. */
  const d = distribution(Array(30).fill(0.05), { title: "t" });
  ok(d !== null && d.lo < d.hi, "an entirely flat column still yields a usable axis", `${d?.lo} … ${d?.hi}`);
  ok(barsIn(d.svg) === 1, "and exactly one bucket is drawn", `${barsIn(d.svg)} bars`);
}
{
  /* ALL NEGATIVE — the mirror of the case that shipped with no cyan. */
  const d = distribution([-0.1, -0.2, -0.05, -0.3, -0.12, -0.08], { title: "t" });
  ok(d.lo < 0, "an all-negative column has a negative axis", `lo=${d.lo}`);
  ok(d.hi >= 0, "and still reaches zero, so the sign has somewhere to change", `hi=${d.hi}`);
  ok(d.zeroAt === null, "with nothing above zero there is no interior mark to place");
}
{
  const one = distribution([0.42], { title: "t" });
  ok(one !== null && one.lo < one.hi, "a single value does not produce a zero-width axis");
  ok(distribution([], { title: "t" }) === null, "an empty column returns null rather than an empty figure");
  ok(distribution([Number.NaN, Number.POSITIVE_INFINITY], { title: "t" }) === null, "a column of non-finite values returns null");
}
{
  /* THE UNSIGNED CASE, used for magnitudes, must not invent a negative half. */
  const d = distribution([1, 2, 3, 4, 5, 6, 7, 8], { title: "t", signed: false });
  ok(d.lo === 0, "an unsigned axis starts at zero", `lo=${d.lo}`);
  ok(d.zeroAt === null, "and has no interior zero mark to place");
}
{
  /* THE BUCKET COUNT COMES FROM THE SAMPLE. Fifty values across twenty-one buckets filled six of
     them — a picket fence. Small samples must get few buckets and large ones more. */
  const few = distribution([1, 2, 3, 4, 5], { title: "t", signed: false });
  const many = distribution(Array.from({ length: 400 }, (_, i) => i % 97), { title: "t", signed: false });
  ok(barsIn(few.svg) <= 5, "five values do not get twenty-one buckets", `${barsIn(few.svg)} bars`);
  ok(barsIn(many.svg) > barsIn(few.svg), "four hundred values get more than five do", `${barsIn(many.svg)} bars`);
}
{
  /* COLOUR IS THE SITE'S, NOT THE FIGURE'S. A price figure must never reach for the funding pair;
     that exact substitution shipped on the home page and is the reason `tone` exists. */
  const price = distribution([-0.1, 0.1, 0.05, -0.02, 0.2, -0.3], { title: "t", tone: "price" });
  const funding = distribution([-0.1, 0.1, 0.05, -0.02, 0.2, -0.3], { title: "t" });
  ok(!price.svg.includes("--pays-"), "a price distribution uses no funding colour");
  ok(funding.svg.includes("--pays-"), "a funding distribution does");
}


/* ---------------------------------------------------------- the diverging bar */
console.log("\ndiverging bars — the side a bar falls on and the colour it is drawn in\n");
{
  /* THE INVARIANT, ASSERTED ACROSS THE DOMAIN rather than on the ten rows that happen to be on
     the page today. /funding shipped a chart whose hue said "below the venue's base rate" while
     the legend directly above it said "shorts pay longs", so a contract at +6.71% — longs paying,
     amber in every table cell on the same page — was drawn cyan. A person looking at the rendered
     page found that; no instrument did. This is the instrument: amber if and only if the bar lies
     to the right of the zero mark, over every axis shape the page can build. */
  let checked = 0, disagreements = 0, offTrack = 0;
  for (const [lo, hi] of [[-50, 11], [-1, 1], [0, 20], [-20, 0], [-100, 100], [-0.5, 60]]) {
    const span = hi - lo;
    const at = (v) => ((v - lo) / span) * 100;
    const zeroAt = at(0);
    for (let step = 0; step <= 60; step++) {
      const v = lo + (span * step) / 60;
      const bar = signedBar(v, at(v), zeroAt);
      checked++;
      if ((bar.cls === "bars__fill--l") !== (bar.left >= zeroAt - 1e-9)) disagreements++;
      if (bar.left < -1e-9 || bar.left + bar.width > 100 + MIN_BAR + 1e-9) offTrack++;
    }
  }
  ok(disagreements === 0, "across every axis shape, a bar is amber exactly when it lies right of zero",
     `${checked} positions checked`);
  ok(offTrack === 0, "and no bar is drawn off the end of its own track");

  /* A rate of exactly zero: nobody is paying, and paysClass() files >= 0 in the long-pays class.
     The figure and the table row beneath it must agree about the one value where the convention
     is arbitrary, or the page contradicts itself on it. */
  const z = signedBar(0, 50, 50);
  ok(z.cls === "bars__fill--l", "a rate of exactly zero takes the same class as paysClass(0)");
  ok(z.width >= MIN_BAR, "and is still drawn as a mark rather than vanishing into the rule", `width=${z.width}`);

  /* A near-zero rate must read as a presence. Its NUMBER says how small; a bar of zero width says
     the row has no reading at all, which is a different claim and a false one. */
  const tiny = signedBar(-0.0001, 49.9999, 50);
  ok(tiny.width >= MIN_BAR, "a near-zero rate keeps a visible mark", `width=${tiny.width}`);
  ok(tiny.cls === "bars__fill--s", "on the side its sign puts it");

  /* THE OLD BEHAVIOUR, NAMED. Colouring by distance from a non-zero reference is what shipped.
     These two rates sit on the same side of ZERO and opposite sides of a 10.95% BASE RATE, and
     they must now come back the same colour — under the old rule they did not. */
  const ax = (v) => ((v + 0.5) / 1.0) * 100;
  const below = signedBar(0.0671, ax(0.0671), ax(0));
  const above = signedBar(0.15, ax(0.15), ax(0));
  ok(below.cls === above.cls, "two positive rates either side of the base rate share one hue",
     `${below.cls} / ${above.cls}`);
}

console.log(bad ? `\n${bad} failure(s)\n` : "\nevery figure scale holds on the shapes that broke it\n");
process.exit(bad ? 1 : 0);
