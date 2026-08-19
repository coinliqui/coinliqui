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
  /* SITEMAP <loc> VALUES ARE ABSOLUTE PRODUCTION URLS, which is correct in a sitemap and wrong
     to follow here. The first version fetched them as given, so a check running against a
     locally-built worker was reading PRODUCTION's child sitemaps and comparing them to the
     LOCAL search index. It passed for the same reason it was meaningless: the two sides
     usually agree, and when production was briefly unreachable the whole gate failed with
     "fetch failed" and no indication why. Both halves must come from the build under test. */
  const local = (u) => origin + new URL(u).pathname;
  const maps = await locs(`${origin}/sitemap-index.xml`);
  const urls = new Set();
  for (const m of maps) for (const u of await locs(local(m))) urls.add(new URL(u).pathname);
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
    /* A FILE WITH NO fetch( CANNOT BE FETCHING ANYTHING. Without this the scan reported
       github.com as an unattributed upstream, because src/lib/site.ts names the public
       repository in the Organization `sameAs` — a declarative identity claim rendered into
       JSON-LD, not a request. The gate caught it on the push that added it, which is the
       system working; the check was over-broad, and "appears as an https:// string" is not
       the same predicate as "is fetched". This one is, and it is checkable by reading the
       file rather than by judging intent. */
    if (!/\bfetch\s*\(/.test(src)) continue;
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
 * Two implementations of one number format, disagreeing.
 *
 * There is no bundler here — public/interact.js is served raw — so every formatter exists
 * twice: once in TypeScript for the server render, once in vanilla JS for the interaction
 * layer. Interaction is supposed to be a layer OVER already-rendered values, so a formatter
 * that differs by one digit silently rewrites the reader's number on a click that changed
 * nothing else.
 *
 * Both had drifted, and in opposite directions:
 *   qty        the volume column. Server toFixed(2) at K, client toFixed(1). All 200 rows of
 *              the bar table were rewritten from "23.37K" to "23.4K" on any timeframe click,
 *              while the other 1,200 cells matched byte for byte.
 *   compactUsd the heatmap. ONE client formatter was serving TWO different server ones — the
 *              token-quantity rule with a "$" glued on — so the legend printed "≥ $29.6M" and
 *              the tooltip over the same cell printed "$29.65M".
 *
 * This sweeps a magnitude ladder through the REAL functions in both files rather than through
 * copies of them: the client bodies are read out of public/interact.js and evaluated, so the
 * check cannot pass against a version of the code that is not shipping.
 */
const LADDER = [
  0, 0.001, 0.5, 0.999, 1, 1.005, 9.999, 23.37, 999.994, 999.995, 999.999,
  1000, 1000.5, 1234.5, 23370, 23450, 38449, 76800, 999_499, 999_500, 999_999,
  1e6, 1_050_000, 1_234_567, 29_650_000, 30_410_000, 41_200_000, 999_999_999,
  1e9, 1_050_000_000, 2_409_939_735,
];

/** Pull a `const NAME = (…) => {…};` or `const NAME = (…) => expr;` body out of a source file. */
function extractFn(src, name) {
  const start = src.indexOf(`const ${name} = (`);
  if (start < 0) throw new Error(`${name} not found in interact.js`);
  // Walk from the arrow to the end of the function, balancing braces or stopping at the
  // statement's semicolon for expression bodies.
  const arrow = src.indexOf("=>", start);
  let i = src.indexOf("{", arrow);
  const semi = src.indexOf(";", arrow);
  if (i < 0 || (semi >= 0 && semi < i)) return src.slice(start, semi + 1);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + ";";
  }
  throw new Error(`${name}: unbalanced braces`);
}

export function formatterDrift(interactSrc, serverImpls) {
  const out = [];
  for (const [name, serverFn] of Object.entries(serverImpls)) {
    let clientFn;
    try {
      // eslint-disable-next-line no-new-func
      clientFn = new Function(`${extractFn(interactSrc, name)} return ${name};`)();
    } catch (e) {
      out.push(`${name}: could not evaluate the client implementation — ${e.message}`);
      continue;
    }
    for (const v of LADDER) {
      for (const n of [v, -v]) {
        const a = serverFn(n);
        const b = clientFn(n);
        if (a !== b) {
          out.push(`${name}(${n}): server "${a}" vs client "${b}"`);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * A route the build produces that the gate never asks for.
 *
 * THE GATE WAS BLIND TO ITS OWN COVERAGE. scripts/smoke.mjs walks a hand-written ROUTES list
 * and prints "31 routes rendered", which reads like a statement about the site and is only a
 * statement about the list. The build produced 39. Six sitemap endpoints — funding-hub,
 * liquidations, open-interest, pages, tools, unlocks — were never requested by anything, so a
 * 500 in one of them would ship green and be served to Googlebot.
 *
 * That is the precise failure smoke.mjs was written to stop, one level up: a new template gets
 * added, nobody remembers the list, and the gate confirms everything is fine.
 *
 * Astro's own internals are excluded — they are framework plumbing, not pages of this site.
 * A dynamic route counts as covered when ROUTES contains a concrete instance of it.
 */
const ASTRO_INTERNAL = new Set(["/_image", "/_server-islands/[name]"]);

export function uncoveredRoutes(manifestSrc, routes) {
  const built = [...manifestSrc.matchAll(/"route":"([^"]*)"/g)].map((m) => m[1]);
  const covered = (r) => {
    if (routes.includes(r)) return true;
    if (!r.includes("[")) return false;
    // /funding/[symbol] is covered by /funding/btc
    const re = new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "$");
    return routes.some((x) => re.test(x));
  };
  return [...new Set(built)].filter((r) => !ASTRO_INTERNAL.has(r) && !covered(r));
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

/**
 * A text colour that cannot be read on the surface it is printed on.
 *
 * The design system defines three text steps and four surfaces. Nothing checked that any pair
 * of them was legible, and one was not: --text-faint was 2.82:1 on --surface-3, where .tbl th
 * renders at 12px. WCAG AA wants 4.5:1 below 18.66px. That is not a taste call — it is a
 * number the tokens either meet or do not, and it had never been computed.
 *
 * This is a consistency pair like the others: the palette asserts a hierarchy, WCAG asserts a
 * floor, and until now the two were never compared.
 */
const SURFACES = ["--bg", "--surface-1", "--surface-2", "--surface-3"];
const TEXTS = ["--text", "--text-dim", "--text-faint"];
const AA_NORMAL = 4.5;

const srgb = (h) => {
  const v = h.replace("#", "");
  const f = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const chan = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
const lum = (h) => { const [r, g, b] = srgb(h); return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); };
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export function unreadableText(css) {
  /* EVERY DEFINITION, NOT THE FIRST. The first version kept only the first hex it saw for each
     token, so a later `@media { :root { --text-faint: #3a3f45 } }` was invisible to it and the
     check passed while the palette it described no longer existed. Tested by writing that CSS
     out and running it — see scripts/blind-cases.mjs — rather than by rereading the loop.
     Each token currently has exactly one definition, so this changed no result today; it
     changes what happens the first time someone adds a responsive or themed override. */
  const tok = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)) (tok[m[1]] ??= []).push(m[2]);
  const out = [];
  for (const t of TEXTS) {
    for (const s of SURFACES) {
      /* It knows WHICH of the two is absent, so it says which. "t or s is not a hex token"
         sends a reader to check both, and the one that is fine looks equally suspect. */
      const undefinedToks = [!tok[t] && t, !tok[s] && s].filter(Boolean);
      if (undefinedToks.length) { out.push(`${undefinedToks.join(" and ")} ${undefinedToks.length > 1 ? "are" : "is"} not a hex token in the built CSS`); continue; }
      for (const tv of tok[t]) {
        for (const sv of tok[s]) {
          const r = contrast(tv, sv);
          if (r < AA_NORMAL) out.push(`${t} (${tv}) on ${s} (${sv}) is ${r.toFixed(2)}:1, below ${AA_NORMAL}`);
        }
      }
    }
  }
  return [...new Set(out)];
}

/**
 * A chart that disagrees with the numbers printed beside it.
 *
 * The candles are drawn from a points array, and the same page separately prints "Period high",
 * "Period low" and "over N daily bars" from that array. Two renderings of one dataset, which is
 * the shape that has produced every real find here — a basis computed across two clocks inverted
 * its own sign, and a bar table rewrote 200 volume cells on a click.
 *
 * Swept exhaustively once across all 50 symbols and 200 panels (scripts/sweep-charts.mjs): all
 * agreed. This keeps the cheap half in the gate for the contract pages it already renders, so a
 * future divergence fails before it ships rather than at the next manual sweep.
 */
export function chartAgreement(html) {
  const out = [];
  const active = html.match(/data-tfpanel="([^"]+)"[^>]*data-on/);
  if (!active) return out; // no chart on this page — the empty state is checked elsewhere
  let pts = null;
  for (const m of html.matchAll(/<script[^>]*id="pts-([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1] === active[1]) { try { pts = JSON.parse(m[2]); } catch { out.push(`points for ${m[1]} are not parsable JSON`); } }
  }
  if (!Array.isArray(pts) || !pts.length) return out;

  const txt = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  /* THE FIRST NUMBER AFTER THE LABEL, not every digit near it. The first version stripped all
     non-numerics from a 40-character slice — and that slice contains the NEXT figure too, so
     "$97,949.00    Period low $57,768.00" collapsed to "97949.0057768.00" and Number() gave
     NaN. NaN > 0.005 is FALSE, so the comparison did not fail: it silently passed, on every
     symbol. A check that cannot fail is worse than no check, because it is quoted as evidence.
     Found by running the blind case (a page whose figures genuinely agree) and watching this
     report a finding anyway; the same bug in the other direction was hiding the real answer. */
  const first = (v) => { const m = String(v).match(/-?[\d,]+(?:\.\d+)?/); return m ? Number(m[0].replace(/,/g, "")) : null; };
  const grab = (label) => { const i = txt.indexOf(label); return i < 0 ? null : first(txt.slice(i + label.length, i + label.length + 40)); };
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

  const highs = pts.map((p) => p[3]).filter(Number.isFinite);
  const lows = pts.map((p) => p[4]).filter(Number.isFinite);
  if (highs.length) {
    const cH = Math.max(...highs), cL = Math.min(...lows);
    const pHigh = grab("Period high"), pLow = grab("Period low");
    // 0.5% tolerance: the printed figures are rounded for display, the array is not.
    if (pHigh && rel(pHigh, cH) > 0.005) out.push(`"Period high" ${pHigh} but the chart's maximum is ${cH}`);
    if (pLow && rel(pLow, cL) > 0.005) out.push(`"Period low" ${pLow} but the chart's minimum is ${cL}`);
  }
  const bars = txt.match(/over ([\d,]+) (daily|hourly|weekly|4-hour) bars/);
  if (bars && Number(bars[1].replace(/,/g, "")) !== pts.length)
    out.push(`prose says ${bars[1]} bars, the active chart has ${pts.length}`);

  for (const p of pts) {
    const [, , o, h, l, c] = p;
    if (![o, h, l, c].every(Number.isFinite)) { out.push("a candle has non-finite OHLC"); break; }
    if (h < Math.max(o, c) - 1e-9 || l > Math.min(o, c) + 1e-9 || h < l) {
      out.push(`incoherent candle: o=${o} h=${h} l=${l} c=${c}`); break;
    }
  }
  return out;
}
/**
 * A page that computes a tier-correct liquidation price and labels it with the leverage the
 * READER ASKED FOR rather than the one the exchange would allow.
 *
 * src/lib/margin.ts silently clamps a requested leverage to the tier maximum and reports both
 * `effectiveLeverage` and `leverageClamped`. Twice now, a page has ignored them and printed the
 * requested figure beside the clamped number: /funding/[symbol] said "At 10x long" on twenty
 * contracts whose tier caps at 3x or 5x, and /tools/position-size said "Liquidation at 10x
 * $0.01793" for MON, where $0.01793 is the FIVE-times price. Both render perfectly and mislead
 * exactly the reader who is sizing a position.
 *
 * This is the third time one policy has been implemented on two templates and fixed on one —
 * the /coins case guard and two off-origin checks in verify-live were the others. So the
 * invariant is written down instead of remembered: a file that calls liquidationPrice() must
 * use effectiveLeverage. Source-level, because it is a property of the code rather than of any
 * one rendered page, and a page can be correct today and wrong at the next symbol.
 */
export function requestedLeverageLabels(files, read) {
  const out = [];
  for (const f of files) {
    let src;
    try { src = read(f); } catch { continue; }
    if (!/\bliquidationPrice\s*\(/.test(src)) continue;
    /* CLAMP-AWARE BY EITHER ROUTE. The first version demanded `effectiveLeverage` by name and
       flagged /tools/leverage, which is correct: it derives `permitted` from the same tierFor()
       and computes `effective = Math.min(requested, permitted)` itself, so its label already
       matches its number. A check that tests for a variable name rather than a behaviour cries
       wolf, and an alarm that cries wolf is one you stop reading — which is how the real
       instance gets through. What must never happen is a page computing a liquidation price
       while showing the RAW requested leverage with no clamp anywhere. */
    const clampAware = /effectiveLeverage|leverageClamped/.test(src) ||
      (/maxLeverage/.test(src) && /Math\.min\s*\(/.test(src));
    if (!clampAware) out.push(`${f} computes a liquidation price but is unaware of the tier clamp — it will label a clamped number with the requested leverage`);
  }
  return out;
}

/**
 * An inline client script that does not parse.
 *
 * A SyntaxError in an `is:inline` island kills the WHOLE island: no handler binds, and every
 * interaction on the page silently stops working. Nothing else in this repository can see it.
 * The build does not parse these scripts, the smoke gate renders server-side and gets a perfect
 * page, and verify-live fetches HTML rather than executing it — so the gate reports green while
 * the calculator is dead.
 *
 * That is not hypothetical. Adding `const v = ...` to /tools/position-size collided with an
 * existing `v` in the same scope, the island failed to parse, and the calculator stopped
 * recalculating entirely — shipped, green, and found only by opening the browser console.
 *
 * `new Function(body)` compiles without running, which is exactly the question being asked.
 * define:vars names are injected by Astro at runtime, so they are declared into the preamble
 * before parsing; otherwise every island would fail on its own inputs.
 */
export function inlineScriptSyntax(src, file) {
  const out = [];
  /* ATTRIBUTE ORDER IS ARBITRARY, and this regex used to require `is:inline` to come FIRST.
     `<script is:inline define:vars={{x}}>` was parsed; `<script define:vars={{x}} is:inline>`
     was silently skipped — same script, same risk, invisible to the gate depending on how
     someone happened to type it. Nothing in the codebase triggers it today (checked: every
     executable inline script matches either form, and the only tags that do not are
     `type="application/json"` data blocks, which are data and must not be parsed as code).
     A gate whose coverage depends on attribute order is one edit from a blind spot, and the
     defect this whole function exists for — a SyntaxError killing an entire island while the
     server render stays perfect — is exactly the kind nothing else can see. */
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const tag = m[1];
    if (!/\bis:inline\b/.test(tag)) continue;                      // Astro bundles and checks the rest
    if (/\bsrc\s*=/.test(tag)) continue;                           // no body to parse
    if (/type\s*=\s*"application\/(ld\+)?json"/.test(tag)) continue; // data, not code
    const vars = (tag.match(/define:vars=\{\{([^}]*)\}\}/) ?? [, ""])[1]
      .split(",").map((v) => v.split(":")[0].trim()).filter(Boolean);
    const preamble = vars.length ? `let ${vars.join(", ")};` : "";
    try {
      // eslint-disable-next-line no-new-func
      new Function(preamble + m[2]);
    } catch (e) {
      out.push(`${file}: inline script does not parse — ${e.message}`);
    }
  }
  return out;
}

/**
 * THE FLIP FEED: colour discipline, and that the feed rendered at all.
 *
 * Red and green on this site mean the direction of a funding payment and nothing else. The flip
 * table broke that rule in the worst available way: it coloured a rate captured up to 24 hours
 * earlier, so a contract whose direction had since reversed displayed the opposite of the truth
 * in the site's one reserved visual language. Eight of twenty-five rows, measured.
 *
 * The fix moved the colour to the current rate. This asserts it stayed there — colour may appear
 * ONLY in the "Now (APR)" cell. Scoped to the flip tbody on purpose: the same page's "Funding
 * rates by coin" table colours a different column entirely, so a page-wide rule would be wrong.
 *
 * IT ALSO ASSERTS THE TABLE EXISTS, and that matters more than the colour rule. The gate's warm
 * D1 fixture was empty for as long as the flip feed had existed, so readFlips() returned
 * "warming" and the gate rendered a placeholder every single run — meaning the whole table,
 * including the defect above, was only ever exercised in production. A colour check that quietly
 * passes because there are no rows to colour is the exact placebo this repository keeps
 * producing, so an absent table is a FAILURE here rather than a skip.
 */
export function flipTableColour(html) {
  const out = [];
  const start = html.indexOf("Funding sign flips");
  if (start === -1) return ["/ has no \"Funding sign flips\" section"];
  const seg = html.slice(start, html.indexOf("Funding rates by coin", start) >>> 0 || undefined);

  const heads = [...seg.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(seg);
  if (!body) {
    return ["/ flip feed rendered no table — the warm D1 fixture is empty, so this branch is untested (node scripts/seed-smoke-d1.mjs)"];
  }
  const rows = [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  if (!rows.length) return ["/ flip feed table has no rows — nothing to check (seed the warm fixture)"];

  const nowCol = heads.findIndex((h) => /^Now \(APR\)$/.test(h));
  if (nowCol === -1) out.push(`/ flip feed has no "Now (APR)" column; headers are ${heads.join(" | ")}`);

  for (const r of rows) {
    const tds = [...r.matchAll(/<td([^>]*)>/g)].map((m) => m[1]);
    const sym = (/<td[^>]*class="sym"[^>]*>([\s\S]*?)<\/td>/.exec(r)?.[1] ?? "?").replace(/<[^>]*>/g, "").trim();
    tds.forEach((attrs, i) => {
      if (/pays-[ls]\b/.test(attrs) && i !== nowCol) {
        out.push(`/ flip feed colours column ${i} (${heads[i] ?? "?"}) on ${sym} — red/green is reserved for the current rate`);
      }
    });
  }
  return [...new Set(out)];
}

/**
 * TWO COLOUR LANGUAGES, AND THE RULE THAT KEEPS THEM APART.
 *
 * Candles mean price up/down in green and red. Funding means who pays in amber and cyan. Those
 * were the same pair until candles were added, and the site's legend said so on every page:
 * "colour encodes the direction of payment only". Two meanings sharing one pair is the defect;
 * a page showing both without naming both is the same defect one step later.
 *
 * The palettes are READ OUT OF THE SOURCE, never listed here. A checker with its own copy of
 * the hexes is the drifted pair this file exists to catch — change a token, and a transcribed
 * check keeps passing against a colour nobody uses any more.
 *
 * Four things are asserted:
 *   1. the CSS token and the chart ink agree, so a table and a chart band cannot disagree;
 *   2. no candle hue equals a funding hue;
 *   3. a page rendering both languages names both in its legend;
 *   4. a page rendering funding colour names the funding legend at all.
 */
export function colourPalettes(chartSrc, baseSrc) {
  const ink = (k) => new RegExp(`\\b${k}:\\s*"(#[0-9a-fA-F]{6})"`).exec(chartSrc)?.[1] ?? null;
  const tok = (k) => new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{6})`).exec(baseSrc)?.[1] ?? null;
  return {
    candle: { up: ink("up"), down: ink("down") },
    funding: { paysL: ink("paysL"), paysS: ink("paysS") },
    token: { paysL: tok("pays-l"), paysS: tok("pays-s") },
  };
}

export function colourLanguageDrift(p) {
  const out = [];
  const all = [p.candle.up, p.candle.down, p.funding.paysL, p.funding.paysS, p.token.paysL, p.token.paysS];
  if (all.some((v) => !v)) return [`could not read every colour out of the source (${JSON.stringify(p)}) — this check is not looking at anything`];
  if (p.funding.paysL.toLowerCase() !== p.token.paysL.toLowerCase())
    out.push(`chart ink paysL ${p.funding.paysL} and CSS --pays-l ${p.token.paysL} disagree — a table and a chart band would show one meaning in two colours`);
  if (p.funding.paysS.toLowerCase() !== p.token.paysS.toLowerCase())
    out.push(`chart ink paysS ${p.funding.paysS} and CSS --pays-s ${p.token.paysS} disagree`);
  for (const [cn, cv] of Object.entries(p.candle))
    for (const [fn, fv] of Object.entries(p.funding))
      if (cv.toLowerCase() === fv.toLowerCase())
        out.push(`candle ${cn} and funding ${fn} are both ${cv} — one colour cannot carry two meanings`);
  return out;
}

/** Does a page that speaks a colour language explain it? */
export function colourLegend(html, p) {
  const out = [];
  const has = (hex) => html.toLowerCase().includes(hex.toLowerCase());
  const candles = has(p.candle.up) || has(p.candle.down);
  const funding = /class="[^"]*\bpays-[ls]\b/.test(html) || has(p.funding.paysL) || has(p.funding.paysS);
  /* Matched on meaning, not on an exact sentence, so rewording the copy does not fail the
     build — but removing the explanation does. */
  const saysCandle = /candles?\b[^.]{0,120}(green|red)/i.test(html) || /(green|red)[^.]{0,60}candle/i.test(html);
  const saysFunding = /(amber|cyan)[^.]{0,80}(pay|longs|shorts)/i.test(html) || /(longs pay shorts|shorts pay longs)/i.test(html);
  if (candles && !saysCandle) out.push("draws candle colours but never says what green and red mean");
  if (funding && !saysFunding) out.push("shows funding colour but never says what it encodes");
  if (candles && funding && !(saysCandle && saysFunding))
    out.push("shows BOTH colour languages and does not name both");
  return out;
}

/**
 * NO INDIVIDUAL IS PUBLISHED BY THIS SITE.
 *
 * The identity block once carried an operator's real name and a link to their personal
 * code-hosting account, and emitted `founder: { @type: "Person", name }` into the JSON-LD of
 * every page — the most machine-readable way there is to bind a person to a domain, and the
 * form that gets lifted into knowledge panels and training corpora. It was removed at the
 * operator's request.
 *
 * THIS CHECK CONTAINS NO NAMES, DELIBERATELY. The obvious implementation is a denylist of the
 * strings to look for — and this repository is public, so a denylist would republish exactly
 * what it exists to keep out, in a file whose whole purpose is to be read. So it asserts the
 * SHAPE instead: no Person anywhere in the graph, no founder, no author, no personal profile
 * link. That is name-free, and it holds for any person rather than for one.
 */
/**
 * A NAME IS ACCOUNTABILITY. A PERSONAL CONTACT ROUTE IS AN ATTACK SURFACE. THEY ARE NOT THE
 * SAME OBJECT, AND THIS CHECK IS THE LINE BETWEEN THEM.
 *
 * The earlier version of this function forbade `founder` outright, because the policy then was
 * that no person appears anywhere. That policy over-corrected. The harm that prompted it was
 * specific and traceable: a PERSONAL EMAIL ADDRESS in machine-readable commit metadata, read by
 * every scraper that walks a public repository, unwithdrawable once published. A name rendered
 * on an about page is not that. It is the single strongest thing this site can say that an
 * anonymous clone will not — and it costs nothing that can be harvested.
 *
 * So the rule is narrow. A Person may be named. A Person may carry NOTHING ELSE: no email, no
 * url, no sameAs, no telephone, no address, no jobTitle. And no address other than the project
 * contact may appear anywhere in the document, in any surface, whatever it is attached to.
 *
 * The personal-profile rule is unchanged and matched on the SHAPE of a profile URL rather than
 * on any particular handle, so it keeps working for accounts nobody has created yet.
 */
export function publishesAPerson(html, allowedEmail = "hello@coinliqui.com", projectNamespace = "coinliqui") {
  const out = [];
  const NAME_ONLY = new Set(["@type", "name"]);

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { out.push("JSON-LD does not parse, so it cannot be checked for a person"); continue; }
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      if (node["@type"] === "Person") {
        const extra = Object.keys(node).filter((k) => !NAME_ONLY.has(k));
        if (!node.name) out.push(`JSON-LD ${path} is a Person with no name — an entry that identifies nobody has no reason to exist`);
        if (extra.length) out.push(`JSON-LD ${path} is a Person carrying ${extra.map((k) => `"${k}"`).join(", ")} — a name is accountability, anything more is a contact route attached to an individual`);
      }
      /* An individual may be attached ONLY as a plain named founder. */
      for (const k of ["author", "creator", "employee", "owns", "worksFor", "memberOf"]) {
        if (node[k]) out.push(`JSON-LD ${path} carries "${k}" — only a named founder is permitted to attach an individual to this site`);
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(data, "$");
  }

  /* ANY address that is not the project's, anywhere in the document — prose, markup, JSON-LD,
     an attribute, a comment. This is the rule the whole policy rests on, so it is matched on
     the whole page rather than on the places an address is expected. */
  for (const m of html.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
    const addr = m[0].toLowerCase();
    if (addr !== allowedEmail.toLowerCase()) {
      out.push(`the document publishes ${m[0]} — the project address is the only one this site may carry`);
    }
  }

  /* A PROFILE LINK IS JUDGED BY WHOSE NAMESPACE IT IS IN, NOT BY ITS SHAPE.
     The first version matched host + one or two path segments, which is the shape of a personal
     profile AND the shape of the project's own repository. It fired on
     https://github.com/coinliqui/coinliqui the moment that became sameAs — a true positive for
     the pattern and a false one for the policy, which has never been "no code-hosting links" but
     "nothing belonging to a person". The namespace is the thing that distinguishes them. */
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?(?:github|gitlab|twitter|x|linkedin|instagram|t)\.(?:com|me|io)\/([A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_.-]+)?/g)) {
    if (m[1].toLowerCase() === projectNamespace.toLowerCase()) continue;
    out.push(`links an account outside the project namespace: ${m[0]} — sameAs and every other outbound identity link may only point at ${projectNamespace}, never at a person's account`);
  }
  return [...new Set(out)];
}

/**
 * THE NAME ON THE PAGE AND THE NAME IN THE MARKUP MUST BE ONE NAME.
 *
 * Two independent renderings of the same fact, one visible and one not, is the exact shape
 * that has produced every self-contradiction on this site so far. Here it would be worse than
 * cosmetic: a founder in the JSON-LD who is named nowhere a reader can see is a claim made
 * only to machines, which is the definition of the thing this site is trying not to look like.
 */
export function founderAgreement(html) {
  const out = [];
  let ld = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (n.founder && n.founder.name) ld = n.founder.name;
      Object.values(n).forEach(walk);
    };
    walk(data);
  }
  const vis = (html.match(/founded and run by\s*<strong[^>]*>([^<]+)<\/strong>/) || [])[1];
  if (!ld && !vis) return out;
  if (ld && !vis) out.push(`the markup names "${ld}" as founder but no reader can see that name on the page`);
  if (vis && !ld) out.push(`the page names "${vis.trim()}" as founder but the markup does not, so the claim is invisible to anything reading the structured data`);
  if (ld && vis && ld.trim() !== vis.trim()) out.push(`the page names "${vis.trim()}" and the markup names "${ld}"`);
  return out;
}

/**
 * DOES THE GATE'S FIXTURE STILL COVER WHAT THE CODE READS?
 *
 * The warm store is a capture. Every feature added after it reads a key that is not there, so
 * the page renders its "no data" branch, the gate reports green, and the feature is only ever
 * exercised in production. Twice now: the flip feed rendered a placeholder on every gate run
 * for its whole life, and the 15-minute series did the same — `npm run check` never drew a 15m
 * panel until this check existed.
 *
 * The prefixes are DISCOVERED from the source, never listed here. A hardcoded list is a third
 * copy that ages into the same problem: add a series, forget the list, and the check certifies
 * a fixture that cannot render it.
 *
 * It reports prefixes that the code reads and the fixture lacks. It deliberately does NOT
 * complain about the reverse — a fixture holding keys nothing reads is harmless clutter, not a
 * blind spot.
 */
export function fixtureGaps(sources, fixtureKeys) {
  const wanted = new Map();
  for (const [file, src] of sources) {
    /* Template reads of the form kv.get(`prefix:${sym}`) — the shape every per-symbol series
       uses. Bare constant keys ("snapshot", "live") are matched separately below. */
    for (const m of src.matchAll(/\.get\(\s*`([a-z0-9]+):\$\{/gi)) {
      if (!wanted.has(m[1])) wanted.set(m[1], file);
    }
  }
  const have = new Set([...fixtureKeys].map((k) => (k.includes(":") ? k.split(":")[0] : k)));
  const gaps = [];
  for (const [prefix, file] of wanted) {
    if (!have.has(prefix)) gaps.push(`${prefix}:* is read by ${file} and absent from the warm fixture — the gate renders its empty branch and never sees the feature`);
  }
  return gaps.sort();
}

/**
 * A CELL DERIVED FROM A LIVE RATE MUST BE LIVE TOO.
 *
 * The one-minute overlay repaints elements carrying data-spot. It repainted the APR cell and
 * left everything computed FROM that rate at the value the server rendered five minutes
 * earlier, so a row contradicted itself a minute after load. Measured on /coins/bitcoin: one
 * row read 0.90% APR beside $2.30, and $2.30 is the weekly cost of the 1.20% that cell held
 * before the pull — 0.90% gives $1.73.
 *
 * This is the SECOND time two representations of one funding rate have drifted apart: the
 * first was hlApr against the venue array, fixed at the source. This one arrived from the
 * other end, through an overlay rather than a render, which is why fixing the source did not
 * prevent it and why a check is worth more than either fix.
 *
 * It works on the SOURCE rather than the rendered page on purpose — the defect is a missing
 * attribute, and an attribute that is missing produces no evidence in the HTML to find.
 */
export function staleDerivedCells(sources) {
  const out = [];
  for (const [file, src] of sources) {
    /* Rows/blocks that contain a live APR. Split coarsely on the element that carries it and
       look at what follows within the same table row or card. */
    for (const m of src.matchAll(/data-spot=\{?[^}]*?"apr"/g)) {
      const after = src.slice(m.index, m.index + 900);
      const block = after.slice(0, after.search(/<\/tr>|<\/div>\s*<\/div>/) + 1 || 900);
      /* Anything computing from an apr in that block must carry its own data-spot. */
      for (const d of block.matchAll(/<(td|div|span)\b([^>]*)>\{[^}]*?\b(week\(|carryCost\(|aprSpread|\.apr\s*>=\s*0)/g)) {
        if (!/data-spot/.test(d[2])) {
          out.push(`${file}: a cell derived from a live APR carries no data-spot — it will hold the render-time value after the overlay repaints the rate (${d[0].slice(0, 70).replace(/\s+/g, " ")}…)`);
        }
      }
    }
  }
  return [...new Set(out)];
}


/**
 * A PAGE MUST BE ABLE TO EXPLAIN ITS OWN ARITHMETIC.
 *
 * Basis is a subtraction, so both halves have to be read at one instant. The funding template
 * divided a five-minute snapshot mark by a one-minute spot: measured median error 0.4 bps,
 * worst 6.2 bps, and on AVAX it printed +6.0 bps - "perpetual richer than spot" - where the
 * matched-clock value was -0.2 bps. The sign is the entire meaning of the number, so the stale
 * half did not blur it, it inverted it. Nothing caught this, because every value on the page
 * was individually plausible and the client overlay repaired it ~300ms after paint.
 *
 * The invariant that catches it needs no second source: whatever mark and spot a page PRINTS,
 * the basis printed beside them must be the difference between those two.
 *
 * THE TOLERANCE IS NOT A CONSTANT, and the first version of this check got that wrong. Prices
 * are printed to a decimal count chosen from their magnitude, so the half-ulp a reader cannot
 * see is worth a different number of basis points on every coin: 0.005 in $64,000 is 0.0008
 * bps, but 0.0005 in $6.31 is 0.79 bps. A flat threshold tight enough for BTC fires on every
 * cheap coin on a page that is entirely correct - and a check that cries wolf is a check that
 * gets ignored. So the tolerance is derived from the printed precision itself and the real
 * defect still clears it by 4x.
 */
export function basisSelfConsistent(html) {
  const out = [];
  const grab = (re) => {
    const m = html.match(re);
    if (!m) return null;
    const raw = m[1].replace(/[$,\s]/g, "");
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return { v, dp: (raw.split(".")[1] || "").length };
  };
  const mark = grab(/data-spot="mark"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const spot = grab(/data-spot="last"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const basis = grab(/data-spot="basis"[^>]*>\s*([+-]?[\d.]+)/);
  if (!mark || !spot || !basis || spot.v <= 0 || mark.v <= 0) return out;

  const derived = (mark.v / spot.v - 1) * 10_000;
  /* Half of the last printed place on each price, carried into bps, plus half of the basis's
     own last place. Nothing here is a fudge factor - every term is a digit the page withheld. */
  const tol =
    (0.5 * Math.pow(10, -mark.dp)) / mark.v * 10_000 +
    (0.5 * Math.pow(10, -spot.dp)) / spot.v * 10_000 +
    0.5 * Math.pow(10, -basis.dp);

  if (Math.abs(derived - basis.v) > tol) {
    out.push(
      `the basis printed (${basis.v.toFixed(1)} bps) is not the difference between the mark (${mark.v}) and the spot (${spot.v}) printed beside it, which is ${derived.toFixed(1)} bps - a gap of ${Math.abs(derived - basis.v).toFixed(1)} against ${tol.toFixed(2)} bps of display rounding, so one of the three is read off a different clock` +
        ((derived >= 0) !== (basis.v >= 0) ? ", and they disagree on the SIGN" : "")
    );
  }
  return out;
}


/**
 * A URL MAY ONLY CLAIM A COMMIT DATE IF A COMMIT IS THE ONLY THING THAT CHANGES IT.
 *
 * Companion to scripts/sitemap-honesty.mjs, which carries the full account and the blind
 * cases. The discrimination is exact and needs no parsing of the generators: a git date is
 * byte-for-byte the string committed in lastmod.json, while a data stamp is truncated to the
 * hour, so a URL carrying the former is one making a claim about its own source control.
 * If the page behind it reads a live store, that claim is false - the page moves between
 * commits, and a crawler scheduling on the date will not come back for it.
 */
/**
 * READING A LIVE STORE IS A PROXY, AND ONE ROUTE IS THE EXCEPTION THAT PROVES IT COARSE.
 *
 * /data-sources calls getSnapshot, but only for coverage counts - how many contracts clear the
 * floor, how many exist. Those move when a coin crosses the floor, not when the market ticks.
 * Measured the same way the tools were: captured under one snapshot, polled until the store
 * rotated 260s later, diffed with every freshness element stripped. /methodology changed in
 * that window and is now a data route; /data-sources did not. A git date is the honest stamp
 * for it, and an hourly one would waste crawl budget claiming a change that had not happened.
 *
 * An entry here is a claim backed by that measurement, not a way to quiet the check. Anything
 * added without one is the defect this file exists to catch, wearing a different hat.
 */
const LASTMOD_MEASURED_STABLE = new Set(["/data-sources"]);

export function sitemapLastmodHonesty(xmlBody, lastmodTable, liveRoutes) {
  const out = [];
  /* The origin is consumed explicitly. Written as a lazy prefix, the path group captured
     "//coinliqui.com/tools" — the first slash of "https://" — and matched nothing in the table. */
  for (const m of xmlBody.matchAll(/<loc>(?:https?:\/\/[^/<]+)?([^<]*)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
    const [, path, stamp] = m;
    if (lastmodTable[path] !== stamp) continue;
    if (liveRoutes.has(path) && !LASTMOD_MEASURED_STABLE.has(path)) {
      out.push(`${path} carries its git date (${stamp}) but the page reads a live store — it changes without a commit, so the date is a claim the site cannot keep`);
    }
  }
  return out;
}


/**
 * THE BREADCRUMB MARKUP AND THE BREADCRUMB A READER SEES MUST BE THE SAME BREADCRUMB.
 *
 * Structured data that overstates the page is the one kind of markup that can cost more than
 * it earns - it is the basis of a manual action, and the failure is silent, since a graph is
 * invisible to everyone except the crawler acting on it. The trail is printed by each template
 * and the graph is built in the layout from a prop, so the two are one edit away from
 * disagreeing at any time, and nothing in a browser would show it.
 *
 * So: every page that prints a trail must carry a BreadcrumbList saying exactly that trail,
 * every page that carries one must print it, and the link target must match too - a crumb
 * pointing at /funding while the markup names /coins would be worse than no markup.
 */
export function breadcrumbAgreement(html) {
  const out = [];
  /* A noindex page has no search result to shape, so the markup would be dead weight and the
     demand for it noise. /tools/liquidation-price is the live case: it serves 410 Gone and
     still prints its trail, which is right for the reader who followed an old link and wrong
     for a crawler being told to forget the URL. Caught by this check on its first run. */
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
  const vis = html.match(/<p class="crumb"[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*›\s*([^<]+)<\/p>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean)
    .flatMap((j) => (j["@graph"] ?? [j]))
    .find((n) => n && n["@type"] === "BreadcrumbList");

  /* Both halves of one rule. A noindex page is not required to carry markup — /tools/liquidation-price
     rightly keeps its trail while serving 410 Gone — and it is equally not permitted to, which is
     the half the first version of this check left unguarded. */
  if (noindex) {
    if (ld) out.push(`the page is noindex but carries a BreadcrumbList — it has no search result to shape, so the markup is bytes nothing will read`);
    return out;
  }
  if (!vis && !ld) return out;
  if (vis && !ld) { out.push(`the page prints the trail "${vis[2].trim()} › ${vis[3].trim()}" but carries no BreadcrumbList, so a search result shows the raw URL path instead`); return out; }
  if (!vis && ld) { out.push(`the page carries a BreadcrumbList but prints no trail — markup may not claim a position the reader cannot see`); return out; }

  const items = ld.itemListElement ?? [];
  const [parent, current] = [items[0] ?? {}, items[1] ?? {}];
  const wantLabel = vis[2].trim(), wantCurrent = vis[3].trim(), wantHref = vis[1];
  if (items.length !== 2) out.push(`the trail has 2 rungs but the BreadcrumbList has ${items.length}`);
  if (parent.name !== wantLabel) out.push(`the trail reads "${wantLabel}" but the markup names "${parent.name}"`);
  if (current.name !== wantCurrent) out.push(`the trail ends at "${wantCurrent}" but the markup ends at "${current.name}"`);
  if (parent.item && !String(parent.item).endsWith(wantHref)) out.push(`the trail links to ${wantHref} but the markup points at ${parent.item}`);
  return out;
}


/**
 * THE README STATES ITS OWN RULE AND THEN BROKE IT THREE TIMES.
 *
 * "this file deliberately names the constants rather than a count, because the count goes stale
 * here and nothing notices" — and two lines above it said "25 contracts", "25 pages", and
 * "42 URLs across 7". By the time anyone read it the site published 50 contracts across 78
 * sitemap URLs. Nothing noticed, exactly as the file predicted of itself.
 *
 * That matters more once the repository is public, because the README stops being a note to
 * ourselves and becomes the front page a reader uses to decide whether the site's claims can
 * be trusted. A front page whose first checkable fact is wrong answers that question badly.
 *
 * So: no bare count of a thing the code sizes. Named constants, or a live URL, or nothing.
 */
export function readmeCounts(readme) {
  const out = [];
  const patterns = [
    [/\b(\d+)\s+contracts?\b/gi, "contracts"],
    [/\b(\d+)\s+pages\b/gi, "pages"],
    [/\b(\d+)\s+URLs?\s+across\b/gi, "sitemap URLs"],
    [/\b(\d+)\s+coins?\b/gi, "coins"],
    /* Added after both drifted in the published README: "around twenty" checks when there were
       26, and "twenty-four" templates. Word-form numbers count — the file broke its own rule in
       words, not digits, which is exactly how it evaded the first version of this check. */
    [/\b(\d+|twenty|thirty|forty|fifty)[\s-]+(?:of its )?checks\b/gi, "checks"],
    [/\bthan (\d+|twenty-four|twelve|twenty)\b/gi, "templates or files"],
  ];
  for (const [re, what] of patterns) {
    for (const m of readme.matchAll(re)) {
      /* A count inside a quoted upstream fact is a measurement, not a claim about our own size. */
      const around = readme.slice(Math.max(0, m.index - 90), m.index);
      if (/verified|as of|upstream|returned|POST |`\/info/i.test(around)) continue;
      out.push(`README says "${m[0]}" — a bare count of ${what}, which the code sizes and this file's own rule says to name by constant instead`);
    }
  }
  return [...new Set(out)];
}


/**
 * AN EXCLUSION NOBODY CAN EVALUATE IS AN EXCLUSION NOBODY WILL EVER REMOVE.
 *
 * robots.txt carried eight bare strings in a BLOCKED array, under a comment saying that
 * blocking the wrong bot makes the site uncitable. Five of them were wrong on their own terms —
 * Common Crawl among them, on a site whose only problem is that it exists nowhere but itself —
 * and two more were dead tokens the operator had retired, so the site believed it was blocking
 * a reseller it was in fact serving. None of that was discoverable from the file, because none
 * of the entries said why it was there.
 *
 * So an entry now has to carry its reason, in the file, where the next person deciding whether
 * to re-block something will read it.
 */
export function botPolicyReasons(src) {
  const out = [];
  const block = src.match(/const BLOCKED[^=]*=\s*\[([\s\S]*?)\];/);
  const rate = src.match(/const RATE_LIMITED[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) { out.push("robots.txt.ts has no BLOCKED list in the expected shape — the audit cannot see it"); return out; }
  for (const [label, m] of [["blocked", block], ["rate-limited", rate]]) {
    if (!m) continue;
    for (const entry of m[1].split("},")) {
      if (!/ua:/.test(entry)) continue;
      const ua = (entry.match(/ua:\s*"([^"]+)"/) || [])[1] || "?";
      const why = (entry.match(/why:\s*"([^"]*)"/) || [])[1];
      if (!why || why.trim().length < 12) {
        out.push(`${ua} is ${label} with no stated reason — every exclusion must say why, or be removed`);
      }
    }
  }
  /* A bare string list is the shape the audit replaced; catch a regression to it. */
  if (/const BLOCKED\s*=\s*\[\s*"/.test(src)) out.push("BLOCKED has reverted to a bare string list, which is how eight unexamined exclusions survived");
  return out;
}


/**
 * A PAGE MUST NOT STATE TWO CONTRADICTORY THINGS AND HIDE ONE WITH CSS.
 *
 * The freshness pill rendered both of its states into every page — "Updated 4 min ago" and
 * "Not updating" — and hid one with a display rule. A browser showed the right one. Every text
 * extraction took both, so the first lines of the extracted text of /, /about, /unlocks,
 * /funding/btc and /coins/bitcoin read "Updated 4 min ago Not updating", and two independent
 * agents fetching this site to assess whether it was live reported that it was not. On the
 * pages that exist to establish that the data is live.
 *
 * CSS is a rendering instruction, not a redaction. Anything that reads the text layer — a
 * crawler, an answer engine, a screen reader, a reader-mode view — sees through it. So a
 * mutually exclusive pair may not both be present in the markup; whichever is true is the one
 * that gets written, by whichever party is in a position to know.
 */
export function contradictoryStates(html) {
  const out = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const PAIRS = [
    [/\bUpdated\b[^.]{0,40}\bago\b/i, /\bNot updating\b/i, "the age of the data and a claim that it is not updating"],
  ];
  for (const [a, b, what] of PAIRS) {
    if (a.test(text) && b.test(text)) {
      out.push(`the text layer carries both ${what} — one is hidden with CSS, which redacts it from a browser and from nothing else`);
    }
  }
  return out;
}


/**
 * WHERE THE RENDERED TEXT AND THE EXTRACTED TEXT DIVERGE.
 *
 * The freshness pill shipped both of its states into every page and hid one with CSS. A browser
 * showed the right one; every text extractor took both, so all 43 routes told a machine the data
 * was dead, and two agents assessing the site duly reported it. That was found by accident. This
 * finds the rest of the class on purpose.
 *
 * THE DISTINCTION THAT MATTERS, and it is not "is it hidden". Measured in a real browser against
 * production, computing styles element by element:
 *
 *   display:none, visibility:hidden, and the `hidden` attribute
 *       Hidden from sighted readers AND from assistive technology. Nobody is meant to receive
 *       this. It reaches a naive extractor anyway. THIS is the divergence — text present for
 *       machines and for nobody else, which is the definition of the defect.
 *
 *   clip-path: inset(50%), 1px boxes, off-screen positioning
 *       Hidden from sighted readers and ANNOUNCED BY SCREEN READERS. `.vh`, `.freshness__word`
 *       and `.cta__label` are all this pattern, and they are correct: "Search", "Updated",
 *       "Pin coins" are labels a blind reader needs and a sighted one gets from context. An
 *       extractor taking them is receiving what assistive tech receives. NOT a defect, and a
 *       check that flagged these would push someone to delete real accessibility work.
 *
 * So the rule is narrow: text that no human of any kind is meant to receive may not sit in the
 * markup. If a state is conditional, the party that knows the condition writes it.
 *
 * Script and style bodies are excluded — they are data, not text, and every serious extractor
 * strips them. Their SIZE is reported separately by extractionRatio below, because that is a
 * different question with a different answer.
 */
export function hiddenFromEveryone(html) {
  const out = [];

  /* CSS RULES COME FROM <style> BLOCKS, AND THE FIRST VERSION READ THE WHOLE DOCUMENT.
     Scanning every `{...}` in the page meant every JSON data island was parsed as a stylesheet.
     The gate went red on precisely the four routes with the largest islands — /funding,
     /funding/kpepe, /liquidations/survival, /unlocks — reported as "fetch failed", which is
     what this harness prints when a body check throws or hangs rather than when a fetch does.
     It looked like a server problem and was mine. Restricting the scan to <style> is both the
     correct reading of what a stylesheet is and the fix. */
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");

  const hidingClasses = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(;|$)/i.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const classes = [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]);
      if (classes.length) hidingClasses.add(classes[classes.length - 1]);
    }
  }

  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");

  /* OPENING TAGS ONLY, and the text taken by slicing forward rather than by matching a pair.
     Matching `<tag ...>...</tag>` looked equivalent and was not: matchAll yields NON-OVERLAPPING
     matches, so an enclosing <div> swallowed everything inside it and every nested element went
     untested. The real defect — a hidden <button> inside a page-head <div> — was invisible to
     the check while the standalone cases passed, because in those the hidden element was never
     nested. Fault injection through the gate is what caught it; the unit cases could not. */
  for (const m of body.matchAll(/<(\w+)([^>]*)>/g)) {
    const [, tag, attrs] = m;
    const from = m.index + m[0].length;
    const after = body.slice(from, from + 600);
    const close = after.indexOf(`</${tag}>`);
    const inner = close >= 0 ? after.slice(0, close) : after;
    const isHidden = /\bhidden(?=[\s>=])|\bhidden$/.test(attrs);
    const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || "";
    const hidingClass = cls.split(/\s+/).find((c) => hidingClasses.has(c));
    if (!isHidden && !hidingClass) continue;
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push(
      isHidden
        ? `<${tag} hidden> carries the text "${text.slice(0, 60)}" — hidden from sighted readers and from assistive technology alike, so it exists only for whatever reads the markup naively`
        : `.${hidingClass} is hidden by a display/visibility rule but carries the text "${text.slice(0, 60)}" — nobody receives this except a naive extractor`
    );
  }
  return [...new Set(out)];
}

/**
 * HOW MUCH OF THE DOCUMENT IS PROSE, AND HOW MUCH IS EMBEDDED DATA.
 *
 * /funding/btc carries a 15,878-character JSON data island against 3,547 characters of visible
 * prose — four and a half times more machine payload than reading matter. Every serious
 * extractor strips <script>, including the one in this file, so this is NOT counted as hidden
 * text above. But the ratio is worth watching rather than assuming: a page that is mostly
 * embedded numbers is one careless extractor away from reading as a numeric dump, and the
 * number moves whenever a timeframe or a series is added. Reported, not enforced — there is no
 * defensible threshold, and inventing one would be worse than looking at it.
 */
export function extractionRatio(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].reduce((a, m) => a + m[1].length, 0);
  const prose = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  return { scripts, prose, ratio: prose ? +(scripts / prose).toFixed(1) : Infinity };
}


/**
 * THE DATE THE MACHINE LAYER STATES MUST BE THE DATE THE PAGE STATES.
 *
 * dateModified is the one structured-data field a crawler acts on for recrawl scheduling, and
 * the one most easily filled with the request clock — which is what this site's sitemaps did
 * once, giving every URL a modification time equal to the instant of the fetch. Two requests
 * five seconds apart returned two different dates for a page unchanged in days. Here the page
 * already prints its own timestamp in the freshness pill, so the two are checkable against each
 * other and there is no excuse for them to differ.
 */
export function dateModifiedAgreement(html) {
  const out = [];
  const pill = (html.match(/data-fresh="(\d+)"/) || [])[1];
  let ld = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (n.dateModified) ld = n.dateModified;
      Object.values(n).forEach(walk);
    };
    walk(j);
  }
  /* A noindex page has no search result to schedule a recrawl for, so the field is not owed —
     the same rule the breadcrumb check settled. /watchlist is the live case. */
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) return out;
  if (!pill && !ld) return out;
  if (pill && !ld) out.push("the page prints a freshness timestamp but the structured data carries no dateModified — the age is stated to readers and withheld from every machine");
  /* dateModified WITHOUT a live pill is not a contradiction. /liquidations/sweep publishes a
     frozen dataset: it deliberately shows no "updated N min ago", and the date the underlying
     data was captured is exactly what dateModified is for. Demanding a live pill there would
     be demanding the page pretend to be live, which is the opposite of the point. */
  if (pill && ld) {
    const a = Number(pill), b = Date.parse(ld);
    if (!Number.isFinite(b) || Math.abs(a - b) > 1000) {
      out.push(`the pill says ${new Date(a).toISOString()} and dateModified says ${ld} — one of them is not the snapshot`);
    }
  }
  return out;
}
