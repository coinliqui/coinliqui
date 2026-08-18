/**
 * THE INCREMENTAL DETECTOR MUST AGREE WITH THE SQL ON EVERY BOUNDARY, INCLUDING ZERO.
 *
 * The feed is now maintained by comparing consecutive samples instead of re-deriving 24 hours
 * from D1. That is only safe if the two definitions of "flip" are the same definition, and the
 * place they would quietly differ is the sign boundary: the SQL says
 *   (prev < 0 AND curr >= 0) OR (prev >= 0 AND curr < 0)
 * which puts exactly-zero on the NON-NEGATIVE side of both tests. A detector that treated zero
 * as its own case, or used <= anywhere, would produce a feed that looks entirely plausible and
 * disagrees with the reference on the rows nobody inspects.
 *
 * scripts/flips-parity.mjs checks agreement against production. These cases check the parts
 * production may not exercise for weeks — a rate sitting exactly at zero, a pair appearing or
 * disappearing between passes, an out-of-order sample, the window boundary, and the dedupe that
 * once let one contract appear four times under a column headed "Now (APR)".
 *
 *   node --experimental-strip-types scripts/flip-events-cases.mjs
 */
import { detectFlips, mergeEvents, feedFromEvents, sampleFrom } from "../src/lib/flip-events.ts";

const T = 1_760_000_000_000;
const S = (at, aprs) => ({ at, aprs });
let bad = 0;
const ok = (cond, name, detail = "") => {
  if (!cond) bad++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

/* ---- the sign boundary, which is the whole risk ------------------------------------- */
const one = (prev, curr) => detectFlips(S(T, { "X|V": prev }), S(T + 300_000, { "X|V": curr }));
ok(one(-0.01, 0.01).length === 1, "negative to positive is a flip");
ok(one(0.01, -0.01).length === 1, "positive to negative is a flip");
ok(one(-0.01, 0).length === 1, "negative to EXACTLY ZERO is a flip (zero is non-negative)");
ok(one(0, -0.01).length === 1, "exactly zero to negative is a flip");
ok(one(0, 0.01).length === 0, "zero to positive is NOT a flip — both non-negative");
ok(one(0.01, 0).length === 0, "positive to zero is NOT a flip");
ok(one(0, 0).length === 0, "zero to zero is not a flip");
ok(one(-0.02, -0.01).length === 0, "negative to less negative is not a flip");
ok(one(0.02, 0.01).length === 0, "positive to less positive is not a flip");

/* ---- samples that are absent, unusable, or out of order ------------------------------ */
ok(detectFlips(null, S(T, { "X|V": 1 })).length === 0, "no previous sample yields no flips");
ok(one(NaN, 0.01).length === 0, "a NaN previous value cannot be compared");
ok(one(-0.01, NaN).length === 0, "a NaN current value cannot be compared");
ok(detectFlips(S(T + 1, { "X|V": -1 }), S(T, { "X|V": 1 })).length === 0, "a previous sample newer than the current one is refused");
ok(detectFlips(S(T, { "X|V": -1 }), S(T, { "X|V": 1 })).length === 0, "two samples at the same instant give no gap to report");
ok(detectFlips(S(T, {}), S(T + 300_000, { "NEW|V": 1 })).length === 0, "a pair appearing for the first time is not a flip");
ok(detectFlips(S(T, { "GONE|V": -1 }), S(T + 300_000, {})).length === 0, "a pair that disappeared is not a flip");

/* ---- symbols containing the separator ----------------------------------------------- */
{
  const f = detectFlips(S(T, { "k|PEPE|HlPerp": -1 }), S(T + 300_000, { "k|PEPE|HlPerp": 1 }));
  ok(f.length === 1 && f[0].symbol === "k|PEPE" && f[0].venue === "HlPerp",
    "a symbol containing the separator splits on the LAST one", f[0] ? `${f[0].symbol} / ${f[0].venue}` : "none");
}

/* ---- gapMin reports the sampling interval, not the event ---------------------------- */
{
  const f = detectFlips(S(T, { "X|V": -1 }), S(T + 890 * 60_000, { "X|V": 1 }));
  ok(f[0]?.gapMin === 890, "gapMin is the distance between samples", `${f[0]?.gapMin}`);
}

/* ---- the window ---------------------------------------------------------------------- */
{
  const now = T + 24 * 3600_000;
  const inside = { symbol: "A", venue: "V", prevApr: -1, apr: 1, at: now - 23 * 3600_000, gapMin: 5 };
  const outside = { symbol: "B", venue: "V", prevApr: -1, apr: 1, at: now - 25 * 3600_000, gapMin: 5 };
  const merged = mergeEvents([inside, outside], [], now, 24);
  ok(merged.length === 1 && merged[0].symbol === "A", "events older than the window are dropped");
}

/* ---- dedupe and total, the defect that shipped once ---------------------------------- */
{
  const now = T + 24 * 3600_000;
  const evs = [];
  for (let i = 0; i < 4; i++) evs.push({ symbol: "LTC", venue: "BybitPerp", prevApr: -1, apr: 1, at: now - (4 - i) * 60_000, gapMin: 5 });
  for (let i = 0; i < 30; i++) evs.push({ symbol: `S${i}`, venue: "HlPerp", prevApr: 1, apr: -1, at: now - (100 + i) * 60_000, gapMin: 5 });
  const feed = feedFromEvents(evs, T, now, 24);
  const ltc = feed.rows.filter((r) => r.symbol === "LTC" && r.venue === "BybitPerp");
  ok(ltc.length === 1, "a pair that flipped four times appears ONCE", `${ltc.length} row(s)`);
  ok(ltc[0]?.at === now - 60_000, "and it is the LATEST of the four");
  ok(feed.total === 31, "total counts distinct pairs, not events", `${feed.total}`);
  ok(feed.rows.length === 25, "rows are capped at 25 while total is not", `${feed.rows.length}`);
  let desc = true;
  for (let i = 1; i < feed.rows.length; i++) if (feed.rows[i].at > feed.rows[i - 1].at) desc = false;
  ok(desc, "rows are in descending time order");
}

/* ---- sampleFrom builds the key the detector expects --------------------------------- */
{
  const s = sampleFrom([["BTC", "HlPerp", 0.5, T], ["ETH", "BinPerp", -0.5, T]], T);
  ok(s.aprs["BTC|HlPerp"] === 0.5 && s.aprs["ETH|BinPerp"] === -0.5, "sampleFrom keys by symbol|venue");
}

console.log(bad ? `\n  ${bad} case(s) wrong` : "\n  the incremental detector matches the SQL's definition of a flip, zero included");
process.exit(bad ? 1 : 0);
