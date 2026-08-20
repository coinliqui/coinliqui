/* =========================================================================================
   IS THE CADENCE THIS PAGE CLAIMS THE CADENCE IT IS ACTUALLY GETTING?

   THE DEFECT. Three page families printed a flat sentence — "The mark and the funding update
   every minute", "Funding updates every minute", "Mark price and funding update every minute" —
   server-rendered, unconditional, next to a timestamp. The timestamp was honest and the sentence
   was a promise about the future, and nothing checked whether the promise was being kept. If the
   one-minute cron stops, those pages say "update every minute" beside a figure that last moved
   four hours ago, and they say it in the extracted text an AI crawler lifts verbatim.

   This project has already fixed the mirror image of this once. The client-side "Not updating"
   note was moved OUT of the server-rendered HTML because a machine reading the page was told
   both that it had updated four minutes ago and that it was not updating. This is the same
   contradiction pointed the other way: a claim of freshness with nothing behind it.

   WHY IT MATTERS MORE NOW THAN IT DID. Until 19 August 2026 the site had two upstreams. It now
   has one. Every failure mode of Hyperliquid — an outage, a rate limit, a shape change that
   makes the snapshot unparseable, an IP block on Cloudflare egress — arrives at the reader the
   same way: KV keeps the last good value and the pages go quietly stale. There is no second
   source whose disagreement would reveal it. The age is the only signal, so the words around
   the age have to be true.

   WHAT THIS DOES NOT DO. It does not take the site down and it does not hide the numbers. Stale
   figures with an accurate age are honest and useful — a funding rate from an hour ago is still
   a fact about an hour ago. What is not honest is asserting a cadence that is not being met, so
   only the SENTENCE changes.

   IT MAY NOT SAY "NOT UPDATING", AND THAT IS NOT A STYLE RULE. Those two words are reserved for
   one state written by one party: interact.js, in the reader's browser, when the reader's own
   connection to this site has dropped — a thing only the browser can know. They were deliberately
   removed from server-rendered HTML once already, because every text extractor took both halves
   of the freshness pill and the first line of five routes read "Updated 4 min ago Not updating",
   and two independent agents assessing whether the site was live reported that it was not.
   checks.mjs contradictoryStates guards that pair and caught this module's first wording on the
   gate before it shipped. Stale DATA and a dropped CONNECTION are different facts with different
   knowers, so they get different words: this one says "have not refreshed on schedule".

   THE THRESHOLDS ARE GENEROUS ON PURPOSE. A cron that misses one tick has not stopped, and a
   page that cries stale on ordinary jitter trains the reader to ignore it — the same reason the
   client waits for two consecutive failures before saying "Not updating". Measured against the
   real cadences: the minute tick fires every minute and the ingest every five, so four and
   fifteen minutes are roughly four and three missed ticks respectively.
   ========================================================================================= */

/** A one-minute cron is late, not broken, at three misses. */
export const LIVE_STALE_MIN = 4;
/** The five-minute ingest, at three misses. */
export const SNAP_STALE_MIN = 15;

/**
 * THE AGE LADDER, IN ONE PLACE, BECAUSE IT WAS IN THREE AND THEY DISAGREED.
 *
 * Base.astro had `age()` for the freshness pill. public/interact.js has `say()` for the same
 * pill after hydration. And three templates printed their own inline stamp as
 * `Math.round((Date.now() - at) / 60000) + " min ago"`, with no ladder at all.
 *
 * At ordinary ages all three agree, because everything is "4 min ago". The disagreement only
 * appears when the data is old — the server rendered "7230 min ago" and the client rewrote it to
 * "5 d ago" about 300ms later. Which means the drift was invisible in every normal run and
 * arrives exactly in the failure mode this site is now most exposed to: one upstream, and every
 * way it can fail reaching the reader as quietly stale data. Worse, the raw form is the one a
 * crawler reads, because it is what the server sent.
 *
 * Found by rendering a page against a deliberately stale fixture rather than by reading code.
 * scripts/freshness-cases.mjs now parses the ladder out of interact.js and asserts the two
 * implementations agree across the whole range, so this cannot silently split again.
 */
/* ageWords and minutesSince MOVED TO public/shared.js and are re-exported here unchanged.
   They existed in three places — Base.astro, interact.js, and three templates that printed raw
   minutes — and the split only showed when the data was old, which is the failure mode this
   single-sourced site is most exposed to. One file now, imported by all of them. */
export { ageWords, minutesSince } from "../../public/shared.js";

export interface Freshness {
  /** Whole minutes since the fastest clock this page depends on last advanced. */
  ageMin: number;
  stale: boolean;
  /** The sentence to print where the cadence claim used to be. */
  note: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** PROSE form of the same ladder — "5 days", not "5 d ago" — for use mid-sentence. Deliberately
 *  a separate function rather than a second ladder: the thresholds below must match ageWords in
 *  public/shared.js, and scripts/freshness-cases.mjs asserts they agree at every boundary. */
export function readableAge(min: number): string {
  if (min < 60) return plural(min, "minute", "minutes");
  if (min < 48 * 60) return plural(Math.round(min / 60), "hour", "hours");
  return plural(Math.round(min / 1440), "day", "days");
}

/**
 * @param liveAt   epoch ms of the one-minute tick, or 0/undefined if the page has none
 * @param snapAt   epoch ms of the five-minute snapshot
 * @param claim    the sentence to print when everything is on cadence
 * @param subject  what is not updating, for the stale sentence ("The mark and the funding")
 */
export function freshness(
  liveAt: number | undefined,
  snapAt: number,
  claim: string,
  subject: string,
  now = Date.now(),
): Freshness {
  /* THE FASTEST CLOCK IS THE ONE THE CLAIM IS ABOUT. A page whose snapshot is current but whose
     minute tick died is exactly the case worth catching — the 24-hour figures keep arriving and
     the price stops, which looks like a working page. */
  const fastest = liveAt && liveAt > 0 ? liveAt : snapAt;
  const limit = liveAt && liveAt > 0 ? LIVE_STALE_MIN : SNAP_STALE_MIN;
  const ageMin = Math.max(0, Math.round((now - fastest) / 60_000));
  /* A future stamp is a broken clock somewhere, not freshness, and must not read as healthy. */
  const skewed = fastest - now > 60_000;
  const stale = skewed || ageMin > limit;
  return {
    ageMin,
    stale,
    note: !stale
      ? claim
      : skewed
        ? `${subject} carry a timestamp in the future, which means a clock is wrong somewhere upstream — read every figure here with that in mind.`
        : `${subject} have not refreshed on schedule — they are due every ${limit === LIVE_STALE_MIN ? "minute" : "five minutes"}, and the newest figure on this page is ${readableAge(ageMin)} old. The numbers below are real and were true when they were written.`,
  };
}
