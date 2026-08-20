/**
 * READING SOURCE, WITH COMMENTS ALREADY GONE.
 *
 * Three times in one session a check read prose as code — twice in checks written to prevent
 * exactly that:
 *
 *   - check-inventory decided an export had a call site because the name appeared in a comment.
 *     Fixed there, in that file.
 *   - controlGroupOverflow read a comment naming a class and treated it as a selector.
 *   - read-floor-cases — written to stop a depth floor regrowing — read the paragraph explaining
 *     why the file holds no floor, saw `series.length > 40` quoted in it, and reported a floor.
 *
 * Each was fixed where it happened, which is why it happened again. Stripping is a property of
 * READING now, not something each new check remembers: readSource() gives you code, and reading
 * the raw bytes is readRaw(), which will not run without a stated reason.
 *
 * LINE NUMBERS SURVIVE. Comments are replaced by the same number of newlines rather than
 * deleted, so a match's line number still points at the line it came from — several checks
 * report file:line and would otherwise start lying.
 *
 * A SCANNER, NOT A REGEX, because the thing regexes get wrong here is strings. `"https://x"`
 * is not a line comment, `'/*'` is not a block comment, and every ad-hoc stripper in this
 * repository handled at most one of those. What this does NOT track is regex literals — telling
 * `/foo/` from division needs the parser's token history — so a regex containing a comment
 * opener would confuse it. suspectRegexLiterals() finds those, and nothing in this repository
 * has one; the check that calls it is what keeps that true.
 */
import { readFileSync } from "node:fs";

const NL = (s) => s.replace(/[^\n]/g, "");

/**
 * Replace every comment with whitespace, preserving line structure.
 * `lang` picks which comment syntaxes exist: "js" (also .ts, .astro frontmatter, .mjs),
 * "css" (block only), "html" (<!-- --> plus, for .astro, js and css inside).
 */
export function stripComments(text, lang = "js") {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    /* Strings and templates first: everything inside one is data, including things that look
       like comment openers. Templates may nest ${ ... } holding more code, which is why this
       walks them rather than skipping to the closing backtick. */
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n && text[i] !== q) {
        if (text[i] === "\\") { out += text[i] + (text[i + 1] ?? ""); i += 2; continue; }
        if (text[i] === "\n") break;              // unterminated: a newline ends it
        out += text[i]; i++;
      }
      if (i < n) { out += text[i]; i++; }
      continue;
    }
    if (c === "`") {
      out += c; i++;
      let depth = 0;
      while (i < n) {
        if (text[i] === "\\") { out += text[i] + (text[i + 1] ?? ""); i += 2; continue; }
        if (text[i] === "$" && text[i + 1] === "{") { depth++; out += "${"; i += 2; continue; }
        if (depth > 0 && text[i] === "}") { depth--; out += "}"; i++; continue; }
        if (depth === 0 && text[i] === "`") { out += "`"; i++; break; }
        out += text[i]; i++;
      }
      continue;
    }
    if ((lang === "js" || lang === "css" || lang === "html") && c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const body = end === -1 ? text.slice(i) : text.slice(i, end + 2);
      out += NL(body); i += body.length; continue;
    }
    /* `://` IS NOT A LINE COMMENT. A quoted URL is protected by the string branch above, but a
       bare one — `<p>See https://coinliqui.com/terms</p>`, `url(https://x)` — is not, and the
       first version of this ate the rest of the line. Every ad-hoc stripper in this repository
       carried this exception; the point of one reader is that it carries it once. */
    if (lang === "js" && c === "/" && d === "/" && text[i - 1] === ":") { out += c; i++; continue; }
    if (lang === "js" && c === "/" && d === "/") {
      const end = text.indexOf("\n", i);
      const body = end === -1 ? text.slice(i) : text.slice(i, end);
      out += NL(body); i += body.length; continue;
    }
    if ((lang === "html" || lang === "js") && c === "<" && text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const body = end === -1 ? text.slice(i) : text.slice(i, end + 3);
      out += NL(body); i += body.length; continue;
    }
    out += c; i++;
  }
  return out;
}

/** The language a path's comments are written in. */
export const langOf = (path) =>
  /\.css$/.test(path) ? "css" : /\.(html|md)$/.test(path) ? "html" : "js";

/** Read a file as CODE. This is the one to use. */
export function readSource(path, lang = langOf(path)) {
  return stripComments(readFileSync(path, "utf8"), lang);
}

/**
 * Read a file as BYTES, comments and all. Some checks genuinely want the prose — the
 * permission-claim sweep reads comments on purpose, because the claim it hunts regrew inside
 * one. The reason is a required argument so that choice is visible at the call site rather than
 * being the default nobody noticed.
 */
export function readRaw(path, why) {
  if (typeof why !== "string" || why.length < 12) {
    throw new Error(`readRaw(${path}) needs a reason: say why this check must see comments`);
  }
  return readFileSync(path, "utf8");
}

/**
 * Regex literals whose body contains a comment opener. The scanner above does not track regex
 * literals, so one of these would be mis-stripped. Nothing here has one; this is what says so.
 */
export function suspectRegexLiterals(text) {
  return [...text.matchAll(/[=(,:[]\s*\/(?![/*])(?:\\.|\[[^\]]*\]|[^\\/\n])*\/[gimsuy]*/g)]
    .map((m) => m[0])
    .filter((r) => /\\\/\\\*|\\\/\\\//.test(r) || /\/\*|(?<!\\)\/\//.test(r.slice(1, -1)));
}
