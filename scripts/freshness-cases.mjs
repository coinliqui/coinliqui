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
  /* AND THE SENTENCE MUST DESCRIBE THE SAME THING THE VERDICT DID. The clock being judged is
     the LAGGING one — that is the design — and the note called its age "the newest figure on
     this page". On this very case that read "the newest figure on this page is 1 h 30 min old"
     while the 24-hour change, the open interest and the venue table beside it were one minute
     old. Right verdict, false sentence, and the sentence is the part a reader acts on. */
  check("  ...and does not call the OLD clock the newest figure", split.note, /newest of them is 2 hours old/);
  check("  ...and says the rest of the page is current", split.note, /five-minute snapshot, which is 1 minute old/);
  /* The reverse case must not acquire a second sentence it has no business making: when the
     snapshot is the older of the two there is nothing reassuring to add. */
  const bothOld = freshness(agoMin(90), agoMin(120), CLAIM, SUBJ, NOW);
  check("both clocks late -> no reassurance about the snapshot", bothOld.note, /^(?!.*five-minute snapshot, which)/s);
  /* And with one clock only, there is no other clock to describe. */
  const snapOnly = freshness(undefined, agoMin(40), CLAIM, SUBJ, NOW);
  check("snapshot-only page mentions no second clock", snapOnly.note, /^(?!.*five-minute snapshot, which)/s);
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
console.log("\n  there is no second ladder to compare against, and that is the assertion");
{
  /* THIS BLOCK USED TO PARSE say() OUT OF interact.js AND SWEEP A RANGE THROUGH BOTH LADDERS.
     It failed the gate the moment the ladders were merged — "could not find say() in
     public/interact.js — this assertion is reading nothing" — which is exactly the message it
     was written to produce, arriving for the happy reason rather than the sad one.

     A comparison is the right tool while two implementations exist and the wrong tool once they
     do not: it can only report that two things agree, and the stronger property is that there is
     only one thing. So this now asserts the singularity directly — interact.js must import the
     ladder rather than define one — and checks.mjs duplicateRuleImplementations enforces the
     same rule across the whole repository for every shared function. */
  const js = readFileSync(new URL("../public/interact.js", import.meta.url), "utf8");
  check("interact.js imports the shared source", /from\s*["']\.\/shared\.js|import\(\s*["']\.\/shared\.js/.test(js), true);
  check("interact.js pulls ageWords out of it", /\bageWords\b/.test(js), true);
  check("interact.js defines no ladder of its own", /const\s+say\s*=\s*\(m\)\s*=>/.test(js), false);
  check("  ...and no bare minute rung either", /`\$\{m\} min ago`/.test(js), false);
  /* The ladder's own boundaries, from the one implementation. */
  check("59 -> minutes", ageWords(59), /^59 min ago$/);
  check("60 -> hours", ageWords(60), /^1 h ago$/);
  check("2879 -> hours", ageWords(2879), /^48 h ago$/);
  check("2880 -> days", ageWords(2880), /^2 d ago$/);
  check("7230 -> days, never raw minutes", ageWords(7230), /^5 d ago$/);
}

console.log(bad ? `\n  ${bad} FAILURE(S)\n` : `\n  the cadence claim holds inside the boundary and stops outside it, on every case\n`);
process.exit(bad ? 1 : 0);
