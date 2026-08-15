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
 * A page that a crawler can find and the site's own search cannot.
 *
 * On 15 August the typeahead index had fallen eighteen URLs behind the sitemaps: the whole
 * coins section, three of the four calculators, both liquidation studies and the unlock
 * calendar. All live, all in the nav, all indexed for Google — and typing "solana" returned
 * nothing. Nothing broke; search simply could not see whole sections.
 *
 * A hand-maintained list beside a generated sitemap always drifts, because one is enforced by
 * a crawler and the other by memory. So the sitemaps are the authority: anything a crawler is
 * told exists must be reachable from the search box.
 *
 * The reverse is deliberately NOT checked. An entry pointing at a page that is not in a
 * sitemap is legitimate — /watchlist and /status are real, useful, and correctly noindex.
 */
export async function searchIndexGaps(origin) {
  const locs = async (u) =>
    [...(await (await fetch(u)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const maps = await locs(`${origin}/sitemap-index.xml`);
  const urls = new Set();
  for (const m of maps) for (const u of await locs(m)) urls.add(new URL(u).pathname);
  const index = await (await fetch(`${origin}/search-index.json`)).json();
  const known = new Set(index.map((r) => r.href));
  return [...urls].filter((p) => !known.has(p));
}

/**
 * An upstream this site talks to that /data-sources does not name.
 *
 * That page's own heading is "Every endpoint behind every number on this site", which is a
 * promise it cannot keep by memory. It had already drifted: three Hyperliquid endpoints listed
 * where the code calls five — the two missing ones draw every chart — and no mention at all of
 * the Ethereum endpoints behind the vesting register. Five of nine operations, two of five
 * hosts, and a tidy table that looked complete.
 *
 * This compares the hosts that appear in fetch() calls in the code that renders pages against
 * the hosts named on the rendered page. It is deliberately host-level rather than endpoint-level:
 * an endpoint list needs prose to be useful, but a HOST is a fact, and an unnamed host is either
 * an attribution the page owes someone or a vendor nobody decided to depend on.
 *
 * CONTROL_PLANE are hosts that never put a number on a page — deploy, indexing and analytics
 * plumbing. They are excluded by name rather than by pattern so that adding one is a decision.
 */
const CONTROL_PLANE = new Set([
  "api.cloudflare.com", "oauth2.googleapis.com", "searchconsole.googleapis.com",
  "www.googleapis.com", "coinliqui.com",
]);

export async function unnamedUpstreams(dataSourcesHtml, readFile, files) {
  const hosts = new Set();
  for (const f of files) {
    let src = "";
    try { src = await readFile(f); } catch { continue; }
    for (const m of src.matchAll(/https:\/\/([a-z0-9.\-]+)/gi)) {
      const h = m[1].toLowerCase().replace(/\.$/, "");
      if (!CONTROL_PLANE.has(h)) hosts.add(h);
    }
  }
  const text = strip(dataSourcesHtml).replace(/<[^>]+>/g, " ").toLowerCase();

  /* Vendors the page names at a deliberately coarser granularity than the hostname, because
     that is the granularity a reader needs. "Ethereum JSON-RPC" is the honest description of
     three interchangeable public endpoints queried for the same eth_call; naming all three
     would tell a reader nothing and would make swapping one a content change. Each alias is a
     decision, written here, rather than something a regex arrives at by accident. */
  const ALIAS = {
    "ethereum-rpc.publicnode.com": "ethereum json-rpc",
    "eth.drpc.org": "ethereum json-rpc",
    "1rpc.io": "ethereum json-rpc",
  };

  /* WHOLE WORDS, AT LEAST FOUR CHARACTERS. The first version of this took any label longer
     than two characters as a substring, which meant `eth.drpc.org` counted as named by any
     page containing the word "whether" — a check that passes because it is blind, which is
     precisely the defect class it was written to catch. It caught two of three hosts in its
     own negative test and that is how this was found. */
  const word = (s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`).test(text);
  const named = (h) => {
    if (text.includes(h)) return true;
    if (ALIAS[h] && text.includes(ALIAS[h])) return true;
    return h
      .split(".")
      .filter((p) => !["com", "org", "io", "xyz", "net", "api", "www"].includes(p))
      .some((p) => p.length >= 4 && word(p));
  };
  return [...hosts].filter((h) => !named(h));
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
