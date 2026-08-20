#!/usr/bin/env node
/**
 * External verification. Nothing here reads a Cloudflare dashboard or an API — every
 * assertion is what a client on the open internet actually receives, because a dashboard
 * toggle showing the value you want and a crawler being served a challenge are perfectly
 * compatible states.
 *
 *   node scripts/verify-live.mjs [origin]        default https://coinliqui.com
 */
const ORIGIN = process.argv[2] || "https://coinliqui.com";
const CRAWLERS = [
  "GPTBot/1.1", "OAI-SearchBot/1.0", "ChatGPT-User/1.0",
  "ClaudeBot/1.0", "Claude-User/1.0", "Claude-SearchBot/1.0",
  "PerplexityBot/1.0", "Perplexity-User/1.0",
  "Googlebot/2.1 (+http://www.google.com/bot.html)", "Google-Extended/1.0",
  "Mozilla/5.0 (compatible; bingbot/2.0)", "Applebot/0.1", "Amazonbot/0.1",
];
const KEY_PATHS = ["/", "/funding/btc", "/robots.txt", "/sitemap-index.xml"];

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
  const complete = (b) => /^\s*<!doctype html/i.test(b) && /<\/html>\s*$/i.test(b);
  complete(done) && !complete(cut)
    ? ok("completeness test separates a finished document from a truncated one")
    : bad("the completeness test cannot tell a truncated document from a whole one — section 7 is meaningless");

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
  let broken = [], thin = [], hollow = [], gone = [];
  for (const u of urls) {
    const r = await fetchAs(pathOf(u) || "/", "GPTBot/1.1");
    if (r.status !== 200) broken.push(`${u} ${r.status}`);
    else if (!/Coinliqui/.test(r.body)) thin.push(u);
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
  hollow.length ? bad(`contract page with no chart panel: ${hollow.join(", ")}`) : ok("every contract page renders a chart, or says why it cannot yet");

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
 *   - every off-origin script must be on the allowlist below, BY HOSTNAME. The list is empty,
 *     so any off-origin script that is PERMITTED TO RUN is a failure.
 *   - script-src must never contain a scheme or a wildcard. `https:` or `*` permits the
 *     entire internet while reading like a policy. With an empty allowlist it must also name
 *     no host at all.
 *   - the directives that do the anti-injection work must all still be present. Relaxing
 *     script-src for analytics was a decision; quietly losing object-src 'none' is not.
 *
 * HOSTNAME EQUALITY OR AN EXPLICIT SUFFIX, NEVER A PREFIX. `startsWith("https://x.com")` also
 * matches https://x.com.evil.tld. That hole was found here once by writing the blind case out
 * and running it, and widening the allowlist makes it more dangerous rather than less —
 * scripts/blind-cases.mjs keeps the cases.
 */
/* EMPTY, AND THAT IS THE ASSERTION. Not "no hosts have been added yet" — no host is permitted
   to serve a script to this site. Adding one here is a deliberate act that has to survive the
   question GA4 failed: what decision gets made with what it returns. */
const SCRIPT_HOSTS = [];
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
    : ok(`${p} script-src permits no off-origin host at all — ${cspHosts.length} named, parsed as hostnames rather than matched as substrings`);

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
for (const p of ["/", "/funding/btc", "/coins/bitcoin", "/watchlist", "/404",
                 "/funding/notacoin", "/coins/notacoin", "/tools/leverage"]) {
  const r = await fetchAs(p, "Mozilla/5.0");
  const isDoc = /^\s*<!doctype html/i.test(r.body);
  if (!isDoc) { bad(`${p} did not return an HTML document (${r.status}, ${r.body.length}b)`); continue; }
  /<\/html>\s*$/i.test(r.body)
    ? ok(`${p.padEnd(20)} ${String(r.status)} complete, ${r.body.length}b`)
    : bad(`${p} TRUNCATED — ${r.status} with ${r.body.length}b and no </html>; the render threw mid-stream`);
}

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
    const PUT_SITES_KNOWN = 13;
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
  const w = /Deployed <code[^>]*>([^<]*)<\/code>, site expects <code[^>]*>([^<]*)</.exec(r.body);
  w && (w[1] === w[2] ? ok(`worker bundle current (${w[1]})`) : bad(`worker bundle stale: deployed ${w[1]}, expected ${w[2]}`));
}

console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}\n`);
process.exit(failures ? 1 : 0);
