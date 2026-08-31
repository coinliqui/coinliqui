import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
const brotli = (html) => {
  try {
    return brotliCompressSync(Buffer.from(html), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  } catch { return null; }
};

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
/* WHICH EXPORTS ARE MEASUREMENTS RATHER THAN CHECKS.
   A check returns a list of findings and can therefore be made to fire; a measurement returns a
   value and "did it fire" is not a question about it. Both scripts that count this suite need
   the distinction, and both used to carry their own copy — one of them as a hardcoded 25, which
   went stale the moment a check was added and printed "30 of 25 ... -5 still unfalsified".
   Declared here, beside the functions, so adding one is a decision instead of an accident. */
export const MEASUREMENT_EXPORTS = ["pageWeight", "colourPalettes"];

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
/**
 * AN INLINE ELEMENT THE COMPILER INVENTED, AND THE HALF-PAGE IT PUTS IN THE WRONG TYPEFACE.
 *
 * Found by looking at /privacy on a phone: everything from the cookie table down was rendering
 * in monospace. Not a paint artefact — computed `font-family: ui-monospace` on eight elements,
 * on desktop and mobile alike, on the live site. Half of two pages had been wrong since the
 * markup was written and no check could see it, because every check asked about the markup we
 * wrote and this markup was not ours.
 *
 * WHAT THE COMPILER DOES. Given an `{expression}` as the only child of an inline element inside
 * a table cell — `<td><code>{PINNED_KEY}</code></td>` — @astrojs/compiler loses track of the
 * open `<code>` and emits two more: one wrapping the next whitespace text node, and one left
 * OPEN after the enclosing `</div>`. Tag counts stay balanced, so a balance check passes. The
 * browser closes the stray one at the end of its container, and every element in between
 * inherits the monospace. Reproduced from the compiler alone in three scoped-style modes, and
 * narrowed to a nine-line fixture:
 *
 *     <table><tbody><tr><td><code>{K}</code></td></tr></tbody></table>
 *     <p>after</p>                          <-- monospace
 *
 * `<code set:text={K} />` compiles clean and renders identically, which is the fix. But the fix
 * is not the point: the point is that this class is invisible to every assertion about markup
 * we authored, so it has to be asserted about markup we RECEIVE. Hence a check on the rendered
 * HTML rather than a lint on the templates.
 *
 * TWO SIGNATURES, because the bug has two halves and either can appear alone:
 *   - an inline formatting element whose entire content is whitespace. Nobody writes that.
 *   - an inline formatting element still open when a block-level element starts inside it.
 *
 * Deliberately NOT a general well-formedness check. Parsing HTML with regular expressions to
 * prove it is well formed is a worse idea than the bug; these are two narrow signatures of one
 * observed defect, and both were confirmed against the two real pages before being written.
 */
/**
 * AN ATTRIBUTE THAT RENDERS AND IS NOT VALID.
 *
 * Found in a browser console: 131 identical SVG errors on one coin page, "rect attribute rx:
 * Unexpected end of attribute. Expected length". Every candle body on every chart carried
 * `rx=""`, and on the wide-candle timeframes `rx=" rx="1""` — quotes closing early and the
 * remainder becoming stray attributes. One character wrong in src/lib/series.ts, shipped from
 * the day hollow candles were written, on every coin page and every timeframe.
 *
 * WHY NOTHING CAUGHT IT. The picture was correct. Browsers recover from bad attributes by
 * ignoring them, and the intended effect on narrow candles was no rounding, which is exactly
 * what ignoring the attribute produces. So the page looked right, the check that reads the
 * chart's DATA passed, and the only evidence was a console the checks never open. This is the
 * phantom-`<code>` lesson again: markup can be wrong in ways the rendered result does not show.
 *
 * TWO SIGNATURES:
 *   - a geometry attribute with an empty value. Every one of these takes a length; none of
 *     them means anything empty, and the browser errors on each.
 *   - a value containing an `attr="` sequence, which only happens when a fragment meant for
 *     insertion between attributes is interpolated inside one.
 *
 * Deliberately narrow. This is not an SVG validator; it is the two shapes actually observed.
 */
/**
 * A CLAIM ABOUT WHAT SOMEBODY ELSE PERMITS, WITH NOTHING BEHIND IT.
 *
 * /data-sources said "Coinbase Exchange ... permits display with attribution" — a legal
 * conclusion about a third party, in this site's own voice, on the one page whose entire
 * purpose is that every claim can be checked against a primary source. It was deleted. It came
 * straight back, because it had never been ONE sentence: the same assertion was also rendered
 * on /coins, and the root copy sat in the header comment of src/lib/coins.ts, which is the
 * decision record every future edit to the spot layer reads first. Deleting instances of a
 * sentence that has a root is how you get it twice.
 *
 * So this reads SOURCE, not rendered HTML. A claim in a comment has not reached a reader yet
 * and is exactly where the next rendered copy comes from.
 *
 * THE RULE, and it is deliberately easy to satisfy: a sentence that says what a named third
 * party permits, forbids or licenses must either
 *   (a) carry a URL in the same breath — the primary document, so a reader can check it; or
 *   (b) say out loud that we have not verified it — "unknown", "unverified", "uncited", "never
 *       cited", "could not read", "403". An honest admission of ignorance is a complete answer
 *       and costs nothing; what is banned is the confident uncited assertion.
 * There is no allowlist and no marker to add. Both escapes are things you would want written
 * anyway, which is the property that keeps a check from being routed around.
 *
 * It fires on restrictive claims as well as permissive ones, and that is not an oversight.
 * A restrictive claim is still an assertion about a document we may not have read, it is still
 * unfalsifiable to a reader, and this project got one of them wrong in the other direction:
 * the same file asserted OKX was an "internal fallback" when no OKX request has ever existed
 * in the codebase.
 */
/**
 * A CADENCE THIS PAGE PROMISES AND NOTHING CHECKS.
 *
 * Three page families printed "The mark and the funding update every minute", "Funding updates
 * every minute", "Mark price and funding update every minute" — server-rendered, unconditional,
 * next to an honest timestamp. The timestamp said what happened; the sentence made a promise
 * about what keeps happening, and nothing verified it. When the one-minute cron stops, those
 * pages assert a cadence beside a figure that last moved hours ago, in the extracted text an AI
 * crawler lifts verbatim.
 *
 * THE SITE HAD ALREADY FIXED THE MIRROR IMAGE. The client-side "Not updating" note was moved out
 * of server-rendered HTML precisely because a machine reading the page was told both that it had
 * updated four minutes ago and that it was not updating. Same contradiction, other direction.
 *
 * WHY IT IS A CHECK AND NOT JUST A FIX. Since 19 August 2026 the site has ONE upstream. Every way
 * Hyperliquid can fail — outage, rate limit, a response shape that will not parse, an IP block on
 * Cloudflare egress — reaches the reader identically: KV keeps the last good value and the pages
 * go quietly stale, with no second source whose disagreement would reveal it. The age is the only
 * signal there is, so a sentence that contradicts the age is the whole failure.
 *
 * THE RULE: a present-tense claim that data "updates every X" must come from an expression, not
 * from literal template text. src/lib/freshness.ts supplies it and stops making it when the
 * clocks say otherwise. Deliberately narrow — it matches the promise form only, so the
 * explanatory "refreshed every two hours" in an empty-state panel, and prose describing how the
 * pipeline works, are left alone.
 */
export function unconditionalCadenceClaims(sources) {
  const out = [];
  const CADENCE = /\b(updates?|refreshes?)\s+every\s+(minute|second|hour|day|\d+\s*(?:s|m|h|min|minutes?|hours?)|two hours|five minutes|ten minutes|fifteen minutes)\b/gi;
  for (const [file, src] of sources) {
    /* Template body only. A claim inside a JS/JSX comment has not reached a reader, and the
       comments in this repo quote the defect they fixed — flagging those would make the check
       fire on its own documentation, which is how a check gets switched off. */
    /* Comments are gone before this sees the file — scripts/lib/source.mjs. This used to carry
       three replaces of its own, which is the habit that let the same defect land three times
       in one session. Only the frontmatter strip is this check's own business: it is code, not
       comment, and a cadence sentence in it has not reached a reader. */
    const body = src.replace(/^---[\s\S]*?^---/m, "");
    for (const m of body.matchAll(CADENCE)) {
      /* Inside an interpolation the sentence is a value, which is the whole point — freshness()
         decides whether to say it. Walk back to the nearest unbalanced brace to tell. */
      const before = body.slice(Math.max(0, m.index - 600), m.index);
      const opens = (before.match(/\{/g) ?? []).length, closes = (before.match(/\}/g) ?? []).length;
      if (opens > closes) continue;
      out.push(`${file}: promises that data "${m[0]}" as literal text — a cadence claim must come from freshness() so it stops when the clocks do`);
    }
  }
  return out;
}

const VENDORS = ["coinbase", "okx", "coingecko", "binance", "bybit", "hyperliquid", "defillama",
                 "publicnode", "drpc", "1rpc", "kraken", "bitfinex"];
/* A PERMISSION VERB IS NOT ENOUGH ON ITS OWN, and the first version of this check proved it:
   23 hits, 19 of them false. "the Cloudflare grant carries browser (write)" is about our OAuth
   token; "verify-live permitted one named Google host" is about our own CSP; "every crawler's
   action must be Allow" is a robots.txt directive. All three are permissions and none is a claim
   about somebody else's LICENCE. So a hit needs a permission verb AND a licence-context noun in
   the same sentence — the noun is what makes it a statement about a legal instrument rather than
   about a config file. Cloudflare and Google left the vendor list for the same reason: we publish
   no figure from either, so a sentence naming them is about infrastructure, not about data we
   display. Precision matters more than reach here: a check that cries wolf nineteen times out of
   twenty-three is a check somebody turns off. */
const PERMISSION = /\b(permits?|permitted|permission|forbids?|forbidden|prohibits?|prohibited|licen[cs]e[ds]?|licensing|non-commercial|noncommercial|free to use|may be used|grants? (?:us|the right|permission))\b/i;
const LICENCE_CONTEXT = /\b(terms|agreement|licen[cs]e|licensing|copyright|attribution|non-commercial|noncommercial|redistribut\w*|republish\w*|display\w*|publish\w*)\b/i;
const CITED = /https?:\/\/\S+/;
/* Two complete escapes, both of them things worth writing anyway.
   DISCLAIMED: saying out loud that we have not verified it. An admission of ignorance is a full
   answer — what this check bans is the confident uncited assertion, not the honest unknown.
   CONDITIONAL: "if their terms turn out to permit it" asserts nothing about what they say. The
   reversal note in api/live.json.ts is exactly that shape and must not be flagged; it is the
   model the rest of the repo is being held to. */
const DISCLAIMED = /\b(unknown|unverified|uncited|not cited|never cited|could not read|unreadable|unread|403|no confirmed right|makes? no claim|we make no claim|still open|have not read|did not read)\b/i;
const CONDITIONAL = /\b(if|whether|turns? out|would|may well|should they|assuming)\b/i;

export function uncitedPermissionClaims(sources) {
  const out = [];
  for (const [file, src] of sources) {
    /* Sentence-ish windows. Splitting on hard stops keeps a citation two paragraphs away from
       rescuing a claim it has nothing to do with, which is the failure mode of a whole-file
       search — and a whole-file search would have passed src/lib/coins.ts, because that file is
       full of URLs elsewhere. */
    for (const sentence of src.split(/(?<=[.!?])\s+|\n\s*\n/)) {
      if (!PERMISSION.test(sentence) || !LICENCE_CONTEXT.test(sentence)) continue;
      const named = VENDORS.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(sentence));
      if (!named.length) continue;
      if (CITED.test(sentence) || DISCLAIMED.test(sentence) || CONDITIONAL.test(sentence)) continue;
      out.push(`${file}: says what ${named.join("/")} permits or forbids, with no URL and no admission that it is unverified — "${sentence.trim().replace(/\s+/g, " ").slice(0, 120)}…"`);
    }
  }
  return out;
}

const GEOMETRY_ATTRS = ["x", "y", "rx", "ry", "cx", "cy", "r", "width", "height", "x1", "y1", "x2", "y2", "stroke-width", "offset"];

export function malformedAttributes(html) {
  const out = [];
  for (const a of GEOMETRY_ATTRS) {
    const n = [...html.matchAll(new RegExp(`\\s${a}=""`, "g"))].length;
    if (n) out.push(`${n} element(s) carry ${a}="" — that attribute takes a length and an empty one is invalid`);
  }
  /* A quoted value that itself contains `name="`. Restricted to the geometry set so a legitimate
     value carrying an equals sign (a URL in href, JSON in a data- attribute) cannot trip it. */
  for (const a of GEOMETRY_ATTRS) {
    for (const m of html.matchAll(new RegExp(`\\s${a}="[^"]*\\s[a-zA-Z-]+="`, "g"))) {
      out.push(`${a} contains a nested attribute — a fragment was interpolated as a value: ${m[0].slice(0, 48)}…`);
      break;
    }
  }
  return out;
}

const INLINE_INVENTED = ["code", "b", "i", "em", "strong", "kbd", "samp", "small"];
const BLOCK_AFTER = ["p", "div", "table", "tbody", "thead", "tr", "td", "th", "h1", "h2", "h3", "section", "ul", "ol", "li"];

export function phantomInlineElements(html) {
  const out = [];
  for (const tag of INLINE_INVENTED) {
    /* Empty or whitespace-only. `\s*` rather than `\s+`: the compiler emits the phantom with a
       newline inside it, and the deploy pipeline collapses that to nothing, so the same defect
       arrives as `<code></code>` in production and `<code>\n  </code>` from the compiler. The
       first version of this required at least one whitespace character and therefore missed the
       live pages entirely while matching the compiler output — a check that fires on the fixture
       and not on the site. */
    for (const m of html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>(\\s*)</${tag}>`, "g"))) {
      const at = html.slice(Math.max(0, m.index - 60), m.index).replace(/\s+/g, " ").slice(-58);
      out.push(`<${tag}> wrapping ${m[1].length ? "nothing but whitespace" : "nothing at all"}, after "…${at}"`);
    }
    /* Still open when a block element starts. Scan from each opening tag to its own close and
       fail if a block tag arrives first — that is the stray, not a nesting style choice. */
    for (const m of html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g"))) {
      const rest = html.slice(m.index + m[0].length);
      const close = rest.search(new RegExp(`</${tag}>`));
      const block = rest.search(new RegExp(`<(?:${BLOCK_AFTER.join("|")})(?:\\s|>)`, "i"));
      if (block !== -1 && (close === -1 || block < close)) {
        const what = rest.slice(block, block + 24).replace(/\s+/g, " ");
        out.push(`<${tag}> is still open when "${what}" begins — the rest of its container inherits its styling`);
      }
    }
  }
  return [...new Set(out)];
}

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

/**
 * ONE RULE, ONE IMPLEMENTATION — CHECKED BY COUNTING, NOT BY COMPARING.
 *
 * THIS REPLACED formatterDrift, AND THE REASON IT REPLACED IT IS THE FINDING. That check took
 * public/interact.js and a `SERVER_FORMATTERS` object in scripts/smoke.mjs and swept a magnitude
 * ladder through both. It worked — it caught the toFixed(1)/toFixed(2) split that rewrote 200
 * volume cells on a click. But SERVER_FORMATTERS was a hand-written copy of the rules living in
 * the test harness, so the check compared the client against a FOURTH implementation rather than
 * against the server's. Three copies were being kept in step by comparing two of them to a
 * fourth.
 *
 * Comparison is the wrong tool for this shape. Five defects on this project have been one fact
 * implemented twice and evaluated at different moments — the quantity formatter, compactUsd, the
 * SQL-versus-JS gapMin rounding, the age ladder in three places, and the crosshair saying "longs
 * paying shorts" where every other surface said "longs pay shorts". Each was fixed by aligning
 * the copies, and aligning copies is how you get the next one.
 *
 * So the rules moved to public/shared.js, which the Astro build, the esbuild worker bundle and
 * the browser all read as the same bytes, and this asserts the property that keeps it true:
 * each named rule is DEFINED exactly once in the repository. A re-export is not a definition; a
 * second `function usd(` or `const pct = (` anywhere is.
 *
 * Deliberately not a general duplicate-code detector. It is a named list, because the value is
 * in the naming: each entry is a rule that has already drifted or that renders on both sides of
 * hydration, and adding to the list is a decision somebody makes on purpose.
 */
const SHARED_RULES = ["paysClass", "paysLabel", "paysArrow", "carryCost", "aprSpread", "pct",
                      "changeWords", "ageWords", "minutesSince", "nf", "qty", "compact", "usd"];

export function duplicateRuleImplementations(sources) {
  const out = [];
  for (const rule of SHARED_RULES) {
    const defs = [];
    for (const [file, src] of sources) {
      /* A re-export names the symbol without defining it, and is the whole point of the design —
         funding.ts and chart.ts both do it so callers keep their import paths. */
      const body = src.replace(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, "");
      const patterns = [
        new RegExp(`\\bfunction\\s+${rule}\\s*\\(`),
        new RegExp(`\\bconst\\s+${rule}\\s*[:=][^=]*[=(]`),
        new RegExp(`\\blet\\s+${rule}\\s*=`),
      ];
      if (patterns.some((re) => re.test(body))) defs.push(file);
    }
    if (defs.length > 1) {
      out.push(`${rule} is implemented ${defs.length} times — ${defs.join(", ")}. One fact, one implementation; see public/shared.js`);
    } else if (defs.length === 0) {
      /* A rule that vanished is as broken as a rule that doubled, and it would otherwise read as
         a pass. This check must not be able to report green by looking at nothing. */
      out.push(`${rule} is not defined anywhere — the shared source has lost a rule this check is meant to guard`);
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
  /* A ROUTE IS A PATH AND THE GATE ASKS FOR URLS. Several entries in ROUTES carry a query,
     because the query is what selects the branch worth rendering — /retired?symbol=FET&at=…
     is the only way to reach the retirement page at all. Compared as raw strings, those
     entries matched nothing and the route read as uncovered while the gate was requesting it
     every run. The same shape as a link counter that dropped every href with a "?" in it,
     found the same day: the query belongs to the request, not to the route. */
  const paths = routes.map((x) => x.split("?")[0]);
  const covered = (r) => {
    if (paths.includes(r)) return true;
    if (!r.includes("[")) return false;
    // /funding/[symbol] is covered by /funding/btc
    const re = new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "$");
    return paths.some((x) => re.test(x));
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
    /* A GATE THAT DIES IS WORSE THAN ONE THAT REPORTS. Destructuring a non-array element threw a
       TypeError and took the whole smoke pass down with it — found by writing a fixture with the
       points as objects instead of tuples. The input is first-party today, so this is latent
       rather than live, but the failure mode of a shape change should be a finding rather than a
       crash: a crash names the checker, a finding names the page. */
    if (!Array.isArray(p)) { out.push(`a chart point is ${typeof p}, not a [t, ?, o, h, l, c] tuple`); break; }
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
    /* A MODULE IS NOT A CLASSIC SCRIPT, and this parsed every inline script as one.
       `new Function` compiles a function BODY, where top-level await is a syntax error — so the
       first `<script is:inline type="module">` on the site failed the gate for using a feature
       that is legal in exactly the context it declares. The check was right that the code did
       not parse; it was parsing it as the wrong kind of thing.
       Wrapping a module body in an async arrow legalises top-level await, which is the whole
       difference that matters here. What it still cannot see is a top-level `import`/`export`
       DECLARATION — illegal inside any function body — so one of those would be reported as a
       parse failure. That is a false alarm rather than a blind spot, it names itself clearly in
       the message, and the site's one inline module uses dynamic import() deliberately: the
       asset version has to travel in the URL, which a static specifier cannot carry. */
    const isModule = /type\s*=\s*"module"/.test(tag);
    const body = isModule ? `(async () => {\n${m[2]}\n});` : m[2];
    try {
      // eslint-disable-next-line no-new-func
      new Function(preamble + body);
    } catch (e) {
      const hint = isModule && /^(import|export)\b/m.test(m[2])
        ? " (parsed as a module body; a top-level import/export declaration cannot be checked this way — use dynamic import())"
        : "";
      out.push(`${file}: inline script does not parse — ${e.message}${hint}`);
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
 *
 * IT USED TO SEE ONE SYNTAX OUT OF THREE, AND SAID OTHERWISE. The only pattern matched was
 * `.get(`prefix:${...}`)` — the shape a per-symbol series uses — and a comment beside it claimed
 * "bare constant keys ("snapshot", "live") are matched separately below", which nothing did.
 * The line it printed on success read *"the warm fixture covers every KV series the code reads"*.
 * That is a name asserting something the value does not measure: `kv.get("flips:24h")` and
 * `kv.get(REACH_KEY)` were both invisible to it, and a maintainer reading the green line would
 * have believed the opposite. Found while adding a KV-backed identity claim whose absence from
 * the fixture this check would have certified as fine.
 *
 * Three read shapes now, and the message names what was searched: a template-literal prefix, a
 * bare quoted key, and a module constant assigned a string literal in the same file. The INPUT
 * widened too — it read only src/lib, so anything a page or a layout reads directly was outside
 * it. The worker stays out on purpose: the gate does not render the worker, so a key only the
 * worker reads is not a fixture gap.
 */
/**
 * WHICH OF THE TWO HALVES IS BEHIND, WHEN THE WORKER STAMP AND THE SITE DISAGREE.
 *
 * verify-live section 16 compared the deployed stamp against the one the SITE expects and
 * reported every difference as `worker bundle stale`. Two conditions, one message, and the
 * likelier one is the other: deploy:site runs verify-live immediately after `wrangler pages
 * deploy` with no wait, so a request can still reach the previous Pages version. Measured on
 * 24 August: it reported "deployed 8df809eceb41, expected 9be2e398a920", and the same check
 * passed forty-five seconds later with nothing changed — 8df809eceb41 was the NEW stamp and
 * the site had not propagated. The message told the operator to run deploy:worker, which was
 * the one thing already done.
 *
 * The local build-stamp separates them: if the deployed worker matches the source tree, the
 * worker is right and the site is the lagging half.
 *
 * Extracted from the inline form so all three verdicts can be exercised. Two of them had never
 * run — a three-branch decision with one tested branch is the shape this whole pass removes.
 */
/**
 * `tickRan` IS THE FOURTH INPUT AND IT SEPARATES TWO STATES THAT LOOKED IDENTICAL.
 *
 * The worker records its build in KV inside the FIVE-MINUTE ingest tick — the minute tick
 * returns before reaching that write. Both callers polled for 150 seconds and then declared
 * the worker stale, and the comment in scripts/stamp-skew.mjs says why the number is 150:
 * "the tick runs once a minute". It does not. So 150 seconds is not two and a half chances,
 * it is half of one, and the check was built to fail whenever the next tick happened to be
 * more than 150s away — about half of all deploys. It did exactly that twice on
 * 27 August 2026, on a worker that was fine.
 *
 * The fix is not a bigger number. A bigger number trades a false red for a slow deploy and
 * still says the wrong thing when it fires. What the check could not do was tell these apart:
 *
 *     the tick has not run yet          the worker is current, the cron simply has not fired
 *     the tick ran, the stamp is old    a real skew, and the message is right
 *
 * So the caller establishes whether a cycle completed — the site publishes `dateModified`
 * from the same `fetchedAt` that tick writes — and passes it here. `tickRan` defaults to true
 * so a caller that cannot observe it gets exactly the old behaviour rather than a silent
 * downgrade to "probably fine".
 *
 * ORDER MATTERS: `site-behind` is decided BEFORE `awaiting-tick`. If the deployed stamp equals
 * the local source then the worker is current and the SITE is the stale half, which is a real
 * finding about deploy order and has nothing to do with cron timing.
 */
export function stampVerdict(deployed, expects, local, tickRan = true) {
  if (deployed === expects) return { state: "current", stamp: deployed };
  if (local && deployed === local) return { state: "site-behind", deployed, expects };
  if (!tickRan) return { state: "awaiting-tick", deployed, expects, local: local ?? null };
  return { state: "worker-stale", deployed, expects, local: local ?? null };
}

export function fixtureGaps(sources, fixtureKeys, constantSources = []) {
  const wanted = new Map();
  const note = (key, file) => {
    const prefix = key.includes(":") ? key.split(":")[0] : key;
    if (prefix && !wanted.has(prefix)) wanted.set(prefix, file);
  };
  /* WHAT MAKES A `.get` A KV READ, and it is not the receiver's name.
     Widening the syntax first produced twenty-nine prefixes of which most were
     `searchParams.get("tf")`, `cookies.get("rail")` and `headers.get("referer")` — a check with
     more exemptions than findings, which is the shape this repository has already had to unpick
     once. The input is narrowed instead: a KV read passes a TYPE as its second argument and
     every other `.get` in this codebase takes one. That is syntactic, needs no list of receiver
     names, and cannot be defeated by renaming a variable. */
  const TYPE = String.raw`\s*,\s*["'](?:json|text|arrayBuffer|stream)["']`;
  /* 4. THE CONSTANT DECLARED IN A FILE THE READER IMPORTS FROM, which case 3 below cannot see.
        /status reads `indexnow:state` as `SNAPSHOT.get(STATE_KEY, "json")`, and STATE_KEY is
        exported by worker/indexnow.ts — the announcer that WRITES the key. That is the shape
        case 3's own comment calls "the normal way to share a key between its reader and its
        writer", resolved only when both ends are in one file. The site's only account-free
        announcement channel was therefore read on a page with no fixture coverage, and the
        success line said all eleven prefixes were covered.
        Names are matched globally rather than per import statement: these are SCREAMING_CASE
        key constants, a collision would still name a real key, and parsing import specifiers
        to be more precise buys nothing this check can use.

        `constantSources` is a SEPARATE input rather than more entries in `sources`, and that
        distinction is the whole care in this change. The worker declares the constants but is
        not on the render path: folding it into `sources` would also collect every key the
        CRON reads — published:retired, funding:rot, index:history — and demand them of a
        fixture that exists to render pages. A check that fails on keys nobody renders is a
        check somebody switches off. */
  const exported = new Map();
  for (const [, src] of [...sources, ...constantSources]) {
    for (const m of src.matchAll(/\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*["']([A-Za-z0-9_:.-]+)["']/g)) exported.set(m[1], m[2]);
  }
  for (const [file, src] of sources) {
    /* 1. kv.get(`prefix:${sym}`, "json") — every per-symbol series. */
    for (const m of src.matchAll(new RegExp(String.raw`\.get\(\s*\x60([a-z0-9]+):\$\{[^\x60]*\x60` + TYPE, "gi"))) note(m[1], file);
    /* 2. kv.get("snapshot", "json") — a literal key, with or without a prefix. */
    for (const m of src.matchAll(new RegExp(String.raw`\.get\(\s*["']([A-Za-z0-9_:.-]+)["']` + TYPE, "g"))) note(m[1], file);
    /* 3. kv.get(REACH_KEY, "json") where REACH_KEY is a string literal declared in this file.
          A constant is the normal way to share a key between its reader and its writer, so
          treating it as unreadable would leave exactly the keys most likely to be shared
          unchecked — which is how the identity claim got in. */
    const consts = new Map();
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*["']([A-Za-z0-9_:.-]+)["']/g)) consts.set(m[1], m[2]);
    for (const m of src.matchAll(new RegExp(String.raw`\.get\(\s*([A-Z][A-Z0-9_]*)` + TYPE, "g"))) {
      const lit = consts.get(m[1]) ?? exported.get(m[1]);
      if (lit) note(lit, file);
    }
  }
  const have = new Set([...fixtureKeys].map((k) => (k.includes(":") ? k.split(":")[0] : k)));
  const gaps = [];
  for (const [prefix, file] of wanted) {
    if (!have.has(prefix)) gaps.push(`${prefix}:* is read by ${file} and absent from the warm fixture — the gate renders its empty branch and never sees the feature`);
  }
  return { gaps: gaps.sort(), searched: wanted.size };
}

/**
 * A CELL DERIVED FROM A LIVE RATE MUST BE LIVE TOO.
 *
 * The one-minute overlay repaints elements carrying data-repaint. It repainted the APR cell and
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
    for (const m of src.matchAll(/data-repaint=\{?[^}]*?"apr"/g)) {
      const after = src.slice(m.index, m.index + 900);
      const block = after.slice(0, after.search(/<\/tr>|<\/div>\s*<\/div>/) + 1 || 900);
      /* Anything computing from an apr in that block must carry its own data-repaint. */
      for (const d of block.matchAll(/<(td|div|span)\b([^>]*)>\{[^}]*?\b(week\(|carryCost\(|aprSpread|\.apr\s*>=\s*0)/g)) {
        if (!/data-repaint/.test(d[2])) {
          out.push(`${file}: a cell derived from a live APR carries no data-repaint — it will hold the render-time value after the overlay repaints the rate (${d[0].slice(0, 70).replace(/\s+/g, " ")}…)`);
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
  const mark = grab(/data-repaint="mark"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const spot = grab(/data-repaint="last"[^>]*>\s*\$?([\d,]+\.?\d*)/);
  const basis = grab(/data-repaint="basis"[^>]*>\s*([+-]?[\d.]+)/);
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
 * ONE URL, TWO PUBLIC ANSWERS TO "WHEN DID THIS CHANGE", AND NOTHING COMPARED THEM.
 *
 * Every indexable page here states when it last changed twice, to the same audience, on two
 * different surfaces: <lastmod> in its sitemap and dateModified in its own structured data.
 * Two checks already guarded one surface each — sitemapLastmodHonesty asks whether a git date
 * is defensible, dateModifiedAgreement asks whether the page's own pill and its own JSON-LD
 * match — and neither could see across.
 *
 * So /data-sources published a git date of 20 August in the sitemap and a dateModified of an
 * hour ago on the page, every hour, for a week. Both of its own checks were green: the sitemap
 * date is defensible (the page was measured and does not move with the market, which is why it
 * carries an explicit exemption), and the pill matched the JSON-LD. The disagreement lived
 * exactly in the gap between the two instruments, which is where this kind of defect always
 * lives, and the direction was the expensive one — the page claimed to be fresher than the
 * sitemap said, so a crawler comparing them learns this host's lastmod is not to be trusted.
 *
 * THE TOLERANCE IS NOT ONE NUMBER, for the same reason sitemapLastmodHonesty's discriminator is
 * not: a git date is byte-for-byte the string in lastmod.json and must match exactly, while a
 * data stamp is deliberately truncated to the hour, so the page's exact instant is the same
 * claim as the sitemap's floored one. Two hours of slack on the data side covers a snapshot
 * rotating between the two fetches of a single smoke run; anything wider is two answers.
 */
export function stampSurfacesAgree(rows, lastmodTable = {}) {
  const out = [];
  for (const { path, lastmod, dateModified } of rows) {
    if (!lastmod || !dateModified) continue;
    const a = Date.parse(lastmod), b = Date.parse(dateModified);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const isGitDate = lastmodTable[path] === lastmod;
    if (isGitDate) {
      if (lastmod !== dateModified) {
        out.push(`${path}: the sitemap publishes the commit date ${lastmod} and the page's own structured data publishes ${dateModified} — two public answers to one question, and the page is the one overclaiming`);
      }
    } else if (Math.abs(b - a) >= 2 * 3_600_000) {
      out.push(`${path}: sitemap lastmod ${lastmod} and page dateModified ${dateModified} are ${Math.round(Math.abs(b - a) / 3_600_000)}h apart — a data stamp is floored to the hour, not to the day`);
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
 * strips them. Their SIZE is reported separately by pageWeight below, because that is a
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
 * text above.
 *
 * AND IT WAS MEASURING THE WRONG THING, IN A FILE THAT NEVER CALLED IT.
 *
 * Two faults, found together. The function existed, was exported, was cited by the comment
 * above as the authority on payload size — and was invoked from nowhere. A grep across the
 * repository returns the definition and that one comment. It had never run.
 *
 * It would also have been blind if it had. It counted <script> against prose, and scripts are
 * not where this site's weight is. Measured live across all 79 URLs: /liquidations/survival is
 * 524,790 bytes of which 479,013 — 91% — is inline <svg>, while its scripts are 4,133 bytes,
 * 0.8%. The old ratio on that page reports about 0.7 and passes, with nine tenths of the page
 * outside its view. /liquidations is 90% svg, and every coin page is about 60%.
 *
 * So it counts ALL non-prose bytes by kind and names the dominant one. The useful unit turned
 * out to be bytes of HTML per word of prose — what a crawler or an answer engine must download
 * to obtain one word it can cite. That distribution across the site is bimodal and tight:
 *
 *   min 18 · p25 82 · median 83 · p75 85 · p90 183 · p95 186 · max 495
 *
 * 83 for the funding and prose pages, ~183 for the coin pages (60% svg), and two outliers:
 * /liquidations 290 and /liquidations/survival 495. Both are heatmaps — a vector graphic IS
 * what those pages are for, and failing them would be demanding they stop being heatmaps. Both
 * also carry a real text table beside the picture (110 rows on survival, 38 on the hub), so
 * they remain citable. The ratio is reported, not gated, for exactly the reason the old comment
 * gave: there is no defensible threshold for it, and inventing one would be worse.
 *
 * WHAT IS GATED IS BREAKAGE, NOT TASTE, and both limits sit roughly 2× from today's extreme in
 * the direction that means a bug rather than a decision:
 *
 *   total > 1 MB          the largest page is 525 KB. A data page reaching a megabyte has a
 *                         runaway series or a duplicated graphic, not a design.
 *   prose < 150 words     the thinnest page is /tools at 224. Falling under 150 means a section
 *                         rendered empty, which is how a page silently loses its content while
 *                         still returning 200.
 */
export function pageWeight(html) {
  const chunk = (re) => [...html.matchAll(re)].reduce((a, m) => a + m[0].length, 0);
  const svg = chunk(/<svg[\s\S]*?<\/svg>/gi);
  const script = chunk(/<script\b[\s\S]*?<\/script>/gi);
  const style = chunk(/<style\b[\s\S]*?<\/style>/gi);
  const template = chunk(/<template\b[\s\S]*?<\/template>/gi);
  const prose = html
    .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = prose ? prose.split(" ").filter(Boolean).length : 0;
  const nonProse = svg + script + style + template;
  const kinds = { svg, script, style, template };
  const dominant = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0];
  return {
    total: html.length,
    words,
    nonProse,
    kinds,
    /** Which kind carries the most bytes, and what share of the page it is. */
    dominant: { kind: dominant[0], bytes: dominant[1], pct: html.length ? +(dominant[1] / html.length * 100).toFixed(1) : 0 },
    /** Bytes a fetcher downloads per word of citable text. Reported, never gated. */
    bytesPerWord: words ? Math.round(html.length / words) : Infinity,
    /**
     * WHAT A READER ACTUALLY DOWNLOADS, WHICH IS NOT `total`.
     *
     * Every figure above is uncompressed, and the gate printed them under the heading "page
     * weight": "523,042B, svg 91.4%" for /liquidations/survival. Anybody reading that would
     * conclude the page is half a megabyte. Measured on production, 27 August 2026:
     *
     *     page                     uncompressed   over the wire
     *     /liquidations/survival        527,309          24,417     21.6x
     *     /liquidations                 328,008          44,796      7.3x
     *     /liquidations/eth             305,356          42,605      7.2x
     *     /                              39,246           6,694      5.9x
     *
     * The heatmap grid is enormously repetitive, so brotli crushes it. The heaviest page on
     * this site costs a reader 45 KB. That is not a page-weight problem, and the number that
     * said it might be was the wrong number — the same label-over-a-different-value shape this
     * file exists to catch, in this file's own output.
     *
     * ESTIMATED, AND SAID SO. This is local brotli at quality 5, not Cloudflare's edge. Against
     * the four rows above it lands 8-25% under the wire figure, so it understates rather than
     * flatters. It is a scale, not a contract: it turns "half a megabyte" into "tens of
     * kilobytes", which is the distinction anybody reading this line needs.
     */
    wireBytes: brotli(html),
  };
}

/* THE ONLY IMPORT IN THIS FILE, and the first version of it was `require("node:zlib")` inside
   a try — which in an ES module is not a lazy import, it is a ReferenceError caught and
   swallowed. wireBytes came back null on every page and weightFaults quietly fell back to the
   uncompressed size, so the check would have kept its old behaviour while its comment claimed
   otherwise. Caught by running it once and printing the number instead of trusting the catch. */

/** The two conditions that mean breakage rather than a design choice. See pageWeight above. */
export const WEIGHT_LIMITS = {
  /* 300 KB over the wire. The heaviest page here costs 45 KB, so this is a ceiling against
     breakage rather than a budget to spend — the same intent the 1 MB uncompressed figure had
     before it turned out to be measuring something a reader never pays. */
  maxWireBytes: 300_000,
  minWords: 150,
};

/** Returns the reasons this page breaches a limit — empty when it does not. */
export function weightFaults(w, limits = WEIGHT_LIMITS) {
  const out = [];
  /* THE LIMIT IS ON WHAT A READER DOWNLOADS, and it used to be on the uncompressed size. On
     this site those differ by up to 21x, so the old ceiling was effectively 48 KB of real
     transfer on the pages that matter — a limit nobody chose. It falls back to `total` when
     zlib is unavailable, which is the conservative direction. */
  const paid = w.wireBytes ?? w.total;
  if (paid > limits.maxWireBytes) out.push(`${paid.toLocaleString()} bytes over the wire exceeds ${limits.maxWireBytes.toLocaleString()} — ${w.dominant.kind} is ${w.dominant.pct}% of the uncompressed ${w.total.toLocaleString()}`);
  if (w.words < limits.minWords) out.push(`${w.words} words of prose is under ${limits.minWords} — a section probably rendered empty`);
  return out;
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
  /* EQUALITY WAS THE WRONG RULE, AND IT TOOK A SECOND INSTRUMENT TO SHOW IT.
     This demanded the pill and dateModified be the same instant, on the premise that they are
     two renderings of one fact. They are not: the pill is how fresh the NUMBERS are, and
     dateModified is when the DOCUMENT changed. On /unlocks those genuinely differ — the amounts
     are valued at live prices and move hourly, while the register they describe is verified by
     hand and dated by its own stamp, which is also what that URL's sitemap publishes. Equality
     here forced the page to publish a document date it does not believe, and that is how its
     structured data came to disagree with its own sitemap by days.

     THE PILL IS NOT THE RIGHT REFERENCE AT ALL. Once the two are different facts, comparing
     them answers nothing — a document older than its data is the ordinary case on /unlocks and
     /liquidations/sweep, and a document NEWER than its data is only suspicious because it is
     heading somewhere that is genuinely wrong: the future. That is the crisp rule. A
     dateModified ahead of render time is a recrawl a crawler will make and find nothing for,
     and it is the only shape here that cannot be defended by any page.

     The other two halves of this check are unchanged and were always right: a page that tells
     readers an age must tell machines one too, and the value must be a date. Whether the
     document date agrees with the SITEMAP's copy of it is a different question, asked across
     two surfaces this function only sees one of — stampSurfacesAgree() asks it. */
  if (ld) {
    const b = Date.parse(ld);
    if (!Number.isFinite(b)) {
      out.push(`dateModified is not a date this page can be scheduled on: "${ld}"`);
    } else if (b - Date.now() > 60_000) {
      out.push(`dateModified says ${ld}, which is in the future — a recrawl scheduled on it finds nothing changed`);
    }
  }
  return out;
}

/**
 * A CALCULATOR'S PROSE MUST MOVE WITH ITS CARDS.
 *
 * The tools pages render every figure server-side and let an inline script repaint it on input.
 * That works while every figure carries an id the script writes. Where one does not, the card
 * updates and the sentence beside it keeps its first-byte value, and the page then states two
 * different numbers for the same quantity in the same eyeful.
 *
 * Observed in the browser on the deployed /tools/position-size, 20 August 2026: leverage 5 → 60
 * repainted the liquidation card and left the sentence reading "At 5× the exchange closes this
 * position at $111,358.02" — a price only 60× produces. The benign branch was quieter and
 * worse: "the loss is bounded by the $250.00 you budgeted" never moved when Account or Risk
 * did, so the single number that card exists to promise was the stalest thing on the page.
 *
 * THE RULE. Inside an element carrying a `data-when` branch — the verdict prose — every Astro
 * interpolation must sit directly inside a tag with an id. Not "should"; there is no figure in
 * a verdict that does not derive from a form input, so a bare interpolation there is frozen by
 * construction. `{" "}` is whitespace and `{/* … *␣/}` is a comment; neither is a figure.
 *
 * Scoped to data-when rather than to the whole page on purpose: headings, labels and the
 * explanatory sections below are genuinely static, and a page-wide rule would be noise.
 */
export function staleCalculatorFigures(sources) {
  const out = [];
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/<(\w+)\s+data-when="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
      const branch = m[2];
      const when = /data-when="([^"]*)"/.exec(m[0])[1];
      for (const i of branch.matchAll(/\{/g)) {
        const rest = branch.slice(i.index);
        /* `{" "}` is a spacer and `{/* … *␣/}` is a comment. Since the reader strips comments
           before this runs, an Astro comment arrives as `{}` — empty braces, which would
           otherwise read as a figure with no id. All three are absences, not figures. */
        if (/^\{"\s*"\}/.test(rest) || /^\{\/\*/.test(rest) || /^\{\s*\}/.test(rest)) continue;
        /* What sits between the previous `>` and this `{`. Only whitespace means the
           interpolation is the first child of that tag, so the tag's attributes decide. */
        const before = branch.slice(0, i.index);
        const gt = before.lastIndexOf(">");
        const lt = before.lastIndexOf("<");
        if (lt > gt) continue;                       // inside an attribute, not a text node
        if (before.slice(gt + 1).trim() !== "") {
          out.push(`${file}: a figure in the "${when}" branch is bare text — ${rest.slice(0, 46).replace(/\s+/g, " ")}… will hold its first-byte value while the cards repaint`);
          continue;
        }
        const openTag = before.slice(before.lastIndexOf("<", gt), gt + 1);
        if (!/\bid=/.test(openTag)) {
          out.push(`${file}: a figure in the "${when}" branch has no id — ${openTag.trim()}${rest.slice(0, 34).replace(/\s+/g, " ")}… will hold its first-byte value while the cards repaint`);
        }
      }
    }
  }
  return [...new Set(out)];
}

/**
 * A SET OF OPTIONS A READER CANNOT SEE IS A SET OF OPTIONS THEY DO NOT HAVE.
 *
 * Measured on the live site at innerWidth 371 — an ordinary phone — the eight-button timeframe
 * group was 442px wide with `flex-wrap: nowrap` and `overflow-x: visible`. 1W sat at x=366 and
 * 1M at x=420: both past the right edge, with no scrollbar, no fade and no affordance. The
 * document scrolled sideways instead, 472px against a 371px viewport, on all sixty chart pages.
 * The last button a reader could reach was 1D, which is also the default — so the page read as
 * though it had one timeframe.
 *
 * The cause was a correct fix. The mobile block widens each pill to a 44px touch target, which
 * is right, and made the row 71px too long, which nothing measured.
 *
 * REACHABILITY IS ITS OWN PROPERTY, and markup is where it is invisible: those buttons were
 * present, correct, labelled and wired. It is invisible to a fetcher, invisible at desktop
 * width, and visible only to somebody holding a phone. This is a floor; the proof is the
 * phone-width pass in README.md.
 *
 * WHAT IT ASSERTS, AND WHY IT IS NOT "EVERY FLEX ROW". The first version of this asked every
 * flex rule in the stylesheet to wrap or be exempted, and fired on ten of them — .btn, .verdict,
 * .empty, .nav-item, the topbar clusters. Every one was a fixed arrangement of two or three
 * children that cannot grow, so the finding was noise and the fix would have been a longer
 * exemption list than finding list. A check like that gets turned off, which this file already
 * says in another comment and which I then did anyway.
 *
 * The property that actually matters is narrower and is a fact about the MARKUP, not the CSS: a
 * container whose children are produced by a `.map()` holds a number of controls that nobody
 * chose. The timeframe group has gone from six buttons to eight this year. So the input is read
 * from the templates — every container that renders a variable-length list of buttons or links —
 * and each one's CSS rule must wrap or scroll. Add a new such row anywhere and it is covered
 * without touching this function.
 */
export function controlGroupOverflow(css, sources = []) {
  const out = [];
  /* Already stripped by the reader; kept as a local name for what follows. */
  const bare = css;
  /* Containers whose controls are generated rather than written out one by one. */
  const generated = new Map();
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/<(\w+)[^>]*\bclass="([^"{]+)"[^>]*>([\s\S]{0,600}?)<\/\1>/g)) {
      const body = m[3];
      if (!/\.map\(/.test(body)) continue;
      if (!/<(button|a)\b/.test(body)) continue;
      for (const cls of m[2].trim().split(/\s+/)) {
        if (!generated.has(cls)) generated.set(cls, { file, own: src });
      }
    }
  }
  for (const [cls, entry] of generated) {
    const { file, own } = entry;
    /* THE RULE MAY BE IN EITHER PLACE. Most live in the layout's stylesheet; a page with its own
       <style> block styles its own containers, and looking only at the layout reported those as
       "no rule in the stylesheet" — an instrument saying it cannot see rather than a finding. */
    /* THE SELECTOR MAY BE ELEMENT-QUALIFIED, and until this allowed for that the check reported
       a styled class as unstyled. `.tbl` is declared `table.tbl { ... }` in the layout, so the
       lookup missed it and the message asserted "no rule in either the layout stylesheet or its
       own page" about a rule sitting fifty lines up in the file it had just read. The finding
       fired on the first new page whose generated table happened to be short enough to match —
       the failure was not that the page changed, it was that the instrument could not see. The
       message named one thing and the value measured another, which is the class this project
       has been sweeping for; a check that cannot distinguish "no rule" from "no rule I can
       parse" produces the confident kind of wrong finding. */
    const find = (text) => new RegExp(`(^|[},])\\s*(?:[a-zA-Z][\\w-]*)?\\.${cls}\\s*\\{([^}]*)\\}`, "m").exec(text);
    const rule = find(bare) ?? find(own);
    if (!rule) { out.push(`\`.${cls}\` in ${file} renders a variable number of controls and has no rule in either the layout stylesheet or its own page — nothing here can say whether it wraps`); continue; }
    const body = rule[2];
    /* A non-flex container wraps by default; only a flex row queues its children off the edge. */
    if (!/display:\s*(inline-)?flex/.test(body)) continue;
    if (/flex-direction:\s*column/.test(body)) continue;
    if (/flex-wrap:\s*wrap/.test(body)) continue;
    if (/overflow-x:\s*(auto|scroll)/.test(body)) continue;
    out.push(`\`.${cls}\` (${file}) is a flex row holding a generated list of controls, and it neither wraps nor scrolls — on a narrow screen its last options fall off the edge of the page, and the page scrolls sideways instead of the row`);
  }
  return out;
}


/**
 * A PAGE THAT CHANGES WHEN A PARAMETER CHANGES, AT A URL THAT SAYS IT DOES NOT.
 *
 * `/liquidations` rendered fifty complete contract pages — its own <title>, <h1>, chart and
 * every figure per contract — and published all fifty at one URL, because Base builds the
 * canonical tag from the pathname alone. Forty-nine finished pages therefore instructed every
 * crawler to discard them. They were in no sitemap, announced to no index, and reachable only
 * by submitting a <select>, which nothing that crawls does. Search Console had the demand the
 * whole time: seven coin-named liquidation-map queries in the week to 22 August 2026, against
 * a template with one URL.
 *
 * WHAT THIS DECIDES AND WHAT IT DOES NOT. Whether fifty renderings deserve fifty URLs is a
 * judgement about whether the content earns an index entry — the calculators say no on purpose,
 * because fifty near-identical calculator pages is the thin-page rule broken deliberately. So
 * this does not pick the verdict. It fails when a route varies and NO verdict is recorded,
 * which is the state /liquidations was in for its whole life, and when a recorded verdict no
 * longer matches what the route does.
 *
 * `observed` is gathered by probing, not by reading source: a static analysis would have to
 * decide from the text of a .astro file whether `title` transitively depends on a search
 * parameter, and that is the kind of question that is answered wrongly once and then trusted.
 * Two GETs answer it exactly — bare, and with a second real contract named.
 *
 *   observed  [{ path, redirect: string|null, identityVaries: boolean, canonicalQuery: string }]
 *             `identityVaries` is <title> OR <meta name="description"> — the two tags a search
 *             result is built from, and therefore the two claims the canonical URL is making.
 *             It is NOT the <h1>: a calculator naming the selected contract in its heading is
 *             the page talking to the reader in front of it. The field was called titleVaries
 *             while it already meant both, which is the same label-asserting-more-than-the-
 *             expression-computes defect this file exists to catch, one level up.
 *   declared  [{ path, verdict: "addressed" | "parameter-only", why }]
 */
export function symbolAddressing(observed, declared) {
  const out = [];
  const byPath = new Map(declared.map((e) => [e.path, e]));
  const seen = new Set();
  for (const o of observed) {
    const e = byPath.get(o.path);
    if (o.redirect) {
      /* It canonicalises, which is the only form of "addressed" confirmable from outside: a
         200 carrying a per-contract title IS the defect. */
      seen.add(o.path);
      if (!e) out.push(`${o.path} redirects ?symbol= to ${o.redirect} but is not in SYMBOL_PARAMETERISED`);
      else if (e.verdict !== "addressed") out.push(`${o.path} is recorded "${e.verdict}" but redirects ?symbol= to ${o.redirect} — the record is stale`);
      continue;
    }
    if (!o.identityVaries) {
      /* A record for a route that no longer varies is a record nobody will re-read, and it
         will be cited later as evidence that the question was settled. */
      if (e) out.push(`${o.path} is in SYMBOL_PARAMETERISED but does not vary by ?symbol= — remove the entry or fix the route`);
      continue;
    }
    seen.add(o.path);
    if (!e) {
      out.push(`${o.path} renders a different <title> or meta description for ?symbol= at the same canonical URL, and is not in SYMBOL_PARAMETERISED`);
      continue;
    }
    if (e.verdict === "addressed") out.push(`${o.path} is recorded "addressed" but still answers 200 with per-contract metadata at ?symbol= — the redirect is gone`);
    /* A parameter-only page is one URL for every value, so the tag naming that URL must not
       carry the value. Base strips the query today; if it ever stopped, each of these would
       become fifty self-canonicalising copies of itself in a single deploy. */
    else if (o.canonicalQuery) out.push(`${o.path} is recorded "parameter-only" but its canonical carries the query (${o.canonicalQuery})`);
  }
  /* A declared route that was never probed is a route the gate is not covering, and the entry
     is describing something nobody measured. */
  for (const e of declared) {
    if (!seen.has(e.path) && !observed.some((o) => o.path === e.path)) {
      out.push(`${e.path} is in SYMBOL_PARAMETERISED but was not probed — add it to ROUTES so the verdict is measured`);
    }
  }
  return out;
}

/**
 * THE ANNOUNCER'S STATE FILE, AGAINST WHAT THE SITE ACTUALLY PUBLISHES.
 *
 * WHAT THIS WAS WRITTEN FOR, measured 27 August 2026. The ingest Worker keeps its IndexNow
 * state under `indexnow:state`; it used to be `indexnow:submitted`, and after the rename it
 * writes only the new key and reads the old one solely as a fallback. scripts/indexnow-drain.mjs
 * — the escape hatch that delivers the backlog from a non-Cloudflare address when Microsoft's
 * two endpoints throttle the Worker — was never updated. It still read the LEGACY key.
 *
 * The two had drifted a long way:
 *
 *     indexnow:state       133 URLs known, 58 owed to each Microsoft endpoint, last
 *                          accepted 2026-08-27 11:32 UTC, all 49 liquidation maps present
 *     indexnow:submitted    79 URLs known,  4 owed, nothing ever accepted,
 *                          zero liquidation maps, zero /learn pages
 *
 * So running the drain would have posted FOUR URLs — none of them the ones actually owed —
 * written the 79-URL state back to a key the Worker never reads, and printed "cleared 2
 * endpoint(s); 0 still owed. State written." A green line for a drain that delivered nothing
 * that was owed and reset no backoff. The endpoint would keep refusing the Worker, the operator
 * would believe the backlog was cleared, and nothing anywhere would say otherwise.
 *
 * The structural half of the fix is that the drain now imports STATE_KEY from the Worker, so it
 * cannot name a different key. This is the other half, and it is the one that survives the next
 * rename: whatever key it read, the state it holds must know about the URLs the site publishes.
 * A state file that has never heard of a template is stale whatever the cause — wrong key, a
 * partial write, a namespace restored from backup.
 *
 *   known      the announcer's recorded URL set
 *   published  what the site publishes right now
 */
export function staleAnnouncerState(known, published) {
  const out = [];
  const have = new Set(known ?? []);
  const missing = (published ?? []).filter((u) => !have.has(u));
  if (!missing.length) return out;
  /* Grouped by path prefix rather than listed flat: fifty missing URLs from one template is a
     template the state has never seen, and fifty separate lines say that fifty times without
     saying it once. */
  const byTemplate = new Map();
  for (const u of missing) {
    let seg;
    try { seg = new URL(u).pathname.split("/").filter(Boolean)[0] ?? "/"; } catch { seg = u; }
    byTemplate.set(seg, (byTemplate.get(seg) ?? 0) + 1);
  }
  out.push(
    `the announcer's state is missing ${missing.length} of the ${(published ?? []).length} URL(s) this site publishes` +
    ` — ${[...byTemplate.entries()].map(([t, n]) => `${n}x /${t}`).join(", ")}`,
  );
  return out;
}

/**
 * A PUBLISHED URL THAT ALMOST NOTHING LINKS TO.
 *
 * THE MEASUREMENT THIS EXISTS FOR is already in this repository, taken 24 August 2026 on the
 * contract pages and written above the ticker-chip strip in src/pages/funding/[symbol].astro:
 *
 *     indexed contract pages     (39)   median 50 inbound
 *     NOT indexed                (10)   median  3
 *     eight of the ten Google has not indexed sit at 2-4 inbound links
 *
 * Links are not sufficient — /funding/zro and /funding/vvv carry 50 apiece and are still
 * queued — but a page in that band is a page nothing is pointing at, and on 27 August the
 * forty-nine liquidation maps shipped into it: two inbound links each, from the hub and from
 * one sibling. Nobody noticed for half a day, because nothing was counting.
 *
 * THE FLOOR IS 5, and it is not a round number. It is one above the band where eight of the
 * ten unindexed pages sat. Below it means "in the range this site has already watched fail".
 *
 * WHAT IT FIRES ON TODAY: nothing, with one exemption. That is the honest description, and it
 * is not a reason to drop it — this is a REGRESSION GUARD, not a discovery tool. The defect
 * was found by hand, the fix took the template from 2 to 50, and the check is what stops the
 * next template shipping at 2. Its blind case proves it can fire.
 *
 * THE EXEMPTION IS THE HOMEPAGE and it is structural rather than an excuse. Every page links
 * "/" from the brand in the nav rail, which is chrome; contextual inbound to a site's own root
 * is 0 by nature and always will be.
 *
 *   counts  Map or object of path -> number of DISTINCT pages linking to it, contextually
 */
export function underLinked(counts, floor = 5, exempt = ["/"]) {
  const rows = counts instanceof Map ? [...counts] : Object.entries(counts ?? {});
  return rows
    .filter(([p, n]) => !exempt.includes(p) && n < floor)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([p, n]) => `${p} has ${n} contextual inbound link(s), below the floor of ${floor}`);
}

/**
 * TWO URLS TELLING A SEARCH ENGINE THEY ARE THE SAME DOCUMENT.
 *
 * A duplicate <title> or meta description across two published URLs is one of the few things
 * that will keep a page out of an index on its own: the crawler has fetched two addresses and
 * been handed the same claim about what they are, and it picks one. This site is built almost
 * entirely out of templates that interpolate a symbol, so the failure mode is not sloppiness —
 * it is a template whose variable stops varying. /liquidations spent its whole life rendering
 * fifty different titles at one URL; the mirror of that is one title at fifty URLs, and
 * nothing here would have noticed it either.
 *
 * SWEPT 27 AUGUST 2026 ACROSS ALL 133 PUBLISHED URLS: zero duplicate titles, zero duplicate
 * descriptions, zero duplicate h1s, none missing. So this fires on nothing today and has no
 * exemptions — a regression guard, like underLinked(), and the honest description of it is
 * that it is cheap rather than that it is finding things.
 *
 * TITLE LENGTH IS DELIBERATELY NOT CHECKED. Fifteen titles run past the ~65 characters Google
 * will show, and every one of them carries its query terms in the first thirty: what gets cut
 * is the tail and the " | Coinliqui" suffix. A rule firing on fifteen correct pages to report
 * a cosmetic truncation is the shape this repository turns off within a week — see the
 * rejected-checks note in scripts/check-blind-cases.mjs for the two that were measured and
 * dropped for exactly that reason.
 *
 *   rows  [{ path, title, description }]
 */
export function duplicateHeadMetadata(rows) {
  const out = [];
  for (const [field, label] of [["title", "<title>"], ["description", "meta description"]]) {
    const seen = new Map();
    for (const r of rows ?? []) {
      const v = (r?.[field] ?? "").trim();
      if (!v) { out.push(`${r?.path} has no ${label}`); continue; }
      seen.set(v, [...(seen.get(v) ?? []), r.path]);
    }
    for (const [v, ps] of seen) {
      if (ps.length > 1) out.push(`${ps.length} URLs share one ${label} — ${ps.join(", ")} — "${v.slice(0, 60)}"`);
    }
  }
  return out;
}

/**
 * A TEMPLATE THAT PRODUCES MANY URLS MUST COMPUTE SOMETHING ON EACH OF THEM.
 *
 * WHY THIS EXISTS. On 27 August 2026 this site shipped forty-nine `/liquidations/{symbol}`
 * pages in one day, with 62% five-gram overlap between any two siblings. That is the exact
 * shape Google's scaled-content-abuse policy is aimed at, and the policy is method-agnostic:
 * it does not ask how the pages were made, it asks whether each one carries real value that
 * the others do not. The sanction lands on the domain, not the page.
 *
 * I argued at the time that each map page carries its own heatmap, its own cluster table and
 * its own swept-bars section — that it is a COMPUTATION PER ENTITY rather than a variable
 * substituted into a template. I still think that is true. It was also an argument rather than
 * a measurement, made after the pages had shipped, and this file exists because arguments made
 * after shipping are the ones this repository keeps having to unpick.
 *
 * WHAT COUNTS, AND WHY IT IS A LIST RATHER THAN A HEURISTIC. The discriminating question is
 * not "does this page have numbers" — every page has numbers, and most of them are upstream's.
 * It is whether the page publishes figures UPSTREAM DOES NOT SUPPLY. Hyperliquid gives a mark,
 * an open interest, a raw funding rate and a tier table; it does not give an APR normalised
 * across settlement intervals, a venue spread, a tier-correct liquidation price, a maintenance
 * margin fraction, a corridor, a modelled liquidation surface or a survival counterfactual.
 * Which functions cross that line is a judgement, so it is written down and dated rather than
 * inferred from a name, and every entry says what upstream is missing.
 *
 * CHART PAINTING AND NUMBER FORMATTING ARE DELIBERATELY EXCLUDED. buildPriceChart, paintHeatMap
 * and rawRate present a figure; they do not produce one. Counting them would let a page pass
 * this floor by drawing upstream's numbers prettily, which is the thing the floor is for.
 *
 * ONLY MULTI-INSTANCE TEMPLATES ARE HELD TO IT. A singleton like /about or /methodology cannot
 * be a scaled-content problem — there is one of it. The rule is scoped by the shape of the
 * route, `[param].astro`, so nothing has to be added to a list when a template ships.
 */
export const COMPUTED_FIGURES = [
  ["toApr", "a raw per-interval funding rate normalised to APR — venues publish the rate, not the annualisation, and the interval differs per venue"],
  ["aprSpread", "the gap between two venues' annualised funding on the same contract — nobody publishes it because it spans providers"],
  ["nextSettlement", "the next funding settlement, CORRECTED: Hyperliquid's own nextFundingTime sits in the past on every contract"],
  ["maintenanceMarginFraction", "maintenance margin at a tier — the venue publishes tiers and max leverage, not the fraction"],
  ["liquidationPrice", "a tier-correct liquidation price, which no venue publishes for a hypothetical position"],
  ["naiveLiquidationPrice", "the formula in general circulation, computed alongside the correct one so the gap between them is visible"],
  ["nextTierBoundary", "the notional at which maintenance margin steps, derived from the table"],
  ["corridorAt", "how far price must travel before a position at a given leverage is closed"],
  ["mixUsed", "the leverage weights renormalised over the rungs this contract's cap leaves in play"],
  ["buildLiqMap", "the modelled liquidation density surface: clusters, swept notional, clipped share — no venue publishes position distribution"],
  ["survivalGrid", "the counterfactual: which leveraged entries the rules would have closed, over the real price path"],
  ["aggregate", "the candle series resampled to a timeframe the venue does not serve"],
  ["fundingByBar", "funding aligned to the bars of a chart, which arrives as an unaligned series"],
  ["carryCost", "what holding a position costs over a horizon at that venue's own settlement cadence"],
];

/**
 * `templates` is [{ route, sources: [source, ...] }] — the template plus every component it
 * renders, because a route that delegates its whole body to a component computes through it.
 * `exportsByFile` maps a lib filename to its exported names, so a registry entry that no longer
 * exists fails here rather than silently counting nothing.
 */
export function computedFigureFloor(templates, exportsByFile = {}, floor = 3, registry = COMPUTED_FIGURES) {
  const out = [];
  const known = new Set(Object.values(exportsByFile).flat());
  if (known.size) {
    const gone = registry.map(([fn]) => fn).filter((fn) => !known.has(fn));
    /* A REGISTRY ENTRY THAT NO LONGER EXISTS COUNTS NOTHING AND SAYS NOTHING, which is how a
       floor quietly stops being a floor. It is a failure, not a warning. */
    if (gone.length) out.push(`COMPUTED_FIGURES names ${gone.length} function(s) src/lib no longer exports: ${gone.join(", ")} — the floor is counting them as absent from every page`);
  }
  for (const t of templates ?? []) {
    const src = (t.sources ?? []).join("\n");
    const hits = registry.map(([fn]) => fn).filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(src));
    if (hits.length < floor) {
      out.push(`${t.route} publishes ${hits.length} figure(s) this site computes (${hits.join(", ") || "none"}), under the floor of ${floor} — a template that mints many URLs has to earn each one`);
    }
  }
  return out;
}

/**
 * A PAGE THAT DOES NOT LEAD WITH THE THING IT IS NAMED AFTER.
 *
 * MEASURED, and the measurement is why this exists at all. Over 23.5 hours on 31 August 2026,
 * ChatGPT-User made 392 VERIFIED fetches of this site and 275 of them — 70% — landed on
 * /funding/{symbol}, spread across 36 different contracts. Somebody asks an assistant what a
 * coin's funding rate is and the assistant comes to that page.
 *
 * What it found on arrival: the first 900 characters of visible text were price, twelve-month
 * change, period high, period low, period volume, oracle index, open interest, max leverage and
 * a paragraph of provenance. The funding rate — the first noun in the page's own <title> — was
 * not among them. An extractor reading the whole document still finds it; one that truncates
 * answers with the price.
 *
 * SO THE RULE IS ABOUT THE OPENING, NOT THE PAGE. Everything was present and correct; what was
 * wrong was the order. This asserts that the terms a page is named for appear in its first
 * stretch of readable text, which is the part any summariser is guaranteed to have read.
 *
 * NOT A KEYWORD COUNT. It takes the terms from the caller, because "what this page is about" is
 * a judgement — the caller states it, and the check holds the page to it. A rule that inferred
 * the subject from the title would fire on every page whose title contains a common word.
 *
 *   html   the rendered document
 *   want   [{ label, re }] — each must match inside the opening
 *   chars  how much of the visible text counts as "the opening"
 */
export function leadsWithItsSubject(html, want, chars = 700) {
  const text = String(html ?? "")
    .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const opening = text.slice(0, chars);
  return (want ?? [])
    .filter((w) => !w.re.test(opening))
    .map((w) => `the opening ${chars} characters do not mention ${w.label} — an extractor that truncates answers with whatever came first instead`);
}

/**
 * llms.txt MAKES CHECKABLE CLAIMS ABOUT THIS SITE, AND ONE OF THEM WENT FALSE IN A MORNING.
 *
 * The file exists to be read by machines that will not ask a follow-up question. On
 * 31 August 2026 it said "One analytics script runs, and it is the only off-origin code on the
 * site" and "the Content-Security-Policy names exactly one host, static.cloudflareinsights.com,
 * in script-src". Google Analytics had been restored that morning; there were two counters and
 * two hosts. The claim was precise, checkable, addressed to an audience that cannot notice, and
 * wrong for as long as nobody happened to reread the file.
 *
 * Same class as the /privacy page that promised GA "is gone and is not coming back" — a
 * sentence that was true when written and became a statement the site could not support.
 * Prose does not have a gate unless somebody gives it one.
 *
 * ANCHORED ON THE SENTENCE THAT MAKES THE CLAIM, not on every hostname in the file. llms.txt
 * names coinliqui.com, liqui.io, coinliq.com and several Google endpoints for reasons that have
 * nothing to do with script permissions, so collecting hostnames indiscriminately would compare
 * a disambiguation paragraph against a security header. The claim lives in the sentence that
 * says "script-src", and that is what this reads.
 *
 * BOTH DIRECTIONS. A host the header permits and the file does not mention is an undisclosed
 * third party on a page that claims to disclose them all; a host the file names and the header
 * does not permit is a claim the site no longer supports. Neither is worse than the other.
 *
 *   llms       the rendered llms.txt
 *   scriptSrc  the script-src directive from the live Content-Security-Policy
 */
export function llmsHostsAgree(llms, scriptSrc) {
  const out = [];
  const sentences = String(llms ?? "").split(/(?<=\.)\s+/).filter((x) => /script-src/i.test(x));
  if (!sentences.length) {
    return [`llms.txt no longer contains a sentence about script-src — this check is reading nothing, which is not the same as agreeing`];
  }
  const hostRe = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;
  const claimed = new Set(
    sentences.flatMap((s) => [...s.matchAll(hostRe)].map((m) => m[1].toLowerCase()))
      /* The site's own domain is not an off-origin script host, and 'self' is not a hostname. */
      .filter((h) => !h.endsWith("coinliqui.com")),
  );
  const permitted = new Set(
    String(scriptSrc ?? "").split(/\s+/).filter(Boolean)
      .map((tok) => { if (tok.startsWith("'")) return null; try { return new URL(tok.includes("://") ? tok : `https://${tok}`).hostname.toLowerCase(); } catch { return null; } })
      .filter(Boolean),
  );
  for (const h of permitted) {
    if (!claimed.has(h)) out.push(`the header permits ${h} to serve a script and llms.txt does not mention it where it describes script-src — an undisclosed third party on a page whose purpose is disclosure`);
  }
  for (const h of claimed) {
    if (!permitted.has(h)) out.push(`llms.txt names ${h} as a script host and the live header does not permit it — a claim the site no longer supports`);
  }
  return out;
}
