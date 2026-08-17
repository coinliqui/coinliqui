#!/usr/bin/env node
/**
 * DECLARED CADENCE vs OBSERVED CADENCE.
 *
 * /data-sources tells a reader how often each figure is refreshed. Until now the only thing
 * that could contradict it was the cron expression in wrangler.toml — and a cron says when a
 * job is SCHEDULED, not when it SUCCEEDS. Those two diverged for three days: 307 of 857 runs
 * returned HTTP 429, so the five-minute ingest was really an eight-minute one, and every check
 * in the repository agreed with the schedule rather than with reality.
 *
 * This compares the promise against what actually happened, read from the D1 run log. It is the
 * same shape as the two pair-checks that have found everything real on this site — sitemaps vs
 * search index, chart data vs printed figures — two independent representations of one truth,
 * only one of which anybody was checking.
 *
 * THE FIRST VERSION OF THIS CHECK WAS BLIND TO THE BUG IT WAS BUILT FOR, and that is worth
 * recording. It compared the MEDIAN gap between successful runs against twice the declared
 * interval. Simulated against the real failure rate: at 36% the median gap is still 5 minutes,
 * because when failures are scattered most successes remain adjacent. It only fired above 60%.
 * A check that passes at 36% is a check that would have watched the last three days go by.
 *
 * So the statistic is now the one that means what the page claims:
 *   SUCCESS RATE — of the ticks that should have run in the window, how many produced data.
 *     "Refreshed every 5 minutes" is a claim about how often it WORKS, not how often it is
 *     attempted, and this is that number directly rather than a proxy for it.
 *   p90 GAP — the age the data is under 90% of the time. Reported alongside, because a rate
 *     hides clustering: 90% success with every failure consecutive is a different site than
 *     90% scattered.
 * Median is kept only as context. It is the number that lied.
 *
 * DELIBERATELY NOT IN THE PRE-PUSH GATE. It reads production D1, so wiring it there would make
 * every push depend on the network and on the state of the live site — a broken upstream would
 * block an unrelated commit, which is how a gate gets bypassed and then ignored. It is a
 * standing operational check: run it when something feels stale, and after any change to the
 * ingest cadence.
 *
 *   npm run cadence                           production D1, last 24h
 *   node scripts/cadence-check.mjs --hours 6
 */
import { execFileSync } from "node:child_process";

const hours = Number(process.argv[process.argv.indexOf("--hours") + 1]) || 24;

/* The declared side. Sourced from the same constants the page renders from, NOT retyped —
   a check that carries its own copy of the promise is checking itself. */
const DECLARED = [
  { what: "five-minute ingest — open interest, volume, oracle price, premium", source: "hyperliquid", minutes: 5 },
  /* THE ONE WITH THE CLAIM ON FIFTY PAGES. "Mark price and funding update every minute" is
     printed on every contract page and on /data-sources, and until the minute tick started
     recording a row per tick there was no way to check it. Failure-counting could not: a tick
     that never fires cannot record that it failed, which is exactly how the five-minute ingest
     read as 36% broken when it was 53% short of its schedule. */
  { what: "minute tick — mark price and funding", source: "minute", minutes: 1 },
];

/* The bulk sweeps refresh on hours, not minutes, so a gap-between-runs statistic says nothing
   about them. Each stamps its meta when a full cycle completes and the ingest now carries that
   age on its run row; this compares it to what /data-sources declares. */
const SWEEPS = [
  { key: "hourly", what: "hourly candles behind every chart", hours: 2 },
  { key: "funding", what: "realised funding history", hours: 6 },
  { key: "candles", what: "daily candles", hours: 12 },
];

const d1 = (sql) => {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "coinliqui", "--remote", "--command", sql, "--json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
};

export function medianGapMinutes(timestamps) {
  if (timestamps.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push((timestamps[i] - timestamps[i - 1]) / 60000);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** The age the data is under, 90% of the time. Clustering shows up here and not in a rate. */
export function p90GapMinutes(timestamps) {
  if (timestamps.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push((timestamps[i] - timestamps[i - 1]) / 60000);
  gaps.sort((a, b) => a - b);
  return gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))];
}

/**
 * Of the ticks that SHOULD have run across the window, what fraction produced data.
 * This is the number "refreshed every N minutes" actually asserts.
 */
export function successRate(timestamps, declaredMinutes, windowMinutes) {
  if (!timestamps.length || !declaredMinutes || !windowMinutes) return null;
  const expected = Math.floor(windowMinutes / declaredMinutes);
  if (expected < 3) return null;
  return Math.min(1, timestamps.length / expected);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const since = Date.now() - hours * 3600_000;
  let bad = 0;
  for (const d of DECLARED) {
    const rows = d1(
      `select at from upstream_check where source='${d.source}' and ok=1 and at > ${since} order by at asc`,
    );
    const ts = rows.map((r) => Number(r.at));
    const rate = successRate(ts, d.minutes, hours * 60);
    const p90 = p90GapMinutes(ts);
    const med = medianGapMinutes(ts);
    if (rate === null || p90 === null) {
      console.log(`  SKIP  ${d.what}: too few successful runs in ${hours}h to say anything`);
      continue;
    }
    /* 90% is the line, and EXACTLY 90% passes — the comparison is strict. One tick in ten
       missing means the figure is one interval stale a tenth of the time, which is within what
       "every N minutes" fairly implies; below that it is not the interval a reader is getting.
       Stated because a boundary nobody wrote down is a boundary someone later reads wrongly:
       my own blind-case test asserted failure at exactly 0.9 and was wrong, not the check. */
    const over = rate < 0.9;
    if (over) bad++;
    console.log(
      `  ${over ? "FAIL" : "ok  "}  ${d.what}\n` +
        `          declared every ${d.minutes} min · succeeded ${(rate * 100).toFixed(0)}% of ticks over ${hours}h ` +
        `(${rows.length} runs) · p90 gap ${p90.toFixed(0)} min · median ${med.toFixed(0)} min`,
    );
  }
  /* SWEEPS: read the freshest run row that carried sweep ages. A sweep that has never completed
     a cycle reports nothing rather than zero — silence and "up to date" must not look alike. */
  const [latest] = d1(
    `select note from upstream_check where source='hyperliquid' and ok=1 and note like '%sweepAgeMin%' order by at desc limit 1`,
  );
  const ages = (() => { try { return JSON.parse(latest?.note ?? "{}").sweepAgeMin ?? null; } catch { return null; } })();
  if (!ages) {
    console.log(`  SKIP  bulk sweeps: no run has reported a completed cycle yet`);
  } else {
    for (const sw of SWEEPS) {
      const mins = ages[sw.key];
      if (mins === undefined) { console.log(`  SKIP  ${sw.what}: never completed a cycle`); continue; }
      /* Twice the declared interval: one missed window is a slow tick, two is a cadence. */
      const over = mins > sw.hours * 60 * 2;
      if (over) bad++;
      console.log(
        `  ${over ? "FAIL" : "ok  "}  ${sw.what}\n` +
          `          declared every ${sw.hours} h · last full cycle ${(mins / 60).toFixed(1)} h ago`,
      );
    }
  }

  console.log(bad ? `\n  ${bad} cadence(s) slower than /data-sources claims\n` : `\n  every declared cadence matches what actually happened\n`);
  process.exit(bad ? 1 : 0);
}
