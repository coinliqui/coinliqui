#!/usr/bin/env node
/**
 * The bearer comparison guarding /ingest and /report on the ingest Worker.
 *
 * Small enough to look obviously right and it was not: the first version indexed BOTH strings
 * modulo their own length and OR'd the result. `String.prototype.charCodeAt` returns NaN past
 * the end, and `x ^ NaN` evaluates to `x` in JavaScript rather than throwing or poisoning the
 * accumulator — so a shorter guess could clear the differing bits it never reached. The
 * prefix and repeat cases below are that defect, stated as inputs.
 */
import { sameSecret } from "../worker/ingest.ts";

const KEY = "b7f3a1c9e2d84605b7f3a1c9e2d84605";
const cases = [
  ["the key itself", KEY, true],
  ["empty candidate", "", false],
  ["a proper prefix of the key", KEY.slice(0, 16), false],
  ["the key with one byte appended", KEY + "0", false],
  ["the key with one byte changed", "c" + KEY.slice(1), false],
  ["the key repeated twice", KEY + KEY, false],
  ["the same length, entirely different", "0".repeat(KEY.length), false],
  ["one byte longer, differing only in the extra byte", KEY + KEY[0], false],
  ["case flipped", KEY.toUpperCase(), false],
  ["a single space", " ", false],
];

let bad = 0;
for (const [name, got, want] of cases) {
  const r = sameSecret(KEY, got);
  if (r !== want) bad++;
  console.log(`  ${r === want ? "ok  " : "MISS"}  ${name.padEnd(50)} ${r} (want ${want})`);
}
/* An empty EXPECTED secret must never match anything — the handler refuses before calling
   this, and this must not be the layer that disagrees. */
for (const got of ["", "x", KEY]) {
  const r = sameSecret("", got);
  if (r !== false) { console.log(`  MISS  empty expected secret matched ${JSON.stringify(got)}`); bad++; }
}
console.log(`  ok    an empty expected secret matches nothing`);
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  trigger auth: no prefix, repeat or length trick clears the comparison");
