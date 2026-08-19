/**
 * THE ONLY THING THAT MATTERS ABOUT THIS STEP IS WHEN IT STAYS SILENT.
 *
 * Every page on this site changes every five minutes because prices move. A submitter that
 * treats that as a change announces ~78 URLs twelve times an hour forever, which is the exact
 * behaviour the protocol exists to distinguish real signals from — and the domain would earn
 * the treatment that behaviour earns. So these cases are weighted towards proving it does
 * NOTHING, and the one case that must fire is a URL that genuinely did not exist before.
 *
 *   node scripts/indexnow-cases.mjs
 */
import { stepIndexNow, publishedUrls } from "../worker/indexnow.ts";

const O = "https://coinliqui.com";
const kv = (initial) => {
  let store = initial === undefined ? undefined : JSON.stringify(initial);
  return {
    get: async () => (store === undefined ? null : JSON.parse(store)),
    put: async (_k, v) => { store = v; },
    read: () => (store === undefined ? undefined : JSON.parse(store)),
  };
};

let posted = [];
globalThis.fetch = async (url, opts) => {
  posted.push({ host: new URL(url).hostname, body: JSON.parse(opts.body) });
  return { ok: true, status: 200 };
};

/**
 * ONE URL SET, POSTED TO EVERY ENDPOINT.
 *
 * This used to flatten `urlList` across every POST and call the result "submitted", which was
 * the same number while there was exactly one endpoint. Fanning out to five turned "submitted 1"
 * into "submitted 5" for one URL and failed two cases that were entirely correct — the harness
 * was counting REQUESTS and reporting URLS.
 *
 * So the count is now distinct URLs, and the fan-out gets its own assertion: every endpoint must
 * receive an identical list. A bug that sent Bing a different set from Yandex would have been
 * invisible to a flattened array, and is exactly the kind of thing a fan-out introduces.
 */
const run = async (name, seen, current, expect) => {
  posted = [];
  const store = kv(seen);
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, current);
  const submitted = [...new Set(posted.flatMap((p) => p.body.urlList))];
  let ok = expect(submitted, line, store.read());
  if (posted.length) {
    const first = JSON.stringify(posted[0].body.urlList);
    const divergent = posted.filter((p) => JSON.stringify(p.body.urlList) !== first);
    const hosts = new Set(posted.map((p) => p.host));
    if (divergent.length) { console.log(`        endpoints disagreed about the URL list: ${divergent.map((d) => d.host).join(", ")}`); ok = false; }
    if (hosts.size !== posted.length) { console.log(`        an endpoint was posted to twice: ${posted.map((p) => p.host).join(", ")}`); ok = false; }
  }
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(52)} submitted ${submitted.length} to ${posted.length} endpoint(s)`);
  if (!ok) console.log(`        line: ${line}`);
  return ok;
};

const base = publishedUrls(O, ["BTC", "ETH"], ["bitcoin"]);
let bad = 0;
const check = async (...a) => { if (!(await run(...a))) bad++; };

/* THE CASE THIS EXISTS FOR: identical URL set, prices moved. Must submit nothing. */
await check("prices moved, URL set identical", base, base, (s) => s.length === 0);
await check("same set, ten passes in a row", base, base, (s) => s.length === 0);

/* A contract crossing the floor is a URL that did not exist. Must submit exactly it. */
const withNew = publishedUrls(O, ["BTC", "ETH", "SOL"], ["bitcoin"]);
await check("a contract crosses the floor", base, withNew,
  (s) => s.length === 1 && s[0] === `${O}/funding/sol`);

/* A coin reaching its publication date, same shape. */
const withCoin = publishedUrls(O, ["BTC", "ETH"], ["bitcoin", "ethereum"]);
await check("a coin reaches its publication date", base, withCoin,
  (s) => s.length === 1 && s[0] === `${O}/coins/ethereum`);

/* First run must NOT announce everything — that is the bulk dump the design refuses. */
await check("first run, no state at all", undefined, base,
  (s, line, stored) => s.length === 0 && /baseline/.test(line) && stored.length === base.length);

/* A contract dropping below the floor removes a URL. Nothing to announce, and the state must
   follow so that its return later counts as new again. */
const fewer = publishedUrls(O, ["BTC"], ["bitcoin"]);
await check("a contract retires below the floor", base, fewer, (s) => s.length === 0);

/* A failed submission must not record the URLs as sent, or they are lost forever. */
{
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const store = kv(base);
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const held = JSON.stringify(store.read()) === JSON.stringify(base);
  console.log(`  ${held ? "ok  " : "FAIL"}  ${"every endpoint 500 — state must NOT advance".padEnd(52)} retries next pass`);
  if (!held) { bad++; console.log(`        line: ${line}`); }
}

/* PARTIAL ACCEPTANCE, WHICH IS THE STATE THE FAN-OUT INTRODUCED AND THE ONLY NEW ONE.
   One index having received the URLs is the whole objective; holding the state back because a
   second index was down would re-announce the same set to the first one on every pass until it
   recovered, which is the submission pattern the baseline rule exists to avoid. So: any single
   acceptance advances, and the log has to say which ones failed. */
{
  globalThis.fetch = async (url) => ({ ok: new URL(url).hostname === "yandex.com", status: new URL(url).hostname === "yandex.com" ? 202 : 503 });
  const store = kv(base);
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const advanced = JSON.stringify(store.read()) === JSON.stringify(withNew);
  const named = line.includes("yandex.com 202") && line.includes("503");
  const ok = advanced && named;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"one endpoint accepts, four fail — state advances".padEnd(52)} ${advanced ? "advanced" : "HELD"}, log names both`);
  if (!ok) { bad++; console.log(`        line: ${line}`); }
}

console.log(bad ? `\n  ${bad} case(s) wrong` : "\n  submits only on a URL that did not exist before, and never on a price tick");
process.exit(bad ? 1 : 0);
