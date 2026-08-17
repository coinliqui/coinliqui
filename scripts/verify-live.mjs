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
 * This mattered more than it looks. Node's fetch defaults to `Accept: * / *`, and Cloudflare
 * only injects its Web Analytics beacon into responses for requests whose Accept header asks
 * for HTML. So the beacon check below — the one guarding the published claim that this site
 * loads no third-party scripts — passed for a year of runs while every real visitor was being
 * served exactly the script it was written to catch. A verifier that does not look like the
 * thing it is verifying is worse than no verifier: it produces confident green.
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
    if (/\/funding\/[a-z0-9]/i.test(u) && r.status === 200 && !/data-tfpanel="[^"]+" [^>]*data-on/.test(r.body)) {
      hollow.push(u);
    }
  }
  broken.length ? bad(`non-200: ${broken.join(", ")}`) : ok("every sitemap URL 200 as GPTBot");
  thin.length ? bad(`missing brand: ${thin.join(", ")}`) : ok("every sitemap URL carries the brand");
  hollow.length ? bad(`contract page with no chart panel: ${hollow.join(", ")}`) : ok("every contract page renders a chart");

  /* Withdrawn URLs must stay withdrawn. A 410 that silently becomes a 200 or a 301 puts a
     commodity page back into the index, which is the whole thing the removal was for. */
  for (const [p, want] of [["/tools/liquidation-price", 410]]) {
    const r = await fetchAs(p, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    if (r.status !== want) gone.push(`${p} is ${r.status}, expected ${want}`);
    if (urls.some((u) => pathOf(u) === p)) gone.push(`${p} is still listed in a sitemap`);
  }
  gone.length ? bad(gone.join("; ")) : ok("withdrawn URLs return 410 and are absent from the sitemaps");
}

/* 6. The /privacy claim: no analytics, no third-party script, zero off-origin requests. */
console.log("\n6. privacy claim");
for (const p of ["/", "/funding/btc"]) {
  const r = await fetchAs(p);
  // A canonical <link> is a hint, not a subresource — it costs the reader no request, and
  // on a preview host it legitimately points at the apex. Only things the browser FETCHES
  // count against the /privacy claim.
  const ext = [...r.body.matchAll(/<(?:script|img|iframe)[^>]*src="(https?:\/\/[^"]+)"|<link(?![^>]*rel="(?:canonical|alternate)")[^>]*href="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1] || m[2]).filter((u) => u && !u.startsWith(ORIGIN) && !u.startsWith("https://schema.org"));
  ext.length ? bad(`${p} loads off-origin: ${ext.join(", ")}`) : ok(`${p} zero off-origin subresources`);
  /* Checked under BOTH Accept headers, because the injection is conditional on it and the
     browser case is the one the claim is about. Keeping the `* / *` probe alongside is not
     redundancy — a difference between the two is itself the finding. */
  /* THE CHECK CHANGED WHEN THE CLAIM DID. The host injects a Web Analytics tag at its edge,
     after this Worker has finished, and the credential needed to switch that off is not one
     this project holds. /privacy now states that plainly and stakes the guarantee on the thing
     that is actually enforceable: the browser refuses to fetch it. So the assertion here is no
     longer "no beacon tag exists" — which we cannot make true — but the two that we can:
     the ONLY off-origin script is that known tag, and the CSP that neuters it is intact.
     A NEW third-party script, or a weakened script-src, still fails. */
  const KNOWN_BLOCKED = /static\.cloudflareinsights\.com/;
  const beacon = /beacon\.min\.js|cloudflareinsights|\/cdn-cgi\/(rum|challenge-platform|zaraz)/;
  const wild = await fetchAs(p, "Mozilla/5.0", "*/*");
  const otherThirdParty = [...r.body.matchAll(/<script[^>]*src="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1]).filter((u) => !u.startsWith(ORIGIN) && !KNOWN_BLOCKED.test(u));
  const csp = r.headers.get("content-security-policy") ?? "";
  const scriptSrc = (csp.match(/script-src ([^;]*)/) ?? [, ""])[1];
  const cspSound = /'self'/.test(scriptSrc) && !/https?:|\*/.test(scriptSrc);
  otherThirdParty.length
    ? bad(`${p} loads an UNKNOWN third-party script: ${otherThirdParty.join(", ")}`)
    : !cspSound
    ? bad(`${p} script-src no longer confines scripts to this origin: "${scriptSrc.trim()}"`)
    : ok(`${p} only the known CSP-blocked tag off-origin (browser Accept: ${beacon.test(r.body)}, */*: ${beacon.test(wild.body)}); script-src confines to self`);
  r.headers.get("set-cookie") ? bad(`${p} sets a cookie: ${r.headers.get("set-cookie")}`) : ok(`${p} sets no cookie`);
}

/* 7. Data freshness, as served. */
console.log("\n7. data");
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
