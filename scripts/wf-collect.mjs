#!/usr/bin/env node
/**
 * COLLECT A WORKFLOW'S FINDINGS FROM DISK, AND REFUSE TO HAND OVER A SUBSET.
 *
 * THE DEFECT THIS EXISTS FOR, twice in one day. A multi-agent workflow produced N findings; the
 * synthesis step received them as `JSON.stringify(findings).slice(0, 26000)` interpolated into a
 * prompt; the slice cut mid-record; and the final report was written from four of ten candidates
 * while stating a conclusion about all ten. Both times the conclusion happened to be right, which
 * is the dangerous version — nothing in the output distinguished "read everything" from "read
 * 40% and generalised". Both times it was caught afterwards by reading the journal by hand, which
 * is not a mechanism.
 *
 * THE FIX IS NOT A BIGGER SLICE. A bigger slice fails the same way one input later. The fix is
 * that the synthesis step must never receive its evidence through a prompt at all:
 *
 *   1. every finder agent WRITES its own result to <dir>/<key>.json as it finishes;
 *   2. the workflow tells the synthesis agent the directory and the EXPECTED COUNT;
 *   3. the synthesis agent runs this script, which either prints the complete set or exits
 *      non-zero with a message saying exactly what is missing;
 *   4. the synthesis agent is instructed to refuse to synthesise on a non-zero exit.
 *
 * The count is the whole point. A directory read without an expected count has the same failure
 * mode as a slice: it looks complete because it is all there was.
 *
 * IT ALSO REFUSES ON EXTRAS. A file nobody expected means the caller's model of the run is wrong,
 * and a synthesis over a set the author cannot enumerate is not one they can vouch for.
 *
 *   node scripts/wf-collect.mjs <dir> <expectedCount> [--quiet]
 *   node scripts/wf-collect.mjs --blind
 */
import { readdirSync, readFileSync } from "node:fs";

export function collect(entries, expected) {
  const problems = [];
  const parsed = [];
  for (const [name, text] of entries) {
    try {
      parsed.push({ name, value: JSON.parse(text) });
    } catch (e) {
      problems.push(`${name} is not valid JSON (${e instanceof Error ? e.message.slice(0, 60) : e})`);
    }
  }
  /* EMPTY-BUT-VALID COUNTS AS MISSING. `{}` and `[]` parse cleanly and carry no finding, so a
     finder that returned nothing would otherwise pad the count to the expected number and make
     the set look whole. That is the same lie as truncation, arriving from the other end. */
  const empty = parsed.filter((p) => p.value === null || (typeof p.value === "object" && Object.keys(p.value).length === 0));
  for (const e of empty) problems.push(`${e.name} parsed but is empty — a finder returned nothing`);

  const n = parsed.length - empty.length;
  if (!Number.isInteger(expected) || expected < 1) problems.push(`expected count must be a positive integer, got ${expected}`);
  else if (n < expected) problems.push(`INCOMPLETE: ${n} usable finding(s) on disk, ${expected} expected — ${expected - n} missing`);
  else if (n > expected) problems.push(`UNEXPECTED: ${n} finding(s) on disk, only ${expected} expected — the caller's model of this run is wrong`);

  return { ok: problems.length === 0, count: n, problems, findings: parsed.filter((p) => !empty.includes(p)) };
}

if (process.argv.includes("--blind")) {
  /* Every way the set can be wrong, and the one way it can be right. */
  const j = (o) => JSON.stringify(o);
  const three = [["a.json", j({ v: 1 })], ["b.json", j({ v: 2 })], ["c.json", j({ v: 3 })]];
  const cases = [
    ["the complete set passes", three, 3, null],
    ["one finding short — the truncation defect", three.slice(0, 2), 3, /INCOMPLETE: 2 usable/],
    ["most of the set missing", three.slice(0, 1), 10, /INCOMPLETE: 1 usable finding\(s\) on disk, 10 expected — 9 missing/],
    ["an extra nobody expected", [...three, ["d.json", j({ v: 4 })]], 3, /UNEXPECTED: 4/],
    ["a truncated file that will not parse", [...three.slice(0, 2), ["c.json", '{"v": 3']], 3, /not valid JSON/],
    ["a finder that returned {}", [...three.slice(0, 2), ["c.json", "{}"]], 3, /parsed but is empty/],
    ["a finder that returned null", [...three.slice(0, 2), ["c.json", "null"]], 3, /parsed but is empty/],
    ["an expected count of zero", three, 0, /positive integer/],
    ["nothing on disk at all", [], 3, /INCOMPLETE: 0 usable/],
  ];
  let bad = 0;
  for (const [name, entries, expected, want] of cases) {
    const r = collect(entries, expected);
    const hit = want ? r.problems.some((p) => want.test(p)) : r.ok;
    if (!hit) { bad++; console.log(`  BLIND  ${name}`); console.log(`         got: ${r.problems.join(" | ") || "(clean)"}`); }
    else console.log(`  ok     ${want ? "REFUSES" : "ACCEPTS "} ${name}`);
  }
  console.log(bad ? `\n  ${bad} BLIND SPOT(S)\n` : `\n  ${cases.length} cases: it accepts only the complete set\n`);
  process.exit(bad ? 1 : 0);
}

const [dir, expectedRaw] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dir || expectedRaw === undefined) {
  console.error("usage: node scripts/wf-collect.mjs <dir> <expectedCount>");
  process.exit(2);
}
let entries = [];
try {
  entries = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => [f, readFileSync(`${dir}/${f}`, "utf8")]);
} catch (e) {
  console.error(`  REFUSING TO SYNTHESISE: cannot read ${dir} — ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const r = collect(entries, Number(expectedRaw));
if (!r.ok) {
  console.error(`\n  REFUSING TO HAND OVER A SUBSET. Do not synthesise from this.\n`);
  for (const p of r.problems) console.error(`    - ${p}`);
  console.error(`\n  Report the run as incomplete instead of reporting on what survived.\n`);
  process.exit(1);
}
const bytes = entries.reduce((n, [, t]) => n + t.length, 0);
if (!process.argv.includes("--quiet")) console.error(`  ${r.count}/${expectedRaw} findings, ${bytes.toLocaleString()} bytes — complete`);
process.stdout.write(JSON.stringify(r.findings.map((f) => f.value), null, 1));
