#!/usr/bin/env node
/**
 * THE NODE PIN FIRES ON THE MOVE THAT PROMPTED IT, AND STAYS QUIET ON A PATCH RELEASE.
 *
 *   node scripts/node-version-cases.mjs
 *   node scripts/node-version-cases.mjs --blind   no pin at all, which must fail
 */
import { nodePinVerdict } from "./lib/node-pin.mjs";

const blind = process.argv.includes("--blind");
/* THE OLD RULE, reproduced: nothing compared the runtime with anything. */
const verdict = blind ? () => ({ ok: true, problems: [] }) : nodePinVerdict;

let bad = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };
const PIN = { nvmrc: "24\n", engines: ">=24 <25" };

console.log(`\nthe pinned Node major${blind ? "  [BLIND: no pin]" : ""}\n`);
ok(verdict({ ...PIN, running: "v24.21.0" }).ok, "24.21.0, this machine since 13 Oct 2026: go");
ok(verdict({ ...PIN, running: "v24.0.0" }).ok, "24.0.0, a different patch: go");
ok(!verdict({ ...PIN, running: "v25.8.1" }).ok, "25.8.1, the old machine: stop");
ok(!verdict({ ...PIN, running: "v22.12.0" }).ok, "22.12.0, an older major: stop");
ok(!verdict({ nvmrc: "24", engines: ">=25 <26", running: "v24.21.0" }).ok, "engines and .nvmrc disagree: stop, even on the right Node");
ok(!verdict({ nvmrc: "", engines: ">=24 <25", running: "v24.21.0" }).ok, "an empty .nvmrc: stop");
ok(!verdict({ nvmrc: "24", engines: undefined, running: "v24.21.0" }).ok, "no engines field: stop");

if (blind) {
  if (!bad) { console.error("\nBLIND: the absent pin satisfied every assertion. This suite cannot see a wrong Node."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against no pin`);
  process.exit(0);
}
if (bad) { console.error(`\nnode version cases FAILED: ${bad}`); process.exit(1); }
console.log("\nnode version cases: a patch goes through, a different major stops the gate and both deploys");
