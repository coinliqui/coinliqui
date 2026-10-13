#!/usr/bin/env node
/**
 * THE FIRST STEP OF THE GATE AND OF BOTH DEPLOYS: is this the Node the project is pinned to?
 * See scripts/lib/node-pin.mjs for why it exists.
 *
 *   node scripts/node-version.mjs
 */
import { readFileSync } from "node:fs";
import { nodePinVerdict } from "./lib/node-pin.mjs";

const v = nodePinVerdict({
  running: process.version,
  nvmrc: readFileSync(".nvmrc", "utf8"),
  engines: JSON.parse(readFileSync("package.json", "utf8")).engines?.node,
});
if (!v.ok) {
  console.error("\nnode version: STOP");
  for (const p of v.problems) console.error(`  FAIL  ${p}`);
  console.error(`\n  Switch to Node ${v.want} (it is in .nvmrc), then run this again.\n`);
  process.exit(1);
}
console.log(`node version: ${process.version} matches the pinned major ${v.want}`);
