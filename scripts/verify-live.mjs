#!/usr/bin/env node
/**
 * External verification. Nothing here reads a Cloudflare dashboard or an API — every
 * assertion is what a client on the open internet actually receives, because a dashboard
 * toggle showing the value you want and a crawler being served a challenge are perfectly
 * compatible states.
 *
 *   node scripts/verify-live.mjs [origin]        default https://coinliqui.com
 */
/* THE ONE IMPORT IN THIS FILE, and it is a pure function with a standing blind case rather
   than anything that touches the network. Everything else here is deliberately self-contained
   — this runs against production and its whole claim is that it asserts what a client on the
   open internet receives. underLinked() decides nothing about the site; it turns a count into
   a sentence, and it lives in checks.mjs so it is covered by the gate's own fixture suite. */
import { underLinked, duplicateHeadMetadata } from "./checks.mjs";

const ORIGIN = process.argv[2] || "https://coinliqui.com";
const CRAWLERS = [
  "GPTBot/1.1", "OAI-SearchBot/1.0", "ChatGPT-User/1.0",
  "ClaudeBot/1.0", "Claude-User/1.0", "Claude-SearchBot/1.0",
  "PerplexityBot/1.0", "Perplexity-User/1.0",
  "Googlebot/2.1 (+http://www.google.com/bot.html)", "Google-Extended/1.0",
  "Mozilla/5.0 (compatible; bingbot/2.0)", "Applebot/0.1", "Amazonbot/0.1",
];
const KEY_PATHS = ["/", "/funding/btc", "/robots.txt", "/sitemap-index.xml"];

/**
 * DID THE DOCUMENT FINISH? One definition, because there were two.
 *
 * Astro streams. A throw partway through a template flushes the status and everything rendered
 * so far, then stops — the error goes to the log, never into the body. So a mid-render TypeError
 * does not arrive as a 500. It arrives as **200 text/html with a truncated body**: measured at 0
 * bytes locally, where wrangler pages dev buffers, and at 9,159 bytes in production, where it
 * does not. A crawler stores the amputated page rather than skipping it.
 *
 * The self-test in section 0 used to carry its own copy of this predicate and prove that the
 * COPY could tell the two apart, which is the one-fact-two-implementations shape this project
 * keeps finding — in, of all places, the instrument that guards the class. Section 0, section 5
 * and section 7 all call this now.
 */
const isDocument = (b) => /^\s*<!doctype html/i.test(b);
const rendersToEnd = (b) => isDocument(b) && /<\/html>\s*$/i.test(b);

let failures = 0;
const bad = (m) => { failures++; console.log("   FAIL  " + m); };
const ok = (m) => console.log("   ok    " + m);

/**
 * SEND WHAT A BROWSER SENDS.
 *
 * This mattered more than it looks, and the lesson outlived the check that taught it. Node's
 * fetch defaults to `Accept: * / *`, and an edge can serve a materially different body on that
 * header than on a browser's — Cloudflare, for one, injects scripts only into responses whose
 * Accept asks for HTML. A check here once ran for a year against a body no visitor was ever
 * served, and reported green the whole time. A verifier that does not look like the thing it
 * is verifying is worse than no verifier: it produces confident green.
 */
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/**
 * AND THE CORRECTION TO THE PARAGRAPH ABOVE: LOOK LIKE IT TO THE SERVER, NOT TO THE ANALYTICS.
 *
 * The rule above is right and it had an unwatched cost. This script impersonates thirteen
 * crawlers on purpose, several times per run, over every URL in the sitemap — and the zone's
 * analytics believed it. Measured over five days: 13,314 requests arrived carrying a named
 * crawler's user-agent, and 11,882 of them (89%) came from the IP of the laptop this script
 * runs on. Cloudflare verified 1,205 as genuine. The weekly report's section C, which had
 * never once run, was written to count those names — so the first number it ever produced for
 * "GPTBot fetches" would have been our own verification traffic, and it would have looked
 * excellent.
 *
 * The two requirements are not in conflict, because the server does not branch on user-agent
 * at all — there is no UA gate anywhere in src/, robots.txt is advisory text and nothing else.
 * What the crawler UA is really testing is the EDGE: whether Cloudflare challenges a client
 * calling itself GPTBot. A suffix leaves that intact and makes the traffic separable
 * afterwards, so the harness stops being indistinguishable from the thing it imitates.
 *
 * Section C now counts only clients Cloudflare VERIFIED, which makes this contamination
 * structurally impossible rather than merely labelled — this suffix is for the human reading
 * a user-agent breakdown, not the mechanism that keeps the number honest.
 */
const SELF = " (+https://coinliqui.com/about; coinliqui-selfcheck)";

async function fetchAs(path, ua = "Mozilla/5.0", accept = ACCEPT) {
  const r = await fetch(ORIGIN + path, {
    headers: { "user-agent": ua + SELF, accept, "accept-language": "en-GB,en;q=0.9" },
    redirect: "manual",
  });
  return { status: r.status, headers: r.headers, body: await r.text() };
}

/**
 * BYTES ON THE WIRE, which `fetch` cannot tell you.
 *
 * The first version of the weight check did this:
 *
 *   const r = await fetch(url, { headers: { "accept-encoding": "br, gzip" } });
 *   const wire = (await r.arrayBuffer()).byteLength;   // 387,021
 *
 * and reported every page as several times over budget. undici DECOMPRESSES transparently and
 * leaves `content-encoding: br` on the response, so the header confirms compression while the
 * body you measure is the decoded one — the check reads as correct and is wrong by 5x. There is
 * no `content-length` to fall back on either; these responses are chunked.
 *
 * node:https does not decompress, so this counts what a client actually waits for. It is the
 * same shape as the HEAD-versus-GET lesson recorded elsewhere in this file: the convenient API
 * answered a different question than the one being asked, confidently.
 */
/** Same as wireSize but asks for no compression — the control the self-test compares against. */
async function wireSizeIdentity(path) {
  const https = await import("node:https");
  return new Promise((resolve, reject) => {
    const u = new URL(ORIGIN + path);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { "user-agent": "Mozilla/5.0" + SELF, accept: ACCEPT, "accept-encoding": "identity" } },
      (res) => { let wire = 0; res.on("data", (c) => { wire += c.length; });
        res.on("end", () => resolve({ wire, enc: res.headers["content-encoding"] ?? "none" })); },
    ).on("error", reject);
  });
}

async function wireSize(path) {
  const https = await import("node:https");
  return new Promise((resolve, reject) => {
    const u = new URL(ORIGIN + path);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search,
        headers: { "user-agent": "Mozilla/5.0" + SELF, accept: ACCEPT, "accept-encoding": "br, gzip" } },
      (res) => {
        let wire = 0;
        res.on("data", (c) => { wire += c.length; });
        res.on("end", () => resolve({ wire, enc: res.headers["content-encoding"] ?? "none", status: res.statusCode }));
      },
    ).on("error", reject);
  });
}

/** Does this URL answer a signed-out reader? GET, not HEAD — GitHub, among others, answers the
 *  two differently, and this project has been wrong about exactly that before. Redirects are
 *  followed, because a 301 to a live page is a working link. */
async function reachable(url) {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0" + SELF, accept: ACCEPT, "accept-language": "en-GB,en;q=0.9" },
      signal: AbortSignal.timeout(20_000),
    });
    /* The body is read and discarded: some hosts only fail after the headers, and an unread
       body leaves the socket open for the rest of the run. */
    await r.arrayBuffer().catch(() => {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status, why: `HTTP ${r.status}` };
  } catch (e) {
    /* status null means "never got an answer" — a different fact from any status code, and the
       judge treats it differently depending on the class. */
    return { ok: false, status: null, why: String(e.message || e).slice(0, 80) };
  }
}

console.log(`\n=== ${ORIGIN} ===\n`);

/* 0. THE INSTRUMENTS, BEFORE ANY READING TAKEN WITH THEM.
 *
 * Two measurements in this project produced confident, plausible, wrong numbers, and both were
 * caught only because a human found the value implausible — not by any check:
 *
 *   - a switch-latency harness polled with setTimeout and reported ~4000 ms for every case,
 *     including one that could not have taken longer than a DOM toggle;
 *   - a page-weight harness measured `(await r.arrayBuffer()).byteLength` while the response
 *     carried `content-encoding: br`, so it reported DECODED bytes as wire bytes — off by 5x,
 *     with the header sitting there appearing to confirm it.
 *
 * A check that cannot fail is a placebo; a MEASUREMENT that cannot be wrong-detected is the
 * same thing wearing a number. So the instruments are tested against a case where a broken one
 * would give a specific wrong answer, and the run stops if any of them fails — because every
 * figure printed below is taken with them and none of it would mean anything.
 */
console.log("0. the instruments");
{
  /* wireBytes must count TRANSFERRED bytes. If it ever auto-decodes, the compressed and
     identity readings converge — so requiring a large gap is exactly the blind case. */
  const [comp, ident] = await Promise.all([wireSize("/funding/btc"), wireSizeIdentity("/funding/btc")]);
  const ratio = ident.wire / Math.max(1, comp.wire);
  if (comp.enc === "none") {
    bad(`wireBytes: the compressed request came back unencoded (${comp.wire}b) — cannot tell a working instrument from a broken one`);
  } else if (ratio < 2) {
    bad(`wireBytes is measuring DECODED bytes: compressed ${comp.wire.toLocaleString()}b vs identity ${ident.wire.toLocaleString()}b is a ratio of ${ratio.toFixed(2)}, and this page compresses ~5x. Every weight figure below would be wrong.`);
  } else {
    ok(`wireBytes counts transferred bytes (${comp.enc} ${comp.wire.toLocaleString()}b vs identity ${ident.wire.toLocaleString()}b, ${ratio.toFixed(1)}x)`);
  }

  /* The completeness test must distinguish a finished document from a truncated one. Feed it
     both and require it to disagree with itself. */
  const done = "<!doctype html><html><body>x</body></html>";
  const cut = "<!doctype html><html><body>x";
  const notADoc = "OK";
  rendersToEnd(done) && !rendersToEnd(cut) && !rendersToEnd(notADoc)
    ? ok("completeness test separates a finished document from a truncated one, and from a non-document")
    : bad("the completeness test cannot tell a truncated document from a whole one — sections 5 and 7 are meaningless");

  if (failures) {
    console.log(`\n  INSTRUMENTS FAILED — stopping rather than reporting numbers taken with them.\n`);
    process.exit(1);
  }
}

/* 1. Crawler access. The whole project's visibility rests on this, and it cannot be
      confirmed from the dashboard. */
console.log("1. crawler access");
for (const ua of CRAWLERS) {
  const codes = [];
  for (const p of KEY_PATHS) codes.push((await fetchAs(p, ua)).status);
  const allOk = codes.every((c) => c === 200);
  (allOk ? ok : bad)(`${ua.slice(0, 40).padEnd(42)} ${codes.join(" ")}`);
}

/* 2. robots.txt, read to the END. Cloudflare's Managed robots.txt appends its AI-blocking
      rules after our content, so a file that starts correctly can still forbid everything. */
console.log("\n2. robots.txt in full");
{
  const r = await fetchAs("/robots.txt", "GPTBot/1.1");
  console.log("   ----- begin -----");
  console.log(r.body.split("\n").map((l) => "   " + l).join("\n").trimEnd());
  console.log("   ----- end -----");
  /* "MISSING OR WRONG ORIGIN" WAS TWO DIAGNOSES SHARING ONE MESSAGE, and they want opposite
     responses: an absent line means add one, while a present line on the wrong origin is the
     canonical-host family that already cost this project eight hours of http://localhost:4321
     in every sitemap. Read the line back and name which it is. */
  {
    const lines = r.body.split("\n").map((l) => l.trim()).filter((l) => /^sitemap:/i.test(l));
    const want = `Sitemap: ${ORIGIN}/sitemap-index.xml`;
    if (lines.includes(want)) ok("sitemap line present, on the canonical origin");
    else if (!lines.length) bad("robots.txt has no Sitemap: line at all");
    else bad(`robots.txt advertises the wrong sitemap URL: ${lines.join(" | ")} — expected ${want}`);
  }
  /^user-agent:\s*\*\s*\ndisallow:\s*\/\s*$/im.test(r.body.trim()) && bad("blanket Disallow: / is present");
  for (const b of ["GPTBot", "ClaudeBot", "PerplexityBot", "Googlebot"]) {
    const seg = r.body.split(/\n\s*\n/).find((s) => new RegExp(`user-agent:\\s*${b}`, "i").test(s)) ?? "";
    /disallow:\s*\/\s*$/im.test(seg) ? bad(`${b} is disallowed`) : ok(`${b} allowed`);
  }
  /cloudflare|managed by/i.test(r.body) ? bad("looks like Cloudflare appended to robots.txt") : ok("no Cloudflare-appended block");
}

/* 3. Indexability. The host guard must now be OFF for the apex and ON for everything else. */
console.log("\n3. indexability");
{
  const r = await fetchAs("/funding/btc", "Googlebot/2.1");
  const xr = r.headers.get("x-robots-tag");
  xr ? bad(`apex still sends X-Robots-Tag: ${xr}`) : ok("apex sends no X-Robots-Tag");
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(r.body)?.[1];
  canon === `${ORIGIN}/funding/btc` ? ok(`canonical ${canon}`) : bad(`canonical is ${canon}`);
  const pv = await fetch("https://coinliqui.pages.dev/funding/btc", { headers: { "user-agent": "Googlebot/2.1" + SELF } });
  pv.headers.get("x-robots-tag")?.includes("noindex") ? ok("pages.dev still noindex") : bad("pages.dev is indexable");
}

/* 4. www must not serve a second copy of the site. */
console.log("\n4. www");
{
  const r = await fetchAs("/", "Mozilla/5.0");
  const w = await fetch(ORIGIN.replace("https://", "https://www."), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0" + SELF } });
  [301, 308].includes(w.status) ? ok(`www -> ${w.status} ${w.headers.get("location")}`) : bad(`www returns ${w.status}, not a redirect`);
  r.status === 200 ? ok("apex 200") : bad(`apex ${r.status}`);
}

/**
 * EVERY READER-SIDE COUNTER THIS SITE RUNS, AND BOTH HALVES OF EACH ONE.
 *
 * A counter counts nothing unless the tag is IN the document and the CSP that document ships
 * PERMITS the host it names. Between 19 and 27 August 2026 the first held for the Cloudflare
 * beacon and the second did not: the tag was injected into every page, our own policy blocked
 * it, and the account recorded zero pageloads for eight days while every surface stayed green.
 * That is why this returns a list of what is missing rather than a boolean.
 *
 * ONE FUNCTION FOR BOTH CALL SITES. Section 5 walks every URL in the sitemaps; section 7 walks
 * the documents no sitemap lists — /watchlist, /status, the 404 and 410 branches. Those two
 * had separate copies of the same regex pair, which is how one of them would eventually learn
 * about a new counter and the other would not.
 *
 * GA4 IS MATCHED ON ITS LOADER URL AND A MEASUREMENT ID, not on gtag.js having executed. The
 * loader is deferred behind idle-or-interaction, so at fetch time the only thing in the
 * document is the inline bootstrap that queues the config call and builds that URL — which is
 * exactly what must be present for the hit to fire later.
 */
const COUNTERS = [
  {
    name: "cloudflare beacon",
    tag: /<script[^>]+src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/,
    host: /script-src[^;]*\bstatic\.cloudflareinsights\.com\b/,
  },
  {
    name: "google analytics",
    tag: /googletagmanager\.com\/gtag\/js\?id=/,
    id: /\bG-[A-Z0-9]{6,15}\b/,
    host: /script-src[^;]*\bwww\.googletagmanager\.com\b/,
  },
];
const analyticsGaps = (body, csp) =>
  COUNTERS.flatMap((c) =>
    !c.tag.test(body) ? [`no ${c.name} tag`]
      : c.id && !c.id.test(body) ? [`${c.name} tag carries no measurement ID`]
      : !c.host.test(csp) ? [`${c.name} blocked by this page's own CSP`]
      : []);


/* 5. Every URL we asked Google to index must resolve, as a crawler, with numbers in it. */
console.log("\n5. sitemap");
{
  const idx = await fetchAs("/sitemap-index.xml", "GPTBot/1.1");
  // Sitemaps always emit the CANONICAL origin, which is not necessarily the host being
  // tested — take the path, never a string-replace against ORIGIN.
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  const maps = [...idx.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  let urls = [];
  for (const m of maps) {
    const b = await fetchAs(pathOf(m), "GPTBot/1.1");
    urls.push(...[...b.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]));
  }
  const offOrigin = urls.filter((u) => !u.startsWith(ORIGIN + "/") && u !== ORIGIN);
  offOrigin.length ? bad(`${offOrigin.length} URLs off-origin`) : ok(`${maps.length} sitemaps, ${urls.length} URLs, all on ${ORIGIN}`);
  let broken = [], thin = [], hollow = [], gone = [], cut = [];
  /* THE ANALYTICS COVERAGE ASSERTION, and the reason it lives inside this loop rather than in a
     section of its own: this loop already holds every URL the site publishes, fetched with a
     browser's accept header, which is the header the injection keys off. Counting the beacon
     here costs nothing and covers ALL of them rather than a sample.

     WHY IT IS ASSERTED AT ALL. "Analytics is on every page" is a promise about pages that do not
     exist yet, and the only honest form of that promise is a gate that fails when a new page
     does not carry it. The tag is injected by Cloudflare at the edge, after this site's code has
     finished, so it is not something a template can forget — but "the host does it for us" is a
     configuration claim, and this project has already shipped one of those in the present tense
     about something nobody had done. Two halves are checked, because either one alone leaves the
     page counting nothing: the tag must be PRESENT in the document, and the CSP that document
     ships must PERMIT the host it names. Between 19 and 27 August the first held and the second
     did not, and the site recorded zero pageloads for eight days. */
  let noBeacon = [], beaconOk = 0;
  /* =======================================================================================
     THE INTERNAL LINK GRAPH, BUILT FROM A LOOP THAT WAS ALREADY FETCHING EVERY PAGE.

     Not one extra request: this walk exists to check that every sitemap URL answers 200 to a
     crawler, and the bodies are in hand. What it costs is a regex per page.

     CONTEXTUAL LINKS ONLY — inside <main>. The nav rail and the footer link the same set from
     all 133 pages, so counting them would give every page in the nav 132 inbound and every
     page not in it almost none, which measures the nav rather than the site.

     THE HREF IS NORMALISED TO ITS PATH, and the first version of this measurement did not do
     that. It skipped any href carrying a query string, so the fifty
     `/tools/position-size?symbol=X` links the contract pages carry went uncounted: the tools
     template read 3 inbound where it actually has 53. /tools/position-size is the page Google
     currently has as "Discovered - currently not indexed", so a wrong number and a real
     symptom agreed, which is the most convincing thing a bad instrument can produce. It would
     have sent somebody to link a template that was never under-linked.
     ======================================================================================= */
  const inbound = new Map(urls.map((u) => [pathOf(u) || "/", 0]));
  /* The head of every page, collected in the same pass and for the same reason: the bodies
     are already in hand. See duplicateHeadMetadata() for what two URLs sharing one title
     costs, and for why title LENGTH is deliberately not checked here. */
  const heads = [];
  const linkNorm = (h) => { const p = h.split("#")[0].split("?")[0]; return p.length > 1 ? p.replace(/\/$/, "") : p; };
  for (const u of urls) {
    const r = await fetchAs(pathOf(u) || "/", "GPTBot/1.1");
    if (r.status === 200) {
      const self = pathOf(u) || "/";
      const mi = r.body.indexOf("<main"), mj = r.body.indexOf("</main>");
      const main = mi > 0 ? r.body.slice(mi, mj) : "";
      for (const t of new Set([...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => linkNorm(m[1])))) {
        if (t !== self && inbound.has(t)) inbound.set(t, inbound.get(t) + 1);
      }
      heads.push({
        path: self,
        title: (r.body.match(/<title>([\s\S]*?)<\/title>/) ?? [, ""])[1].trim(),
        description: (r.body.match(/<meta name="description" content="([^"]*)"/) ?? [, ""])[1].trim(),
      });
    }
    if (r.status !== 200) broken.push(`${u} ${r.status}`);
    else if (!/Coinliqui/.test(r.body)) thin.push(u);
    /* THE BRAND IS NOT A COMPLETENESS TEST, AND IT WAS BEING USED AS ONE.
       "Coinliqui" is in the <title> and the topbar, inside the first two kilobytes of every
       document. A template that throws halfway still flushes all of that, so `thin` above is
       satisfied by the header of a page whose body never arrived.
       And the arriving thing is not a 500. Astro streams: the status is committed before the
       throw, so a mid-render TypeError reaches a crawler as 200 text/html with a truncated
       body — measured at 0 bytes locally, where wrangler buffers, and at 9,159 bytes in
       production, where it does not. Googlebot stores the amputated page rather than skipping
       it, which is worse than an error.
       Section 7 tests this on eight hand-picked paths. This loop already has every URL in the
       sitemaps in its hand, so the same assertion costs nothing here and covers all of them. */
    /* THE isDocument() GATE WAS EXCLUDING THE WORST CASE FROM THE CHECK WRITTEN FOR IT.
       rendersToEnd already requires isDocument, so this said: of the 200s that ALREADY look
       like an HTML document, do they end properly. A 200 with a zero-byte body — the exact
       presentation a mid-render throw produces under `wrangler pages dev`, and the one this
       whole section exists to catch — fails isDocument and was skipped silently, while the
       success line below claimed "every sitemap URL renders to </html>, not a sample". So did
       a 200 carrying an error page, a redirect body, or anything else that is not a document.
       No gate now, and the three shapes are named apart, because "empty" and "truncated" want
       different investigations. */
    if (r.status === 200 && !rendersToEnd(r.body)) {
      const why = r.body.length === 0 ? "empty body behind a 200"
        : !isDocument(r.body) ? "200 but not an HTML document"
        : "no closing tag";
      cut.push(`${u} (${r.body.length}b, ${why})`);
    }
    /* 200 IS NOT COMPLETE. /funding/uni returned 200, carried the brand, and rendered a
       timeframe bar above an empty space where the chart should have been — this check
       passed for every hour that page was broken. A contract page promises a chart; if the
       selected timeframe has no panel, the page is hollow and the check has to say so. */
    /* A CHART OR THE DOCUMENTED ABSENCE OF ONE. This check flagged /funding/chip, a contract
       that had just crossed the coverage floor and whose candles the chunked sweep had not
       reached yet. That page is CORRECT: it says "Candles not collected yet", explains that a
       new contract is fetched within five minutes, and still carries mark, 24-hour change,
       open interest, max leverage, the venue comparison and the margin tiers. The check was
       asserting something the site deliberately does not promise, and would have gone on
       failing for every newly-listed contract forever.

       The real defect it was written for — /funding/uni rendering a timeframe bar above empty
       space, silently, for an hour — is still caught: that page had NEITHER a panel NOR the
       empty state. Requiring one of the two keeps the alarm and drops the false one. */
    if (r.status === 200 && isDocument(r.body)) {
      const csp = r.headers.get("content-security-policy") ?? "";
      const miss = analyticsGaps(r.body, csp);
      if (miss.length) noBeacon.push(`${u} (${miss.join(", ")})`);
      else beaconOk++;
    }
    if (
      /\/funding\/[a-z0-9]/i.test(u) && r.status === 200 &&
      !/data-tfpanel="[^"]+" [^>]*data-on/.test(r.body) &&
      !/Candles not collected yet/.test(r.body)
    ) {
      hollow.push(u);
    }
  }
  broken.length ? bad(`non-200: ${broken.join(", ")}`) : ok("every sitemap URL 200 as GPTBot");
  thin.length ? bad(`missing brand: ${thin.join(", ")}`) : ok("every sitemap URL carries the brand");
  cut.length ? bad(`TRUNCATED — 200 with no </html>, the render threw mid-stream: ${cut.join(", ")}`)
             : ok(`every one of the ${urls.length} sitemap URLs answered 200 with a complete HTML document — no empty bodies, no truncation, not a sample`);
  hollow.length ? bad(`contract page with no chart panel: ${hollow.join(", ")}`) : ok("every contract page renders a chart, or says why it cannot yet");
  const dupHeads = duplicateHeadMetadata(heads);
  dupHeads.length ? bad(`published URL(s) whose head does not identify them uniquely:\n          ${dupHeads.join("\n          ")}`)
    : ok(`all ${heads.length} published URLs carry a title and a meta description, and no two share either`);
  const orphans = underLinked(inbound);
  orphans.length ? bad(`${orphans.length} published URL(s) almost nothing links to:\n          ${orphans.join("\n          ")}`)
    : ok(`every published URL carries at least 5 contextual inbound links — median per template: ${
        [...new Map([...inbound].reduce((m, [p, n]) => {
          const t = p === "/" ? "/" : p.split("/")[1];
          m.set(t, [...(m.get(t) ?? []), n]); return m;
        }, new Map()))].sort().map(([t, a]) => `/${t} ${a.sort((x, y) => x - y)[a.length >> 1]}`).join(", ")}`);
  noBeacon.length ? bad(`page(s) where a counter is missing or cannot run: ${noBeacon.join("; ")}`)
    : ok(`both counters run on all ${beaconOk} published pages — each tag present AND permitted by that page's own CSP, checked per page rather than assumed from one`);

  /* Withdrawn URLs must stay withdrawn. A 410 that silently becomes a 200 or a 301 puts a
     commodity page back into the index, which is the whole thing the removal was for. */
  for (const [p, want] of [["/tools/liquidation-price", 410]]) {
    const r = await fetchAs(p, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    if (r.status !== want) gone.push(`${p} is ${r.status}, expected ${want}`);
    if (urls.some((u) => pathOf(u) === p)) gone.push(`${p} is still listed in a sitemap`);
  }
  gone.length ? bad(gone.join("; ")) : ok("withdrawn URLs return 410 and are absent from the sitemaps");
}

/* 6. THE CSP, AS THE ANTI-INJECTION CONTROL IT ACTUALLY IS.
 *
 * THIS SECTION HAS NOW BEEN REWRITTEN TWICE FOR THE SAME REASON, in opposite directions, and
 * that is the thing worth reading before editing it again. It first asserted script-src was
 * exactly 'self', because /privacy claimed zero third-party scripts. Then the site ran Google
 * Analytics 4 and the assertion failed on correct behaviour, so the allowlist grew. GA4 is now
 * removed and SCRIPT_HOSTS is empty again — so an assertion demanding an analytics host would
 * fail on correct behaviour a second time. A check that encodes a decision has to be edited
 * when the decision is, and the failure looks identical either way: green where it should be
 * red, or red where the site is right.
 *
 * What survives both rewrites is the half that was always the real value. A CSP is protection
 * against an origin NOBODY CHOSE: a compromised dependency, an injected tag, a rewriting
 * proxy. So:
 *
 *   - every off-origin script must be on the allowlist below, BY HOSTNAME, and the comparison
 *     runs in both directions: a host in the header and not on the list fails as "permits a
 *     host nobody chose", a host on the list and not in the header fails as "missing an
 *     allowlisted host".
 *   - script-src must never contain a scheme or a wildcard. `https:` or `*` permits the
 *     entire internet while reading like a policy.
 *   - the directives that do the anti-injection work must all still be present. Relaxing
 *     script-src for analytics was a decision; quietly losing object-src 'none' is not.
 *
 * HOSTNAME EQUALITY OR AN EXPLICIT SUFFIX, NEVER A PREFIX. `startsWith("https://x.com")` also
 * matches https://x.com.evil.tld. That hole was found here once by writing the blind case out
 * and running it, and widening the allowlist makes it more dangerous rather than less —
 * scripts/blind-cases.mjs keeps the cases.
 */
/* ONE HOST, AND THAT IS THE ASSERTION — not "some hosts are fine". This list is the site's
   record of every off-origin script it chose, and it is compared against the live header in
   BOTH directions: a host in the header and not here fails as "permits a host nobody chose",
   and a host here and not in the header fails as "missing an allowlisted host". So this line
   cannot drift from production in either direction without the gate saying which way.

   static.cloudflareinsights.com added 27 August 2026 at the operator's decision, after the
   measurement that the beacon was being injected into every page, blocked by our own policy,
   and recording nothing — 0 pageloads in 31 days against a live tag. It survives the question
   GA4 failed: what it returns is whether anyone reads the site at all, which Search Console
   cannot answer because it counts only clicks that came from Google. */
/* www.googletagmanager.com added 27 August 2026 on the operator's instruction, restoring the
   GA4 property that ran 17-19 August. The record of why it was removed then is still in
   /privacy and in src/lib/site.ts, and none of it turned out to be wrong — it is expensive and
   it was unused. What changed is the question: neither the Cloudflare beacon nor Search
   Console can say which page a reader went to next, and that is the number that decides which
   of the fifty contract pages is worth writing more about.

   NAMING THIS HOST PERMITS EVERY GTM CONTAINER, not ours. www.googletagmanager.com serves any
   container to anyone who asks for one; CSP has no notion of whose tag it is. That is a real
   widening and it is written here rather than implied, because the list below reads like a
   list of tags and is in fact a list of hosts. */
const SCRIPT_HOSTS = ["static.cloudflareinsights.com", "www.googletagmanager.com"];
const REQUIRED_CSP = [
  ["object-src", "'none'"], ["base-uri", "'self'"], ["frame-ancestors", "'none'"],
  ["form-action", "'self'"], ["default-src", "'self'"],
];
console.log("\n6. content security policy");
for (const p of ["/", "/funding/btc"]) {
  const r = await fetchAs(p);
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
  const ORIGIN_HOST = hostOf(ORIGIN);
  const sameOrigin = (u) => hostOf(u) === ORIGIN_HOST;
  const isSchemaOrg = (u) => hostOf(u) === "schema.org";
  const allowed = (u) => SCRIPT_HOSTS.includes(hostOf(u));

  const csp0 = r.headers.get("content-security-policy") ?? "";
  const scriptSrc0 = (csp0.match(/(?:^|;)\s*script-src ([^;]*)/) ?? [, ""])[1];
  /* A SCRIPT TAG IN THE MARKUP IS NOT A SCRIPT THAT RUNS, and conflating the two made this
     check fail on correct behaviour the first time it ran. Cloudflare injects its own Web
     Analytics beacon into every page as it leaves the edge, after this Worker is done — the
     tag is in the HTML and the CSP does not permit its host, so the browser refuses to fetch
     it. That is the intended state, and /privacy describes it in those words.
     So the question is not "is there an off-origin tag" but "is there an off-origin script
     that IS PERMITTED TO RUN and that we did not choose". A tag present in the markup AND
     allowed by script-src, without being on the deliberate list, is the actual failure.
     THIS LOOP CAN ONLY SEE THE BEACON BECAUSE OF ONE HEADER, which the SEND WHAT A BROWSER
     SENDS note at the top of this file already explains and which was re-measured on 19 August
     to be sure it still holds: the injection keys off `accept`, an HTML accept gets the tag, a
     wildcard one does not, and the user-agent makes no difference in either direction. The
     re-measurement was prompted by an ad-hoc curl elsewhere that omitted the header, saw a
     clean page and was believed for several minutes. The note was right; the convenience fetch
     was not. That is the whole reason ACCEPT is a constant at the top of this file. */
  const permitted = (u) => { const h = hostOf(u); return !!h && scriptSrc0.includes(h); };
  const scripts = [...r.body.matchAll(/<script[^>]*src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const offOrigin = scripts.filter((u) => !sameOrigin(u));
  const runsUnchosen = offOrigin.filter((u) => permitted(u) && !allowed(u));
  const blocked = offOrigin.filter((u) => !permitted(u));
  runsUnchosen.length
    ? bad(`${p} permits an off-origin script nobody chose: ${runsUnchosen.join(", ")}`)
    : ok(`${p} off-origin scripts: ${offOrigin.length - blocked.length} allowed and intended, ${blocked.length} present but CSP-blocked`);

  const subres = [...r.body.matchAll(/<(?:img|iframe)[^>]*src="(https?:\/\/[^"]+)"|<link(?![^>]*rel="(?:canonical|alternate)")[^>]*href="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1] || m[2]).filter((u) => u && !sameOrigin(u) && !isSchemaOrg(u) && !allowed(u));
  subres.length
    ? bad(`${p} loads an unlisted off-origin subresource: ${subres.join(", ")}`)
    : ok(`${p} no unlisted off-origin subresource`);

  const csp = r.headers.get("content-security-policy") ?? "";
  if (!csp) { bad(`${p} sends no Content-Security-Policy`); continue; }
  const dir = (name) => (csp.match(new RegExp(`(?:^|;)\\s*${name} ([^;]*)`)) ?? [, ""])[1].trim();

  const scriptSrc = dir("script-src");
  const loose = /(^|\s)(\*|https?:)(\s|$)/.test(scriptSrc);
  /* HOSTNAME EQUALITY, NOT SUBSTRING — and this file wrote the blind cases warning about
     exactly this hole before reintroducing it two directives later. `scriptSrc.includes(h)`
     is satisfied by `https://www.googletagmanager.com.evil.tld`, so a policy that had been
     quietly widened to an attacker-controlled lookalike would have reported "names hosts, no
     scheme or wildcard" and passed. Tokenise and parse each source instead. */
  const cspHosts = scriptSrc.split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.startsWith("'")) return null;
    try { return new URL(tok.includes("://") ? tok : `https://${tok}`).hostname; } catch { return null; }
  }).filter(Boolean);
  const named = SCRIPT_HOSTS.every((h) => cspHosts.includes(h));
  const strayHosts = cspHosts.filter((h) => !SCRIPT_HOSTS.includes(h));
  loose ? bad(`${p} script-src contains a scheme or wildcard — that permits every origin: "${scriptSrc}"`)
    : !/'self'/.test(scriptSrc) ? bad(`${p} script-src no longer allows 'self': "${scriptSrc}"`)
    : !named ? bad(`${p} script-src is missing an allowlisted host: "${scriptSrc}"`)
    : strayHosts.length ? bad(`${p} script-src permits a host nobody chose: ${strayHosts.join(", ")}`)
    /* THE MESSAGE USED TO SAY "permits no off-origin host at all" UNCONDITIONALLY, computed
       from a branch that had just proved the header names exactly the allowlist. With an empty
       allowlist the two happened to coincide; with one host on it the sentence would have been
       false on every green run. A label that asserts a fact the expression does not compute is
       the class this project keeps finding, and it would have been shipped here by leaving a
       correct check with a stale sentence attached. */
    : ok(cspHosts.length
        ? `${p} script-src names exactly the ${cspHosts.length} chosen host(s): ${cspHosts.join(", ")} — parsed as hostnames rather than matched as substrings`
        : `${p} script-src permits no off-origin host at all — parsed as hostnames rather than matched as substrings`);

  const missing = REQUIRED_CSP.filter(([k, v]) => dir(k) !== v);
  missing.length
    ? bad(`${p} lost anti-injection directive(s): ${missing.map(([k, v]) => `${k} ${v}`).join(", ")}`)
    : ok(`${p} object-src, base-uri, frame-ancestors, form-action, default-src all intact`);
}

/* 7. DID THE DOCUMENT FINISH?
      Astro streams. A throw partway through a template flushes the status and everything
      rendered so far, then stops — the error goes to the log, never into the body. So the
      reader gets a correct status code, a correct content-type, a header, a nav, and then
      nothing: no h1, no content, no </html>.

      This lives HERE rather than only in smoke.mjs, and the distinction is not academic.
      `wrangler pages dev` BUFFERS: locally the same throw yields a 0-byte body, which the
      smoke gate catches as EMPTY BODY. Production STREAMS: the body is 9,159 bytes and
      looks alive. Measured on both, on the very defect that prompted this — an unimported
      SYMBOL_CAP in 404.astro that made every mistyped coin URL serve an amputated page.

      The paths below are chosen to cover the BRANCHES of /404, not just the template. The
      generic branch (/404 itself) rendered perfectly throughout; only the rewrite branch —
      the one a real person reaches by mistyping a coin — was broken. */
console.log("\n7. documents render to completion");
/* AND THE ANALYTICS ASSERTION FOR THE PAGES NO SITEMAP LISTS. Section 5 covers every published
   URL; these are the documents a reader can reach that are deliberately absent from the
   sitemaps — /watchlist carries noindex, /status is operational, and the 404 and 410 branches
   are pages a real person lands on after mistyping a coin. "Analytics on every page" has to mean
   every page a person can see, not every page a crawler is invited to, so the same two halves
   are asserted here on the routes section 5 structurally cannot reach. */
let extraBeaconGaps = [];
for (const p of ["/", "/funding/btc", "/coins/bitcoin", "/watchlist", "/404",
                 "/funding/notacoin", "/coins/notacoin", "/tools/leverage",
                 "/status", "/status/indexation", "/retired?symbol=FET"]) {
  const r = await fetchAs(p, "Mozilla/5.0");
  if (!isDocument(r.body)) { bad(`${p} did not return an HTML document (${r.status}, ${r.body.length}b)`); continue; }
  rendersToEnd(r.body)
    ? ok(`${p.padEnd(20)} ${String(r.status)} complete, ${r.body.length}b`)
    : bad(`${p} TRUNCATED — ${r.status} with ${r.body.length}b and no </html>; the render threw mid-stream`);
  const miss = analyticsGaps(r.body, r.headers.get("content-security-policy") ?? "");
  if (miss.length) extraBeaconGaps.push(`${p}: ${miss.join(", ")}`);
}
extraBeaconGaps.length
  ? bad(`unlisted document(s) counting no reader: ${extraBeaconGaps.join("; ")}`)
  : ok("the documents no sitemap lists — watchlist, status, the 404 and 410 branches — carry both counters too");

/* 8. "NEXT SETTLEMENT" MUST BE IN THE FUTURE, on every contract page.
 *
 * The card printed Hyperliquid's `nextFundingTime` verbatim, and that field is in the past on
 * every one of its 232 contracts — it publishes the START of the hour being predicted, and the
 * hour settles at its end. A page rendered at 14:27:48 UTC announced the next settlement as
 * 14:00. Fifty pages, every hour, for as long as the card has existed.
 *
 * The assertion is deliberately tighter than "in the future": the card's own meta says
 * "Hyperliquid, hourly", so the value must be within the next SIXTY MINUTES of the render time.
 * Merely testing "later than now" would be satisfied by rolling a wrong time to tomorrow, which
 * is exactly the shape of a check that cannot fail. Both times come from the same document, so
 * this compares the page against itself and needs no clock of ours. */
console.log("\n8. next settlement is in the future");
for (const p of ["/funding/btc", "/funding/eth", "/funding/sol", "/funding/kpepe"]) {
  const r = await fetchAs(p, "Mozilla/5.0");
  const renderedAt = new Date();   // within a second of when the server rendered it
  const card = /Next settlement<\/div>\s*<div[^>]*>([^<]*)</.exec(r.body)?.[1]?.trim();
  const stampStr = /<time datetime="([^"]+)"/.exec(r.body)?.[1];
  if (!card || !stampStr) { bad(`${p} has no readable "Next settlement" card or render stamp`); continue; }
  if (card === "—") { ok(`${p.padEnd(16)} no next settlement published — dash, not a guess`); continue; }
  const m = /^(\d{2}):(\d{2})$/.exec(card);
  if (!m) { bad(`${p} "Next settlement" is not a HH:MM time: "${card}"`); continue; }
  /* AGAINST THE RENDER TIME, NOT THE SNAPSHOT STAMP — and the difference is not cosmetic.
     nextSettlement() in src/lib/funding.ts computes from Date.now() at render. This check used
     the page's first <time datetime> — the freshness pill, which carries the SNAPSHOT's age and
     is routinely five minutes older. Whenever a render landed after an hour boundary that the
     snapshot predated, the arithmetic produced 61-65 minutes and the check failed three correct
     pages: "Next settlement 07:00 is 63 min from the page's stamp 05:57". Intermittent by
     construction, invisible for most of the day, and the page was right every time.
     Same shape as the defect that prompted this sweep: a condition evaluated on a proxy for the
     value the code actually used. The stamp is still printed, because the GAP between it and the
     render time is the useful diagnostic when this does fail. */
  const stamp = new Date(stampStr);
  const cand = new Date(renderedAt); cand.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  if (cand <= renderedAt) cand.setUTCDate(cand.getUTCDate() + 1);
  const aheadMin = Math.round((cand - renderedAt) / 60000);
  const lagMin = Math.round((renderedAt - stamp) / 60000);
  aheadMin > 0 && aheadMin <= 60
    ? ok(`${p.padEnd(16)} ${card} UTC, ${aheadMin} min ahead of render (snapshot ${lagMin} min behind)`)
    : bad(`${p} "Next settlement ${card}" is ${aheadMin} min from render time — an hourly contract settles within 60, so this time is in the past or too far out`);
}

/* 9. Data freshness, as served. */
/* 9. THE DOCUMENT MUST NOT DEPEND ON A COOKIE.
      `Vary: Cookie` keys a shared cache on the whole Cookie header, so one cookie with a
      per-visitor value — any analytics cookie — turns a shared cache into a per-visitor cache
      with a ~100% miss rate. The fix was not to drop the header but to remove the dependency:
      the rail's collapsed state is applied client-side before paint, so the HTML is the same
      for everyone and there is nothing to vary on.

      BOTH halves are asserted, because either alone can hold while the bug is present. A page
      could drop `Vary` and still render per-cookie HTML — now serving the wrong nav state from
      a shared cache — or keep identical HTML and still send `Vary`, paying the whole cost for
      nothing. Compared as full bodies rather than lengths: the two documents used to differ by
      the token `is-collapsed`, and a length comparison treats near-misses as equal.

      The freshness stamp moves between requests, so it is normalised out. That is a real
      difference and not the one under test; everything else must match exactly. */
console.log("\n9. the document does not depend on a cookie");
for (const p of ["/", "/funding/btc"]) {
  const plain = await fetchAs(p, "Mozilla/5.0");
  const withCookie = await fetch(ORIGIN + p, {
    headers: { "user-agent": "Mozilla/5.0" + SELF, accept: ACCEPT, cookie: "rail=0; _ga=GA1.1.1234567890.1700000000" },
    redirect: "manual",
  }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.text() }));

  const norm = (b) => b.replace(/datetime="[^"]*"/g, "").replace(/>[^<]*(?:just now|min ago|h ago|d ago)[^<]*</g, "><");
  const a = norm(plain.body), b = norm(withCookie.body);
  if (a !== b) {
    /* Name the first divergence rather than only reporting inequality — a diff nobody can
       locate is a check nobody acts on. */
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    bad(`${p} renders DIFFERENT html with a cookie — first divergence at byte ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} vs ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
  } else {
    ok(`${p.padEnd(14)} identical with and without cookies (${plain.body.length}b)`);
  }
  const vary = (plain.headers.get("vary") ?? "").toLowerCase();
  vary.includes("cookie")
    ? bad(`${p} still sends Vary: Cookie ("${vary}") — one per-visitor cookie makes every visitor their own cache entry`)
    : ok(`${p.padEnd(14)} no Vary: Cookie (vary: ${vary || "none"})`);
}

/* 10. WHAT THE SOURCE DECLARES vs WHAT A CLIENT RECEIVES.
      /robots.txt set `public, max-age=300` and was served `public, max-age=14400` on every
      request for as long as it existed — a 48x drift between a number in this repository and
      the number anyone actually got. Nothing was broken; the source was simply describing a
      response that is not the one sent.

      The endpoints and their expected values are READ OUT OF THE SOURCE, not listed here. A
      table of expected values in this file would be a third copy to drift, and the whole point
      is that a second copy already drifted. If someone edits the header in the route, this
      check follows them; if the edge overrides it, this check says so.

      Deliberately compared as the CACHE DIRECTIVES ONLY, order-insensitive: `max-age=300,
      public` and `public, max-age=300` are the same policy, and flagging that as drift would
      train everyone to ignore the check. */
console.log("\n10. the cache headers this repo declares are the ones served");
{
  const { readFileSync } = await import("node:fs");
  const ROUTES = [
    ["/robots.txt", "src/pages/robots.txt.ts"],
    ["/sitemap-index.xml", "src/pages/sitemap-index.xml.ts"],
    ["/search-index.json", "src/pages/search-index.json.ts"],
    ["/llms.txt", "src/pages/llms.txt.ts"],
  ];
  const directives = (v) =>
    (v ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).sort().join(", ");

  for (const [path, file] of ROUTES) {
    let declared = null;
    try {
      /* The LAST cache-control literal in the file: these routes have one response, and taking
         the last avoids matching a value quoted inside an explanatory comment above it. */
      const all = [...readFileSync(file, "utf8").matchAll(/"cache-control":\s*"([^"]+)"/g)];
      declared = all.length ? all[all.length - 1][1] : null;
    } catch { /* reported below */ }

    if (!declared) { bad(`${path} — no cache-control literal found in ${file}; this check is not looking at anything`); continue; }
    const served = (await fetchAs(path, "Mozilla/5.0")).headers.get("cache-control");
    directives(declared) === directives(served)
      ? ok(`${path.padEnd(20)} ${served}`)
      : bad(`${path} declares "${declared}" and serves "${served}" — the source describes a response nobody receives`);
  }
}

/* 10. Data freshness, as served. */
/* 11. PAGE WEIGHT, AS A RATCHET RATHER THAN A TARGET.
      Measured on the wire, brotli, live. The heaviest page here is a contract page at ~72 KB
      compressed / 386 KB decoded, and 43% of its 4,519 DOM nodes belong to timeframe panels the
      reader cannot see — three of four charts are rendered and hidden so switching needs no
      request and no JavaScript. Stripping the hidden panels' SVG would save 18 KB on the wire
      and 162 KB decoded.

      THAT TRADE IS DELIBERATE AND IS NOT CHANGED HERE. It is the house rule working as intended
      — interaction as a layer over already-rendered values — and I could not measure whether it
      costs anything that matters: this environment records no paint timings, and the anonymous
      PageSpeed Insights quota is exhausted, so LCP and TBT are UNMEASURED. Acting on "4,519
      nodes exceeds a Lighthouse threshold" would be optimising against a number nobody here has
      seen. What IS measured and good: CLS 0.0000 across zero layout shifts, TTFB 81 ms.

      So this is a ratchet. It does not judge whether today's weight is right; it fails the day
      a page grows past it, which is the failure that actually arrives — a template gains a
      section, fifty pages gain 40 KB, and nobody notices because each page still renders.
      Budgets are the observed size plus roughly a quarter of headroom. Raising one is a
      decision someone makes on purpose, in a diff, with a reason. */
console.log("\n11. page weight on the wire");
{
  const BUDGET = [
    ["/", 8_000], ["/funding", 9_500], ["/funding/btc", 92_000], ["/coins/bitcoin", 72_000],
    ["/open-interest", 6_500], ["/liquidations", 60_000], ["/liquidations/survival", 30_000],
    ["/unlocks", 14_000], ["/watchlist", 12_000], ["/tools/leverage", 8_000],
    /* RAISED 8,000 -> 10,600 ON 19 AUGUST, on purpose, in a diff, with the reason — which is what
       the paragraph above demands of anyone who touches these numbers. The ratchet did its job: it
       failed at 8,489b the first time it was run after /about gained the material that makes it a
       trust artefact rather than an introduction — a six-row table of the limits the site will not
       claim past, a provenance section pointing at the public source, and the paragraph explaining
       the coinliq.com spelling-corrector hijack to a reader who arrived through it. That growth is
       the page's purpose, so the budget moves rather than the content. 10,600 is the observed
       8,489 plus the quarter of headroom this list is specified to carry, not a round number
       chosen to stop the alarm. */
    ["/about", 10_600],
  ];
  for (const [path, budget] of BUDGET) {
    const { wire, enc } = await wireSize(path);
    if (enc === "none") {
      bad(`${path} is served UNCOMPRESSED (${wire.toLocaleString()}b) — compression is worth 70-96% on every page here`);
    } else if (wire > budget) {
      bad(`${path} is ${wire.toLocaleString()}b on the wire, over its ${budget.toLocaleString()}b budget by ${(wire - budget).toLocaleString()}b`);
    } else {
      ok(`${path.padEnd(24)} ${String(wire).padStart(7)}b ${enc}  (budget ${budget.toLocaleString()})`);
    }
  }
}

/* 12. THE SAME QUANTITY, ON DIFFERENT PAGES, AT ONE SNAPSHOT INSTANT.
      Hyperliquid's funding APR is rendered on /, /watchlist, /funding, every contract page and
      every coin page. Two of those read a different upstream field than the rest: `hlApr` was
      metaAndAssetCtxs.funding (the interval in progress) while the venue rows come from
      predictedFundings (the next interval). Both were labelled "Hyperliquid funding APR".

      That was deliberate and documented, on a measurement — worst disagreement 0.31pp, no sign
      flips — and the measurement expired. At 2026-08-18T07:02:11Z: 21 of 49 coins disagreed,
      worst 12.0pp, and THREE flipped sign, so the same contract was painted green on one page
      and red on another in the one visual language reserved for payment direction.

      This is the check that decides the question, and it has to hold the snapshot still to ask
      it: three pages fetched concurrently, and the comparison is only valid if all three carry
      the SAME <time datetime>. Different stamps mean different snapshots, and a drift measured
      across two snapshots is not a defect — so a stamp mismatch fails loudly rather than
      reporting a false one, and finding zero coins fails too, because a comparison of nothing
      passes trivially. */
console.log("\n12. one funding number, across every page that prints it");
{
  const [w, f, h] = await Promise.all([fetchAs("/watchlist"), fetchAs("/funding"), fetchAs("/")]);
  const stamps = [...new Set([w, f, h].map((r) => /datetime="([^"]+)"/.exec(r.body)?.[1]))];
  if (stamps.length !== 1 || !stamps[0]) {
    bad(`cannot compare — the three pages carry ${stamps.length} different snapshot stamps (${stamps.join(", ")}); rerun`);
  } else {
    const wl = new Map();
    for (const m of w.body.matchAll(/<tr data-sym="([A-Z0-9]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const c = /<td class="num (pays-[ls])"[^>]*>([^<]*)<\/td>/.exec(m[2]);
      if (c) wl.set(m[1], { cls: c[1], txt: c[2].replace(/[^0-9.\-]/g, "") });
    }
    const fv = new Map();
    for (const m of f.body.matchAll(/<span class="(pays-[ls])"[^>]*data-sym="([A-Z0-9]+)"[^>]*data-venue="HlPerp"[^>]*>([^<]*)<\/span>/g)) {
      fv.set(m[2], { cls: m[1], txt: m[3].replace(/[^0-9.\-]/g, "") });
    }
    const shared = [...wl.keys()].filter((k) => fv.has(k));
    if (shared.length < 10) {
      bad(`only ${shared.length} coins matched between /watchlist and /funding — the extraction is broken, not the site`);
    } else {
      const drift = [], flip = [];
      for (const sym of shared) {
        const a = wl.get(sym), b = fv.get(sym);
        const d = Math.abs(Number(a.txt) - Number(b.txt));
        if (d > 0.02) drift.push(`${sym} ${a.txt}% vs ${b.txt}% (${d.toFixed(2)}pp)`);
        if (a.cls !== b.cls) flip.push(`${sym}: /watchlist ${a.cls} ${a.txt}% vs /funding ${b.cls} ${b.txt}%`);
      }
      flip.length
        ? bad(`${flip.length} contract(s) painted OPPOSITE payment directions on different pages at ${stamps[0]}: ${flip.join("; ")}`)
        : ok(`colour agrees on all ${shared.length} coins at ${stamps[0]}`);
      drift.length
        ? bad(`${drift.length}/${shared.length} coins disagree on Hyperliquid APR: ${drift.slice(0, 6).join("; ")}${drift.length > 6 ? " …" : ""}`)
        : ok(`Hyperliquid APR agrees on all ${shared.length} coins`);
    }
  }
}

/* 13. THE CONTACT ADDRESS MUST SURVIVE THE EDGE.
      Cloudflare's Email Address Obfuscation rewrites any mailto: it finds in HTML as it leaves
      the edge — after our code has run. Live, it turned the only contact address on the site
      into href="/cdn-cgi/l/email-protection#…" (which 404s) with the visible text replaced by
      the literal string "[email protected]". Unreachable by click, nonsense to every crawler,
      on the pages published specifically so that a real operator could be identified.

      This can only be checked from OUTSIDE. The origin is correct and always was; the rewrite
      happens downstream, so a build-time check or a local render sees nothing wrong — the same
      reason the beacon injection needed an external verifier.

      Asserted on the surfaces that carry the address, HTML and plain text alike, because the
      obfuscator only touches HTML and a check that looked only at security.txt would be green
      throughout. */
/* 12b. THE CANONICAL MUST NAME THE HOST THAT SERVED IT.
   For about eight hours every canonical on this site read http://localhost:4321, because the
   build moved from Cloudflare to a laptop and astro.config only fails closed when CF_PAGES is
   set. Production is the only place this is observable, so it is checked here as well as in the
   artifact — a canonical pointing at an unfetchable host is the most damaging single line the
   site can publish, and it published it without anything going red. */
console.log("\n12b. every canonical names the canonical origin");
{
  for (const p of ["/", "/about", "/funding/btc", "/coins/bitcoin", "/unlocks"]) {
    const r = await fetchAs(p, "Mozilla/5.0");
    const can = (r.body.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (!can) bad(`${p} has no canonical at all`);
    else if (!can.startsWith(ORIGIN)) bad(`${p} canonical is ${can} — not ${ORIGIN}`);
    else ok(`${p.padEnd(16)} canonical ${can}`);
  }
  for (const p of ["/llms.txt", "/.well-known/security.txt", "/sitemap-index.xml"]) {
    const r = await fetchAs(p, "Mozilla/5.0");
    const n = (r.body.match(/(localhost|127\.0\.0\.1)/g) || []).length;
    n ? bad(`${p} carries ${n} localhost reference(s)`) : ok(`${p.padEnd(28)} no localhost origin`);
  }
}

console.log("\n13. the contact address survives Cloudflare's edge");
{
  const ADDR = "hello@coinliqui.com";
  for (const p of ["/about", "/privacy"]) {
    const r = await fetchAs(p, "Mozilla/5.0");
    const rewritten = /cdn-cgi\/l\/email-protection/.test(r.body);
    const placeholder = /\[email(?:&#160;|&nbsp;|\s)protected\]/i.test(r.body);
    const real = r.body.includes(`mailto:${ADDR}`);
    if (rewritten || placeholder) {
      bad(`${p} contact address was rewritten by the edge (cdn-cgi link: ${rewritten}, "[email protected]" text: ${placeholder}) — <!--email_off--> is missing or stopped working`);
    } else if (!real) {
      bad(`${p} does not carry mailto:${ADDR} at all`);
    } else {
      ok(`${p.padEnd(10)} mailto:${ADDR} intact, no cdn-cgi rewrite`);
    }
  }
  for (const p of ["/.well-known/security.txt", "/llms.txt"]) {
    const r = await fetchAs(p, "GPTBot/1.1");
    r.body.includes(ADDR)
      ? ok(`${p.padEnd(28)} carries ${ADDR}`)
      : bad(`${p} no longer carries the contact address`);
  }

  /* THE ONE ADDRESS ON THE SITE THAT IS DELIBERATELY UNPROTECTED.
     Everything above proves the <!--email_off--> workaround is holding. It cannot prove whether
     the feature it works around is switched on, and the Cloudflare grant this project has is
     Workers-scoped: the zone settings endpoint returns 9109 Unauthorized, so the switch cannot
     be read. /status carries the same address with no wrapper for exactly this reason. If it
     comes back rewritten, obfuscation is ON and every other address on the site is reachable
     only because of the opt-out — which makes that opt-out load-bearing, and worth saying out
     loud rather than discovering again by having the contact route break. */
  {
    const r = await fetchAs("/status", "Mozilla/5.0");
    const probe = (r.body.match(/id="contact-probe"[^>]*href="([^"]*)"/) || [])[1];
    if (!probe) {
      bad("/status no longer carries the unwrapped contact probe — the zone's obfuscation state is unmeasurable again");
    } else if (/cdn-cgi\/l\/email-protection/.test(probe)) {
      ok(`edge obfuscation is ON — the unwrapped probe came back as ${probe.slice(0, 44)}…, so <!--email_off--> is load-bearing on every other page`);
    } else if (probe === `mailto:${ADDR}`) {
      ok("edge obfuscation is OFF — the unwrapped probe survived verbatim, so the contact route does not depend on the opt-out");
    } else {
      bad(`/status probe came back as ${probe} — neither the address nor a known rewrite`);
    }
  }
}

/* 14. THE SOCIAL CARD MUST BE AN IMAGE A PLATFORM WILL ACTUALLY RENDER.
      og:image and twitter:image pointed at an SVG on all 78 URLs, under
      twitter:card="summary_large_image". No platform renders SVG, so the card never appeared
      anywhere and every shared link came out bare — free distribution discarded silently, with
      nothing to notice: the tag was present, the URL returned 200, and image/svg+xml is a
      perfectly valid content-type. That is why this asserts the FORMAT and not merely that the
      URL resolves, which was always true. */
console.log("\n14. the social card renders where it is shared");
{
  const r = await fetchAs("/", "Mozilla/5.0");
  const grab = (re) => re.exec(r.body)?.[1] ?? null;
  const og = grab(/<meta property="og:image" content="([^"]+)"/);
  const tw = grab(/<meta name="twitter:image" content="([^"]+)"/);
  const card = grab(/<meta name="twitter:card" content="([^"]+)"/);

  if (!og || !tw) { bad(`missing card image tags (og:image ${og}, twitter:image ${tw})`); }
  else if (og !== tw) { bad(`og:image and twitter:image disagree: ${og} vs ${tw}`); }
  else {
    /* The root-probed icon, from the open internet. dist/favicon.ico existing at build time and
     coinliqui.com/favicon.ico answering are different claims — this is the second one. */
  const fav = await fetch(ORIGIN + "/favicon.ico", { headers: { "user-agent": "Mozilla/5.0" + SELF } });
  const favBytes = Buffer.from(await fav.arrayBuffer());
  fav.status === 200 && favBytes.length >= 6 && favBytes.readUInt16LE(0) === 0 && favBytes.readUInt16LE(2) === 1
    ? ok(`/favicon.ico is a real ICO (${favBytes.length} bytes)`)
    : bad(`/favicon.ico returned ${fav.status}, ${favBytes.length} bytes, not an ICO`);

  const img = await fetch(og, { headers: { "user-agent": "facebookexternalhit/1.1" + SELF } });
    const type = img.headers.get("content-type") ?? "";
    const bytes = (await img.arrayBuffer()).byteLength;
    if (img.status !== 200) bad(`${og} returns ${img.status} to a social crawler`);
    else if (/svg/i.test(type)) bad(`${og} is ${type} — no social platform renders SVG, so the "${card}" card never appears`);
    else if (!/^image\/(png|jpeg|webp)/i.test(type)) bad(`${og} is ${type}, which is not a format social crawlers render`);
    /* Facebook and X both drop images over 5 MB, and both want at least 200x200. */
    else if (bytes > 5_000_000) bad(`${og} is ${bytes.toLocaleString()}b — over the 5MB most platforms accept`);
    else ok(`${og.replace(ORIGIN, "")} ${type}, ${bytes.toLocaleString()}b, card "${card}"`);
  }
}

/* 15. A MEASUREMENT THAT WAS TRUE ONCE, TURNED INTO ONE THAT STAYS TRUE.
      worker/ingest.ts carries a write budget "measured rather than assumed, at 49 published
      contracts" — ~1,228 KV writes/day, 3.7% of the paid million a month. Correct when written,
      and it SCALES WITH THE PUBLISHED SET: every sweep writes once per contract per cycle, so
      raising the coverage floor or the symbol cap multiplies it, and nothing re-checked the
      premise.

      That is the same shape as the defect found today by measurement rather than by review: the
      note in hyperliquid.ts said two funding fields agreed to within 0.31pp with no sign flips,
      which was true when measured and false a fortnight later — and the note asking the next
      person not to touch it was the thing standing in the way. A measured justification with no
      trip point is a decision that will be wrong eventually and silent when it is.

      So the arithmetic is recomputed here from the LIVE published count and the sweep cadences,
      and it fails at 25% of quota rather than at 100% — a trigger that fires with room to act,
      not an alarm at the moment of breach. */
console.log("\n15. the ingest write budget still holds at today's coverage");
{
  const ds = await fetchAs("/data-sources", "Mozilla/5.0");
  const m = /([\d,]+) of ([\d,]+) perpetuals clear that floor today; ([\d,]+) are published/.exec(
    ds.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
  );
  if (!m) {
    bad("could not read the published count off /data-sources — this check is not looking at anything");
  } else {
    const published = Number(m[3].replace(/,/g, ""));
    /* THE CADENCES ARE READ OUT OF worker/ingest.ts, NOT TRANSCRIBED.
       The first version copied them into this file, and measuring where it fired showed the
       problem: it only tripped past 429 published contracts against a universe of 232, so
       coverage alone could never reach it and the check was close to inert. The change that
       actually moves this number is someone tightening a sweep, and a transcribed copy would not
       have noticed — the same drifted-pair failure this whole file exists to catch, aimed at
       itself.

       HOW MUCH HEADROOM THERE ACTUALLY IS, measured rather than asserted, because the first
       draft of this comment guessed and was wrong. Today: 3.7%. Every sweep moved to hourly at
       today's coverage: 12.3%. The full 232-contract universe at today's cadences: 13.9%. The
       full universe with every sweep hourly: 53.1%, which trips. So no single realistic change
       reaches the limit and a combination does — which is the honest description of a 27x
       margin, and the reason the trip point is 25% rather than something tuned to fire. */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("worker/ingest.ts", "utf8");
    const constOf = (name) => {
      const v = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src)?.[1];
      return v ? Number(v) : null;
    };
    const CHUNK = constOf("CHUNK");
    /* THE SWEEP LIST IS DERIVED, NOT TRANSCRIBED — and that is the whole correction here.
       It used to be the literal array [hourly, funding, candles], typed into this file. A fourth
       sweep, m15, was added to the worker at the same 2-hour cadence as hourly, and this check
       never saw it: 600 writes a day, the joint-largest source, invisible. A check that keeps its
       own copy of the list it is auditing is auditing its copy. */
    const SWEEPS = [...src.matchAll(/\{\s*name:\s*"([a-z0-9]+)"\s*,\s*key:\s*"[^"]*"\s*,\s*hours:\s*([A-Z0-9_]+)/g)]
      .map((m) => [m[1], constOf(m[2])]);

    /* AND EVERY CRON, NOT THE FIRST ONE THAT MATCHED A SHAPE. `/"\d+-\d+\/(\d+)/` matched
       "2-59/5" and stopped, so the second trigger — "* * * * *", 1,440 ticks a day, each writing
       the `live` key — was absent from the budget entirely. That single omission was larger than
       the whole stated total. */
    const cron = /crons\s*=\s*\[([^\]]*)\]/.exec(readFileSync("wrangler.toml", "utf8"))?.[1] ?? "";
    const specs = [...cron.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const ticksOf = (spec) => {
      const min = spec.trim().split(/\s+/)[0];
      if (min === "*") return 1440;
      const every = /^\d+-\d+\/(\d+)$/.exec(min) ?? /^\*\/(\d+)$/.exec(min);
      return every ? Math.floor(1440 / Number(every[1])) : null;
    };
    const ticks = specs.map(ticksOf);
    const FIVE = Math.min(...ticks.filter(Number.isFinite));   // the ingest tick
    const MINUTE = Math.max(...ticks.filter(Number.isFinite)); // the live tick

    /* WRITES PER TICK ARE DECLARED, AND THE DECLARATION IS GUARDED. Counting them from source
       would mean parsing control flow; declaring them means the numbers can go stale. So the
       count of SNAPSHOT.put call sites in the worker is asserted instead: add a write anywhere
       and this fails until somebody comes back here and decides what it costs. */
    const PUT_SITES = (src.match(/SNAPSHOT\.put\(/g) ?? []).length;
    /* 14 SINCE 24 AUGUST. The new one writes `published:retired`, and it is guarded twice: the
       published set must have genuinely changed, and at least one symbol must have LEFT. A join
       writes nothing. Observed frequency is a retirement every few days — FET on 24 August, and
       MORPHO's arrival on the 21st wrote nothing here — so it is a handful of writes a month
       against a million, and it does not enter the per-tick arithmetic below.
       Raised deliberately, which is the whole point of this assertion: a write added anywhere
       fails this until somebody comes back and decides what it costs. */
    const PUT_SITES_KNOWN = 14;
    const PER_INGEST_TICK = 3;   // snapshot, flips LAST_KEY, flips EVENTS_KEY
    const PER_MINUTE_TICK = 1;   // live

    if (PUT_SITES !== PUT_SITES_KNOWN) {
      bad(`worker/ingest.ts has ${PUT_SITES} KV write sites, the budget below was reasoned about ${PUT_SITES_KNOWN} — re-derive it before trusting the percentage`);
    }
    if (!CHUNK || !Number.isFinite(FIVE) || !Number.isFinite(MINUTE) || !SWEEPS.length || SWEEPS.some(([, h]) => !h)) {
      bad(`could not read the ingest constants (CHUNK=${CHUNK}, ticks=${JSON.stringify(ticks)}, sweeps=${JSON.stringify(SWEEPS)}) — the budget cannot be recomputed, so this check is blind`);
    } else {
      const chunks = Math.ceil(published / CHUNK);
      const TICKS = FIVE;
      const perDay = FIVE * PER_INGEST_TICK + MINUTE * PER_MINUTE_TICK
        + SWEEPS.reduce((a, [, h]) => a + published * (24 / h) + chunks * (24 / h), 0);
      const perMonth = perDay * 30;
      const QUOTA = 1_000_000, TRIP = 0.25;
      const pct = (100 * perMonth) / QUOTA;
      const cad = SWEEPS.map(([n, h]) => `${n} ${h}h`).join(", ");
      const ticksNote = `${FIVE} ingest + ${MINUTE} live ticks/day`;
      pct > TRIP * 100
        ? bad(`ingest would write ~${Math.round(perMonth).toLocaleString()} KV writes/month at ${published} published contracts (${cad}, ${ticksNote}) — ${pct.toFixed(1)}% of the ${QUOTA.toLocaleString()} quota, past the ${TRIP * 100}% trip point. The budget in worker/ingest.ts was measured at 49 contracts and no longer holds.`)
        : ok(`~${Math.round(perMonth).toLocaleString()} writes/month at ${published} published · ${cad} · ${ticksNote} (${pct.toFixed(1)}% of quota, trips at ${TRIP * 100}%)`);
    }
  }
}

console.log("\n16. data");
{
  const r = await fetchAs("/status", "Mozilla/5.0");
  const grab = (re) => re.exec(r.body)?.[1]?.trim() ?? "?";
  for (const [lbl, re] of [
    ["snapshot age", /Snapshot age<\/div>\s*<div[^>]*>([^<]*)</],
    ["SNAPSHOT binding", /<td[^>]*>KV binding <code[^>]*>SNAPSHOT<\/code><\/td>\s*<td[^>]*>([^<]*)</],
    ["DB binding", /<td[^>]*>D1 binding <code[^>]*>DB<\/code><\/td>\s*<td[^>]*>([^<]*)</],
  ]) console.log(`   ---   ${lbl}: ${grab(re)}`);
  /* "WORKER BUNDLE STALE" NAMED ONE CONDITION AND FIRED ON TWO.
     It compares the deployed stamp against the one the SITE expects, and reports any difference
     as a stale worker. The opposite happens just as often: deploy:site runs this immediately
     after `wrangler pages deploy`, with no wait, so a request can still reach the previous
     Pages version — the worker is current and the SITE is behind. Measured today: it reported
     "deployed 8df809eceb41, expected 9be2e398a920" and forty-five seconds later the same check
     passed with no change to anything, because 8df809eceb41 was the NEW stamp and the site had
     not propagated. A false alarm that says "run deploy:worker" when deploy:worker is the one
     thing that is already done.

     The local build-stamp is what separates them, and it costs a file read: if the deployed
     worker matches the source tree, the worker is right and the site is the lagging half. */
  const w = /Deployed <code[^>]*>([^<]*)<\/code>, site expects <code[^>]*>([^<]*)</.exec(r.body);
  if (w) {
    const [, deployed, expects] = w;
    const { readFileSync } = await import("node:fs");
    const local = (/"([0-9a-f]{12})"/.exec(readFileSync("worker/build-stamp.ts", "utf8")) || [])[1] ?? null;
    const { stampVerdict } = await import("./checks.mjs");

    /* THE RETRY BELONGS BEFORE THE VERDICT, NOT ON ONE BRANCH OF IT. The first version retried
       only when the deployed stamp matched the source tree, on the theory that Pages
       propagation was the sole lag. There are TWO, and they read through the same value: the
       "deployed" stamp is whatever the worker last wrote to KV on its tick, so a worker that
       has just been deployed still reports the previous build for up to a minute. Measured
       today: this returned "the worker is behind the source tree. Run: npm run deploy:worker"
       about a worker that had been deployed ninety seconds earlier, and a single 20-second
       wait cleared it. A verdict taken from a stale reading is a wrong verdict whichever
       branch it lands on. */
    /* THE WINDOW HAS TO OUTLAST THE THING THAT REFRESHES THE VALUE, and one 20-second wait did
       not. "Deployed" is whatever the worker last wrote to KV on its tick, and the tick that
       writes it runs once a minute — so a freshly deployed worker reports its previous build
       until the next tick lands. Measured on 24 August by polling: the pair took 120 SECONDS to
       agree, twice the wait, and the check failed a deploy that was entirely correct.
       Polled to 150s rather than slept once, so the ordinary case still costs nothing: it stops
       the moment the two agree. */
    let [deployedNow, expectsNow] = [deployed, expects];
    for (let waited = 0; deployedNow !== expectsNow && waited < 150_000; waited += 20_000) {
      await new Promise((res) => setTimeout(res, 20_000));
      const again = /Deployed <code[^>]*>([^<]*)<\/code>, site expects <code[^>]*>([^<]*)</.exec((await fetchAs("/status", "Mozilla/5.0")).body);
      if (again) [, deployedNow, expectsNow] = again;
    }
    const v = stampVerdict(deployedNow, expectsNow, local);
    if (v.state === "current") ok(`worker bundle current (${deployedNow})${deployed !== expects ? " — one of the two was still lagging when this check started" : ""}`);
    else if (v.state === "site-behind") bad(`the SITE is behind, not the worker: the deployed worker ${deployedNow} matches worker/build-stamp.ts, and the site still expects ${expectsNow} after 150s of polling. Re-run the Pages deploy rather than deploy:worker.`);
    else bad(`worker bundle stale: deployed ${deployedNow}, the site expects ${expectsNow}, and worker/build-stamp.ts says ${local ?? "?"} — the worker is behind the source tree after 150s of polling. Run: npm run deploy:worker`);
  }
}

/* 17. THE URLS THIS SITE PUBLISHES ABOUT ITSELF MUST RESOLVE FOR A SIGNED-OUT READER.
 *
 * The defect this exists for: `sameAs` on all 79 pages, the visible link on /about under the
 * heading "The site's own history, which you can read", and the provenance line in llms.txt all
 * pointed at https://github.com/coinliqui/coinliqui. The repository is public — the GitHub API
 * says `"private": false` to an authenticated call. An anonymous GET returns 404, because the
 * owning account is under a spam flag and GitHub hides a flagged account's pages from everyone
 * but its owner. So the site's single external corroboration resolved to "no such thing" for
 * every reader, every crawler and every answer engine, and every instrument this project owns
 * reported green, because every one of them reads OUR origin.
 *
 * It was not a cosmetic break. Asked to assess the domain from /about alone, an extraction model
 * named the repository as the FIRST of three ways a reader could verify the site and quoted the
 * "source is public" sentence as grounds for its verdict — so the one link an agent would follow
 * to check us was the one that failed.
 *
 * TWO CLASSES, AND THE FIRST DRAFT CONFLATED THEM. Run once against everything external, this
 * reported three failures: the GitHub 404, a 403 from coinbase.com and a timeout from bybit.com.
 * Only the first is ours. The other two are anti-bot edges refusing a non-browser client, and
 * treating them as defects would have produced two standing exemptions on the first run — the
 * shape this project keeps having to unpick. So the question asked of each URL is what CLAIM it
 * carries:
 *
 *   SELF-CLAIM — sameAs, and any external URL in llms.txt. These exist to be checked by a
 *     stranger. Anything that is not a 2xx fails, including a 403: a reader who cannot reach it
 *     cannot verify us, and why they cannot is not the point.
 *   EDITORIAL — an ordinary outbound link to somebody's docs or terms. Only 404 and 410 fail,
 *     because those mean the page is gone. A 403, a 429 or a timeout is that host's policy about
 *     robots and says nothing about this site; it is printed, not counted.
 *
 * WHAT IT FIRES ON TODAY, asked before wiring it in: six distinct external URLs, zero exemptions.
 * It fired on the GitHub URL the first time it ran, which is why sameAs is empty today.
 *
 * WHY THIS IS NOT MISTAKEN FOR ABUSE: one GET per DISTINCT URL per run, deduplicated, from a
 * self-identifying user-agent, following redirects — five to eight requests spread over as many
 * unrelated hosts. That is an ordinary outbound-link check, and smaller than one page load.
 */
console.log("\n17. the URLs this site publishes about itself resolve to a signed-out reader");
{
  /* THE INSTRUMENT FIRST, ON OUR OWN ORIGIN, so proving the judge can fail costs a third party
     nothing. Both verdicts are exercised: a 404 must fail in either class, and the editorial
     class must NOT fail on a 403 — an over-strict judge would fill this section with exemptions,
     which is the failure mode being avoided rather than a lesser one. */
  const probe = await reachable(ORIGIN + "/notacoin");
  /* status null is "never got an answer": fatal for a self-claim, because a reader cannot
     verify what they cannot reach; tolerated for an editorial link, because a host that drops
     non-browser clients has not deleted the page. */
  const judge = (status, self) => status === null ? !self : (status >= 200 && status < 300 ? true : self ? false : !(status === 404 || status === 410));
  const instrumentOk =
    !probe.ok && probe.status === 404 &&
    judge(404, true) === false && judge(404, false) === false &&
    judge(403, true) === false && judge(403, false) === true &&
    judge(200, true) === true && judge(null, false) === true && judge(null, true) === false;
  if (!instrumentOk) {
    bad(`the reachability judge is wrong about at least one of {404 self, 404 editorial, 403 self, 403 editorial, 200, timeout} — section 17 means nothing (probe: ${probe.why})`);
  } else {
    ok(`reachability judge: 404 fails in both classes, 403 fails only as a self-claim, our own /notacoin rejected (${probe.why})`);

    const PAGES = ["/about", "/data-sources", "/methodology", "/terms", "/privacy", "/"];
    const host = (u) => { try { return new URL(u).hostname; } catch { return null; } };
    const SELF_HOST = host(ORIGIN);
    const found = new Map();          // url -> { self, where:Set }
    const note = (u, where, self) => {
      if (!/^https?:\/\//i.test(u)) return;
      if (host(u) === SELF_HOST) return;   // our own origin is sections 5 and 7's job
      const e = found.get(u) ?? { self: false, where: new Set() };
      e.self ||= self;
      e.where.add(where);
      found.set(u, e);
    };
    for (const p of PAGES) {
      const r = await fetchAs(p, "Mozilla/5.0");
      for (const m of r.body.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) note(m[1], `${p} link`, false);
      /* sameAs is the one that mattered, and it lives in the graph rather than in an anchor. */
      for (const m of r.body.matchAll(/"sameAs":\s*(\[[^\]]*\])/g)) {
        try { for (const u of JSON.parse(m[1])) note(u, `${p} sameAs`, true); } catch { /* section 10 owns malformed JSON-LD */ }
      }
    }
    const llms = await fetchAs("/llms.txt", "Mozilla/5.0", "text/plain,*/*");
    for (const m of llms.body.matchAll(/https?:\/\/[^\s)>\]]+/g)) note(m[0].replace(/[.,;]$/, ""), "llms.txt", true);

    if (!found.size) {
      bad(`no external URL found on ${PAGES.join(" ")} or /llms.txt — this check is not looking at anything`);
    } else {
      const selfClaims = [...found].filter(([, e]) => e.self);
      const broken = [];
      for (const [u, e] of found) {
        const r = await reachable(u);
        const good = judge(r.status, e.self);
        if (!good) broken.push(`${u} — ${r.why} — ${e.self ? "SELF-CLAIM" : "editorial"} — in ${[...e.where].join(", ")}`);
        else if (!r.ok) console.log(`   ---   ${u} answered ${r.why} to a non-browser client; editorial link, not counted`);
      }
      /* An empty self-claim set is the CURRENT DELIBERATE STATE, not a pass. Saying so keeps this
         from reading as "the corroboration checks out" when there is none to check. */
      console.log(`   ---   ${selfClaims.length} self-claim URL(s), ${found.size - selfClaims.length} editorial`
        + (selfClaims.length ? "" : " — the site currently corroborates itself with no external URL at all (see IDENTITY.sameAs)"));
      broken.length
        ? bad(`${broken.length} published URL(s) do not resolve:\n         ` + broken.join("\n         "))
        : ok(`all ${found.size} external URL(s) published on this site resolve, or are refused by an anti-bot edge rather than gone`);
    }
  }
}

console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}\n`);
process.exit(failures ? 1 : 0);
