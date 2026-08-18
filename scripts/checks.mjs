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
      if (!tok[t] || !tok[s]) { out.push(`${t} or ${s} is not a hex token in the built CSS`); continue; }
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
export function publishesAPerson(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { out.push("JSON-LD does not parse, so it cannot be checked for a person"); continue; }
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      if (node["@type"] === "Person") out.push(`JSON-LD ${path} is a Person${node.name ? ` named "${node.name}"` : ""}`);
      for (const k of ["founder", "author", "creator", "employee", "owns"]) {
        if (node[k]) out.push(`JSON-LD ${path} carries "${k}" — an individual attached to the site`);
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(data, "$");
  }
  /* A personal profile link is the same exposure without the schema. Matched on the shape of a
     user profile URL — host plus a single path segment — rather than on any particular handle. */
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?(?:github|gitlab|twitter|x|linkedin|instagram|t)\.(?:com|me|io)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?/g)) {
    out.push(`links a personal profile: ${m[0]}`);
  }
  return [...new Set(out)];
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
 * The invariant that does catch it needs no second source: whatever mark and spot a page
 * PRINTS, the basis it prints beside them must be the difference between those two. If the
 * numerator comes off a different clock, the printed numbers stop reconciling and this fails.
 * Tolerance is display rounding only - the prices are shown to `dp` places, which at the worst
 * price magnitude on the site is under 0.01 bps of slack; 0.2 leaves room and still catches a
 * one-minute drift, the smallest mismatch the architecture can produce.
 */
export function basisSelfConsistent(html) {
  const out = [];
  const num = (re) => {
    const m = html.match(re);
    if (!m) return null;
    const v = Number(m[1].replace(/[$,\s]/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  const mark = num(/data-spot="mark"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const spot = num(/data-spot="last"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const basis = num(/data-spot="basis"[^>]*>\s*([+-]?[\d.]+)/);
  if (mark == null || spot == null || basis == null || spot <= 0) return out;
  const derived = (mark / spot - 1) * 10_000;
  if (Math.abs(derived - basis) > 0.2) {
    out.push(
      `the basis printed (${basis.toFixed(1)} bps) is not the difference between the mark (${mark}) and the spot (${spot}) printed beside it, which is ${derived.toFixed(1)} bps - one of the three is read off a different clock` +
        ((derived >= 0) !== (basis >= 0) ? ", and they disagree on the SIGN" : "")
    );
  }
  return out;
}
