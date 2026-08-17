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
async function fetchAs(path, ua = "Mozilla/5.0", accept = ACCEPT) {
  const r = await fetch(ORIGIN + path, {
    headers: { "user-agent": ua, accept, "accept-language": "en-GB,en;q=0.9" },
    redirect: "manual",
  });
  return { status: r.status, headers: r.headers, body: await r.text() };
}

console.log(`\n=== ${ORIGIN} ===\n`);

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
  r.body.includes(`Sitemap: ${ORIGIN}/sitemap-index.xml`) ? ok("sitemap line present, on the canonical origin") : bad("sitemap line missing or wrong origin");
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
  const pv = await fetch("https://coinliqui.pages.dev/funding/btc", { headers: { "user-agent": "Googlebot/2.1" } });
  pv.headers.get("x-robots-tag")?.includes("noindex") ? ok("pages.dev still noindex") : bad("pages.dev is indexable");
}

/* 4. www must not serve a second copy of the site. */
console.log("\n4. www");
{
  const r = await fetchAs("/", "Mozilla/5.0");
  const w = await fetch(ORIGIN.replace("https://", "https://www."), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0" } });
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
 * THIS SECTION USED TO ASSERT A RULE THAT NO LONGER EXISTS. It checked that the only
 * off-origin script was Cloudflare's blocked beacon and that script-src was exactly 'self',
 * because /privacy claimed zero third-party scripts and zero off-origin requests. The site now
 * runs Google Analytics 4 deliberately, so that assertion would fail on correct behaviour —
 * a check defending a retired rule, which is the drift this file exists to catch.
 *
 * What survives is the half that was always the real value. A CSP is protection against an
 * origin NOBODY CHOSE: a compromised dependency, an injected tag, a rewriting proxy. So:
 *
 *   - every off-origin script must be on the allowlist below, BY HOSTNAME. A new one fails.
 *   - script-src must name hosts and must never contain a scheme or a wildcard. `https:` or
 *     `*` permits the entire internet while reading like a policy.
 *   - the directives that do the anti-injection work must all still be present. Relaxing
 *     script-src for analytics is a decision; quietly losing object-src 'none' is not.
 *
 * HOSTNAME EQUALITY OR AN EXPLICIT SUFFIX, NEVER A PREFIX. `startsWith("https://x.com")` also
 * matches https://x.com.evil.tld. That hole was found here once by writing the blind case out
 * and running it, and widening the allowlist makes it more dangerous rather than less —
 * scripts/blind-cases.mjs keeps the cases.
 */
const SCRIPT_HOSTS = ["www.googletagmanager.com"];
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
     it. That is the intended state: GA4 is the analytics this site chose, and a second
     off-origin script for duplicate data is weight nobody asked for.
     So the question is not "is there an off-origin tag" but "is there an off-origin script
     that IS PERMITTED TO RUN and that we did not choose". A tag present in the markup AND
     allowed by script-src, without being on the deliberate list, is the actual failure. */
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
    : !named ? bad(`${p} script-src is missing an allowlisted analytics host: "${scriptSrc}"`)
    : strayHosts.length ? bad(`${p} script-src permits a host nobody chose: ${strayHosts.join(", ")}`)
    : ok(`${p} script-src permits exactly ${cspHosts.join(", ")} — parsed as hostnames, not matched as substrings`);

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
  const card = /Next settlement<\/div>\s*<div[^>]*>([^<]*)</.exec(r.body)?.[1]?.trim();
  const stampStr = /<time datetime="([^"]+)"/.exec(r.body)?.[1];
  if (!card || !stampStr) { bad(`${p} has no readable "Next settlement" card or render stamp`); continue; }
  if (card === "—") { ok(`${p.padEnd(16)} no next settlement published — dash, not a guess`); continue; }
  const m = /^(\d{2}):(\d{2})$/.exec(card);
  if (!m) { bad(`${p} "Next settlement" is not a HH:MM time: "${card}"`); continue; }
  const stamp = new Date(stampStr);
  const cand = new Date(stamp); cand.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  if (cand <= stamp) cand.setUTCDate(cand.getUTCDate() + 1);
  const aheadMin = Math.round((cand - stamp) / 60000);
  aheadMin <= 60
    ? ok(`${p.padEnd(16)} ${card} UTC, ${aheadMin} min after the page's own stamp (${stampStr.slice(11, 19)})`)
    : bad(`${p} "Next settlement ${card}" is ${aheadMin} min from the page's stamp ${stampStr.slice(11, 19)} — an hourly contract cannot settle that far out, so this time is in the past`);
}

/* 9. Data freshness, as served. */
console.log("\n9. data");
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
