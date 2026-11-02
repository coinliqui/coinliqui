#!/usr/bin/env node
/**
 * THE ARRIVAL COUNT, ON THE REQUEST SEQUENCES IT MUST COUNT AND THE ONES IT MUST NOT.
 *
 * src/lib/entries.ts decides on the page's request what an arrival would be, and counts it only
 * when the browser loads the page's 1x1 image. Each case below is a sequence of requests the
 * server sees — a reader from ChatGPT, a typed address, a click inside the site, and the clients
 * that are not readers: crawlers, ChatGPT's own fetch, curl, prerender, a preview host, the
 * site's own phone sweep, and the one that broke the first version: a scraper that sends a real
 * browser's Sec-Fetch headers and takes the HTML only (measured 30 October 2026, Chrome 142 on
 * macOS, 24 hours a day, no stylesheet, script or image).
 *
 * The blind half runs the same sequences through the first version — count the page's request
 * when its headers look like a browser's — and must fail on that scraper.
 *
 *   node --experimental-strip-types scripts/entry-cases.mjs
 *   node --experimental-strip-types scripts/entry-cases.mjs --blind
 */
import { classifyEntry, classifyBeacon, beaconUrl } from "../src/lib/entries.ts";

const blind = process.argv.includes("--blind");
const ORIGIN = "https://coinliqui.com";
const NOW = Date.UTC(2026, 10, 2, 12);
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const nav = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const req = (url, headers) => ({ method: "GET", url, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const HTML = { status: 200, contentType: "text/html; charset=utf-8" };

/** What a browser does with a page: the document, then the page's image, from the same agent. */
const browse = (url, headers, country = "US") => {
  const decided = classifyEntry(req(url, headers), HTML, ORIGIN, NOW, country);
  const out = [{ kind: "page", r: req(url, headers), country }];
  if (decided) out.push({ kind: "image", r: req(ORIGIN + beaconUrl(decided), { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin", referer: url, "user-agent": headers["user-agent"] }), country });
  return out;
};
/** What a page-fetching client does: the document and nothing else. */
const fetchOnly = (url, headers, country = "US") => [{ kind: "page", r: req(url, headers), country }];

/** The rule: count image requests the beacon accepts. */
const counted = (seq) => seq.filter((x) => x.kind === "image").map((x) => classifyBeacon(x.r, ORIGIN, NOW, x.country)).filter(Boolean);
/** The first version: count page requests that look like a browser's navigation. */
const countedV1 = (seq) => seq.filter((x) => x.kind === "page").map((x) => classifyEntry(x.r, HTML, ORIGIN, NOW, x.country)).filter(Boolean);
const count = blind ? countedV1 : counted;

let bad = 0;
const ok = (cond, what) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${what}`); if (!cond) bad++; };
const one = (seq, want) => { const c = count(seq); return c.length === 1 && Object.entries(want).every(([k, v]) => c[0][k] === v); };

console.log(`\narrivals, counted when the browser loads the page${blind ? "  [BLIND: the first version, counting the page's own request]" : ""}\n`);
ok(one(browse(`${ORIGIN}/liquidations/eth?utm_source=chatgpt.com`, { ...nav, "sec-fetch-site": "cross-site", "user-agent": CHROME }), { how: "external", src: "chatgpt.com", path: "/liquidations/eth", device: "desktop" }),
  "a reader from a ChatGPT link counts once, external, from chatgpt.com");
ok(one(browse(`${ORIGIN}/funding/btc`, { ...nav, "sec-fetch-site": "cross-site", referer: "https://www.google.com/", "user-agent": IPHONE }, "BR"), { how: "external", src: "www.google.com", device: "mobile", country: "BR" }),
  "a Google result on a phone counts, with the referring host, the device and the country");
ok(one(browse(`${ORIGIN}/`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }), { how: "direct", src: "(none)" }), "a typed address or bookmark counts as direct");
ok(one(browse(`${ORIGIN}/coins`, { ...nav, "sec-fetch-site": "same-origin", referer: `${ORIGIN}/`, "user-agent": CHROME }), { how: "internal", src: "(site)" }), "a click inside the site is kept apart as internal");

ok(count(fetchOnly(`${ORIGIN}/liquidations/near`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }, "US")).length === 0,
  "a scraper sending real browser headers and taking only the HTML is not a reader");
ok(count([...Array(24)].flatMap((_, i) => fetchOnly(`${ORIGIN}/liquidations/${["sol", "eth", "doge"][i % 3]}`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME }, ["US", "GB", "BR"][i % 3]))).length === 0,
  "the same scraper hourly across pages and countries for a day is still nobody");
ok(count(browse(`${ORIGIN}/funding/btc`, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })).length === 0, "Googlebot is not a reader");
ok(count(browse(`${ORIGIN}/funding/btc`, { ...nav, "sec-fetch-site": "cross-site", "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" })).length === 0,
  "ChatGPT's own fetch is not a reader, even with browser headers");
ok(count(browse(`${ORIGIN}/funding/btc`, { "user-agent": "curl/8.7.1" })).length === 0, "curl is not a reader");
ok(count(browse(`${ORIGIN}/funding/eth`, { ...nav, "sec-fetch-site": "same-origin", "sec-purpose": "prefetch;prerender", "user-agent": CHROME })).length === 0, "a prerender is the browser guessing, not a person arriving");
ok(count(browse(`https://coinliqui.pages.dev/funding/btc`, { ...nav, "sec-fetch-site": "none", "user-agent": CHROME })).length === 0, "a preview host is not the site");
ok(count(browse(`${ORIGIN}/liquidations/eth`, { ...nav, "sec-fetch-site": "none", "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (+https://coinliqui.com/about; coinliqui-selfcheck)" })).length === 0,
  "the site's own phone sweep, a real Chrome on every page, is not a reader");
ok(count([{ kind: "image", r: req(`${ORIGIN}/arrive?p=%2Ffunding%2Fbtc&s=(none)&h=direct`, { "user-agent": CHROME }), country: "US" }]).length === 0,
  "an image request without a browser's image headers or a page of this site behind it is not counted");

if (blind) {
  if (!bad) { console.error("\nBLIND: the first version satisfied every case. This suite cannot tell a reader from a page-fetching scraper."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against counting the page's own request`);
  process.exit(0);
}
if (bad) { console.error(`\nentry cases FAILED: ${bad}`); process.exit(1); }
console.log("\nentry cases: a reader is counted once, when the page is loaded; a client that takes the HTML is not");
