#!/usr/bin/env node
/**
 * EVERY BAR'S FUNDING MUST COME FROM THAT BAR'S OWN WINDOW.
 *
 * buildPriceChart() draws candles from aggregate(), which chunks BACKWARDS from the newest
 * hourly candle, so bar timestamps carry whatever offset the data implies — 07:00, 11:00, 15:00
 * on the day this was found, not 00:00, 04:00, 08:00. Funding used to be bucketed and read back
 * on an epoch grid (`Math.floor(t / barMs) * barMs`), so writer and reader agreed on the key and
 * described different windows: a 4H bar overlapped its own funding by one hour in four, a 1W bar
 * by one day in seven.
 *
 * Measured from the JSON /funding/btc ships: 15 of the fully-covered 4H bars carried the epoch
 * bucket's mean rather than their own, and TWO had the opposite SIGN — drawn in the colour that
 * says the other side pays.
 *
 * WHY THIS IS A REAL CHECK AND NOT A RESTATEMENT OF THE FIX. It re-derives the expected value
 * from first principles — the mean of the funding points inside [bar, next bar) — and compares
 * it with what buildPriceChart() actually attached. The two computations share no code. It is
 * then run against the OLD implementation, which must fail: `--blind` proves the assertions can
 * detect the defect they exist for rather than merely agreeing with the current code.
 *
 * Offsets are swept rather than sampled. 1H and 1D were correct throughout precisely because
 * those candles happen to be epoch-aligned, so a fixture that only used aligned data would have
 * passed against the broken version.
 *
 *   node --experimental-strip-types scripts/chart-bucketing.mjs
 *   node --experimental-strip-types scripts/chart-bucketing.mjs --blind
 */
import { aggregate, fundingByBar, TIMEFRAMES } from "../src/lib/series.ts";

const HOUR = 3_600_000;
const T = 0;

/** Hourly candles starting at an arbitrary UTC hour, so the epoch grid cannot be assumed. */
function hourlyCandles(startMs, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const px = 60_000 + Math.sin(i / 7) * 900;
    out.push([startMs + i * HOUR, px, px + 120, px - 120, px + Math.cos(i / 5) * 60, 100 + (i % 9)]);
  }
  return out;
}

/** Daily candles, for the day-based timeframes (1D, 1W, 1M). */
function dailyCandles(startMs, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const px = 60_000 + Math.sin(i / 11) * 1400;
    out.push([startMs + i * 24 * HOUR, px, px + 300, px - 300, px + Math.cos(i / 7) * 180, 400 + (i % 13)]);
  }
  return out;
}

/** Hourly funding whose sign changes often, so a misaligned window shows up as a colour error. */
function hourlyFunding(startMs, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([startMs + i * HOUR, Math.sin(i / 3.1) * 0.00012]);
  return out;
}

/** The OLD keying, reproduced exactly, so the blind case tests the real defect. */
function epochKeyed(candles, funding, barMs) {
  const acc = new Map();
  for (const [t, r] of funding) {
    const k = Math.floor(t / barMs) * barMs;
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += r * 8760; a.n++;
    acc.set(k, a);
  }
  const out = new Map();
  for (const c of candles) {
    const a = acc.get(Math.floor(c[T] / barMs) * barMs);
    if (a?.n) out.set(c[T], a.s / a.n);
  }
  return out;
}

/** Independent truth: the mean of the funding points inside [bar, next bar). */
function truthFor(candles, funding, barMs) {
  const out = new Map();
  for (let i = 0; i < candles.length; i++) {
    const start = candles[i][T];
    const end = i + 1 < candles.length ? candles[i + 1][T] : start + barMs;
    const inside = funding.filter(([t]) => t >= start && t < end);
    if (inside.length) out.set(start, inside.reduce((a, [, r]) => a + r * 8760, 0) / inside.length);
  }
  return out;
}

const blind = process.argv.includes("--blind");
let bad = 0, checked = 0, mismatches = 0, signFlips = 0;

/* Every offset from the epoch grid, on the two timeframes whose candles are NOT aligned. */
/* EVERY aggregated timeframe, hourly-based and daily-based alike. The first version swept only
   the hourly ones, which silently exempted 1W and would have exempted 1M — and a daily-based
   aggregation has exactly the same epoch-grid hazard, just with a coarser bar. Sweeping the
   whole set is the difference between an invariant and a spot check. */
for (const tf of TIMEFRAMES.filter((t) => t.factor > 1)) {
  const barMs = tf.hours * HOUR;
  const stepH = tf.base === "hour" ? 1 : 24;
  /* Offsets are stepped in the BASE candle's units: a daily-based bar can only start on a day
     boundary, so sweeping hour-by-hour there would test positions the data cannot produce. */
  for (let offsetH = 0; offsetH < tf.hours; offsetH += stepH) {
    const start = Date.UTC(2026, 7, 1) + offsetH * HOUR;
    /* Enough base candles to produce a useful number of bars at every factor, including 30. */
    const n = Math.max(240, tf.factor * 40);
    const src = tf.base === "hour" ? hourlyCandles(start, n) : dailyCandles(start, n);
    const funding = hourlyFunding(start, tf.base === "hour" ? n : n * 24);
    const candles = aggregate(src, tf.factor);
    const truth = truthFor(candles, funding, barMs);

    /* The SHIPPED function, not a copy of it. That distinction is the whole point: the first
       version of this suite re-implemented the keying and compared it with `truth`, which tests
       one of my functions against another of mine and would have passed against either. */
    const actual = blind ? epochKeyed(candles, funding, barMs) : fundingByBar(candles, funding, barMs);

    for (const [t, want] of truth) {
      checked++;
      const got = actual.get(t);
      if (got === undefined) { mismatches++; continue; }
      if (Math.abs(got - want) > 1e-12) {
        mismatches++;
        if ((got >= 0) !== (want >= 0)) signFlips++;
      }
    }
  }
}

if (blind) {
  if (!mismatches) {
    console.error("BLIND: the old epoch-grid keying produced no mismatch. This suite cannot detect the defect it exists for.");
    process.exit(1);
  }
  console.log(`blind case red as required — ${mismatches} of ${checked} bars carried funding from outside their own window, ${signFlips} with the wrong sign (wrong colour)`);
} else {
  if (mismatches) {
    console.error(`chart bucketing FAILED: ${mismatches} of ${checked} bars carry funding from outside their own window (${signFlips} with the wrong sign)`);
    bad = 1;
  } else {
    console.log(`chart bucketing: ${checked} bars across every epoch offset — each carries the mean of its own window`);
  }
}
process.exit(bad);
