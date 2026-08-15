#!/usr/bin/env node
/**
 * Apply a list of {file, current, proposed} edits — and SHOW WHAT CHANGED.
 *
 * WHY THIS EXISTS. Twice on 14 August a bulk application of agent-proposed edits went wrong
 * in a way a count could not show:
 *
 *   - `npm run build` printed a ReferenceError and I ran the output through `grep -c`, read
 *     the number 1, assumed it was the known SESSION warning, and pushed. Fifty-four pages
 *     went to a 500 body. The evidence was on my screen in words and I had reduced it to an
 *     integer before looking at it.
 *   - a 126-edit application reported "101 applied" and that number was true; one of the 101
 *     had replaced a guard clause with a duplicate import, which the count could not express.
 *
 * So this prints a real unified diff, per file, and refuses to write anything at all if any
 * edit is ambiguous. A count is a summary of a diff, and summarising before reading is the
 * failure mode this whole file is an apology for.
 *
 *   node scripts/apply-edits.mjs edits.json            # dry run: diff only, writes nothing
 *   node scripts/apply-edits.mjs edits.json --write    # apply, after printing the same diff
 *
 * edits.json: [{ "file": "src/…", "current": "…verbatim…", "proposed": "…" }, …]
 * `current` must appear EXACTLY ONCE in the file. Zero matches or two is a hard stop for the
 * whole run, not a skipped line — a partly-applied rename is worse than none, because the
 * site then uses both words for one thing and nothing says which is right.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , path, ...flags] = process.argv;
if (!path) { console.error("usage: node scripts/apply-edits.mjs <edits.json> [--write]"); process.exit(2); }
const write = flags.includes("--write");
const edits = JSON.parse(readFileSync(path, "utf8"));

/** Minimal unified diff, enough to read a change without trusting a summary of it. */
function diff(before, after, file) {
  const a = before.split("\n"), b = after.split("\n");
  const out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    // find the next line that re-synchronises the two sides
    let k = 1, sync = -1;
    while (k < 40 && sync < 0) {
      if (a[i + k] !== undefined && a[i + k] === b[j]) sync = 0;
      else if (b[j + k] !== undefined && b[j + k] === a[i]) sync = 1;
      else k++;
    }
    const ctx = out.length && out[out.length - 1] !== "" ? [] : [`  ${file}`];
    if (sync === 0) { for (let n = 0; n < k; n++) out.push(`  \x1b[31m- ${a[i + n]}\x1b[0m`); i += k; }
    else if (sync === 1) { for (let n = 0; n < k; n++) out.push(`  \x1b[32m+ ${b[j + n]}\x1b[0m`); j += k; }
    else {
      out.push(`  \x1b[31m- ${a[i]}\x1b[0m`, `  \x1b[32m+ ${b[j]}\x1b[0m`);
      i++; j++;
    }
    out.unshift(...ctx);
  }
  return out;
}

const byFile = new Map();
for (const e of edits) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)).push(e);

let fatal = 0;
const staged = [];
for (const [file, es] of byFile) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch { console.error(`  FATAL  cannot read ${file}`); fatal++; continue; }
  const before = text;
  // longest first, so a shorter edit cannot consume text a longer one needs
  for (const e of [...es].sort((x, y) => y.current.length - x.current.length)) {
    const n = text.split(e.current).length - 1;
    if (n !== 1) {
      console.error(`  FATAL  ${file}: "${e.current.slice(0, 70).replace(/\n/g, "⏎")}" matched ${n} times, need exactly 1`);
      fatal++;
      continue;
    }
    text = text.replace(e.current, e.proposed);
  }
  if (text !== before) staged.push({ file, before, after: text });
}

if (fatal) {
  console.error(`\n${fatal} edit(s) did not match exactly once. Nothing written — fix the list and re-run.\n`);
  process.exit(1);
}

for (const s of staged) {
  console.log(`\n\x1b[1m${s.file}\x1b[0m`);
  console.log(diff(s.before, s.after, s.file).join("\n"));
}

if (!write) {
  console.log(`\n${staged.length} file(s) would change. Read the diff above, then re-run with --write.\n`);
  process.exit(0);
}
for (const s of staged) writeFileSync(s.file, s.after);
console.log(`\n${staged.length} file(s) written. Now run: npm run check\n`);
