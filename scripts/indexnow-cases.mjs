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
import { stepIndexNow, publishedUrls, retryDelayMs } from "../worker/indexnow.ts";

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

/* THE CLOCK IS PINNED, AND THE COIN CASES NOW USE IT RATHER THAN A HAND-PASSED LIST.
   publishedUrls took a coinSlugs argument and the one real caller passed `[]`, so all ten coin
   pages went unannounced from the day the template shipped. The argument is gone: which coins
   are published is a pure function of the coin table and the clock. These two instants straddle
   a real publication date in that table — four coins are live on the 15th, all ten by the 17th —
   so the case exercises the mechanism that actually publishes a coin URL. */
const T1 = Date.parse("2026-08-15T00:00:00Z");
const T2 = Date.parse("2026-08-17T12:00:00Z");
const base = publishedUrls(O, ["BTC", "ETH"], T1);
let bad = 0;
const check = async (...a) => { if (!(await run(...a))) bad++; };

/* THE CASE THIS EXISTS FOR: identical URL set, prices moved. Must submit nothing. */
await check("prices moved, URL set identical", base, base, (s) => s.length === 0);
await check("same set, ten passes in a row", base, base, (s) => s.length === 0);

/* A contract crossing the floor is a URL that did not exist. Must submit exactly it. */
const withNew = publishedUrls(O, ["BTC", "ETH", "SOL"], T1);
await check("a contract crosses the floor", base, withNew,
  (s) => s.length === 1 && s[0] === `${O}/funding/sol`);

/* The clock crossing a coin's publishAt, which is how a coin URL really comes into existence.
   Six coins share the later date, and all six must be announced — a version that announced only
   the first would pass a one-URL assertion. */
const withCoins = publishedUrls(O, ["BTC", "ETH"], T2);
await check("the clock crosses six coins' publication date", base, withCoins,
  (s) => s.length === 6 && s.every((u) => u.startsWith(`${O}/coins/`)) &&
         s.includes(`${O}/coins/litecoin`) && s.includes(`${O}/coins/bnb`));

/* First run must NOT announce everything — that is the bulk dump the design refuses. */
await check("first run, no state at all", undefined, base,
  (s, line, stored) => s.length === 0 && /baseline/.test(line) && stored.known.length === base.length && !stored.pending);

/* A contract dropping below the floor removes a URL. Nothing to announce, and the state must
   follow so that its return later counts as new again. */
const fewer = publishedUrls(O, ["BTC"], T1);
await check("a contract retires below the floor", base, fewer, (s) => s.length === 0);

/* A failed submission must not record the URLs as sent, or they are lost forever. The invariant
   is no longer "the state is byte-identical" — `known` advances unconditionally now, because it
   is a record of what has been published rather than a receipt. What must hold is that every
   endpoint is still OWED the URL and will be offered it again. */
{
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const store = kv(base);
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const st = store.read();
  const owed = Object.values(st.pending ?? {});
  const held = owed.length === 5 && owed.every((l) => l.includes(`${O}/funding/sol`));
  console.log(`  ${held ? "ok  " : "FAIL"}  ${"every endpoint 500 — all five still owe the URL".padEnd(52)} ${owed.length}/5 owed`);
  if (!held) { bad++; console.log(`        line: ${line}`); }
}

/* THE CASE THE LIVE RUN TAUGHT. Announcing the twenty-two previously-unannounced URLs returned
   429 from the aggregator AND from Bing while three others accepted. Under a single shared state
   that advanced on any acceptance, those URLs would never have been offered to Bing again —
   losing the one index this project has no other account-free route into.

   The assertion moved once, deliberately. It used to require Bing be retried on the very NEXT
   pass; that was the behaviour before backoff existed, and it is the behaviour that turned into
   288 identical payloads a day against an endpoint refusing on IP grounds. What must hold now:
   Bing keeps the URL, the four that accepted are not resent, and nothing goes to Bing until its
   window opens. The retry itself is asserted by the expired-backoff case below. */
{
  let round = 0;
  const seenBy = [];
  globalThis.fetch = async (url, opts) => {
    const h = new URL(url).hostname.replace(/^www\./, "");
    seenBy.push(`${round}:${h}:${JSON.parse(opts.body).urlList.join("|")}`);
    const ok = h !== "bing.com";
    return { ok, status: ok ? 200 : 429 };
  };
  const store = kv(base);
  await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const afterFirst = store.read();
  round = 1;
  const line2 = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const afterSecond = store.read();

  const bingOwed = (afterFirst.pending?.["bing.com"] ?? []).includes(`${O}/funding/sol`);
  const bingThrottled = (afterFirst.backoff?.["bing.com"]?.fails ?? 0) === 1;
  const othersCleared = Object.keys(afterFirst.pending ?? {}).length === 1;
  const secondPassSilent = !seenBy.some((e) => e.startsWith("1:"));
  const stillOwed = (afterSecond.pending?.["bing.com"] ?? []).includes(`${O}/funding/sol`);
  const named = /bing\.com in backoff/.test(line2);
  const ok = bingOwed && bingThrottled && othersCleared && secondPassSilent && stillOwed && named;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"bing 429s: it alone stays owed, and nothing is resent".padEnd(52)} ${secondPassSilent ? "second pass silent" : "SECOND PASS SENT"}`);
  if (!ok) { bad++; console.log(`        after first: ${JSON.stringify(afterFirst.pending)} ${JSON.stringify(afterFirst.backoff)}\n        calls: ${seenBy.join(" ")}\n        line: ${line2}`); }
}

/* THE BACKLOG WITHOUT BACKOFF WAS THE ABUSE THE BASELINE RULE EXISTS TO PREVENT, aimed at
   somebody else's endpoint instead of our own state: an endpoint refusing permanently got the
   same 22-URL payload every five minutes, 288 times a day. And the refusal IS permanent-ish —
   measured, not assumed: api.indexnow.org and www.bing.com returned 429 to the Worker three
   times over ninety minutes while the byte-identical payload returned 200 from a laptop. Same
   host, key, URL list and minute; only the source IP differed. Both are Microsoft-run and they
   throttle Cloudflare's shared Workers egress. */
{
  const delays = [1, 2, 3, 4, 8, 12, 20].map((f) => [f, Math.round(retryDelayMs(f) / 60_000)]);
  const want = [[1, 5], [2, 10], [3, 20], [4, 40], [8, 640], [12, 720], [20, 720]];
  const ok = JSON.stringify(delays) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"the retry delay doubles and caps at 12 hours".padEnd(52)} ${delays.map(([f, m]) => `${f}:${m}m`).join(" ")}`);
  if (!ok) bad++;
}

{
  /* An endpoint whose nextAt is in the future must be skipped entirely — and a NEW url arriving
     must not be an excuse to retry it early, because the backlog is what carries the new url
     until the window opens. */
  posted = [];
  globalThis.fetch = async (url, opts) => { posted.push({ host: new URL(url).hostname.replace(/^www\./, ""), body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
  const far = Date.now() + 6 * 3_600_000;
  const store = kv({
    known: base,
    pending: { "bing.com": [`${O}/terms`], "api.indexnow.org": [`${O}/terms`] },
    backoff: { "bing.com": { fails: 7, nextAt: far }, "api.indexnow.org": { fails: 7, nextAt: far } },
  });
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const hosts = posted.map((p) => p.host);
  const skippedBoth = !hosts.includes("bing.com") && !hosts.includes("api.indexnow.org");
  const othersSent = hosts.includes("yandex.com") && hosts.includes("search.seznam.cz") && hosts.includes("searchadvisor.naver.com");
  const st = store.read();
  /* THE NEW URL SPECIFICALLY, NOT "THE BACKLOG IS NON-EMPTY".
     This read `.length > 0`, and the store above is SEEDED with pending: {"bing.com": [.../terms]}
     — so the assertion was satisfied by its own fixture and would have passed whether or not the
     new URL was carried. It was not being carried: the backoff branch in worker/indexnow.ts
     `continue`d without writing the list, while `known` advanced, so a URL that first appeared
     during a backoff window was never announced to that endpoint at all. The test asserted a
     proxy for the property, the property was false, and the gate was green for both.
     Assert the thing: sol must be in bing's backlog, and the seeded url must still be there too. */
  const bingOwes = st.pending?.["bing.com"] ?? [];
  const stillOwed = bingOwes.includes(`${O}/funding/sol`) && bingOwes.includes(`${O}/terms`)
    && (st.backoff?.["bing.com"]?.nextAt ?? 0) === far;
  const named = /backoff/.test(line);
  const ok = skippedBoth && othersSent && stillOwed && named;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"two endpoints in backoff are skipped, three still sent".padEnd(52)} sent to ${hosts.join(",") || "nobody"}`);
  if (!ok) { bad++; console.log(`        line: ${line}\n        backoff: ${JSON.stringify(st.backoff)}\n        bing owes: ${JSON.stringify(bingOwes)}`); }
}

{
  /* Success clears both the backlog and the backoff, so a recovered endpoint returns to the
     ordinary five-minute cadence instead of staying throttled for ever. */
  posted = [];
  globalThis.fetch = async (url, opts) => { posted.push({ host: new URL(url).hostname.replace(/^www\./, ""), body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
  const store = kv({
    known: base,
    pending: { "bing.com": [`${O}/terms`] },
    backoff: { "bing.com": { fails: 3, nextAt: Date.now() - 1000 } },
  });
  const line = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const st = store.read();
  const cleared = !(st.backoff ?? {})["bing.com"] && !(st.pending ?? {})["bing.com"];
  const retried = posted.some((p) => p.host === "bing.com" && p.body.urlList.includes(`${O}/terms`));
  const ok = cleared && retried;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"an expired backoff retries, and success clears both".padEnd(52)} ${retried ? "retried" : "NOT RETRIED"}, ${cleared ? "cleared" : "STILL SET"}`);
  if (!ok) { bad++; console.log(`        line: ${line}\n        state: ${JSON.stringify(st)}`); }
}

/* =====================================================================================
   "ALL PREVIOUSLY SUBMITTED AND ACCEPTED" WAS PRINTED AFTER ZERO SUBMISSIONS.

   The quiet-pass line is reached when `owed.size === 0`, which means no endpoint has a backlog
   and nothing is fresh. It says nothing whatever about whether anything was ever sent — and
   `known`, the field it was reasoning from, carries a comment saying so in as many words: "it
   is a record, not a receipt".

   Measured, not argued: with a fresh state and a fetch stub that counts POSTs, pass 1 returns
   "first run, recorded 3 URLs as the baseline WITHOUT SUBMITTING" and pass 2 returns "all
   previously submitted and accepted", with zero POSTs across both. Two lines in one log, one
   tick apart, flatly contradicting each other.

   Who it misleads: an operator scanning /status for why nothing is indexed reads "submitted and
   accepted" and looks somewhere else, when the truth is that no URL on this site has ever been
   announced to any endpoint. `sentAt` is the difference, and these are its cases.
   ===================================================================================== */
{
  const urls = ["/", "/funding/btc", "/funding/eth"].map((p) => `${O}${p}`);
  let sent = 0;
  globalThis.fetch = async () => { sent++; return { ok: true, status: 200 }; };
  const store = kv();
  await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, urls);      // baseline, sends nothing
  const quiet = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, urls);
  const honest = sent === 0 && /never been accepted|recorded baseline/.test(quiet) && !/previously submitted and accepted/.test(quiet);
  console.log(`  ${honest ? "ok  " : "FAIL"}  ${"a quiet pass after a baseline does not claim a submission".padEnd(52)} ${sent} POST(s), says: ${quiet.slice(20, 96)}`);
  if (!honest) bad++;

  /* THE OTHER HALF, so this is not satisfied by a line that never claims anything. Once an
     endpoint has accepted, the quiet pass must say so and must carry the date. */
  const withNew = [...urls, `${O}/funding/sol`];
  await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const after = await stepIndexNow({ SNAPSHOT: store, SITE_ORIGIN: O }, withNew);
  const claims = sent > 0 && /last accepted \d{4}-\d{2}-\d{2}/.test(after);
  console.log(`  ${claims ? "ok  " : "FAIL"}  ${"and does claim one, with a date, once an endpoint accepts".padEnd(52)} ${sent} POST(s), says: ${after.slice(20, 96)}`);
  if (!claims) bad++;

  /* A state written before sentAt existed must read as "never accepted" rather than throwing or
     silently claiming success — the conservative direction, self-correcting on the first send. */
  const legacy = kv({ known: urls });
  const line = await stepIndexNow({ SNAPSHOT: legacy, SITE_ORIGIN: O }, urls);
  const safe = /never been accepted|recorded baseline/.test(line);
  console.log(`  ${safe ? "ok  " : "FAIL"}  ${"a state predating sentAt reads as never-accepted".padEnd(52)} ${line.slice(20, 96)}`);
  if (!safe) bad++;
}

console.log(bad ? `\n  ${bad} case(s) wrong` : "\n  submits only on a URL that did not exist before, never on a price tick, never forgets an endpoint that refused, and never hammers one that keeps refusing");
process.exit(bad ? 1 : 0);
