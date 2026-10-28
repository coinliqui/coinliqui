#!/usr/bin/env node
/**
 * THE ARRIVAL COUNT, AGAINST THE REQUESTS IT MUST COUNT AND THE ONES IT MUST NOT.
 *
 * src/lib/entries.ts decides, from the browser's own Sec-Fetch headers, whether a request is a
 * person arriving and from where. The cases below are real request shapes: a ChatGPT link, a
 * typed address, a click inside the site, and the crawlers, fetchers, prefetches and preview hosts
 * that a naive "count every page load" would mix in. The blind half runs the same cases through
 * that naive counter and must fail, or this suite proves nothing about the rule.
 *
 *   node --experimental-strip-types scripts/entry-cases.mjs
 *   node --experimental-strip-types scripts/entry-cases.mjs --blind
 */
import { classifyEntry } from "../src/lib/entries.ts";

const blind = process.argv.includes("--blind");
const ORIGIN = "https://coinliqui.com";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const nav = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const req = (url, headers) => ({ method: "GET", url, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const HTML = { status: 200, contentType: "text/html; charset=utf-8" };

/** What the rule replaces: every GET of a page is an arrival. */
const naive = (r, res) => (r.method === "GET" && res.status === 200 && res.contentType.includes("text/html")
  ? { how: "external", src: "(none)", device: "desktop", path: new URL(r.url).pathname, day: "x" } : null);
const subject = blind ? naive : (r, res, country) => classifyEntry(r, res, ORIGIN, Date.UTC(2026, 9, 28, 12), country);

let bad = 0;
const ok = (cond, what) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${what}`); if (!cond) bad++; };
const is = (e, want) => e && Object.entries(want).every(([k, v]) => e[k] === v);

console.log(`\narrivals counted from the browser's own headers${blind ? "  [BLIND: every page load counts]" : ""}\n`);
ok(is(subject(req(`${ORIGIN}/liquidations/eth?utm_source=chatgpt.com`, { ...nav, "sec-fetch-site": "cross-site", "user-agent": CHROME }), HTML),
  { how: "external", src: "chatgpt.com", path: "/liquidations/eth", device: "desktop" }), "a ChatGPT link counts as an external arrival from chatgpt.com");
ok(is(subject(req(`${ORIGIN}/funding/btc`, { ...nav, "sec-fetch-site": "cross-site", referer: "https://www.google.com/", "user-agent": IPHONE }), HTML),
  { how: "external", src: "www.google.com", device: "mobile" }), "a Google result on a phone counts, with the referring host and the device");
ok(is(subject(req(`${ORIGIN}/funding/sol`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }), HTML, "GE"),
  { how: "direct", country: "GE" }), "the country Cloudflare reports is kept, so the operator's own visits can be set aside");
ok(is(subject(req(`${ORIGIN}/`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }), HTML),
  { how: "direct", src: "(none)" }), "a typed address or bookmark counts as direct");
ok(is(subject(req(`${ORIGIN}/coins`, { ...nav, "sec-fetch-site": "same-origin", referer: `${ORIGIN}/`, "user-agent": CHROME }), HTML),
  { how: "internal", src: "(site)" }), "a click inside the site is kept apart as internal");
ok(subject(req(`${ORIGIN}/funding/btc`, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), HTML) === null,
  "Googlebot, which sends no Sec-Fetch headers, is not a reader");
ok(subject(req(`${ORIGIN}/funding/btc`, { ...nav, "sec-fetch-site": "cross-site", "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" }), HTML) === null,
  "ChatGPT's own fetch is not a reader, even with browser headers");
ok(subject(req(`${ORIGIN}/funding/btc`, { "user-agent": "curl/8.7.1" }), HTML) === null, "curl is not a reader");
ok(subject(req(`${ORIGIN}/liquidations/eth`, { ...nav, "sec-fetch-site": "none", "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (+https://coinliqui.com/about; coinliqui-selfcheck)" }), HTML) === null,
  "the site's own phone-width sweep, a real Chrome on every page, is not 153 readers");
ok(subject(req(`${ORIGIN}/funding/eth`, { ...nav, "sec-fetch-site": "same-origin", "sec-purpose": "prefetch;prerender", "user-agent": CHROME }), HTML) === null,
  "a prerender is the browser guessing, not a person arriving");
ok(subject(req(`https://coinliqui.pages.dev/funding/btc`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }), HTML) === null,
  "a preview host is not the site");
ok(subject(req(`${ORIGIN}/funding/notacoin`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }), { status: 404, contentType: "text/html" }) === null,
  "a 404 is not an arrival at a page");
ok(subject(req(`${ORIGIN}/api/live.json`, { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", "user-agent": CHROME }), { status: 200, contentType: "application/json" }) === null,
  "the page's own data pull is not an arrival");

if (blind) {
  if (!bad) { console.error("\nBLIND: counting every page load satisfied every case. This suite cannot tell a reader from a fetcher."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against counting every page load`);
  process.exit(0);
}
if (bad) { console.error(`\nentry cases FAILED: ${bad}`); process.exit(1); }
console.log("\nentry cases: readers, their source and their device are told apart from everything else");
