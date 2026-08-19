#!/usr/bin/env node
/**
 * THE CADENCE CLAIM, AND THE CASES WHERE IT MUST STOP BEING MADE.
 *
 * The whole value of freshness() is in the boundary: too eager and it cries stale on ordinary
 * cron jitter, which trains a reader to ignore it; too lax and it keeps promising a cadence that
 * stopped hours ago. So the boundary is asserted from both sides, one minute either way, rather
 * than at a comfortable distance from it.
 *
 *   node --experimental-strip-types scripts/freshness-cases.mjs
 */
import { freshness, readableAge, ageWords, LIVE_STALE_MIN, SNAP_STALE_MIN } from "../src/lib/freshness.ts";
import { readFileSync } from "node:fs";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const agoMin = (m) => NOW - m * 60_000;
const CLAIM = "The mark and the funding update every minute.";
const SUBJ = "The mark and the funding";

let bad = 0;
const check = (name, got, want) => {
  const ok = typeof want === "boolean" ? got === want : want.test(String(got));
  if (!ok) { bad++; console.log(`  FAIL   ${name}`); console.log(`         got: ${JSON.stringify(got).slice(0, 130)}`); }
  else console.log(`  ok     ${name}`);
};

console.log("\n  the live clock, at the boundary");
for (const m of [0, 1, LIVE_STALE_MIN - 1, LIVE_STALE_MIN]) {
  const f = freshness(agoMin(m), agoMin(2), CLAIM, SUBJ, NOW);
  check(`${m} min old -> claims the cadence`, f.stale, false);
  check(`${m} min old -> prints the claim verbatim`, f.note, new RegExp("^" + CLAIM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
}
for (const m of [LIVE_STALE_MIN + 1, 30, 60 * 26]) {
  const f = freshness(agoMin(m), agoMin(2), CLAIM, SUBJ, NOW);
  check(`${m} min old -> stops claiming`, f.stale, true);
  check(`${m} min old -> says what is actually happening`, f.note, /have not refreshed on schedule/);
  /* THE RESERVED PHRASE. "Not updating" belongs to interact.js and to the reader's connection
     state; this module's first wording used it, and checks.mjs contradictoryStates failed the
     gate because a text extractor would then read an age and a death notice in one document —
     the exact defect that had two agents report this site dead. Asserted here so the wording
     cannot drift back into it. */
  check(`${m} min old -> never uses the reserved connection-state phrase`, /not updating/i.test(f.note), false);
  check(`${m} min old -> never repeats the promise`, f.note.includes("update every minute"), false);
}

console.log("\n  a page with no live clock falls back to the snapshot's slower limit");
{
  const justInside = freshness(0, agoMin(SNAP_STALE_MIN), CLAIM, SUBJ, NOW);
  check(`${SNAP_STALE_MIN} min snapshot, no live -> still claims`, justInside.stale, false);
  const justOutside = freshness(undefined, agoMin(SNAP_STALE_MIN + 1), CLAIM, SUBJ, NOW);
  check(`${SNAP_STALE_MIN + 1} min snapshot, no live -> stale`, justOutside.stale, true);
  check("the slower limit is quoted, not the fast one", justOutside.note, /every five minutes/);
  /* THE CASE THAT LOOKS HEALTHY AND IS NOT: snapshot current, minute tick dead. The 24-hour
     figures keep arriving so the page looks alive while the price is frozen. */
  const split = freshness(agoMin(90), agoMin(1), CLAIM, SUBJ, NOW);
  check("snapshot fresh but live tick dead -> stale", split.stale, true);
  check("  ...and judged against the FAST limit", split.note, /every minute/);
}

console.log("\n  a clock that is wrong rather than late");
{
  const future = freshness(NOW + 10 * 60_000, agoMin(2), CLAIM, SUBJ, NOW);
  check("a stamp 10 min in the future -> stale", future.stale, true);
  check("  ...and says a clock is wrong, not that data is old", future.note, /timestamp in the future/);
  const jitter = freshness(NOW + 20_000, agoMin(2), CLAIM, SUBJ, NOW);
  check("20s of ordinary skew -> still healthy", jitter.stale, false);
}

console.log("\n  the age ladder never prints arithmetic homework");
check("59 minutes", readableAge(59), /^59 minutes$/);
check("1 minute is singular", readableAge(1), /^1 minute$/);
check("90 minutes reads as hours", readableAge(90), /^2 hours$/);
check("one day reads as hours", readableAge(60 * 24), /^24 hours$/);
check("four days reads as days", readableAge(60 * 24 * 4), /^4 days$/);
check("no bare minute counts above an hour", readableAge(361).includes("minute"), false);

/* ------------------------------------------------------------------------------------------
   THE SERVER'S LADDER AND THE BROWSER'S MUST BE ONE LADDER.

   The pill is rendered by the server and rewritten by interact.js about 300ms later. Those were
   two independent implementations, and a third — three templates printing raw minutes with no
   ladder at all — made it three. At ordinary ages they agree because everything is "4 min ago";
   the split only shows when the data is old, which is precisely the failure mode a single-sourced
   site is most exposed to, and the raw form is the one a crawler reads because it is what the
   server sent. Found by rendering against a stale fixture, not by reading code.

   So the client's ladder is PARSED OUT OF interact.js and run against the server's across the
   whole range. Comparing behaviour rather than trusting that two copies were kept in step is the
   same technique checks.mjs formatterDrift uses for numbers.
   ------------------------------------------------------------------------------------------ */
console.log("\n  the server ladder and the browser ladder are the same ladder");
{
  const js = readFileSync(new URL("../public/interact.js", import.meta.url), "utf8");
  const m = js.match(/const say = \(m\) =>([\s\S]*?);\n/);
  if (!m) { bad++; console.log("  FAIL   could not find say() in public/interact.js — this assertion is reading nothing"); }
  else {
    const say = new Function("m", `return (${m[1].trim()});`);
    const sample = [0, 1, 2, 30, 59, 60, 61, 90, 119, 120, 600, 1439, 1440, 2879, 2880, 4321, 7230, 20000, 100000];
    const drift = sample.filter((n) => say(n) !== ageWords(n));
    if (drift.length) {
      bad++;
      console.log(`  FAIL   ${drift.length} age(s) render differently on the server and in the browser`);
      for (const n of drift.slice(0, 6)) console.log(`         ${n} min: server "${ageWords(n)}" vs browser "${say(n)}"`);
    } else console.log(`  ok     ${sample.length} ages, from 0 to ${sample[sample.length - 1]} minutes, render identically`);
    /* AND THE COMPARISON ITSELF MUST BE ABLE TO FAIL. A drift detector that reports "identical"
       because it compared nothing is the failure it exists to catch, wearing a green tick. Run it
       against a ladder that IS wrong — the raw-minutes form the templates actually shipped — and
       require it to notice. */
    const rawLadder = (n) => `${n} min ago`;
    const wouldCatch = sample.filter((n) => rawLadder(n) !== ageWords(n));
    check("the drift comparison notices a ladder that is wrong", wouldCatch.length > 0, true);
    check("  ...and it is the raw-minutes form that it notices", wouldCatch.includes(7230), true);
    /* The defect verbatim: the raw form three templates used before the ladder was applied. */
    check("7230 minutes is never printed as raw minutes", ageWords(7230), /^5 d ago$/);
    check("  ...which is what the templates used to send a crawler", `${7230} min ago`, /^7230 min ago$/);
  }
}

console.log(bad ? `\n  ${bad} FAILURE(S)\n` : `\n  the cadence claim holds inside the boundary and stops outside it, on every case\n`);
process.exit(bad ? 1 : 0);
