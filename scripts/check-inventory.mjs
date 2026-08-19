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
import { readFileSync, readdirSync } from "node:fs";
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
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments are not call sites
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // nor are line comments
  return new RegExp(`\\b${name}\\b`).test(b);
}).map((f) => f.replace("./scripts/", "").replace("./", ""));

const dead = all.filter((n) => callersOf(n).length === 0);

/* Which checks have a standing fixture proving they fire. Read from the suite rather than
   duplicated here, so the two cannot disagree. */
const blind = readFileSync("scripts/check-blind-cases.mjs", "utf8");
const fixtured = [...blind.matchAll(/check:\s*"(\w+)"/g)].map((m) => m[1]);
const elsewhere = (/PROVEN_ELSEWHERE = \[([^\]]*)\]/.exec(blind)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
const claimed = [...new Set([...fixtured, ...elsewhere])];
const fictional = claimed.filter((n) => !exportedFns.includes(n));

/* Measurement functions return a value, not a list; "did it fire" is not a question about them.
   Kept explicit rather than inferred, so adding one is a decision instead of an accident. */
const MEASUREMENTS = ["pageWeight", "colourPalettes"];
const checks = exportedFns.filter((n) => !MEASUREMENTS.includes(n));
const unfalsified = checks.filter((n) => !claimed.includes(n));

console.log(`checks.mjs exports ${exportedFns.length} functions and ${exportedConsts.length} consts`);
console.log(`  ${checks.length} finding-returning checks, ${MEASUREMENTS.length} measurement functions\n`);

console.log(`GROUP 1 — proven to fire by a standing fixture: ${claimed.length}`);
for (const n of claimed.sort()) console.log(`    ${n}`);
console.log(`\nGROUP 2 — called every gate, never shown to fire: ${unfalsified.length}`);
for (const n of unfalsified.sort()) console.log(`    ${n.padEnd(26)} called by ${callersOf(n).join(", ")}`);
console.log(`\nGROUP 3 — no call site anywhere: ${dead.length}`);
for (const n of dead) console.log(`    ${n}  <-- exported and never invoked`);

let bad = 0;
if (dead.length) { bad++; console.log(`\n  FAIL  ${dead.length} export(s) have no call site — the extractionRatio class`); }
if (fictional.length) { bad++; console.log(`\n  FAIL  coverage list names ${fictional.join(", ")}, which checks.mjs does not export`); }
if (bad) process.exit(1);
console.log(`\n  every export is invoked; ${claimed.length}/${checks.length} checks have a fixture proving they can fire`);
