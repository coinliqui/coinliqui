#!/usr/bin/env node
/**
 * WHERE A BAR OPENS, AND WHAT THE AXIS UNDER IT SAYS.
 *
 * Two defects, found together on production on 17 September 2026, both fixed once already on
 * /coins/[coin] and nowhere else, because the fix lived in that template:
 *
 *   BARS THAT MOVED WITH THE RENDER. Aggregated bars were chunked back from the newest base bar,
 *   so where a bar opened depended on the minute the page was rendered. /funding/btc?tf=30m had
 *   all 300 bars opening at :15 or :45, ?tf=12h all 90 at 08:00 and 20:00, and the first 1W bar
 *   was three days wide. /liquidations/sweep marked its wick "5 Feb, 23:00".
 *
 *   AN AXIS WITH NO DATE. Hour ticks were labelled with the hour alone and thinned by index:
 *   /funding/btc?tf=30m read "00:00" six times, ?tf=15m "12:00, 00:00, 12:00 …".
 *
 * The expected bars are recomputed here from the base series by window, sharing no code with
 * slotBars(). Every label is read back against the bar it sits on. Store lengths and starting
 * minutes are swept, because a fixture that happens to begin on the hour passes the old code.
 *
 *   node --experimental-strip-types scripts/time-axis-cases.mjs
 *   node --experimental-strip-types scripts/time-axis-cases.mjs --blind
 *
 * --blind runs the same assertions against the old chunking and the old ticks, and must fail.
 */
import { TIMEFRAMES, BASE_MIN, drawnBars } from "../src/lib/series.ts";
import { timeTicks, xTick, CH } from "../src/lib/chart.ts";

const blind = process.argv.includes("--blind");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) return true;
  bad++;
  console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`);
  return false;
};

/* ---------------------------------------------------------------- the old code, for --blind */
const oldBars = (base, tf) => {
  const out = [];
  for (let end = base.length; end > 0; end -= tf.factor) {
    const s = base.slice(Math.max(0, end - tf.factor), end);
    out.unshift([s[0][0], s[0][1], Math.max(...s.map((c) => c[2])), Math.min(...s.map((c) => c[3])), s[s.length - 1][4], s.reduce((a, c) => a + c[5], 0)]);
  }
  return out.slice(-tf.bars);
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const OLD_UNITS = [
  { label: (d) => String(d.getUTCFullYear()), bucket: (d) => `${d.getUTCFullYear()}` },
  { label: (d) => `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`, bucket: (d) => `${d.getUTCFullYear()}-${Math.floor(d.getUTCMonth() / 3)}` },
  { label: (d) => `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`, bucket: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}` },
  { label: (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`, bucket: (d) => `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY + 4) / 7)}` },
  { label: (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`, bucket: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` },
  { label: (d) => `${pad(d.getUTCHours())}:00`, bucket: (d) => `${d.getUTCDate()}-${Math.floor(d.getUTCHours() / 6)}` },
  { label: (d) => `${pad(d.getUTCHours())}:00`, bucket: (d) => `${d.getUTCDate()}-${d.getUTCHours()}` },
];
function oldTicks(times, want = 8) {
  if (times.length < 2) return [];
  let chosen = OLD_UNITS[OLD_UNITS.length - 1], picks = [];
  for (const u of OLD_UNITS) {
    const idx = []; let prev = "";
    for (let i = 0; i < times.length; i++) { const b = u.bucket(new Date(times[i])); if (b !== prev) { idx.push(i); prev = b; } }
    if (idx.length >= 3) { chosen = u; picks = idx; }
    if (idx.length >= want) break;
  }
  if (picks.length > want) { const step = Math.ceil(picks.length / want); picks = picks.filter((_, k) => k % step === 0); }
  return picks.filter((i) => i > 0).map((i) => ({ i, label: chosen.label(new Date(times[i])) }));
}
const bars = blind ? oldBars : drawnBars;
const ticks = blind ? oldTicks : timeTicks;

/* ---------------------------------------------------------------- fixtures */
/** A complete base series of `n` bars, `stepMin` apart, whose newest bar opens at `lastOpen`. */
function base(stepMin, n, lastOpen) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const t = lastOpen - k * stepMin * MIN, j = Math.floor(t / (stepMin * MIN));
    const px = 100 + Math.sin(j / 7) * 9;
    out.push([t, px, px + 1 + (j % 5), px - 1 - (j % 3), px + Math.cos(j / 3), 10 + (j % 11)]);
  }
  return out;
}

/** The bar a window should hold, from base bars by timestamp alone. */
function expected(src, from, to) {
  const s = src.filter((c) => c[0] >= from && c[0] < to);
  if (!s.length) return null;
  return [from, s[0][1], Math.max(...s.map((c) => c[2])), Math.min(...s.map((c) => c[3])), s[s.length - 1][4], s.reduce((a, c) => a + c[5], 0)];
}

/* Render moments: on the slot, one base bar in, and the last base bar of a slot. */
const NOW = Date.UTC(2026, 8, 17, 0, 0);
const ENDS = [0, 15, 45, 60, 105, 180, 225, 420, 690, 705].map((m) => NOW + m * MIN);

/* ---------------------------------------------------------------- bars */
console.log(`\nwhere each bar opens${blind ? "  [BLIND: chunked back from the newest bar]" : ""}\n`);
let barCases = 0;
for (const tf of TIMEFRAMES.filter((t) => t.factor > 1)) {
  const stepMin = BASE_MIN[tf.base], slot = stepMin * tf.factor * MIN;
  const onClock = DAY % slot === 0;
  for (const end of tf.base === "day" ? [NOW, NOW - DAY, NOW - 3 * DAY] : ENDS) {
    const lastOpen = Math.floor(end / (stepMin * MIN)) * stepMin * MIN;
    for (const n of [tf.factor * tf.bars + 1, tf.factor * 20 + 3, tf.factor * 9 + tf.factor - 1]) {
      const src = base(stepMin, n, lastOpen);
      const got = bars(src, tf);
      barCases++;
      const at = `${tf.key} newest base ${new Date(lastOpen).toISOString().slice(0, 16)} n=${n}`;
      if (onClock) {
        const off = got.filter((b) => b[0] % slot !== 0);
        ok(!off.length, `${at}: every bar opens on its slot`, off.length ? `${off.length} of ${got.length}, first at ${new Date(off[0][0]).toISOString().slice(11, 16)}` : "");
        const wrong = got.filter((b) => JSON.stringify(expected(src, b[0], b[0] + slot)) !== JSON.stringify(b));
        ok(!wrong.length, `${at}: every bar holds exactly the base bars inside its slot`, wrong.length ? `${wrong.length} bars` : "");
        /* The oldest bar is a whole slot: the store began inside it only if its first base bar is late. */
        const first = got[0];
        ok(!first || src.filter((c) => c[0] >= first[0] && c[0] < first[0] + slot).length === tf.factor,
          `${at}: the oldest bar is a whole slot, not a stub`);
      } else {
        const gaps = got.slice(1).map((b, i) => b[0] - got[i][0]);
        ok(gaps.every((g) => g === slot), `${at}: every bar is exactly ${tf.factor} days wide`,
          gaps.some((g) => g !== slot) ? `gap of ${gaps.find((g) => g !== slot) / DAY} days` : "");
      }
      ok(got.length <= tf.bars, `${at}: no more than ${tf.bars} bars`);
    }
  }
}

/* ---------------------------------------------------------------- axis */
console.log(`\nwhat each tick says${blind ? "  [BLIND: bare hours, thinned by index]" : ""}\n`);
const LABEL = /^(?:(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?(?: ?(\d\d):(\d\d))?$|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ’(\d\d)$|^(\d{4})$/;
let axisCases = 0;
for (const tf of TIMEFRAMES) {
  const stepMin = BASE_MIN[tf.base];
  for (const end of tf.base === "day" ? [NOW, NOW - 5 * DAY] : ENDS) {
    const lastOpen = Math.floor(end / (stepMin * MIN)) * stepMin * MIN;
    for (const n of [tf.factor * tf.bars + 1, Math.ceil(tf.factor * tf.bars * 0.4), tf.factor * 8]) {
      const drawn = bars(base(stepMin, n, lastOpen), tf);
      if (drawn.length < 3) continue;
      for (const want of [8, 10]) {
        const times = drawn.map((b) => b[0]);
        const tk = ticks(times, want);
        axisCases++;
        const at = `${tf.key} ${drawn.length} bars to ${new Date(lastOpen).toISOString().slice(5, 16)} want=${want}`;
        ok(tk.length >= 2 && tk.length <= want, `${at}: between 2 and ${want} ticks`, `got ${tk.length}`);
        /* "12:00" may repeat under different dates; a label read with the date carried from its left
           may not — "00:00" six times resolves to one moment six times. */
        let carry = "";
        const moments = tk.map(({ label }) => (/^\d\d:\d\d$/.test(label) ? `${carry} ${label}` : ((carry = label.replace(/ \d\d:\d\d$/, "")), label)));
        ok(new Set(moments).size === moments.length, `${at}: no two ticks name the same moment`, JSON.stringify(tk.map((k) => k.label)));
        /* Every label is true of the bar it sits on. A time with no date is read against the
           nearest date to its left, so an undated axis fails on its first tick. */
        let dated = null;
        for (const { i, label } of tk) {
          const d = new Date(times[i]);
          const m = LABEL.exec(label);
          if (!ok(m, `${at}: "${label}" is a label this suite can read`)) break;
          const [, day, mon, hh, mm, qMon, qYr, yr] = m;
          if (yr) { ok(+yr === d.getUTCFullYear(), `${at}: "${label}" names its bar's year`); continue; }
          if (qMon) { ok(MON.indexOf(qMon) === d.getUTCMonth() && +qYr === d.getUTCFullYear() % 100, `${at}: "${label}" names its bar's month`); continue; }
          if (day) dated = { day: +day, mon: MON.indexOf(mon) };
          const dateOk = dated && dated.day === d.getUTCDate() && dated.mon === d.getUTCMonth();
          if (!ok(dateOk, `${at}: "${label}" sits on a bar of the date it names`,
            dated ? `bar opens ${d.toISOString().slice(5, 16)}` : "no date on the axis before it")) break;
          if (hh) ok(+hh === d.getUTCHours() && +mm === d.getUTCMinutes(), `${at}: "${label}" names its bar's time`, `bar opens ${d.toISOString().slice(11, 16)}`);
          else if (tf.hours < 24) ok(times[i] % DAY === 0, `${at}: "${label}" without a time sits on a bar opening at midnight`, `bar opens ${d.toISOString().slice(11, 16)}`);
        }
      }
    }
  }
}

/* A dated label at the edge is slid inside the viewBox rather than cut off. */
if (!blind) {
  const at = (x) => +/x="([\d.]+)"/.exec(xTick(x, 10, "14 Sep 12:00"))[1];
  const half = (12 * 11 * 0.6) / 2;
  ok(at(3) - half >= 0 && at(CH.w - 3) + half <= CH.w && at(600) === 600, "an edge tick is slid inside the viewBox; a middle one stays on its bar");
}

if (blind) {
  if (!bad) { console.error("\nBLIND: the old chunking and ticks satisfied every assertion. This suite cannot see the defects it exists for."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against the old code`);
  process.exit(0);
}
if (bad) { console.error(`\ntime axis cases FAILED: ${bad}`); process.exit(1); }
console.log(`time axis: ${barCases} bar series open on their slots, ${axisCases} axes name the bars they sit on`);
