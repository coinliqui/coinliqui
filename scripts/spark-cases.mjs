#!/usr/bin/env node
/**
 * THE PER-ROW FUNDING SHAPE, AGAINST THE BOOK THAT WOULD FLATTEN IT.
 *
 * A column of sparklines is a comparison or it is decoration, and what decides which is the axis.
 * Few's rule: pin the minimum and maximum across every row, because under per-row axes a 5% move
 * and a 50% move draw the identical picture and the reader compares shapes that are not
 * comparable. That is the property these cases assert, and the blind run scales each row to its
 * own maximum to prove they can see the difference.
 *
 * THE SHAPE THE SCALE ACTUALLY MEETS is the one every figure on this site has had to survive:
 * thirty-six contracts resting on a venue constant and one printing −60% a year. Pinned to the
 * maximum, forty-nine rows are a flat line through the middle; scaled per row, the flat ones
 * become noise amplified to full height. Both are wrong and they are wrong in opposite
 * directions, which is why the domain is a high percentile and what falls outside it is counted.
 *
 *   node --experimental-strip-types scripts/spark-cases.mjs
 *   node --experimental-strip-types scripts/spark-cases.mjs --blind
 */
import { sparkScale, sparkPoints, SPARK_POINTS, SPARK_STEP_MS, bucketOf } from "../src/lib/sparks.ts";

const blind = process.argv.includes("--blind");

/** THE FAULT, REPRODUCED: every row scaled to its own maximum. */
const perRowPoints = (values, _shared) => {
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? 50 : (i / (n - 1)) * 100,
    y: 50 - (v / max) * 50,
    clipped: false,
  }));
};
const points = blind ? perRowPoints : sparkPoints;

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};

const BASE = 0.0000125 * 8760;
const flat = (v, n = 42) => Array(n).fill(v);
/* The real book: a mass on the venue constant, a handful priced, one extreme. */
const book = [
  ...Array(36).fill(null).map(() => flat(BASE)),
  flat(0.0671), flat(0.019), flat(-0.0103), flat(-0.0157),
  Array.from({ length: 42 }, (_, i) => -0.02 - i * 0.001),
  Array.from({ length: 42 }, (_, i) => (i < 30 ? BASE : -0.60)),
];

console.log(`\nthe shared scale${blind ? "  [BLIND:每 row scaled to its own maximum]".replace("每", "each ") : ""}\n`);
{
  const scale = sparkScale(book);
  ok(scale !== null, "a book with a mass and an outlier still produces a scale");

  /* THE RULE ITSELF. Two rows whose values differ by an order of magnitude must differ in the
     drawing by an order of magnitude. Under a per-row axis they are identical pictures. */
  const small = points(flat(0.01), scale);
  const large = points(flat(0.10), scale);
  const dev = (pts) => Math.abs(pts[0].y - 50);
  ok(dev(large) > dev(small) * 2, "a rate ten times larger draws a mark far further from zero",
     `small=${dev(small).toFixed(1)} large=${dev(large).toFixed(1)}`);

  /* And the mirror: identical values across two rows must draw identically. Per-row scaling
     satisfies this trivially, so it is not the discriminating case — it is here because a shared
     scale that somehow varied by row would be worse than either. */
  const a = points(flat(0.0671), scale), b = points(flat(0.0671), scale);
  ok(a.every((p, i) => Math.abs(p.y - b[i].y) < 1e-9), "two rows holding the same rate draw the same mark");

  /* ZERO IS THE MIDDLE, FOR EVERY ROW, because the hue either side of it is what the column
     means. A row that put its own mean on the centre line would be drawing a different claim. */
  const zero = points(flat(0), scale);
  ok(zero.every((p) => Math.abs(p.y - 50) < 1e-9), "a rate of exactly zero sits on the centre line");
  const neg = points(flat(-0.05), scale), pos = points(flat(0.05), scale);
  ok(neg[0].y > 50 && pos[0].y < 50, "negative draws below the line and positive above",
     `neg y=${neg[0].y.toFixed(1)} pos y=${pos[0].y.toFixed(1)}`);

  /* THE OUTLIER IS COUNTED, NOT ALLOWED TO SET THE SCALE. If −60% set the domain, the 36 rows on
     the base rate would sit 0.09% of the height off centre — a flat line, which is the failure
     this percentile exists to prevent. */
  ok(scale.max < 0.30, "one −60% contract does not set the domain for the whole column", `max=${scale.max}`);
  ok(scale.clipped > 0 && scale.clipped < scale.of * 0.1, "and what falls outside it is counted, not silently flattened",
     `clipped=${scale.clipped} of ${scale.of}`);
  const wild = points(flat(-0.60), scale);
  ok(wild.every((p) => p.clipped), "every point of an off-scale row is marked as clipped");
  ok(wild.every((p) => p.y <= 100.0001 && p.y >= -0.0001), "and is pinned inside the drawing rather than escaping it");

  /* Nothing may throw or escape the box on the shapes a real series takes. */
  ok(sparkScale([]) === null, "no finite value yields no scale rather than a throw");
  ok(sparkScale([[NaN, NaN]]) === null, "and neither does a series of absences");
  ok(points([], scale).length === 0, "an empty series draws nothing");
  ok(points([0.05], scale).length === 1 && points([0.05], scale)[0].x === 50, "a single point sits in the middle of its own width");
  const withGap = points([0.01, NaN, 0.02], scale);
  ok(withGap.every((p) => Number.isFinite(p.y)), "a non-finite reading does not produce a non-finite coordinate");
  const allPts = book.flatMap((s) => points(s, scale));
  ok(allPts.every((p) => p.x >= 0 && p.x <= 100 && p.y >= -0.0001 && p.y <= 100.0001),
     `every point of all ${book.length} rows lands inside the box`, `${allPts.length} points`);
}

/* The bucketing contract the worker and the reader must agree on — not part of the blind
   comparison, because the old code had no such concept. */
console.log("\nbuckets\n");
{
  ok(bucketOf(0) === 0, "the epoch is bucket zero");
  ok(bucketOf(SPARK_STEP_MS - 1) === 0, "a moment inside a bucket belongs to it");
  ok(bucketOf(SPARK_STEP_MS) === 1, "and the next step starts the next one");
  ok(bucketOf(SPARK_STEP_MS * SPARK_POINTS) - bucketOf(0) === SPARK_POINTS, `${SPARK_POINTS} buckets span the retained window`);
  ok(SPARK_STEP_MS * SPARK_POINTS === 7 * 86_400_000, "which is exactly seven days", `${SPARK_STEP_MS * SPARK_POINTS}ms`);
}

if (blind) {
  if (!bad) {
    console.error("\nBLIND: per-row scaling satisfied every assertion. This suite cannot tell a comparison from decoration.");
    process.exit(1);
  }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against per-row scaling`);
  process.exit(0);
}
if (bad) { console.error(`\nspark cases FAILED: ${bad}`); process.exit(1); }
console.log("\nspark cases: one axis across every row, and the outlier counted rather than obeyed");
