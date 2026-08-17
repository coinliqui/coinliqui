#!/usr/bin/env node
/**
 * THE CASE WHERE A CHECK WOULD PASS WHILE BEING BLIND.
 *
 * Every consistency check written for this repository has been wrong in its first form — four
 * for four — and reality caught each one, never review. So each allowlist gets its adversarial
 * case written down HERE and run, rather than reasoned about in a comment.
 *
 * The one this file was written for: verify-live exempted an analytics host with
 * `url.startsWith("https://...")`, which also matches https://....evil.tld/x.js. The same
 * shape was in two more comparisons on the same line, and `u.startsWith(ORIGIN)` was the
 * worst of them: it treated https://coinliqui.com.evil.tld/x.js as same-origin and exempted
 * it outright.
 *
 * THESE CASES MATTER MORE SINCE THE ALLOWLIST GREW, not less. The site now runs Google
 * Analytics on purpose, so verify-live permits off-origin scripts from named Google hosts
 * instead of permitting none. Every host added to an allowlist is another prefix an attacker
 * can extend, so the exempt host below is the one actually in use rather than a retired one.
 *
 * ANY ALLOWLIST COMPARED AS A STRING PREFIX HAS THIS HOLE. This file exists so the next one is
 * found by running it.
 *
 *   node scripts/blind-cases.mjs
 */
const ORIGIN="https://coinliqui.com", ALLOWED="www.googletagmanager.com";
const cases=[
  ["the real GA loader",                 "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX", true],
  ["lookalike host, prefix collision",   "https://www.googletagmanager.com.evil.tld/x.js",           false],
  ["subdomain of the allowed host",      "https://evil.www.googletagmanager.com/x.js",               false],
  ["different google host, not listed",  "https://tagmanager.google.com/x.js",                       false],
  ["the retired cloudflare beacon",      "https://static.cloudflareinsights.com/beacon.min.js/v123", false],
  ["unrelated third party",              "https://cdn.example.net/tracker.js",                       false],
];
let bad=0;
for(const [name,url,shouldPass] of cases){
  const exempt = (()=>{try{return new URL(url).hostname===ALLOWED}catch{return false}})();
  const verdict = exempt ? "EXEMPT" : "FLAGGED";
  const correct = exempt === shouldPass;
  if(!correct) bad++;
  console.log(`  ${correct?"ok  ":"BLIND"}  ${verdict.padEnd(7)} ${name}`);
  if(!correct) console.log(`          ^^ ${url}`);
}
/* THE CSP RULE CHANGED AND ITS BLIND CASES CHANGED WITH IT.
   The old predicate was `'self'` and nothing else — any host in script-src failed. That
   encoded "no third-party scripts", a rule this project has retired, and it would now fail on
   the correct policy. The predicate that replaces it is the one that was always doing the
   work: NAMED HOSTS ARE FINE, A SCHEME OR A WILDCARD IS NOT. `https:` and `*` each permit
   every origin on the internet while reading, at a glance, like a policy.
   The two cases that would have been dropped by simply loosening the old test — "scheme
   allowed" and "wildcard" — are exactly why the predicate is written this way. */
const csps=[
  ["self only",                "'self' 'unsafe-inline'",                          true],
  ["self plus the GA host",    "'self' 'unsafe-inline' https://www.googletagmanager.com", true],
  ["wildcard",                 "'self' *",                                        false],
  ["scheme allowed",           "'self' https:",                                   false],
  ["scheme buried mid-list",   "'self' https://www.googletagmanager.com https:",  false],
  ["no self at all",           "https://www.googletagmanager.com",                false],
];
for(const [name,val,shouldPass] of csps){
  const sound = /'self'/.test(val) && !/(^|\s)(\*|https?:)(\s|$)/.test(val);
  const correct = sound === shouldPass;
  if(!correct) bad++;
  console.log(`  ${correct?"ok  ":"BLIND"}  ${sound?"SOUND ":"REJECT"}  script-src ${val}`);
}
/* THE FLIP FEED'S COLOUR RULE, and its own blind spots.
   Red and green here mean the direction of a funding payment and nothing else, and the flip
   table broke that in the worst available way — it coloured a rate up to 24 hours old, so a
   contract whose direction had reversed showed the opposite of the truth. flipTableColour()
   guards it. These are the ways that guard could pass while seeing nothing: no section, no
   table (the gate's D1 fixture was empty for the feed's whole life), no rows, or the column
   it anchors on renamed away. Each must be RED, or the check is decorative. */
{
  const { flipTableColour } = await import("./checks.mjs");
  const head = `<h2>Funding sign flips</h2><table><thead><tr><th>Coin</th><th>Venue</th><th class="num">Was (APR)</th><th class="num">After the flip</th><th class="num">Now (APR)</th><th class="num">Detected (UTC)</th></tr></thead>`;
  const row = (after, now) => `<tr><td class="sym">JUP</td><td class="dim">Bybit</td><td class="num dim">-1.0%</td><td class="num ${after}">2.0%</td><td class="num ${now}">3.0%</td><td class="num faint">09:12 UTC</td></tr>`;
  const page = (rows) => head + "<tbody>" + rows + "</tbody></table><h2>Funding rates by coin</h2>";
  const flips = [
    ["colour only on Now (APR)",                       page(row("dim", "pays-s")),  false],
    ["the original defect: colour on After the flip",  page(row("pays-s", "pays-s")), true],
    ["colour on a historical column, none on Now",     page(row("pays-l", "dim")),  true],
    ["table absent — the empty-fixture case",          `<h2>Funding sign flips</h2><div class="empty">Collecting funding history</div><h2>Funding rates by coin</h2>`, true],
    ["table present, zero rows",                       page(""),                    true],
    ["the anchor column renamed away",                 head.replace("Now (APR)", "Current") + "<tbody>" + row("dim", "pays-s") + "</tbody></table><h2>Funding rates by coin</h2>", true],
    ["section removed entirely",                       `<h2>Something else</h2>`,   true],
  ];
  for (const [name, html, shouldFlag] of flips) {
    const flagged = flipTableColour(html).length > 0;
    const correct = flagged === shouldFlag;
    if (!correct) bad++;
    console.log(`  ${correct ? "ok  " : "BLIND"}  ${flagged ? "FLAGGED" : "clean  "}  flip feed: ${name}`);
  }
}

console.log(bad?`\n  ${bad} BLIND SPOT(S)`:"\n  no blind spots in these cases");
