// src/lib/funding.ts
var HOURS_PER_YEAR = 24 * 365;
function toApr(ratePerInterval, intervalHours) {
  if (!Number.isFinite(ratePerInterval) || !Number.isFinite(intervalHours) || intervalHours <= 0) {
    return NaN;
  }
  return ratePerInterval * (HOURS_PER_YEAR / intervalHours);
}

// src/lib/hyperliquid.ts
var INFO = "https://api.hyperliquid.xyz/info";
var OI_NOTIONAL_FLOOR = 5e6;
var OI_RETIRE_FLOOR = 35e5;
var SYMBOL_CAP = 50;
async function info(body) {
  const send = () => fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  let r = await send();
  if (r.status === 429 || r.status === 502) {
    await new Promise((res) => setTimeout(res, 1200));
    r = await send();
  }
  if (!r.ok) throw new Error(`hyperliquid ${r.status}`);
  return await r.json();
}
var n = (x) => typeof x === "string" || typeof x === "number" ? Number(x) : NaN;
async function fetchSnapshot(published = []) {
  const [meta, predicted] = await Promise.all([
    info({ type: "metaAndAssetCtxs" }),
    info({ type: "predictedFundings" })
  ]);
  const [{ universe }, ctxs] = meta;
  const predictedBySymbol = new Map(predicted);
  const all = universe.map((u, i) => {
    const c = ctxs[i] ?? {};
    const markPx = n(c.markPx);
    const openInterest = n(c.openInterest);
    const prevDayPx = n(c.prevDayPx);
    const venues = (predictedBySymbol.get(u.name) ?? []).filter(([, v]) => v && Number.isFinite(Number(v.fundingRate)) && Number.isFinite(Number(v.fundingIntervalHours)) && Number(v.fundingIntervalHours) > 0).map(([venue, v]) => {
      const rate = Number(v.fundingRate);
      const intervalHours = v.fundingIntervalHours;
      return {
        venue,
        rate,
        intervalHours,
        apr: toApr(rate, intervalHours),
        nextFundingTime: v.nextFundingTime ?? null
      };
    });
    const aprs = venues.map((v) => v.apr).filter(Number.isFinite);
    return {
      symbol: u.name,
      markPx,
      oraclePx: n(c.oraclePx),
      prevDayPx,
      change24h: Number.isFinite(markPx) && prevDayPx ? markPx / prevDayPx - 1 : NaN,
      openInterest,
      oiNotional: openInterest * markPx,
      dayNtlVlm: n(c.dayNtlVlm),
      premium: n(c.premium),
      maxLeverage: u.maxLeverage,
      marginTableId: u.marginTableId,
      /* ONE HYPERLIQUID FUNDING NUMBER. There used to be two, on purpose, and the measurement
              that justified it expired.
      
              The note this replaces said: `hlApr` is metaAndAssetCtxs.funding, the rate for the
              interval NOW IN PROGRESS, while `venues` comes from predictedFundings, each venue's
              published rate for the NEXT interval — the only source that exists for Binance and
              Bybit and therefore the only basis on which venues can be compared. Both were labelled
              "funding". That was checked rather than assumed, across all 232 contracts: 188
              identical, worst disagreement 0.31pp, "none exceeding 1pp, and NO sign flips". On
              rates running to ±85% that was noise, so the two were left alone, and the note asked
              the next person not to unify them and call it a fix.
      
              Both bounds are now false. Measured live at one snapshot instant (2026-08-18T07:02:11Z,
              a single <time> stamp shared by /, /watchlist and /funding): 21 of 49 published coins
              disagreed, worst 12.0pp — PENDLE at -6.10% against +5.90% — and THREE contracts
              disagreed in SIGN. MON, JUP and PENDLE were painted green on /watchlist and red on
              /funding at the same second: the site told one reader shorts pay longs and another
              longs pay shorts, about the same contract on the same venue, in the one visual language
              reserved for that single meaning.
      
              There was a second contradiction inside a single row, independent of any drift.
              `aprSpread` below is max-min over `venues`, and /watchlist printed it in the column
              beside `hlApr`, which is not a member of that array. PENDLE: venues 5.90 / 2.48 / 10.95
              gives the 8.47% that was printed — but with -6.10% in the Hyperliquid column the spread
              would be 17.05%. Two adjacent cells of one row could not both be true.
      
              So `hlApr` is now Hyperliquid's entry in the same array the spread is computed from,
              and every page quotes one number. Nothing computed on the current-interval meaning —
              all six consumers were display — so this changes what is shown and not what is derived.
              The next-interval rate is also the honest one to colour: it is the payment that has not
              happened yet, which is what a reader deciding whether to hold is asking about. */
      hlApr: venues.find((v) => v.venue === "HlPerp")?.apr ?? NaN,
      venues,
      aprSpread: aprs.length >= 2 ? Math.max(...aprs) - Math.min(...aprs) : null
    };
  });
  const live = new Set(published);
  const eligible = all.filter(
    (p) => Number.isFinite(p.oiNotional) && (p.oiNotional >= OI_NOTIONAL_FLOOR || live.has(p.symbol) && p.oiNotional >= OI_RETIRE_FLOOR)
  ).sort((a, b) => b.oiNotional - a.oiNotional);
  return {
    available: true,
    fetchedAt: Date.now(),
    perps: eligible.slice(0, SYMBOL_CAP),
    // Reported on the site as "N of M clear the floor", so it counts the ENTRY floor only —
    // a number inflated by contracts kept alive on hysteresis would not match its own label.
    eligibleCount: all.filter((p) => Number.isFinite(p.oiNotional) && p.oiNotional >= OI_NOTIONAL_FLOOR).length,
    universeCount: all.length
  };
}
async function fetchLive(symbols) {
  const want = new Set(symbols);
  const [meta, predicted] = await Promise.all([
    info({ type: "metaAndAssetCtxs" }),
    info({ type: "predictedFundings" })
  ]);
  const [{ universe }, ctxs] = meta;
  const bySymbol = new Map(predicted);
  const out = { at: Date.now(), mark: {}, apr: {} };
  universe.forEach((u, i) => {
    if (!want.has(u.name)) return;
    const mk = n(ctxs[i]?.markPx);
    if (Number.isFinite(mk)) out.mark[u.name] = mk;
    const venues = {};
    for (const [venue, v] of bySymbol.get(u.name) ?? []) {
      if (!v) continue;
      const a = toApr(Number(v.fundingRate), Number(v.fundingIntervalHours));
      if (Number.isFinite(a)) venues[venue] = a;
    }
    if (Object.keys(venues).length) out.apr[u.name] = venues;
  });
  return out;
}

// src/lib/candles.ts
var INFO2 = "https://api.hyperliquid.xyz/info";
var CANDLE_DAYS = 800;
var CANDLE_HOURS = 1080;
var CANDLE_M15_MINUTES = 14 * 24 * 60;
async function fetchCandles(symbol, days = CANDLE_DAYS) {
  const end = Date.now();
  const start = end - days * 864e5;
  const r = await fetch(INFO2, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1d", startTime: start, endTime: end } })
  });
  if (!r.ok) throw new Error(`candles ${symbol} ${r.status}`);
  const raw = await r.json();
  const d = raw.filter((c) => Number(c.v) > 0).map((c) => [c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v)]);
  return { u: Date.now(), d };
}
async function fetchHourly(symbol, hours = CANDLE_HOURS) {
  const end = Date.now();
  const start = end - hours * 36e5;
  const r = await fetch(INFO2, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1h", startTime: start, endTime: end } })
  });
  if (!r.ok) throw new Error(`hourly ${symbol} ${r.status}`);
  const raw = await r.json();
  const d = raw.filter((c) => Number(c.v) > 0).map((c) => [c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v)]);
  return { u: Date.now(), d };
}
async function fetchM15(symbol, minutes = CANDLE_M15_MINUTES) {
  const end = Date.now();
  const start = end - minutes * 6e4;
  const r = await fetch(INFO2, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "15m", startTime: start, endTime: end } })
  });
  if (!r.ok) throw new Error(`m15 ${symbol} ${r.status}`);
  const raw = await r.json();
  const d = raw.filter((c) => Number(c.v) > 0).map((c) => [c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v)]);
  return { u: Date.now(), d };
}
async function fetchFundingHistory(symbol, sinceMs, endMs) {
  const r = await fetch(INFO2, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "fundingHistory", coin: symbol, startTime: sinceMs, ...endMs ? { endTime: endMs } : {} })
  });
  if (!r.ok) throw new Error(`fundingHistory ${symbol} ${r.status}`);
  const raw = await r.json();
  return raw.map((x) => [x.time, Number(x.fundingRate)]).filter((x) => Number.isFinite(x[1]));
}
function mergeFunding(prev, next, cap = 5200) {
  const m = /* @__PURE__ */ new Map();
  for (const [t, v] of prev) m.set(t, v);
  for (const [t, v] of next) m.set(t, v);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).slice(-cap).map(([t, v]) => [t, v]);
}

// src/lib/sweep-order.ts
function orderSweeps(states, now, backoffMs) {
  const eligible = states.filter((s) => !(s.stalledSince > 0 && now - s.stalledSince < backoffMs));
  return eligible.sort((a, b) => {
    const ac = a.cursor > 0 ? 1 : 0, bc = b.cursor > 0 ? 1 : 0;
    if (ac !== bc) return bc - ac;
    const ar = (now - a.lastCycle) / (a.hours * 36e5);
    const br = (now - b.lastCycle) / (b.hours * 36e5);
    if (ar !== br) return br - ar;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// src/lib/routes.ts
var PAGES_DATA = ["/", "/methodology"];
var PAGES_CODE = ["/about", "/methodology/liquidations", "/data-sources", "/privacy", "/terms"];
var TOOLS = ["/tools", "/tools/position-size", "/tools/leverage", "/tools/funding-cost", "/tools/funding-arbitrage"];
var LIQUIDATIONS = ["/liquidations", "/liquidations/sweep", "/liquidations/survival"];
var FUNDING_HUB = ["/funding"];
var OPEN_INTEREST = ["/open-interest"];
var UNLOCKS = ["/unlocks"];
var COINS_HUB = ["/coins"];
var STATIC_ROUTES = [
  ...PAGES_DATA,
  ...PAGES_CODE,
  ...COINS_HUB,
  ...FUNDING_HUB,
  ...OPEN_INTEREST,
  ...TOOLS,
  ...LIQUIDATIONS,
  ...UNLOCKS
];

// src/lib/coins.ts
var COINS = [
  {
    slug: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    publishAt: "2026-08-14",
    blurb: "The first and largest cryptocurrency, and the one whose derivatives market sets the tone for every other."
  },
  {
    slug: "ethereum",
    name: "Ethereum",
    symbol: "ETH",
    publishAt: "2026-08-14",
    blurb: "The largest smart-contract platform, and the second-largest perpetual market by open interest."
  },
  {
    slug: "solana",
    name: "Solana",
    symbol: "SOL",
    publishAt: "2026-08-14",
    blurb: "A high-throughput layer-1 whose perpetual funding is among the most volatile of the majors."
  },
  {
    slug: "xrp",
    name: "XRP",
    symbol: "XRP",
    publishAt: "2026-08-14",
    blurb: "A payment-focused asset with a large retail spot base and comparatively small open interest."
  },
  {
    slug: "bnb",
    name: "BNB",
    symbol: "BNB",
    publishAt: "2026-08-17",
    blurb: "The BNB Chain asset, listed here because its perpetual funding rarely matches its spot demand."
  },
  {
    slug: "dogecoin",
    name: "Dogecoin",
    symbol: "DOGE",
    publishAt: "2026-08-17",
    blurb: "The original memecoin, and a reliable example of funding running far ahead of spot."
  },
  {
    slug: "cardano",
    name: "Cardano",
    symbol: "ADA",
    publishAt: "2026-08-17",
    blurb: "A research-led layer-1 with deep spot liquidity relative to its open interest."
  },
  {
    slug: "avalanche",
    name: "Avalanche",
    symbol: "AVAX",
    publishAt: "2026-08-17",
    blurb: "A layer-1 with a subnet architecture, and one of the smaller major perpetual markets by open interest."
  },
  {
    slug: "chainlink",
    name: "Chainlink",
    symbol: "LINK",
    publishAt: "2026-08-17",
    blurb: "The dominant oracle network, whose token trades with unusually persistent positive funding."
  },
  {
    slug: "litecoin",
    name: "Litecoin",
    symbol: "LTC",
    publishAt: "2026-08-17",
    blurb: "One of the oldest altcoins, with a long, clean price history and a modest derivatives market."
  }
];
var isLive = (c, now = Date.now()) => Date.parse(c.publishAt + "T00:00:00Z") <= now;
var liveCoins = (now = Date.now()) => COINS.filter((c) => isLive(c, now));

// worker/indexnow.ts
var INDEXNOW_KEY = "a7f3c19e84b24d6fa0e5b17c93d82f46";
var ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
  "https://yandex.com/indexnow",
  "https://search.seznam.cz/indexnow",
  "https://searchadvisor.naver.com/indexnow"
];
var MAX_URLS = 200;
var STATE_KEY = "indexnow:submitted";
function publishedUrls(origin, symbols, now = Date.now()) {
  return [
    ...STATIC_ROUTES.map((r) => `${origin}${r === "/" ? "/" : r}`),
    ...symbols.map((s) => `${origin}/funding/${s.toLowerCase()}`),
    ...liveCoins(now).map((c) => `${origin}/coins/${c.slug}`)
  ];
}
var retryDelayMs = (fails) => Math.min(5 * 6e4 * 2 ** Math.max(0, fails - 1), 12 * 36e5);
var readState = (raw) => Array.isArray(raw) ? { known: raw } : raw && typeof raw === "object" && Array.isArray(raw.known) ? raw : null;
async function stepIndexNow(env, current) {
  const origin = env.SITE_ORIGIN || "https://coinliqui.com";
  const host = new URL(origin).host;
  let st;
  try {
    st = readState(await env.SNAPSHOT.get(STATE_KEY, "json"));
  } catch {
    return "indexnow: state unreadable, skipped";
  }
  if (!st || !st.known.length) {
    await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current }));
    return `indexnow: first run, recorded ${current.length} URLs as the baseline without submitting`;
  }
  const known = new Set(st.known);
  const fresh = current.filter((u) => !known.has(u));
  const pending = { ...st.pending ?? {} };
  const backoff = { ...st.backoff ?? {} };
  const label = (endpoint) => new URL(endpoint).hostname.replace(/^www\./, "");
  const now = Date.now();
  const owed = /* @__PURE__ */ new Map();
  const held = [];
  for (const e of ENDPOINTS) {
    const name = label(e);
    const back = (pending[name] ?? []).filter((u) => current.includes(u));
    const list = [.../* @__PURE__ */ new Set([...back, ...fresh])].slice(-MAX_URLS);
    if (!list.length) continue;
    const b = backoff[name];
    if (b && b.nextAt > now) {
      pending[name] = list;
      held.push(`${name} in backoff for ${Math.round((b.nextAt - now) / 6e4)}m`);
      continue;
    }
    owed.set(e, list);
  }
  if (!owed.size) {
    if (fresh.length || held.length) await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current, pending, backoff }));
    if (held.length) return `indexnow: nothing sent \u2014 ${held.join(", ")}`;
    return `indexnow: nothing new (${current.length} URLs published, all previously submitted and accepted)`;
  }
  const results = [];
  let accepted = 0;
  for (const [endpoint, list] of owed) {
    const name = label(endpoint);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: list })
      });
      if (res.ok) {
        accepted++;
        delete pending[name];
        delete backoff[name];
        results.push(`${name} ${res.status}`);
      } else {
        pending[name] = list;
        const fails = (backoff[name]?.fails ?? 0) + 1;
        backoff[name] = { fails, nextAt: now + retryDelayMs(fails) };
        results.push(`${name} ${res.status}+${list.length} owed, next in ${Math.round(retryDelayMs(fails) / 6e4)}m`);
      }
    } catch (e) {
      pending[name] = list;
      const fails = (backoff[name]?.fails ?? 0) + 1;
      backoff[name] = { fails, nextAt: now + retryDelayMs(fails) };
      results.push(`${name} ${e instanceof Error ? e.message.slice(0, 32) : "failed"}+${list.length} owed, next in ${Math.round(retryDelayMs(fails) / 6e4)}m`);
    }
  }
  await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current, pending, backoff }));
  const owedTotal = Object.keys(pending).length;
  const head = fresh.length ? `submitted ${fresh.length} new URL(s)` : `retried a backlog`;
  return `indexnow: ${head} to ${accepted}/${owed.size} endpoints [${results.join(", ")}]` + (held.length ? `, skipped: ${held.join(", ")}` : "") + (owedTotal ? `, ${owedTotal} endpoint(s) still owed` : "") + (fresh.length ? ` \u2014 ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? " \u2026" : ""}` : "");
}

// worker/coverage.ts
var collapsedCoverage = (prevCount, newCount) => newCount === 0 || prevCount >= 10 && newCount < prevCount / 2;
var publishedSet = (collapsed, prev, fetched) => collapsed ? prev : fetched;
var orphans = (have, scope) => {
  const covered = new Set(scope);
  return [...have].filter((s) => !covered.has(s));
};

// src/lib/flips.ts
async function readFlipEvents(db, hours = 24, now = Date.now()) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(
      `WITH ordered AS (
           SELECT symbol, venue, apr, at,
                  LAG(apr) OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_apr,
                  LAG(at)  OVER (PARTITION BY symbol, venue ORDER BY at) AS prev_at
           FROM funding_snapshot
           WHERE at >= ?1
         )
         SELECT symbol, venue, prev_apr AS prevApr, apr, at, CAST(ROUND((at - prev_at) / 60000.0) AS INTEGER) AS gapMin
         FROM ordered
         WHERE prev_apr IS NOT NULL
           AND ((prev_apr < 0 AND apr >= 0) OR (prev_apr >= 0 AND apr < 0))
         ORDER BY at ASC`
    ).bind(now - hours * 36e5).all();
    return results ?? [];
  } catch (e) {
    console.warn("readFlipEvents failed, degrading to an empty event list:", e instanceof Error ? e.message : e);
    return [];
  }
}
var FLIPS_KEY = "flips:24h";
var FLIPS_MAX_AGE_MS = 20 * 60 * 1e3;
async function writeCachedFlips(kv, result, now) {
  await kv.put(FLIPS_KEY, JSON.stringify({ computedAt: now, result }));
}

// src/lib/flip-events.ts
var LAST_KEY = "flips:last";
var EVENTS_KEY = "flips:events";
var MAX_EVENTS = 5e3;
function carryForward(prev, rows, at) {
  const aprs = { ...prev?.aprs ?? {} };
  for (const [symbol, venue, apr] of rows) {
    if (Number.isFinite(apr)) aprs[`${symbol}|${venue}`] = { apr, at };
  }
  return { at, aprs };
}
function detectFlips(prev, rows, at) {
  if (!prev) return [];
  const out = [];
  for (const [symbol, venue, apr] of rows) {
    if (!Number.isFinite(apr)) continue;
    const was = prev.aprs[`${symbol}|${venue}`];
    if (!was || !Number.isFinite(was.apr) || was.at >= at) continue;
    const flipped = was.apr < 0 && apr >= 0 || was.apr >= 0 && apr < 0;
    if (!flipped) continue;
    out.push({ symbol, venue, prevApr: was.apr, apr, at, gapMin: Math.round((at - was.at) / 6e4) });
  }
  return out;
}
function mergeEvents(existing, fresh, now, hours) {
  const cutoff = now - hours * 36e5;
  const kept = [...existing, ...fresh].filter((f) => f.at >= cutoff);
  kept.sort((a, b) => a.at - b.at);
  return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}
function feedFromEvents(events, since, now, hours) {
  const cutoff = now - hours * 36e5;
  const latest = /* @__PURE__ */ new Map();
  for (const f of events) {
    if (f.at < cutoff) continue;
    const k = `${f.symbol}|${f.venue}`;
    const prev = latest.get(k);
    if (!prev || f.at > prev.at) latest.set(k, f);
  }
  const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  const rows = [...latest.values()].sort((a, b) => b.at - a.at || cmp(a.symbol, b.symbol) || cmp(a.venue, b.venue));
  return { status: "ready", rows: rows.slice(0, 25), since, total: rows.length };
}

// src/data/terms-baseline.json
var terms_baseline_default = {
  note: "What a human last read, and when. See scripts/terms-watch.mjs for why this is a clock rather than a fetcher. The weekly report surfaces the oldest read so the counter is a number the owner sees rather than a file they have to remember to open.",
  documents: [
    {
      id: "hyperliquid-tou",
      what: "Hyperliquid Terms of Use \u2014 the document the entire site now depends on",
      url: "https://app.hyperliquid.xyz/terms",
      lastUpdatedOnDocument: "2026-06-15",
      readAt: "2026-08-19",
      readHow: "browser; the page is a JS application and a plain fetch returns only the shell",
      finding: "Scoped by its own first sentence to the Interface at app.hyperliquid.xyz. Binds on accessing and using that Interface. Twelve sections, none of them IP, data or licence. The words API, redistribute, republish and scrape do not appear. Section 1.1: 'The Interface is not the exclusive means of accessing Hyperliquid.'",
      watchFor: "any API-scoped or data-scoped instrument; any IP or database-right clause; any change to the first sentence's definition of Interface; any AI/ML clause",
      reviewEveryDays: 30,
      intervalReason: "THIRTY DAYS, AND THE INTERVAL IS SET BY STAKES RATHER THAN BY OBSERVED CHURN. This document is the entire legal basis for every figure the site publishes; if it acquires an API-scoped or data-scoped clause, nothing breaks, nothing looks wrong, and the site is operating with no basis at all until someone notices. The interval is the exposure window, so it is the one that should be short. Observed churn is moderate \u2014 the copy read on 2026-08-19 was dated 2026-06-15, about two months old."
    },
    {
      id: "coinbase-market-data",
      what: "Coinbase Market Data Terms of Use \u2014 the reason the spot layer was removed",
      url: "https://www.coinbase.com/legal/market_data",
      lastUpdatedOnDocument: "2026-08-07",
      readAt: "2026-08-19",
      readHow: "browser; three plain fetches returned 403 and were wrongly recorded as unreadable",
      finding: "Binds on access alone. Licence limited to personal or research purposes and not for an application intended for end users. Forbids redistributing, displaying or disseminating the data or any Derived Works to third parties outside your organisation. Separate AI/ML training prohibition.",
      watchFor: "any relaxation that would permit third-party display, which would reopen the spot layer",
      reviewEveryDays: 90,
      intervalReason: "NINETY DAYS. Highest observed churn of the three \u2014 the copy read on 2026-08-19 was dated 2026-08-07, twelve days old \u2014 but the lowest stakes now that nothing on the site touches it. The only reason to re-read is to catch a relaxation that would make a spot layer possible again, and being three months late to good news costs nothing."
    },
    {
      id: "bybit-api",
      what: "Bybit API Terms \u2014 relevant because the site displays Bybit funding rates received via Hyperliquid",
      url: "https://www.bybit.com/en/help-center/article/Bybit-API-Terms-and-Conditions",
      lastUpdatedOnDocument: "2026-01-16",
      readAt: "2026-08-19",
      readHow: "agent fetch, HTTP 200",
      finding: "Bars providing access to Bybit's platform to a third party and bars automated retrieval. We make no request to Bybit; the position is that we are not party to it. Untested.",
      watchFor: "any clause reaching downstream recipients of data republished by others",
      reviewEveryDays: 90,
      intervalReason: "NINETY DAYS. Lowest observed churn \u2014 read 2026-08-19, dated 2026-01-16, seven months old. Middling stakes: the site displays Bybit funding rates, but the position is that we are not party to this document at all, and that question is with a lawyer rather than with this clock. A change here would sharpen a question already open rather than open a new one."
    }
  ],
  reviewEveryDaysDefault: 90
};

// worker/report.ts
var RUN_CEILING_MS = 2 * 36e5;
var UA = "GPTBot/1.1 (+https://coinliqui.com/status/indexation; coinliqui-selfcheck)";
var SLICE = 20;
var isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};
var b64url = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var b64urlStr = (s) => b64url(new TextEncoder().encode(s));
var share = (a, b) => b ? `${(a / b * 100).toFixed(0)}%` : "\u2014";
async function gscToken(rawKey) {
  const key = JSON.parse(rawKey);
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const iat = Math.floor(Date.now() / 1e3);
  const body = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` + b64urlStr(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: iat + 3600,
    iat
  }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(body));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${body}.${b64url(sig)}`
    })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token exchange failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}
var CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Googlebot",
  "bingbot",
  "Applebot",
  "Amazonbot"
];
function tallyCrawlers(groups) {
  const rows = CRAWLERS.map((name) => {
    let verified = 0, claimed = 0;
    for (const g of groups) {
      if (!(g.dimensions?.userAgent || "").includes(name)) continue;
      claimed += g.count;
      if (g.dimensions?.verifiedBotCategory) verified += g.count;
    }
    return { name, verified, claimed };
  });
  return {
    rows,
    verifiedTotal: rows.reduce((a, r) => a + r.verified, 0),
    claimedTotal: rows.reduce((a, r) => a + r.claimed, 0)
  };
}
async function stepReport(env, force = false) {
  const origin = env.SITE_ORIGIN || "https://coinliqui.com";
  const site = `sc-domain:${new URL(origin).hostname}`;
  const now = /* @__PURE__ */ new Date();
  const week = isoWeek(now);
  let st = await env.SNAPSHOT.get("report:state", "json");
  if (!st || st.week !== week) {
    const due = force || now.getUTCDay() === 1 && now.getUTCHours() >= 7;
    if (!due) return void 0;
    const done = await env.SNAPSHOT.get(`report:${week}`, "json");
    if (done && !force) return void 0;
    st = { week, phase: "coverage", i: 0, lines: [], templates: [], startedAt: Date.now() };
    st.lines.push(`# Indexation \u2014 ${week}`);
    st.lines.push(`
${origin} \xB7 started ${now.toISOString().slice(0, 16).replace("T", " ")} UTC
`);
  }
  if (st.phase === "done") return void 0;
  if (Date.now() - st.startedAt > RUN_CEILING_MS) {
    const mins = Math.round((Date.now() - st.startedAt) / 6e4);
    st.lines.push(`
> **Abandoned after ${mins} minutes in phase \`${st.phase}\`.**`);
    st.lines.push(`> A run holds the ingest tick \u2014 flips, IndexNow and all four candle sweeps`);
    st.lines.push(`> stand aside while it walks. It is ended here so they resume. Everything`);
    st.lines.push(`> above is what it completed before that.`);
    const partial = { week: st.week, at: Date.now(), tookMs: Date.now() - st.startedAt, md: st.lines.join("\n") + "\n" };
    await env.SNAPSHOT.put(`report:${st.week}`, JSON.stringify(partial));
    await env.SNAPSHOT.put("report:latest", JSON.stringify(partial));
    await env.SNAPSHOT.delete("report:state");
    return `report: abandoned in ${st.phase} after ${mins}m`;
  }
  const say = (s = "") => st.lines.push(s);
  const get = async (path) => {
    const r = await fetch(origin + path, { headers: { "user-agent": UA } });
    return { status: r.status, body: await r.text() };
  };
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (st.phase === "coverage") {
    if (!st.sitemapsAt) {
      const idx = await get("/sitemap-index.xml");
      for (const m of locs(idx.body)) {
        const b = await get(m);
        st.templates.push({ name: m.replace("/sitemaps/", "").replace(".xml", ""), urls: locs(b.body), status: b.status });
      }
      st.sitemapsAt = Date.now();
      st.i = 0;
      if (!st.templates.length) {
        st.indexStatus = idx.status;
        st.indexHead = idx.body.slice(0, 160).replace(/\s+/g, " ");
      }
      await env.SNAPSHOT.put("report:state", JSON.stringify(st));
      return "report: sitemaps";
    }
    const flat = st.templates.flatMap((t) => t.urls.map((u) => ({ t, u })));
    const end = Math.min(flat.length, st.i + SLICE * 2);
    for (let n2 = st.i; n2 < end; n2++) {
      const { t, u } = flat[n2];
      const first = (await get(u || "/")).status;
      if (first === 200) {
        t.ok = (t.ok ?? 0) + 1;
        continue;
      }
      const again = (await get(u || "/")).status;
      if (again === 200) t.ok = (t.ok ?? 0) + 1;
      (t.failures ??= []).push([u || "/", first, again]);
    }
    st.i = end;
    if (st.i >= flat.length) {
      say("## A. Coverage\n");
      say("What exists, and whether a crawler can still fetch it. No credentials \u2014 this section always runs.\n");
      if (!st.templates.length) {
        say(`**The sitemap index produced no templates, so nothing could be checked.**`);
        say(`
\`GET ${origin}/sitemap-index.xml\` \u2192 **${st.indexStatus ?? "?"}**, first bytes: \`${st.indexHead ?? ""}\``);
        say(`
Every URL on this site is enumerated from that document. Until it parses, coverage`);
        say(`is unmeasured rather than good. Sections below still ran.`);
      } else {
        say("| Template | URLs | Fetchable as GPTBot |");
        say("|---|---:|---:|");
        for (const t of st.templates) {
          const note = t.urls.length === 0 && t.status !== 200 ? ` \u2014 sitemap returned ${t.status ?? "?"}` : "";
          say(`| \`${t.name}\`${note} | ${t.urls.length} | ${t.ok ?? 0}/${t.urls.length} |`);
        }
        const total = st.templates.reduce((a, x) => a + x.urls.length, 0);
        const okAll = st.templates.reduce((a, x) => a + (x.ok ?? 0), 0);
        say(`| **total** | **${total}** | **${okAll}/${total}** |`);
        const dead = st.templates.filter((t) => t.urls.length === 0 && t.status !== 200);
        if (dead.length) say(`
**${dead.length} sitemap${dead.length > 1 ? "s" : ""} could not be read**, so those templates are unmeasured, not empty.`);
      }
      const failed = st.templates.flatMap((t) => (t.failures ?? []).map((f) => [t.name, ...f]));
      if (failed.length) {
        const hard = failed.filter(([, , , retry]) => retry !== 200);
        say(`
**${hard.length} URLs are not fetchable by a crawler.** Nothing below matters until that is zero.`);
        if (failed.length > hard.length) say(`${failed.length - hard.length} more failed once and succeeded on an immediate retry \u2014 transient, recorded rather than alarmed on.`);
        say("");
        say("| URL | Template | First | Retry |");
        say("|---|---|---:|---:|");
        for (const [tpl, u, first, retry] of failed.slice(0, 25)) say(`| \`${u}\` | \`${tpl}\` | ${first} | ${retry} |`);
        if (failed.length > 25) say(`
\u2026and ${failed.length - 25} more.`);
      }
      say("\n## B. Search Console\n");
      st.phase = env.GSC_SA_KEY ? "inspect" : "search";
      st.i = 0;
      if (!env.GSC_SA_KEY) {
        say("Not available: GSC_SA_KEY is not set.\n");
        say("To enable, in order:\n");
        say("Setup for this section is in DEPLOY.md.\n");
        say("Owner, not Full. Search Analytics (section B2) works for any verified user, but the");
        say("URL Inspection API used for the per-template indexed share is owner-only and returns");
        say("PERMISSION_DENIED for a Full user. Adding a service account as a delegated owner is");
        say("supported on Domain properties and does not affect DNS verification.\n");
        say("Nothing about the site itself changes; this only lets the weekly report read data.");
        st.phase = "crawlers";
      } else {
        say("### Indexed share, per template\n");
        say("| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Other |");
        say("|---|---:|---:|---:|---:|");
      }
      st.i = 0;
    }
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return `report: coverage ${st.i || flat.length}/${flat.length} urls`;
  }
  if (st.phase === "inspect") {
    try {
      if (!st.token || Date.now() - (st.tokenAt ?? 0) > 45 * 6e4) {
        st.token = await gscToken(env.GSC_SA_KEY);
        st.tokenAt = Date.now();
      }
      const flat = st.templates.flatMap((t) => t.urls.map((u) => ({ t, u })));
      const end = Math.min(flat.length, st.i + SLICE);
      for (let n2 = st.i; n2 < end; n2++) {
        const { t, u } = flat[n2];
        const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
          method: "POST",
          headers: { authorization: `Bearer ${st.token}`, "content-type": "application/json" },
          body: JSON.stringify({ inspectionUrl: origin + (u || "/"), siteUrl: site })
        });
        const j = await r.json();
        const res = j?.inspectionResult?.indexStatusResult ?? {};
        const v = res.verdict;
        const k = v === "PASS" || v === "NEUTRAL" || v === "FAIL" ? v : "other";
        (t.tally ??= { PASS: 0, NEUTRAL: 0, FAIL: 0, other: 0 })[k]++;
        if (k !== "PASS") {
          (t.notIndexed ??= []).push([u || "/", String(v ?? j?.error?.message ?? "no verdict"), String(res.coverageState ?? "\u2014")]);
        }
      }
      st.i = end;
      if (st.i >= flat.length) {
        for (const t of st.templates) {
          const q = t.tally ?? { PASS: 0, NEUTRAL: 0, FAIL: 0, other: 0 };
          t.indexed = q.PASS;
          say(`| \`${t.name}\` | ${q.PASS}/${t.urls.length} (${share(q.PASS, t.urls.length)}) | ${q.NEUTRAL} | ${q.FAIL} | ${q.other} |`);
        }
        const missing = st.templates.flatMap((t) => (t.notIndexed ?? []).map((n2) => [t.name, ...n2]));
        if (missing.length) {
          say(`
**The ${missing.length} URLs Google has not indexed**, with its own reason for each. Read the`);
          say("reason before acting: *Discovered \u2014 currently not indexed* is a queue, and the answer is");
          say("usually to wait and watch the series below; *Crawled \u2014 currently not indexed* is a");
          say("judgement about the page, and the answer is to change the page.\n");
          say("| URL | Template | Verdict | Google's coverage state |");
          say("|---|---|---|---|");
          for (const [tpl, u, v, cov] of missing.slice(0, 40)) say(`| \`${u}\` | \`${tpl}\` | ${v} | ${cov} |`);
          if (missing.length > 40) say(`
\u2026and ${missing.length - 40} more.`);
        }
        try {
          const prev = await env.SNAPSHOT.get("index:history", "json") ?? [];
          const point = {
            at: Date.now(),
            total: flat.length,
            indexed: st.templates.reduce((n2, t) => n2 + (t.indexed ?? 0), 0),
            byTemplate: st.templates.map((t) => [t.name, t.indexed ?? 0, t.urls.length])
          };
          await env.SNAPSHOT.put("index:history", JSON.stringify([point, ...prev].slice(0, 26)));
        } catch {
        }
        st.phase = "search";
        st.i = 0;
      }
      await env.SNAPSHOT.put("report:state", JSON.stringify(st));
      return `report: inspect ${st.i || flat.length}/${flat.length} urls`;
    } catch (e) {
      say(`
Inspection stopped: ${e instanceof Error ? e.message : String(e)}`);
      st.phase = "search";
    }
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return "report: inspect halted";
  }
  if (st.phase === "search") {
    if (env.GSC_SA_KEY) {
      try {
        if (!st.token || Date.now() - (st.tokenAt ?? 0) > 45 * 6e4) {
          st.token = await gscToken(env.GSC_SA_KEY);
          st.tokenAt = Date.now();
        }
        const api = async (url, payload) => await (await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${st.token}`, "content-type": "application/json" },
          body: JSON.stringify(payload)
        })).json();
        const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
        const start = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);
        const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
        const sa = await api(base, { startDate: start, endDate: end, dimensions: ["page"], rowLimit: 500 });
        const rows = sa.rows || [];
        say(`
### Search performance, ${start} to ${end}
`);
        if (!rows.length) {
          say("No impressions yet. Expected before roughly week 4 \u2014 a new domain has no history to weigh.");
        } else {
          say("| Template | Impressions | Clicks | Avg position | Pages with impressions |");
          say("|---|---:|---:|---:|---:|");
          for (const t of st.templates) {
            const set = new Set(t.urls.map((u) => origin + (u || "/")));
            const r = rows.filter((x) => set.has(x.keys[0]));
            const imp = r.reduce((a, x) => a + x.impressions, 0);
            const pos = imp ? r.reduce((a, x) => a + x.position * x.impressions, 0) / imp : 0;
            say(`| \`${t.name}\` | ${imp} | ${r.reduce((a, x) => a + x.clicks, 0)} | ${pos ? pos.toFixed(1) : "\u2014"} | ${r.length}/${t.urls.length} |`);
          }
          const q = await api(base, { startDate: start, endDate: end, dimensions: ["query"], rowLimit: 25 });
          if (q.rows?.length) {
            say("\n### Top queries\n");
            say("| Query | Impressions | Clicks | Position |");
            say("|---|---:|---:|---:|");
            for (const r of q.rows.slice(0, 15)) say(`| ${r.keys[0]} | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);
          }
        }
      } catch (e) {
        say(`
Search performance not available: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    st.phase = "crawlers";
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return "report: search";
  }
  say("\n## C. Crawler fetches\n");
  try {
    const absent = [
      !env.CF_ANALYTICS_TOKEN && "CF_ANALYTICS_TOKEN",
      !env.CF_ZONE_ID && "CF_ZONE_ID"
    ].filter(Boolean);
    if (absent.length) throw new Error(`${absent.join(" and ")} ${absent.length > 1 ? "are" : "is"} not set`);
    const day = 864e5;
    const groups = [];
    let windows = 0;
    for (let d = 0; d < 7; d++) {
      const to = new Date(Date.now() - d * day).toISOString();
      const from = new Date(Date.now() - (d + 1) * day).toISOString();
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: `query($zone:String!,$from:Time!,$to:Time!){viewer{zones(filter:{zoneTag:$zone}){
            httpRequestsAdaptiveGroups(limit:1000, filter:{datetime_geq:$from, datetime_lt:$to}, orderBy:[count_DESC]){
              count dimensions{userAgent verifiedBotCategory} }}}}`,
          variables: { zone: env.CF_ZONE_ID, from, to }
        })
      });
      const j = await r.json();
      if (j.errors?.length) {
        if (d === 0) throw new Error(j.errors.map((e) => e.message).join("; "));
        continue;
      }
      const g = j.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
      if (g.length) {
        windows++;
        groups.push(...g);
      }
    }
    const t = tallyCrawlers(groups);
    say(`Last ${windows} day(s), from Cloudflare's edge \u2014 the only place a named crawler is visible at all,`);
    say("since Googlebot runs no JavaScript and never appears in Google Analytics.\n");
    say("| Crawler | Verified fetches | Requests claiming the name |");
    say("|---|---:|---:|");
    for (const row of t.rows) say(`| ${row.name} | ${row.verified || "\u2014"} | ${row.claimed || "\u2014"} |`);
    say(`| **total** | **${t.verifiedTotal}** | **${t.claimedTotal}** |`);
    if (!t.verifiedTotal) {
      say("\nNo VERIFIED crawler seen yet. Normal in the first fortnight; past week 3, re-run verify-live before assuming it is a ranking problem.");
    }
    if (t.claimedTotal > t.verifiedTotal) {
      const pct1 = (t.verifiedTotal / t.claimedTotal * 100).toFixed(1);
      say(`
${pct1}% of the requests carrying a crawler's name were verified as that crawler. Most of the`);
      say("remainder is this project's own verification harness, which impersonates every crawler");
      say("deliberately; the rest is credential scanners wearing whatever name is handy.");
    }
    say("\nA note for anyone reading the zone dashboard instead: roughly a fifth of this zone's");
    say("requests are Cloudflare's own early-hints prefetcher, which receives a 504 every time and");
    say("never reaches the origin. It makes the zone's 5xx rate read about 20% while the Pages");
    say("Function's own error count is zero. Neither number is wrong; they count different things.");
  } catch (e) {
    say(`Not available: ${e instanceof Error ? e.message : String(e)}.
`);
    say("Setup for this section is in DEPLOY.md.");
  }
  say("\n## D. Legal reading age\n");
  {
    const DAY = 864e5;
    const rows = terms_baseline_default.documents.map((d) => {
      const read = Date.parse(`${d.readAt}T00:00:00Z`);
      const every = Number.isInteger(d.reviewEveryDays) ? d.reviewEveryDays : terms_baseline_default.reviewEveryDaysDefault;
      const days = Number.isFinite(read) ? Math.floor((Date.now() - read) / DAY) : null;
      return { id: d.id, days, every, due: days === null || days > every, dated: d.lastUpdatedOnDocument };
    });
    const oldest = rows.reduce((a, b) => (b.days ?? 1e9) > (a.days ?? 1e9) ? b : a, rows[0]);
    const due = rows.filter((r) => r.due);
    say(`**Oldest reading: ${oldest.days === null ? "never" : `${oldest.days} days`} (${oldest.id}).** ${due.length ? `${due.length} document(s) overdue.` : "Nothing overdue."}
`);
    say("| Document | Read | Window | Dated on the document |");
    say("|---|---:|---:|---|");
    for (const r of rows) {
      say(`| ${r.due ? "**" : ""}${r.id}${r.due ? "**" : ""} | ${r.days === null ? "never" : `${r.days}d`} | ${r.every}d | ${r.dated} |`);
    }
    if (due.length) {
      say("\nOpen each in a browser and update `src/data/terms-baseline.json`. A plain fetch is not a");
      say("reading: both documents that matter here served a shell or a 403 to one, and an automated");
      say("watcher would have reported no change indefinitely.");
    }
  }
  say("\n## What to read first\n");
  say("1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.");
  say("2. **Indexed share by template, not by page.** One template stuck in *Discovered \u2014 currently");
  say("   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.");
  say("3. **Position before impressions.** Impressions on a new domain arrive late and jump around;");
  say("   average position per template moves earlier and more honestly.");
  say("4. **Crawler fetches are the leading indicator.** If they are zero, nothing downstream can");
  say("   move, and the cause is access rather than quality.");
  say("5. **Section D is the one nothing else can catch.** Every other failure on this site has a");
  say("   technical symptom. A change to the terms this site depends on has none \u2014 the pages keep");
  say("   rendering perfectly \u2014 so the only detector is somebody re-reading the document.");
  const doc = { week: st.week, at: Date.now(), tookMs: Date.now() - st.startedAt, md: st.lines.join("\n") + "\n" };
  await env.SNAPSHOT.put(`report:${st.week}`, JSON.stringify(doc));
  await env.SNAPSHOT.put("report:latest", JSON.stringify(doc));
  await env.SNAPSHOT.delete("report:state");
  return `report: complete (${st.week})`;
}
async function stepProbe(env) {
  if (!env.GSC_SA_KEY) return null;
  let url = null;
  try {
    const req = await env.SNAPSHOT.get("probe:inspect", "json");
    url = typeof req?.url === "string" ? req.url : null;
  } catch {
    return null;
  }
  if (!url) return null;
  try {
    await env.SNAPSHOT.delete("probe:inspect");
  } catch {
  }
  const out = { url, at: Date.now() };
  try {
    const token = await gscToken(env.GSC_SA_KEY);
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ inspectionUrl: url.trim(), siteUrl: "sc-domain:coinliqui.com" })
    });
    const j = await r.json();
    out.status = r.status;
    if (j?.error) out.error = `${j.error.code} ${j.error.message}`;
    else {
      const i = j?.inspectionResult?.indexStatusResult ?? {};
      out.verdict = i.verdict;
      out.coverageState = i.coverageState;
      out.robotsTxtState = i.robotsTxtState;
      out.indexingState = i.indexingState;
      out.lastCrawlTime = i.lastCrawlTime ?? null;
      out.googleCanonical = i.googleCanonical ?? null;
      out.userCanonical = i.userCanonical ?? null;
      out.pageFetchState = i.pageFetchState ?? null;
      out.referringUrls = i.referringUrls ?? null;
      out.sitemap = i.sitemap ?? null;
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
  }
  try {
    await env.SNAPSHOT.put("probe:result", JSON.stringify(out));
  } catch {
  }
  return String(out.coverageState ?? out.error ?? "done");
}

// worker/build-stamp.ts
var WORKER_BUILD = "f779281c1850";

// worker/ingest.ts
var RETAIN_HOURS = 72;
var CANDLE_REFRESH_HOURS = 12;
var HOURLY_REFRESH_HOURS = 2;
var M15_REFRESH_HOURS = 2;
var FUNDING_REFRESH_HOURS = 6;
var CANARY_RETAIN_HOURS = 168;
var CHUNK = 24;
var FILL_BACKOFF_MS = 10 * 6e4;
function sameSecret(want, got) {
  if (!want || !got) return false;
  let diff = want.length ^ got.length;
  for (let i = 0; i < got.length; i++) diff |= want.charCodeAt(i % want.length) ^ got.charCodeAt(i);
  return diff === 0;
}
var ingest_default = {
  async scheduled(event, env, ctx) {
    if (event.cron === "* * * * *") {
      ctx.waitUntil(minute(env));
      return;
    }
    ctx.waitUntil(run(env));
  },
  /**
   * MANUAL TRIGGERS, AND THEY WERE OPEN TO THE INTERNET.
   *
   * This Worker is published on workers.dev, which is a real, guessable hostname — the name of
   * the script and the account's subdomain, both of which appear in ordinary places. Anyone who
   * found it could POST nothing at all to /ingest and cause a full ingest: upstream fetches to
   * Hyperliquid and Coinbase, D1 writes, KV writes. /report was worse per call — twelve slices,
   * up to 160 subrequests, one Search Console URL Inspection per URL against a quota, and it
   * overwrites the published weekly report. Nothing had happened, and nothing needed to for this
   * to be wrong: the cost of the endpoint being open is not the traffic it has received.
   *
   * A bearer secret rather than an environment guard, deliberately. The lesson from
   * astro.config.mjs — where `if (process.env.CF_PAGES)` protected a hypothesis about where the
   * build ran, and the artifact shipped without it — is that a precondition on the ENVIRONMENT
   * is not a precondition on the request. This one is on the request itself.
   *
   * ABSENT SECRET MEANS CLOSED, NOT OPEN. The failure mode of "no key configured, so let
   * everyone in" is the same defect one layer down, and it is the state a fresh deploy is in.
   *
   * A 404 rather than a 401, matching the response every other path already gets, so the two
   * live paths are not discoverable by probing.
   */
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/report" || path === "/ingest") {
      const want = env.TRIGGER_KEY;
      const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!want || !got || !sameSecret(want, got)) return new Response("not found", { status: 404 });
    }
    if (path === "/report") {
      const steps = [];
      for (let n2 = 0; n2 < 12; n2++) {
        const s = await stepReport(env, n2 === 0 && url.searchParams.has("force"));
        if (!s) break;
        steps.push(s);
        if (s.startsWith("report: complete")) break;
      }
      return new Response(JSON.stringify({ steps }, null, 2) + "\n", { headers: { "content-type": "application/json" } });
    }
    if (path !== "/ingest") return new Response("not found", { status: 404 });
    const r = await run(env);
    return new Response(JSON.stringify(r, null, 2) + "\n", {
      status: r.ok ? 200 : 500,
      headers: { "content-type": "application/json" }
    });
  }
};
var SKIP_SWEEPS = /* @__PURE__ */ Symbol("skip-sweeps");
async function minute(env) {
  const started = Date.now();
  let liveErr = "";
  try {
    const published = await env.SNAPSHOT.get("published:set", "json") ?? [];
    if (published.length) await env.SNAPSHOT.put("live", JSON.stringify(await fetchLive(published)));
  } catch (e) {
    liveErr = (e instanceof Error ? e.message : String(e)).slice(0, 60);
  }
  try {
    const m = /(\d{3})/.exec(liveErr);
    await env.DB.prepare(
      "INSERT INTO upstream_check (at, source, status, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(
      started,
      "minute",
      liveErr ? m ? Number(m[1]) : 0 : 200,
      Date.now() - started,
      liveErr ? 0 : 1,
      JSON.stringify({ liveError: liveErr || void 0 })
    ).run();
  } catch {
  }
}
async function run(env) {
  const started = Date.now();
  const result = { ok: false, ms: 0, status: 0, rows: 0, symbols: 0, venues: {} };
  try {
    {
      const prev = await env.SNAPSHOT.get("worker:build", "json");
      if (prev?.build !== WORKER_BUILD) {
        await env.SNAPSHOT.put("worker:build", JSON.stringify({ build: WORKER_BUILD, at: Date.now() }));
      }
    }
    const publishedKey = "published:set";
    const prevPublished = await env.SNAPSHOT.get(publishedKey, "json") ?? [];
    const snap = await fetchSnapshot(prevPublished);
    result.status = 200;
    result.symbols = snap.perps.length;
    const prevCount = prevPublished.length;
    const collapsed = collapsedCoverage(prevCount, snap.perps.length);
    if (collapsed) result.error = `refused: coverage collapsed ${prevCount} -> ${snap.perps.length}`;
    const published = await (async () => {
      const nowPublished = snap.perps.map((p) => p.symbol);
      if (!collapsed && nowPublished.slice().sort().join(",") !== prevPublished.slice().sort().join(",")) {
        await env.SNAPSHOT.put(publishedKey, JSON.stringify(nowPublished));
        result.coverageChanged = true;
      }
      return publishedSet(collapsed, prevPublished, nowPublished);
    })();
    const at = snap.fetchedAt;
    const rows = [];
    for (const p of snap.perps) {
      for (const v of p.venues) {
        if (Number.isFinite(v.apr)) {
          rows.push([p.symbol, v.venue, v.apr, at]);
          result.venues[v.venue] = (result.venues[v.venue] ?? 0) + 1;
        }
      }
    }
    result.rows = rows.length;
    if (!collapsed) await env.SNAPSHOT.put("snapshot", JSON.stringify(snap));
    if (rows.length) {
      const insert = env.DB.prepare("INSERT INTO funding_snapshot (symbol, venue, apr, at) VALUES (?1, ?2, ?3, ?4)");
      if (!collapsed) await env.DB.batch(rows.map((r) => insert.bind(...r)));
      await env.DB.prepare("DELETE FROM funding_snapshot WHERE at < ?1").bind(at - RETAIN_HOURS * 36e5).run();
    }
    try {
      const ages = {};
      for (const [name, key] of [["hourly", "hourly:meta"], ["funding", "funding:meta"], ["candles", "candles:meta"], ["m15", "m15:meta"]]) {
        const m = await env.SNAPSHOT.get(key, "json");
        if (m?.u) ages[name] = Math.round((Date.now() - m.u) / 6e4);
      }
      if (Object.keys(ages).length) result.sweepAgeMin = ages;
    } catch {
    }
    result.ok = !collapsed && rows.length > 0;
    if (!result.ok && !result.error) result.error = "upstream returned no usable funding rows";
    try {
      const probe = await stepProbe(env);
      if (probe) result.probe = probe;
      const step = await stepReport(env);
      if (step) {
        result.report = step;
        throw SKIP_SWEEPS;
      }
      try {
        const prev = await env.SNAPSHOT.get(LAST_KEY, "json");
        const fresh = detectFlips(prev, rows, at);
        const sample = carryForward(prev, rows, at);
        let existing = await env.SNAPSHOT.get(EVENTS_KEY, "json");
        let seeded = false;
        if (existing === null) {
          existing = await readFlipEvents(env.DB, 24, at);
          seeded = true;
        }
        const events = mergeEvents(existing, fresh, at, 24);
        const oldest = await env.DB.prepare("SELECT MIN(at) AS a FROM funding_snapshot").first();
        const since2 = oldest?.a ?? at;
        await env.SNAPSHOT.put(LAST_KEY, JSON.stringify(sample));
        await env.SNAPSHOT.put(EVENTS_KEY, JSON.stringify(events));
        const covered = (at - since2) / 36e5;
        const feed = covered < 24 ? { status: "warming", since: since2, hours: covered } : feedFromEvents(events, since2, at, 24);
        await writeCachedFlips(env.SNAPSHOT, feed, at);
        result.flips = feed.status === "ready" ? `${seeded ? "seeded from D1, " : ""}${fresh.length} new, ${feed.total} in window, ${feed.rows.length} shown` : `${feed.status} (${covered.toFixed(1)}h of history)`;
      } catch (e) {
        result.flips = `threw (${e instanceof Error ? e.message : String(e)})`;
      }
      try {
        result.indexnow = await stepIndexNow(env, publishedUrls(env.SITE_ORIGIN || "https://coinliqui.com", published));
      } catch (e) {
        result.indexnow = `indexnow: threw (${e instanceof Error ? e.message : String(e)})`;
      }
      const syms = published;
      const sweep = async (key, hours, write, extra = 0, over = syms, preloaded = void 0) => {
        const scope = over;
        const m = preloaded !== void 0 ? preloaded : await env.SNAPSHOT.get(key, "json");
        const have = new Set(m?.h ?? []);
        const room = Math.max(1, CHUNK - extra);
        let firstErr = "";
        const run2 = async (slice) => {
          const done2 = [];
          const oks = await Promise.all(slice.map((s) => write(s).catch((e) => {
            if (!firstErr) firstErr = `${s}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`;
            return false;
          })));
          oks.forEach((ok, i) => {
            if (ok) done2.push(slice[i]);
          });
          return done2;
        };
        const cursor = m?.i ?? 0;
        const inCycle = cursor > 0;
        const stalledSince = m?.f ?? 0;
        const stalled = stalledSince > 0 && Date.now() - stalledSince < FILL_BACKOFF_MS;
        if (!inCycle && !stalled) {
          const missing = scope.filter((s) => !have.has(s));
          if (missing.length) {
            const done2 = await run2(missing.slice(0, room));
            for (const s of done2) have.add(s);
            const coldComplete = !m?.u && scope.every((s) => have.has(s));
            await env.SNAPSHOT.put(key, JSON.stringify({
              u: coldComplete ? Date.now() : m?.u ?? 0,
              i: 0,
              l: m?.l,
              h: [...have],
              f: done2.length ? 0 : Date.now(),
              filled: done2.length,
              e: done2.length ? void 0 : firstErr || void 0
            }));
            return done2.length;
          }
        }
        const due = !m?.u || Date.now() - m.u > hours * 36e5;
        if (!inCycle && !due) return void 0;
        const list = inCycle && m?.l?.length ? m.l : scope;
        const done = await run2(list.slice(cursor, cursor + room));
        for (const s of done) have.add(s);
        const next = cursor + Math.min(room, Math.max(0, list.length - cursor));
        const wrapped = next >= list.length;
        if (wrapped) {
          for (const s of orphans(have, scope)) {
            await env.SNAPSHOT.delete(`${key.split(":")[0]}:${s}`).catch(() => {
            });
            have.delete(s);
          }
        }
        await env.SNAPSHOT.put(key, JSON.stringify({
          u: wrapped ? Date.now() : m?.u ?? 0,
          i: wrapped ? 0 : next,
          l: wrapped ? void 0 : list,
          h: [...have],
          written: done.length,
          e: done.length ? void 0 : firstErr || void 0
        }));
        return done.length;
      };
      const since = Date.now() - 19 * 864e5;
      const rot = await env.SNAPSHOT.get("funding:rot", "json");
      const rotCursor = rot?.c ?? 0;
      let deep = 0;
      const jobs = [
        { name: "hourly", key: "hourly:meta", hours: HOURLY_REFRESH_HOURS, write: async (s) => {
          await env.SNAPSHOT.put(`hourly:${s}`, JSON.stringify(await fetchHourly(s)));
          return true;
        } },
        {
          name: "funding",
          key: "funding:meta",
          hours: FUNDING_REFRESH_HOURS,
          extra: 6,
          write: async (s) => {
            const prev = await env.SNAPSHOT.get(`funding:${s}`, "json") ?? [];
            let merged = mergeFunding(prev, await fetchFundingHistory(s, since));
            const idx = syms.indexOf(s);
            if (deep < 6 && (idx - rotCursor + syms.length) % syms.length < 6 && merged.length) {
              deep++;
              try {
                merged = mergeFunding(await fetchFundingHistory(s, merged[0][0] - 21 * 864e5), merged);
              } catch {
              }
            }
            await env.SNAPSHOT.put(`funding:${s}`, JSON.stringify(merged));
            return true;
          },
          after: async () => {
            await env.SNAPSHOT.put("funding:rot", JSON.stringify({ c: (rotCursor + 6) % Math.max(1, syms.length) }));
          }
        },
        { name: "candles", key: "candles:meta", hours: CANDLE_REFRESH_HOURS, write: async (s) => {
          await env.SNAPSHOT.put(`candles:${s}`, JSON.stringify(await fetchCandles(s)));
          return true;
        } },
        { name: "m15", key: "m15:meta", hours: M15_REFRESH_HOURS, write: async (s) => {
          await env.SNAPSHOT.put(`m15:${s}`, JSON.stringify(await fetchM15(s)));
          return true;
        } }
      ];
      const metas = await Promise.all(jobs.map((j) => env.SNAPSHOT.get(j.key, "json")));
      const byKey = new Map(jobs.map((j, i) => [j.key, metas[i]]));
      const order = orderSweeps(
        jobs.map((j, i) => ({
          name: j.key,
          hours: j.hours,
          lastCycle: metas[i]?.u ?? 0,
          cursor: metas[i]?.i ?? 0,
          stalledSince: metas[i]?.f ?? 0
        })),
        Date.now(),
        FILL_BACKOFF_MS
      );
      for (const chosen of order) {
        const j = jobs.find((x) => x.key === chosen.name);
        const n2 = await sweep(j.key, j.hours, j.write, j.extra ?? 0, j.over ?? syms, byKey.get(j.key) ?? null);
        if (n2 === void 0) continue;
        result[j.name] = n2;
        await j.after?.();
        break;
      }
    } catch (e) {
      if (e !== SKIP_SWEEPS) result.candleError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /(\d{3})/.exec(msg);
    result.status = m ? Number(m[1]) : 0;
    result.error = msg.slice(0, 200);
  }
  result.ms = Date.now() - started;
  try {
    await env.DB.prepare(
      "INSERT INTO upstream_check (at, source, status, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(
      started,
      "hyperliquid",
      result.status,
      result.ms,
      result.ok ? 1 : 0,
      JSON.stringify({ symbols: result.symbols, rows: result.rows, venues: result.venues, error: result.error, sweepAgeMin: result.sweepAgeMin })
    ).run();
    await env.DB.prepare("DELETE FROM upstream_check WHERE at < ?1").bind(started - CANARY_RETAIN_HOURS * 36e5).run();
  } catch {
  }
  return result;
}
export {
  ingest_default as default,
  sameSecret
};
