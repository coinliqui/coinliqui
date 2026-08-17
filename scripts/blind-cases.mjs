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
console.log(bad?`\n  ${bad} BLIND SPOT(S)`:"\n  no blind spots in these cases");
