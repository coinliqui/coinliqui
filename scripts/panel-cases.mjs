#!/usr/bin/env node
/**
 * A TIMEFRAME SWITCH MAY SHOW THE WRONG CHART FOR A MOMENT. IT MAY NEVER SHOW NO CHART.
 *
 * Reported by a reader as "switching a timeframe sometimes leaves no chart visible", reproduced
 * on the live site, and caused by two things at once:
 *
 *   1. `tf` and `mode` are shared by the whole button group, so a fetch that resolves after a
 *      later click applied the LATER key — for a panel that had not arrived yet.
 *   2. The toggle hid every panel when none matched, so "not arrived yet" rendered as nothing.
 *
 * Measured: blank for 13ms with both fetches fast, 4 SECONDS with 1.5s of latency on the second.
 * The 558-combination sweep could not produce it — it waits for each panel before clicking the
 * next, which is exactly the case that cannot race.
 *
 * (1) is fixed by a sequence number in interact.js. (2) is visiblePanel in public/shared.js, and
 * it is the invariant: whatever else is true, a group with panels shows one of them. These cases
 * are what make that a property rather than a claim, and they run without a browser.
 *
 *   node scripts/panel-cases.mjs
 */
import { visiblePanel } from "../public/shared.js";

let bad = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) { bad++; console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${name}`);
};

console.log("\n  the wanted panel wins when it is there");
t("wanted is loaded", visiblePanel(["1d.candle", "4h.candle"], "4h.candle", "1d.candle"), "4h.candle");
t("wanted is the one already shown", visiblePanel(["1d.candle"], "1d.candle", "1d.candle"), "1d.candle");

console.log("\n  and when it is not, the reader keeps what they had");
/* THE DEFECT, EXACTLY. The 4H response calls apply() with the key already advanced to 1W, and
   the 1W panel has not arrived. Before: every panel hidden. Now: 1D stays up until 1W lands. */
t("wanted has not arrived yet -> keep the current one",
  visiblePanel(["1d.candle", "4h.candle"], "1w.candle", "1d.candle"), "1d.candle");
t("wanted absent and current absent -> fall back to a real panel",
  visiblePanel(["1d.candle"], "1w.candle", "12h.candle"), "1d.candle");
t("wanted absent, nothing currently shown -> still shows something",
  visiblePanel(["1d.candle", "4h.candle"], "1w.candle", null), "1d.candle");

console.log("\n  the only way to get nothing is to have nothing");
t("no panels at all", visiblePanel([], "1d.candle", null), null);

/* OVER THE WHOLE SPACE, because the invariant is the point and a case list is a sample of it. */
const KEYS = ["15m.candle", "1d.candle", "1w.candle", "1m.line"];
let swept = 0, blank = 0;
for (const n of [0, 1, 2, 3, 4]) {
  const keys = KEYS.slice(0, n);
  for (const want of [...KEYS, "nope", "", undefined]) {
    for (const cur of [...KEYS, "gone", null, undefined]) {
      swept++;
      const got = visiblePanel(keys, want, cur);
      if (keys.length && (got === null || !keys.includes(got))) blank++;
      if (!keys.length && got !== null) blank++;
    }
  }
}
if (blank) { bad++; console.log(`\n  FAIL  ${blank} of ${swept} states resolved to no panel, or to one that is not loaded`); }
else console.log(`\n  ok    ${swept} combinations of loaded/wanted/current — a group with panels always shows one of them`);

if (bad) { console.error(`\n  ${bad} case(s) wrong\n`); process.exit(1); }
console.log("\n  a switch can be briefly wrong; it cannot be briefly empty\n");
