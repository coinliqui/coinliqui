#!/usr/bin/env node
/**
 * THE STATED SITUATION, AGAINST THE RENDERING ACCIDENTS THAT SPOIL IT.
 *
 * Every data page now opens with a sentence rather than with method, because walking the site as
 * a reader found that none of them answered anything in the first two seconds. That sentence is
 * assembled out of JSX expressions, and Astro renders a whitespace text node between adjacent
 * expressions that sit on separate lines — so "…on a $10,000 position\n{cond ? …}." ships as
 * "position .". It shipped on /coins/{coin} exactly that way.
 *
 * THE FIRST INSTRUMENT FOR THIS WAS THE INTERESTING PART. It reused the tag-stripping the other
 * checks in checks.mjs use, which replaces every tag with a space — correct for "does this text
 * contain X", useless for "what spacing does a reader see", because `<b>50 contracts</b>,` comes
 * back as "50 contracts ,". It reported a fault on all eleven pages when there was one. So the
 * assertions below run on renderedText(), which closes up inline elements the way a browser does,
 * and the blind half of this file runs the SAME cases through the naive strip to prove the two
 * disagree — a check that cannot tell a real gap from its own artefact is not a check.
 *
 *   node scripts/overview-cases.mjs
 *   node scripts/overview-cases.mjs --blind
 */
import { typographyFaults, renderedText } from "./checks.mjs";

const blind = process.argv.includes("--blind");

/** The naive strip, reproduced: every tag becomes a space. This is what got it wrong. */
const naiveText = (html) => String(html ?? "")
  .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const naiveFaults = (html) => {
  const blocks = [...String(html).matchAll(/<p class="overview[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => naiveText(m[1]));
  return blocks.flatMap((t) => (/ [.,;:!?]/.test(t) ? [`space before punctuation: "${t.match(/\S*\s[.,;:!?]\S*/)?.[0] ?? ""}"`] : []));
};
const subject = blind ? naiveFaults : typographyFaults;

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};
const P = (inner) => `<p class="overview">${inner}</p>`;

console.log(`\nthe stated situation${blind ? "  [BLIND: every tag becomes a space]" : ""}\n`);
{
  /* THE SHAPE THAT IS FINE AND WAS REPORTED AS BROKEN. Bold numbers inside a sentence are what
     every overview on the site is made of; if the check cannot read this as clean it will drown
     a real fault in ten false ones. */
  const clean = P(`Longs are paying on <b>41 of the 50 contracts</b>, and shorts on <b>9</b>. The steepest is <b>TRUMP</b>, where shorts pay longs <b>58.96%</b> a year.`);
  ok(subject(clean).length === 0, "a sentence with bold figures against punctuation is clean",
     subject(clean)[0] ?? "");

  /* THE ONE THAT SHIPPED. */
  const shipped = P(`…which is <b>$21.00</b> a week on a $10,000 position\n        , paid to you.`);
  ok(subject(shipped).length > 0, "a whitespace node before punctuation is caught");

  /* A block element between two phrases DOES create a gap, and must not be closed up. */
  const blocky = P(`One sentence.</p><p class="overview">A second one.`);
  ok(renderedText(blocky).includes("sentence. A second"), "a block boundary still separates words");

  ok(subject(P(`Holding it is <b>a cost</b>: longs pay shorts at <b>10.95%</b> a year.`)).length === 0,
     "a colon straight after a closing tag is clean");
  ok(subject(P(`Nothing resolved: <b>undefined</b> a year.`)).length > 0, "an unresolved value is caught");
  ok(subject(P(`It sits <b>9.00%</b> below it, at <b>$69,160</b>, holding <b>$58.7M</b>.`)).length === 0,
     "three bold figures in a row with commas between them are clean");
  ok(subject(P(`The rate is 10.95%Longs pay shorts.`)).length > 0, "a figure welded to the next word is caught");
  ok(subject(P(`Read at <time>2026-09-16 06:11 UTC</time>.`)).length === 0, "a timestamp element before a full stop is clean");
}

if (blind) {
  if (!bad) {
    console.error("\nBLIND: the naive strip satisfied every assertion. This suite cannot tell a rendering fault from its own artefact.");
    process.exit(1);
  }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against the tag-to-space strip`);
  process.exit(0);
}
if (bad) { console.error(`\noverview cases FAILED: ${bad}`); process.exit(1); }
console.log("\noverview cases: the stated situation reads the way it is laid out");
