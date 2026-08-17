#!/usr/bin/env node
/**
 * THE CASE WHERE A CHECK WOULD PASS WHILE BEING BLIND.
 *
 * Every consistency check written for this repository has been wrong in its first form — four
 * for four — and reality caught each one, never review. So each allowlist gets its adversarial
 * case written down HERE and run, rather than reasoned about in a comment.
 *
 * The one this file was written for: verify-live exempted the host's injected analytics tag
 * with `url.startsWith("https://static.cloudflareinsights.com")`, which also matches
 * https://static.cloudflareinsights.com.evil.tld/x.js. The same shape was in two more
 * comparisons on the same line, and `u.startsWith(ORIGIN)` was the worst of them: it treated
 * https://coinliqui.com.evil.tld/x.js as same-origin and exempted it outright.
 *
 * ANY ALLOWLIST COMPARED AS A STRING PREFIX HAS THIS HOLE. This file exists so the next one is
 * found by running it.
 *
 *   node scripts/blind-cases.mjs
 */
const ORIGIN="https://coinliqui.com", INJECTED="https://static.cloudflareinsights.com";
const cases=[
  ["the real injected tag",              "https://static.cloudflareinsights.com/beacon.min.js/v123", true],
  ["lookalike host, prefix collision",   "https://static.cloudflareinsights.com.evil.tld/x.js",      false],
  ["different cloudflare host",          "https://cdn.cloudflareinsights.com/beacon.js",             false],
  ["unrelated third party",              "https://cdn.example.net/tracker.js",                      false],
];
let bad=0;
for(const [name,url,shouldPass] of cases){
  const exempt = (()=>{try{return new URL(url).hostname==="static.cloudflareinsights.com"}catch{return false}})();
  const verdict = exempt ? "EXEMPT" : "FLAGGED";
  const correct = exempt === shouldPass;
  if(!correct) bad++;
  console.log(`  ${correct?"ok  ":"BLIND"}  ${verdict.padEnd(7)} ${name}`);
  if(!correct) console.log(`          ^^ ${url}`);
}
const csps=[
  ["confined",                 "'self' 'unsafe-inline'",                    true],
  ["host allowlisted",         "'self' https://static.cloudflareinsights.com", false],
  ["wildcard",                 "'self' *",                                   false],
  ["scheme allowed",           "'self' https:",                              false],
];
for(const [name,val,shouldPass] of csps){
  const sound = /'self'/.test(val) && !/https?:|\*/.test(val);
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
