/**
 * Body-level checks, run against the RENDERED page rather than the source.
 *
 * Both of these failure modes shipped today, and both failed silently — they lost a colour
 * rather than throwing. Nothing in the build, the type system or the live verifier could see
 * them, because in every case the code was valid and the page returned 200.
 *
 * Rendered output is the right place to look. A class can be defined in one page's scoped
 * style and used in another, where Astro's scoping means the rule never applies; a static
 * grep would call that defined. What the browser receives is the only authority.
 */

/** Internal identifiers that must never reach a reader as a bare word. */
const ENUMS = ["HlPerp", "BinPerp", "BybitPerp"];

/**
 * Classes that are deliberately unstyled here: state hooks the interaction layer toggles and
 * CSS reads via an attribute, or names whose rule lives in a stylesheet this check cannot see.
 * Everything on this list is a decision, not an exemption to be grown casually.
 */
const CLASS_ALLOW = new Set([
  "app", "col", "astro-route-announcer",
]);

const strip = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

/** Every CSS the page actually applies: inline <style> blocks plus any linked stylesheet. */
export async function cssFor(html, origin) {
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) {
    try {
      const r = await fetch(m[1].startsWith("http") ? m[1] : origin + m[1]);
      if (r.ok) css += "\n" + (await r.text());
    } catch { /* a stylesheet we cannot fetch is reported as missing rules, which is honest */ }
  }
  return css;
}

/**
 * A class in the markup with no rule anywhere.
 *
 * This is the one that bit twice today: `.is-bad` on /status, referenced once and defined
 * nowhere, so the stale-snapshot indicator silently rendered in the inherited colour. CSS has
 * no concept of an undefined class — it simply matches nothing — so the page looks fine and
 * the signal is gone.
 */
export function undefinedClasses(html, css) {
  const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const used = new Set();
  for (const m of strip(html).matchAll(/\sclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !c.startsWith("astro-")) used.add(c);
  }
  return [...used].filter((c) => !defined.has(c) && !CLASS_ALLOW.has(c) && !/^data-/.test(c));
}

/**
 * A custom property read but never declared.
 *
 * Same silent class as above and slightly worse: `var(--nope)` with no fallback resolves to
 * the initial value, so a colour becomes inherited, a gap becomes zero, and nothing anywhere
 * says so. A `--fs-xl` deleted from :root while one rule still reads it would render that
 * rule at the inherited size with no error and no console warning.
 */
export function undefinedVars(html, css) {
  const all = css + "\n" + [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]).join(";");
  const declared = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...all.matchAll(/var\(\s*(--[\w-]+)\s*(?:,|\))/g)].map((m) => m[1]));
  // A var() WITH a fallback is a deliberate optional; only the bare ones are defects.
  const withFallback = new Set([...all.matchAll(/var\(\s*(--[\w-]+)\s*,/g)].map((m) => m[1]));
  return [...used].filter((v) => !declared.has(v) && !withFallback.has(v));
}

/**
 * An internal enum value rendered as text.
 *
 * Three separate instances today: the homepage flip feed printed `f.venue` straight out of
 * D1, /status rendered the venue array literal, and both were invisible because the label and
 * the code look equally like words. Inside <code> is legitimate — /status deliberately shows
 * the identifier the API uses, beside its label, because that is what you want when you are
 * diagnosing. Anywhere else it is a leak.
 */
export function rawEnums(html) {
  const text = strip(html).replace(/<code[^>]*>[\s\S]*?<\/code>/g, "");
  const bare = text.replace(/<[^>]+>/g, " ");
  return ENUMS.filter((e) => new RegExp(`(^|[\\s>(,])${e}([\\s<),.]|$)`).test(bare));
}
