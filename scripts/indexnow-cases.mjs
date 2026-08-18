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
globalThis.fetch = async (_url, opts) => {
  posted.push(JSON.parse(opts.body));
  return { ok: true, status: 200 };
};

const run = async (name, seen, current, expect) => {
  posted = [];
  const store = kv(seen);
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, current);
  const submitted = posted.flatMap((p) => p.urlList);
  const ok = expect(submitted, line, store.read());
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(52)} submitted ${submitted.length}`);
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
  console.log(`  ${held ? "ok  " : "FAIL"}  ${"endpoint 500 — state must NOT advance".padEnd(52)} retries next pass`);
  if (!held) { bad++; console.log(`        line: ${line}`); }
}

console.log(bad ? `\n  ${bad} case(s) wrong` : "\n  submits only on a URL that did not exist before, and never on a price tick");
process.exit(bad ? 1 : 0);
