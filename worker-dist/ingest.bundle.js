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
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
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
    const venues = (predictedBySymbol.get(u.name) ?? []).filter(([, v]) => v && Number.isFinite(Number(v.fundingRate))).map(([venue, v]) => {
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
      hlApr: toApr(n(c.funding), 1),
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

// src/lib/candles.ts
var INFO2 = "https://api.hyperliquid.xyz/info";
var CANDLE_DAYS = 800;
var CANDLE_HOURS = 1080;
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

// worker/ingest.ts
var RETAIN_HOURS = 72;
var CANDLE_REFRESH_HOURS = 12;
var HOURLY_REFRESH_HOURS = 2;
var FUNDING_REFRESH_HOURS = 6;
var CANARY_RETAIN_HOURS = 168;
var CHUNK = 24;
var FILL_BACKOFF_MS = 10 * 6e4;
var WORKER_BUILD = "2026-08-14e";
var ingest_default = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Manual trigger, used once after deploy to warm KV before DNS is pointed at the site,
  // and useful for smoke-testing afterwards.
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path !== "/ingest") return new Response("not found", { status: 404 });
    const r = await run(env);
    return new Response(JSON.stringify(r, null, 2) + "\n", {
      status: r.ok ? 200 : 500,
      headers: { "content-type": "application/json" }
    });
  }
};
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
    const nowPublished = snap.perps.map((p) => p.symbol);
    if (nowPublished.slice().sort().join(",") !== prevPublished.slice().sort().join(",")) {
      await env.SNAPSHOT.put(publishedKey, JSON.stringify(nowPublished));
      result.coverageChanged = true;
    }
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
    await env.SNAPSHOT.put("snapshot", JSON.stringify(snap));
    if (rows.length) {
      const insert = env.DB.prepare("INSERT INTO funding_snapshot (symbol, venue, apr, at) VALUES (?1, ?2, ?3, ?4)");
      await env.DB.batch(rows.map((r) => insert.bind(...r)));
      await env.DB.prepare("DELETE FROM funding_snapshot WHERE at < ?1").bind(at - RETAIN_HOURS * 36e5).run();
    }
    result.ok = rows.length > 0;
    if (!result.ok) result.error = "upstream returned no usable funding rows";
    try {
      const syms = nowPublished;
      const sweep = async (key, hours, write, extra = 0) => {
        const m = await env.SNAPSHOT.get(key, "json");
        const have = new Set(m?.h ?? []);
        const room = Math.max(1, CHUNK - extra);
        const run2 = async (slice) => {
          const done2 = [];
          const oks = await Promise.all(slice.map((s) => write(s).catch(() => false)));
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
          const missing = syms.filter((s) => !have.has(s));
          if (missing.length) {
            const done2 = await run2(missing.slice(0, room));
            for (const s of done2) have.add(s);
            const coldComplete = !m?.u && syms.every((s) => have.has(s));
            await env.SNAPSHOT.put(key, JSON.stringify({
              u: coldComplete ? Date.now() : m?.u ?? 0,
              i: 0,
              l: m?.l,
              h: [...have],
              f: done2.length ? 0 : Date.now(),
              filled: done2.length
            }));
            return done2.length;
          }
        }
        const due = !m?.u || Date.now() - m.u > hours * 36e5;
        if (!inCycle && !due) return void 0;
        const list = inCycle && m?.l?.length ? m.l : syms;
        const done = await run2(list.slice(cursor, cursor + room));
        for (const s of done) have.add(s);
        const next = cursor + Math.min(room, Math.max(0, list.length - cursor));
        const wrapped = next >= list.length;
        if (wrapped) {
          const covered = new Set(syms);
          for (const s of have) {
            if (!covered.has(s)) {
              await env.SNAPSHOT.delete(`${key.split(":")[0]}:${s}`).catch(() => {
              });
              have.delete(s);
            }
          }
        }
        await env.SNAPSHOT.put(key, JSON.stringify({
          u: wrapped ? Date.now() : m?.u ?? 0,
          i: wrapped ? 0 : next,
          l: wrapped ? void 0 : list,
          h: [...have],
          written: done.length
        }));
        return done.length;
      };
      const hourly = await sweep("hourly:meta", HOURLY_REFRESH_HOURS, async (s) => {
        const c = await fetchHourly(s);
        await env.SNAPSHOT.put(`hourly:${s}`, JSON.stringify(c));
        return true;
      });
      if (hourly !== void 0) result.hourly = hourly;
      else {
        const since = Date.now() - 19 * 864e5;
        const rot = await env.SNAPSHOT.get("funding:rot", "json");
        const cursor = rot?.c ?? 0;
        let deep = 0;
        const funding = await sweep("funding:meta", FUNDING_REFRESH_HOURS, async (s) => {
          const prev = await env.SNAPSHOT.get(`funding:${s}`, "json") ?? [];
          let merged = mergeFunding(prev, await fetchFundingHistory(s, since));
          const idx = syms.indexOf(s);
          if (deep < 6 && (idx - cursor + syms.length) % syms.length < 6 && merged.length) {
            deep++;
            try {
              merged = mergeFunding(await fetchFundingHistory(s, merged[0][0] - 21 * 864e5), merged);
            } catch {
            }
          }
          await env.SNAPSHOT.put(`funding:${s}`, JSON.stringify(merged));
          return true;
        }, 6);
        if (funding !== void 0) {
          result.funding = funding;
          await env.SNAPSHOT.put("funding:rot", JSON.stringify({ c: (cursor + 6) % Math.max(1, syms.length) }));
        } else {
          const candles = await sweep("candles:meta", CANDLE_REFRESH_HOURS, async (s) => {
            const c = await fetchCandles(s);
            await env.SNAPSHOT.put(`candles:${s}`, JSON.stringify(c));
            return true;
          });
          if (candles !== void 0) result.candles = candles;
        }
      }
    } catch (e) {
      result.candleError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
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
      JSON.stringify({ symbols: result.symbols, rows: result.rows, venues: result.venues, error: result.error })
    ).run();
    await env.DB.prepare("DELETE FROM upstream_check WHERE at < ?1").bind(started - CANARY_RETAIN_HOURS * 36e5).run();
  } catch {
  }
  return result;
}
export {
  ingest_default as default
};
