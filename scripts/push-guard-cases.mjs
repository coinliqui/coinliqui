#!/usr/bin/env node
/**
 * THE PUSH GUARD REFUSES WHAT MUST NOT BECOME PUBLIC, AND LETS AN ORDINARY COMMIT THROUGH.
 *
 * Each case is a real commit in a throwaway repository, fed to scripts/push-guard.sh the
 * way git feeds a pre-push hook. The planted secret and mailbox are assembled at run time,
 * so this file itself never carries either and passes its own guard.
 *
 *   node scripts/push-guard-cases.mjs
 *   node scripts/push-guard-cases.mjs --blind   a guard that lets everything out, which must fail
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const blind = process.argv.includes("--blind");
const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "push-guard-cases-"));
const guard = join(dir, "push-guard.sh");
/* THE OLD STATE, reproduced: the hook ran the gate and nothing looked at what was leaving. */
if (blind) writeFileSync(guard, "#!/bin/sh\ncat >/dev/null\nexit 0\n");
else copyFileSync(join(root, "scripts/push-guard.sh"), guard);
chmodSync(guard, 0o755);

const repo = join(dir, "repo");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
execFileSync("git", ["init", "-q", "-b", "main", repo]);
const ID = ["-c", "user.name=coinliqui", "-c", "user.email=hello@coinliqui.com"];
const commit = (file, body, id = ID) => {
  writeFileSync(join(repo, file), body);
  git("add", file);
  execFileSync("git", ["-C", repo, ...id, "commit", "-q", "-m", `add ${file}`]);
  return git("rev-parse", "HEAD");
};
const base = commit("README.md", "a public repository\n");
const ZERO = "0".repeat(40);
const refused = (sha, from = base) => {
  const r = spawnSync(guard, [], { cwd: repo, input: `refs/heads/main ${sha} refs/heads/main ${from}\n`, encoding: "utf8" });
  return r.status !== 0;
};
const branchOff = () => git("checkout", "-q", "--detach", base);

const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const token = "gh" + "p_" + Array.from({ length: 36 }, (_, i) => alnum[(i * 7 + 3) % alnum.length]).join("");
const mailbox = "someone" + "@" + "gm" + "ail.com";

let bad = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok    ${what}`); else { bad++; console.log(`  FAIL  ${what}`); } };

console.log(`\nthe push guard${blind ? "  [BLIND: lets everything out]" : ""}\n`);
const clean = commit("page.md", "funding rates, hourly\n");
ok(!refused(clean), "an ordinary commit by hello@coinliqui.com: go");
ok(!refused(clean, ZERO), "the same commit as a new branch: go");
branchOff();
ok(refused(commit("config.js", `export const TOKEN = "${token}";\n`)), "a GitHub token in a file: stop");
branchOff();
ok(refused(commit("notes.md", "nothing secret\n", ["-c", "user.name=yuri", "-c", "user.email=yuri@laptop.local"])), "authored as a machine-default <user>@<host>.local: stop");
branchOff();
ok(refused(commit("contact.md", `write to ${mailbox}\n`)), "an added line with a personal mailbox: stop");
branchOff();
ok(refused(commit("config.js", `export const TOKEN = "${token}";\n`), ZERO), "a token on a new branch, nothing on the remote yet: stop");

rmSync(dir, { recursive: true, force: true });

if (blind) {
  if (!bad) { console.error("\nBLIND: letting everything out satisfied every assertion. This suite cannot see a leak."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against an open door`);
  process.exit(0);
}
if (bad) { console.error(`\npush guard cases FAILED: ${bad}`); process.exit(1); }
console.log("\npush guard cases: a token, a stray identity and a personal mailbox are refused; ordinary work goes out");
