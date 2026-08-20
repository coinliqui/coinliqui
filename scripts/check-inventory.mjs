#!/usr/bin/env node
/**
 * THE GATE'S OWN INVENTORY: is every check called, and is its green falsifiable?
 *
 * Written after extractionRatio was found exported, cited by the comment above it as the
 * authority on payload size, and invoked from nowhere in the repository. It had never produced
 * a number anyone saw. That class is now unshippable: an export with no call site fails here.
 *
 * The second question — has a check ever been shown to FIRE — cannot be answered by grep, so it
 * was answered by measurement once: checks.mjs was instrumented to record every call and whether
 * the return was a non-empty finding list, and the whole `npm run check` ran against it. Result:
 * 0 never called, 4 observed to fire, 21 called and silent on every gate. This file keeps the
 * bookkeeping honest between those runs.
 *
 * WHY THE COVERAGE LIST IS VERIFIED AND NOT TRUSTED: a list of "checks we have fixtures for" is
 * itself a claim that can rot. A name in it that is no longer an export would inflate the number
 * while proving nothing, so every entry is required to resolve to a real export.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SRC = "scripts/checks.mjs";
const src = readFileSync(SRC, "utf8");
const exportedFns = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
const exportedConsts = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
const all = [...exportedFns, ...exportedConsts];

/* Call sites, excluding checks.mjs itself and its own comments. A name appearing only in a
   comment is not a caller — the extractionRatio case was exactly that. */
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  if (e.name === "node_modules" || e.name.startsWith(".")) continue;
  const p = `${d}/${e.name}`;
  if (e.isDirectory()) walk(p); else if (/\.(mjs|ts|astro|js)$/.test(e.name) && p !== `./${SRC}`) files.push(p);
} };
walk("./scripts"); walk("./worker"); walk("./src");

const bodies = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const callersOf = (name) => files.filter((f) => {
  const b = bodies.get(f)
    .replace(/\/\*[\s\S]*?\*\//g, " ")        // block comments are not call sites
    .replace(/(^|[^:])\/\/.*$/gm, "$1")       // nor are line comments
    /* AND NOR IS AN IMPORT, which is what made this whole check decorative.
       Comments were stripped and imports were not, while scripts/smoke.mjs imports all 34
       checks on a single line. So every check had a "caller" by construction and
       "GROUP 3 — no call site anywhere: 0" was a guaranteed output rather than a finding.
       Proven by mutation: delete the only call of chartAgreement, leave the import, and the
       gate still printed "every export is invoked" and exited 0. That is precisely the
       extractionRatio class this file was written to catch, alive inside it. */
    .replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["'];?/gm, " ")
    .replace(/^\s*export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/gm, " ");
  return new RegExp(`\\b${name}\\b`).test(b);
}).map((f) => f.replace("./scripts/", "").replace("./", ""));

/* A CHECK CALLED ONLY BY ITS OWN FIXTURE IS NOT WIRED INTO ANYTHING.
   GROUP 3 could never be non-empty, for two compounding reasons. Imports counted as call sites
   (fixed above), and scripts/check-blind-cases.mjs calls every check by design — so "called
   nowhere" was unreachable even after the import fix. Proven by mutation: deleting the only
   real call of chartAgreement from smoke.mjs still left the gate green, because its fixture
   still referenced it.
   The question worth asking is not "is this name mentioned somewhere" but "does anything run it
   on REAL DATA". So the fixture files are excluded from the caller set: a check whose only
   caller is its own blind case is dead in exactly the sense this group exists to name. */
const FIXTURE_ONLY = ["check-blind-cases.mjs"];
const realCallersOf = (n) => callersOf(n).filter((f) => !FIXTURE_ONLY.some((x) => f.endsWith(x)));
const dead = all.filter((n) => realCallersOf(n).length === 0);

/* Which checks have a standing fixture proving they fire. Read from the suite rather than
   duplicated here, so the two cannot disagree. */
const blind = readFileSync("scripts/check-blind-cases.mjs", "utf8");
const fixtured = [...blind.matchAll(/check:\s*"(\w+)"/g)].map((m) => m[1]);
const elsewhere = (/PROVEN_ELSEWHERE = \[([^\]]*)\]/.exec(blind)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
const claimed = [...new Set([...fixtured, ...elsewhere])];
const fictional = claimed.filter((n) => !exportedFns.includes(n));

/* Measurement functions return a value, not a list; "did it fire" is not a question about them.
   The list lives in checks.mjs beside the functions — this file and check-blind-cases.mjs both
   need it, and two copies of one fact is the shape this whole file exists to catch. */
import { MEASUREMENT_EXPORTS } from "./checks.mjs";
const checks = exportedFns.filter((n) => !MEASUREMENT_EXPORTS.includes(n));
const unfalsified = checks.filter((n) => !claimed.includes(n));

console.log(`checks.mjs exports ${exportedFns.length} functions and ${exportedConsts.length} consts`);
console.log(`  ${checks.length} finding-returning checks, ${MEASUREMENT_EXPORTS.length} measurement functions\n`);

console.log(`GROUP 1 — proven to fire by a standing fixture: ${claimed.length}`);
for (const n of claimed.sort()) console.log(`    ${n}`);
console.log(`\nGROUP 2 — called every gate, never shown to fire: ${unfalsified.length}`);
for (const n of unfalsified.sort()) console.log(`    ${n.padEnd(26)} called by ${realCallersOf(n).join(", ") || "(fixture only)"}`);
console.log(`\nGROUP 3 — no call site anywhere: ${dead.length}`);
for (const n of dead) console.log(`    ${n}  <-- only its own fixture calls it; nothing runs it on real data`);

/* ---------------------------------------------------------------------------------------------
   GROUP 4 — THE WORKER'S OWN EXPORTS, because the closing line of this file said "every export
   is invoked" and meant "every export of scripts/checks.mjs".

   Found by mutation, and the mutation was meant to prove something else: an obviously dead
   export was added to worker/coverage.ts, the gate was run, and GROUP 3 still printed 0. It was
   right to — that file was never in the inventory. The sentence underneath it was not, and a
   reader has no way to tell an overclaiming summary from a passing check.

   The worker is where dead code is most expensive. Nothing type-checks a Cloudflare cron into
   existence, so a function that stopped being called still bundles, still deploys, and still
   reads as live infrastructure to whoever opens the file next.

   Its OWN file does not count as a caller, for the same reason checks.mjs does not. */
const WORKER_EXPORT = /^export (?:async )?(?:function|const) (\w+)/gm;
const workerDead = [];
for (const f of files.filter((x) => x.startsWith("./worker/"))) {
  for (const m of readFileSync(f, "utf8").matchAll(WORKER_EXPORT)) {
    const n = m[1];
    const callers = callersOf(n).filter((c) => !f.endsWith(c) && `./${c}` !== f);
    if (!callers.length) workerDead.push([n, f.replace("./", "")]);
  }
}
console.log(`\nGROUP 4 — worker exports nothing outside their own file calls: ${workerDead.length}`);
for (const [n, f] of workerDead) console.log(`    ${n.padEnd(26)} ${f}`);

/* ---------------------------------------------------------------------------------------------
   PROVEN ONCE IS NOT PROVEN.
   The same defect as a dead check, one level up: a VERIFIER that exits non-zero on failure but
   is referenced by no npm script runs only when somebody remembers, and everything it asserts
   has been assumed since the last time anybody did. verify-live.mjs was the case that prompted
   this — 84 assertions about what a client on the open internet actually receives, standalone.
   It now runs at the end of deploy:site.
   A script may be manual by design; that has to be a stated decision rather than an omission,
   so the reason is written here and an unlisted one fails. */
const MANUAL_BY_DESIGN = {
  "configure-zone.mjs": "one-time zone setup; re-running it changes account state, not code",
  "gen-og-png.mjs": "network plus a live credential, and og.png is committed as an artifact — a build that needs the network is a build that gets bypassed",
  "gsc-report.mjs": "reads Search Console with a key that lives only in a worker secret; the worker produces the standing report instead",
};
const npmScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const npmCmds = Object.values(npmScripts).join(" && ");

/* ---------------------------------------------------------------------------------------------
   AN NPM SCRIPT POINTING AT A FILE THAT IS NOT THERE.

   `gen:margin` ran `node --experimental-strip-types scripts/gen-margin-tables.ts`. The file is
   scripts/gen-margin-tables.mjs and has been since it was written. So the only way to refresh
   src/data/margin-tables.json — the tier tables five templates compute liquidation prices from —
   threw MODULE_NOT_FOUND, and had done for as long as the data has been committed. Nothing
   noticed, because the data was still right: the failure is invisible until the day you need it,
   which is the day upstream adds a tier table and every one of those pages throws.

   This is the same class as a dead check, one layer out. A command nobody has run since it was
   typed is a claim about a capability, and the claim is worth exactly as much as the path in it.
   Only the file operand is verified — flags, pipes and binaries are somebody else's business —
   which is enough to catch a rename or a moved file, and those are what actually happen. */
const missingTargets = [];
for (const [name, cmd] of Object.entries(npmScripts)) {
  for (const tok of cmd.split(/\s+/)) {
    if (!/^[\w./-]+\.(mjs|ts|js|cjs)$/.test(tok)) continue;
    if (tok.startsWith("-")) continue;
    if (!existsSync(tok)) missingTargets.push(`${name} runs \`${tok}\`, which does not exist`);
  }
}
console.log(`\nNPM SCRIPTS — file operands that do not exist: ${missingTargets.length}`);
for (const m of missingTargets) console.log(`    ${m}`);
/* "CAN FAIL" MEANT "CONTAINS THE LITERAL STRING process.exit(1)", AND THAT IS NOT WHAT IT MEANS.
 *
 * Most verifiers in this directory compute their exit code — `process.exit(bad ? 1 : 0)` is the
 * house style — and the literal match saw none of them. SEVEN were invisible, including
 * smoke.mjs, which is the gate. So the line this file prints, "scripts that can fail: 24", was a
 * count of the ones written in one particular way, and its unwired analysis was a claim about
 * that subset rather than about the directory.
 *
 * This is the exact defect this file exists to catch — a check that passes because it is blind —
 * living in the check that catches it. Found while wiring in a new probe and noticing the total
 * had not moved.
 *
 * The predicate now asks the real question: is there any exit path whose status is not literally
 * zero. That admits `exit(1)`, `exit(bad ? 1 : 0)` and `exit(130)`, and still excludes a script
 * whose only exit is `exit(0)`. */
const canFail = readdirSync("scripts")
  .filter((f) => /\.(mjs|ts)$/.test(f) && f !== "checks.mjs")
  .filter((f) => {
    const src = readFileSync(`scripts/${f}`, "utf8");
    if (/process\.exitCode\s*=\s*(?!0\b)/.test(src)) return true;
    return [...src.matchAll(/process\.exit\(([^)]*)\)/g)].some((m) => m[1].trim() !== "0");
  });
const unwired = canFail.filter((f) => !npmCmds.includes(f));
const undocumented = unwired.filter((f) => !MANUAL_BY_DESIGN[f]);

console.log(`\nVERIFIERS — scripts that can fail: ${canFail.length}, of which ${unwired.length} are not run by any npm script`);
for (const f of unwired.sort()) console.log(`    ${f.padEnd(26)} ${MANUAL_BY_DESIGN[f] ? "manual by design: " + MANUAL_BY_DESIGN[f].slice(0, 88) : "UNDOCUMENTED"}`);

let bad = 0;
if (undocumented.length) { bad++; console.log(`\n  FAIL  ${undocumented.join(", ")} can fail, is run by nothing, and has no stated reason — proven once is not proven`); }
/* The exemption list rots in the other direction too: an entry excusing a script that no longer
   needs excusing is a stale claim, and the coverage list two sections up is guarded the same way. */
const staleExemptions = Object.keys(MANUAL_BY_DESIGN).filter((f) => !unwired.includes(f));
if (staleExemptions.length) { bad++; console.log(`\n  FAIL  MANUAL_BY_DESIGN excuses ${staleExemptions.join(", ")}, which no longer needs excusing`); }
if (dead.length) { bad++; console.log(`\n  FAIL  ${dead.length} export(s) have no call site — the extractionRatio class`); }
if (workerDead.length) { bad++; console.log(`\n  FAIL  ${workerDead.length} worker export(s) nothing calls — dead code that still deploys`); }
if (missingTargets.length) { bad++; console.log(`\n  FAIL  ${missingTargets.length} npm script(s) point at a file that is not there — a capability nobody has exercised since it was typed`); }
if (fictional.length) { bad++; console.log(`\n  FAIL  coverage list names ${fictional.join(", ")}, which checks.mjs does not export`); }
if (bad) process.exit(1);
console.log(`\n  every export of checks.mjs and of worker/ is invoked; ${claimed.length}/${checks.length} checks have a fixture proving they can fire`);
