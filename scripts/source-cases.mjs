#!/usr/bin/env node
/**
 * THE READER THAT STRIPS COMMENTS, EXERCISED — because three checks read prose as code in one
 * session, and two of them were written to prevent exactly that.
 *
 * Every one was fixed where it happened, which is why it kept happening. scripts/lib/source.mjs
 * makes stripping a property of READING; this file is what makes that property true rather than
 * intended. The cases are the mistakes the ad-hoc strippers actually made.
 *
 *   node scripts/source-cases.mjs
 */
import { stripComments, langOf, readSource, readRaw, suspectRegexLiterals } from "./lib/source.mjs";
import { readFileSync, readdirSync } from "node:fs";

let bad = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) { bad++; console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}`); }
  else console.log(`  ok    ${name}`);
};
const has = (src, re, lang) => re.test(stripComments(src, lang));

console.log("\n  comments go");
t("a line comment", has("const a = 1; // gone", /gone/), false);
t("a block comment", has("/* gone */ const a = 1;", /gone/), false);
t("an Astro expression comment", has("<div>{/* gone */}</div>", /gone/), false);
t("an HTML comment", has("<!-- gone -->", /gone/), false);
t("a CSS block comment", has(".x { /* gone */ color: red }", /gone/, "css"), false);

console.log("\n  and code does not");
t("code after a block comment", has("/* x */ const keep = 1;", /const keep/), true);
t("code after a line comment", has("// x\nconst keep = 1;", /const keep/), true);
t("a CSS declaration beside a comment", has(".x { /* c */ color: red }", /color: red/, "css"), true);

console.log("\n  strings are data, and this is where regexes get it wrong");
t("a comment opener inside single quotes", has("const s = '/* not a comment */';", /not a comment/), true);
t("a double slash inside double quotes", has('const s = "a // b";', /a \/\/ b/), true);
t("a template literal with an expression", has("const t = `a ${x + 1} b`; // gone", /a \$\{x \+ 1\} b/), true);
t("...and the comment after it still goes", has("const t = `a ${x} b`; // gone", /gone/), false);
/* THE ONE THE FIRST VERSION OF THIS READER GOT WRONG. A quoted URL is protected by the string
   branch; a bare one in markup or in url() is not, and it ate the rest of the line. */
t("a bare URL in markup", has("<p>See https://coinliqui.com/terms</p>", /coinliqui\.com\/terms/), true);
t("a CSS url()", has("background: url(https://x/y)", /x\/y/, "css"), true);
t("a quoted URL", has('const u = "https://x/y";', /x\/y/), true);

console.log("\n  line numbers survive, because findings report them");
t("a three-line block comment leaves three lines", stripComments("l1 /* a\nb\nc */ l5\nl6").split("\n").length, 4);
t("a line comment does not eat its newline", stripComments("a // x\nb").split("\n").length, 2);

console.log("\n  the language is taken from the path");
t(".css is css", langOf("a/b.css"), "css");
t(".astro is js", langOf("a/b.astro"), "js");
t(".ts is js", langOf("a/b.ts"), "js");

console.log("\n  reading the raw bytes is a decision, not a default");
try { readRaw("package.json"); t("readRaw with no reason throws", false, true); }
catch { t("readRaw with no reason throws", true, true); }
try { readRaw("package.json", "short"); t("readRaw with a token reason throws", false, true); }
catch { t("readRaw with a token reason throws", true, true); }
t("readRaw with a real reason returns bytes",
  readRaw("package.json", "the test needs the file verbatim").startsWith("{"), true);
t("readSource returns something", readSource("scripts/lib/source.mjs").length > 100, true);

/* THE ONE THING THE SCANNER CANNOT SEE. Telling a regex literal from division needs the
   parser's token history, so a regex whose body holds a comment opener would be mis-stripped.
   Nothing in the scanned tree has one, and this is what says so rather than hoping. */
console.log("\n  nothing in the scanned tree defeats the scanner");
const walk = (d, o = []) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = `${d}/${e.name}`; e.isDirectory() ? walk(p, o) : /\.(ts|astro|js|mjs)$/.test(e.name) && o.push(p); } return o; };
const files = [...walk("src"), ...walk("worker"), ...walk("public")];
const suspects = files.flatMap((f) => suspectRegexLiterals(readFileSync(f, "utf8")).map((r) => `${f}: ${r.slice(0, 40)}`));
t(`${files.length} files hold no regex literal containing a comment opener`, suspects.length, 0);
if (suspects.length) for (const s of suspects) console.log(`          ${s}`);

if (bad) { console.error(`\n  ${bad} case(s) wrong\n`); process.exit(1); }
console.log("\n  reading source gives you code; reading prose is spelled readRaw and needs a reason\n");
