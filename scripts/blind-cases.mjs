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
 * THE ALLOWLIST IS EMPTY AGAIN, AND THAT IS EXACTLY WHEN THIS FILE STOPS WORKING BY ACCIDENT.
 * The site ran Google Analytics for two days, so verify-live permitted one named Google host;
 * GA is gone and SCRIPT_HOSTS is `[]`. Rewriting these cases against the live allowlist would
 * have made every one of them expect FLAGGED — six assertions that pass because the exempt
 * branch is unreachable, proving nothing about the matcher and reporting green. That is the
 * defect this whole file was written to catch, arriving through the front door.
 *
 * So the cases test the MATCHER against a hypothetical allowlist, and a separate assertion
 * tests that the PRODUCTION allowlist is empty. Two questions, two tests: "does hostname
 * comparison reject a lookalike" is permanently answerable, and "is anything allowed today"
 * is answered by reading verify-live rather than by assuming.
 *
 * ANY ALLOWLIST COMPARED AS A STRING PREFIX HAS THIS HOLE. This file exists so the next one is
 * found by running it.
 *
 *   node scripts/blind-cases.mjs
 */
import { readFileSync } from "node:fs";
/* A HOST THAT IS NOT ALLOWED IN PRODUCTION, on purpose. The matcher does not care which name
   it is given, and using the retired GA host would read as though it were still permitted. */
const ALLOWED="cdn.example-allowed.test";
const cases=[
  ["the allowlisted host itself",        "https://cdn.example-allowed.test/x.js",                    true],
  ["lookalike host, prefix collision",   "https://cdn.example-allowed.test.evil.tld/x.js",           false],
  ["subdomain of the allowed host",      "https://evil.cdn.example-allowed.test/x.js",               false],
  ["the retired GA loader",              "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX", false],
  ["the cloudflare beacon",              "https://static.cloudflareinsights.com/beacon.min.js/v123", false],
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
/* AND THE OTHER QUESTION: what does verify-live actually permit today? Read, not assumed.
   If a host is ever added there, this fails and whoever added it has to say so here too. */
/* THE EXPECTED SET, WRITTEN OUT HERE SO ADDING A HOST IS TWO DELIBERATE EDITS RATHER THAN ONE.
   This used to assert the list was EMPTY, which is the same mechanism: a second file has to
   agree before a new off-origin script can pass the gate. It is no longer empty — the
   Cloudflare Web Analytics beacon was allowed on 27 August 2026 — so the assertion names what
   it expects instead of asserting nothing is there. Anything else appearing in verify-live,
   including a lookalike of this host, still fails here. */
const EXPECTED_SCRIPT_HOSTS = ["static.cloudflareinsights.com"];
{
  const src = readFileSync(new URL("./verify-live.mjs", import.meta.url), "utf8");
  const m = src.match(/const SCRIPT_HOSTS = \[([^\]]*)\]/);
  const hosts = m ? m[1].split(",").map((t)=>t.trim().replace(/^["']|["']$/g,"")).filter(Boolean) : null;
  const unexpected = hosts ? hosts.filter((h) => !EXPECTED_SCRIPT_HOSTS.includes(h)) : [];
  const missing = hosts ? EXPECTED_SCRIPT_HOSTS.filter((h) => !hosts.includes(h)) : EXPECTED_SCRIPT_HOSTS;
  if (!m) { bad++; console.log("  BLIND  SCRIPT_HOSTS not found in verify-live.mjs — this assertion is not reading anything"); }
  else if (unexpected.length) { bad++; console.log(`  BLIND  verify-live permits an off-origin script host nobody recorded here: ${unexpected.join(", ")}`); }
  else if (missing.length) { bad++; console.log(`  BLIND  verify-live no longer permits a host this file expects: ${missing.join(", ")} — was it removed on purpose?`); }
  else console.log(`  ok     NAMED   verify-live permits exactly the ${hosts.length} recorded host(s): ${hosts.join(", ")}`);
}

/* THE CSP RULE HAS CHANGED TWICE AND ITS BLIND CASES CHANGED WITH IT BOTH TIMES.
   It began as `'self'` and nothing else — any host in script-src failed. Google Analytics
   made that fail on correct behaviour, so it became NAMED HOSTS ARE FINE, A SCHEME OR A
   WILDCARD IS NOT. GA is gone and the allowlist is empty, so "self plus the GA host" — which
   this list asserted was SOUND right up until it was run today — is now a policy that must be
   rejected. It was caught by running the file rather than by reading it, which is the entire
   argument for the file.
   The predicate is unchanged and did not need to change: every named host must be one we
   chose. `https:` and `*` each permit every origin on the internet while reading, at a glance,
   like a policy; those two cases are why it is written this way rather than as "does it contain
   a hostname".

   A THIRD TIME, 27 AUGUST 2026, AND THIS LIST HAD A HOLE THE FIRST TWO HID. Every case below
   that expected SOUND was a policy naming NO host — so the branch that matters in production,
   "self plus a host we chose", had never once been exercised, and the list would have read as
   green whether that branch worked or not. It is now the case directly under this comment.
   The two rewrites before this one both left the allowlist empty, which is why nobody noticed:
   an assertion suite whose positive cases all sit on one side of the decision it guards is
   testing the other side only. */
const csps=[
  ["self only",                "'self' 'unsafe-inline'",                          true],
  /* PRODUCTION'S ACTUAL SHAPE since the Cloudflare beacon was allowed: 'self' plus exactly one
     chosen host. Written with the synthetic allowed name rather than the real one because this
     block tests the PREDICATE; which host is really permitted is asserted against verify-live
     a few lines above, where it can be compared with the live header. */
  ["self plus the one allowed host", "'self' 'unsafe-inline' https://cdn.example-allowed.test", true],
  ["self plus the retired GA host", "'self' 'unsafe-inline' https://www.googletagmanager.com", false],
  ["wildcard",                 "'self' *",                                        false],
  ["scheme allowed",           "'self' https:",                                   false],
  ["scheme buried mid-list",   "'self' https://www.googletagmanager.com https:",  false],
  ["no self at all",           "https://www.googletagmanager.com",                false],
  /* THE SUBSTRING HOLE, IN THE CHECK THAT WAS WRITTEN TO GUARD AGAINST IT. verify-live
     confirmed "script-src names hosts" with `scriptSrc.includes(host)`, which a lookalike
     satisfies. These two are the cases that must reject and that a substring test accepts. */
  ["lookalike host in script-src",  "'self' https://www.googletagmanager.com.evil.tld", false],
  ["allowed host as a subdomain of a hostile one", "'self' https://evil.tld/www.googletagmanager.com", false],
];
for(const [name,val,shouldPass] of csps){
  /* The predicate verify-live actually uses, transcribed: tokenise, parse each source as a
     hostname, and require every host to be one we chose. Not `includes`. */
  const hosts = val.split(/\s+/).filter(Boolean).map((t) => {
    if (t.startsWith("'")) return null;
    try { return new URL(t.includes("://") ? t : `https://${t}`).hostname; } catch { return null; }
  }).filter(Boolean);
  const sound = /'self'/.test(val)
    && !/(^|\s)(\*|https?:)(\s|$)/.test(val)
    && hosts.every((h) => h === ALLOWED);
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

/* THE INLINE-SCRIPT PARSER, whose coverage used to depend on attribute ORDER.
   A SyntaxError in an is:inline island kills every handler in it while the server render
   stays perfect — nothing else in this repository can see that. The regex required
   `is:inline` to be the first attribute, so the same broken script was caught or missed
   depending on how someone happened to type the tag. These fix the shape of the hole and
   pin down what must NOT be parsed either: external src has no body, and application/json
   blocks are data that would fail as code. */
{
  const { inlineScriptSyntax } = await import("./checks.mjs");
  const parseCases = [
    ["is:inline first, valid",             `<script is:inline>var a = 1;</script>`,                          false],
    ["is:inline first, broken",            `<script is:inline>var a = ;</script>`,                           true ],
    ["is:inline LAST, valid",              `<script define:vars={{x: 1}} is:inline>var a = x;</script>`,      false],
    ["is:inline LAST, broken — the gap",   `<script define:vars={{x: 1}} is:inline>var a = ;</script>`,       true ],
    ["is:inline mid-attrs, broken",        `<script async is:inline data-k="v">var a = ;</script>`,           true ],
    ["the const collision that shipped",   `<script is:inline>const v=1; const v=2;</script>`,               true ],
    ["external src has no body to parse",  `<script async is:inline src="https://x/y.js"></script>`,          false],
    ["application/json is data",           `<script type="application/json" id="pts-1">{"a":[1,2]}</script>`, false],
    ["ld+json is data",                    `<script type="application/ld+json">{"@type":"X"}</script>`,       false],
    ["a bundled module is Astro's job",    `<script>var a = ;</script>`,                                      false],
    ["define:vars names are predeclared",  `<script is:inline define:vars={{ KEY: "k", N: 2 }}>f(KEY,N);</script>`, false],
  ];
  for (const [name, html, shouldFlag] of parseCases) {
    const flagged = inlineScriptSyntax(html, "t").length > 0;
    const correct = flagged === shouldFlag;
    if (!correct) bad++;
    console.log(`  ${correct ? "ok  " : "BLIND"}  ${flagged ? "FLAGGED" : "clean  "}  inline parser: ${name}`);
  }
}

console.log(bad?`\n  ${bad} BLIND SPOT(S)`:"\n  no blind spots in these cases");
