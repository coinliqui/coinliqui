import { fetchSnapshot } from "../src/lib/hyperliquid.ts";
import { fetchCandles, fetchHourly, fetchFundingHistory, mergeFunding, type FundingPoint } from "../src/lib/candles.ts";
import { stepReport } from "./report.ts";
import { COINS, fetchSpot, fetchSpotCandles } from "../src/lib/coins.ts";

/**
 * Ingest worker. Runs on a 5-minute cron, writes the current snapshot to KV (which the
 * pages server-render from) and appends funding history to D1 (which the flip feed reads).
 *
 * CPU budget: the free tier allows 10ms per invocation. Network wait does not count, so
 * the only CPU spent here is JSON parsing and the writes. Margin tables are deliberately
 * NOT fetched here — they change rarely and are committed at build time, which keeps 232
 * extra requests off this path.
 *
 * THE FAILURE MODE THIS GUARDS AGAINST IS SILENCE. If the upstream starts refusing
 * requests, or quietly stops returning one venue, nothing breaks loudly: pages keep
 * serving the last good snapshot and only the timestamp drifts. So every run records
 * what it saw — status, latency, and per-venue row counts — into upstream_check, and
 * /status renders it. A venue falling out of coverage is visible as a count going to
 * zero while the run still reports ok.
 */

interface Env {
  SNAPSHOT: KVNamespace;
  DB: D1Database;
  /* Optional, for the weekly indexation report. Absent means the report still runs and says
     which section it could not produce and how to enable it — never a silent gap. */
  SITE_ORIGIN?: string;
  GSC_SA_KEY?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ZONE_ID?: string;
}

/** Snapshots older than this are pruned; the flip feed only looks back 24h. */
const RETAIN_HOURS = 72;

/**
 * WRITE BUDGET, measured rather than assumed, at 49 published contracts:
 *
 *   snapshot   288/day (every tick)
 *   hourly     49 x 12 cycles + 36 cursor writes = 624/day
 *   funding    49 x  4 cycles + 16               = 212/day
 *   candles    49 x  2 cycles +  6               = 104/day
 *   total    ~1,228/day  =  ~36,800/month
 *
 * That is 3.7% of the 1,000,000 writes/month included with Workers Paid, which this account
 * is on. It is NOT inside the free tier — and the free tier's 1,000/day is an ACCOUNT ceiling
 * shared with everything else on the account, which in this case is already spending 450-610
 * a day of it. Both numbers were read from the KV analytics API, not estimated.
 *
 * Daily candles change once a day, so the 5-minute tick refreshing them would be 7,200
 * pointless upstream calls a day.
 */
const CANDLE_REFRESH_HOURS = 12;
/* Every 2 hours. The liquidation map's right edge is only as current as this, and a 6-hour
   gate meant the newest drawn bar could be seven hours behind a mark price that was five
   minutes old. Daily, hourly and funding are on SEPARATE cadences, and each sweep is chunked,
   so a single invocation never approaches the 50-subrequest ceiling. */
const HOURLY_REFRESH_HOURS = 2;
/** HL's own funding history, 500 rows a call, merged into what is stored so depth grows. */
const FUNDING_REFRESH_HOURS = 6;
/** Canary rows are small but unbounded, so they are pruned on the same schedule. */
const CANARY_RETAIN_HOURS = 168;
/** Symbols per invocation. 24 + the snapshot's 2 + the funding rotation's 6 = 32, inside the
    50-subrequest-per-invocation ceiling with room for a retry. At 49 contracts a full sweep
    is three invocations — fifteen minutes — which is why the cycle list has to be frozen. */
const CHUNK = 24;
/** How long a priority fill that wrote nothing stands down for, so one unfetchable contract
    cannot hold the ordinary refresh cycle hostage. Two ticks' worth plus margin. */
const FILL_BACKOFF_MS = 10 * 60_000;

/**
 * BUILD STAMP. `worker-dist/ingest.bundle.js` is pasted into the dashboard by hand, so the
 * deployed worker can silently be older than the site that reads its output — and the
 * symptom (a chart panel that never fills, a timestamp that drifts) looks nothing like a
 * stale paste. The worker writes this on every run and /status compares it with the value
 * the site was built with.
 *
 * BUMP BOTH when you change this file: here and EXPECTED_WORKER_BUILD in src/lib/version.ts.
 */
const WORKER_BUILD = "2026-08-14g";

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger, used once after deploy to warm KV before DNS is pointed at the site,
  // and useful for smoke-testing afterwards.
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const path = url.pathname;
    /* Manual trigger for the weekly report, so it can be exercised without waiting for a
       Monday. Same slice machine, just forced to start. */
    if (path === "/report") {
      const steps: string[] = [];
      for (let n = 0; n < 12; n++) {
        const s = await stepReport(env, n === 0 && url.searchParams.has("force"));
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
      headers: { "content-type": "application/json" },
    });
  },
};

interface RunResult {
  ok: boolean;
  ms: number;
  status: number;
  rows: number;
  symbols: number;
  venues: Record<string, number>;
  error?: string;
  candles?: number;
  hourly?: number;
  funding?: number;
  candleError?: string;
  /** The set of published contracts changed this run — a URL was added or retired. */
  coverageChanged?: boolean;
  /** A slice of the weekly indexation report ran instead of the bulk sweeps. */
  report?: string;
  /** Coins whose spot candles were refreshed this tick. */
  spot?: number;
  /** Coinbase was unreachable; coin pages keep their last spot price. */
  spotError?: string;
}

/** Sentinel: not an error, just "this tick was spent on the report". */
const SKIP_SWEEPS = Symbol("skip-sweeps");

async function run(env: Env): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { ok: false, ms: 0, status: 0, rows: 0, symbols: 0, venues: {} };

  try {
    /* Only when it CHANGES. Writing this every five minutes cost 288 KV writes a day —
       nearly a third of the free-tier budget — to restate a constant. Reads are 100k/day. */
    {
      const prev = (await env.SNAPSHOT.get("worker:build", "json")) as { build?: string } | null;
      if (prev?.build !== WORKER_BUILD) {
        await env.SNAPSHOT.put("worker:build", JSON.stringify({ build: WORKER_BUILD, at: Date.now() }));
      }
    }
    /* The set that already has live URLs, so the coverage floor can be hysteretic. Read
       before the fetch, written back only when it changes — see OI_RETIRE_FLOOR. */
    const publishedKey = "published:set";
    const prevPublished = ((await env.SNAPSHOT.get(publishedKey, "json")) as string[] | null) ?? [];

    const snap = await fetchSnapshot(prevPublished);
    result.status = 200;
    result.symbols = snap.perps.length;

    const nowPublished = snap.perps.map((p) => p.symbol);
    if (nowPublished.slice().sort().join(",") !== prevPublished.slice().sort().join(",")) {
      await env.SNAPSHOT.put(publishedKey, JSON.stringify(nowPublished));
      result.coverageChanged = true;
    }

    const at = snap.fetchedAt;
    const rows: [string, string, number, number][] = [];
    for (const p of snap.perps) {
      for (const v of p.venues) {
        if (Number.isFinite(v.apr)) {
          rows.push([p.symbol, v.venue, v.apr, at]);
          result.venues[v.venue] = (result.venues[v.venue] ?? 0) + 1;
        }
      }
    }
    result.rows = rows.length;

    // KV first: the site reads from it, and it is the write that matters most.
    await env.SNAPSHOT.put("snapshot", JSON.stringify(snap));

    /* SPOT, every tick, in one subrequest. Coinbase's /products/stats returns the whole
       exchange at once, so the ten coin pages cost one call rather than ten. Wrapped on its
       own: a Coinbase outage must degrade the coin pages to their last spot price, never
       take down a tick that the fifty contract pages depend on. */
    try {
      await env.SNAPSHOT.put("spot", JSON.stringify(await fetchSpot()));
    } catch (e) {
      result.spotError = (e instanceof Error ? e.message : String(e)).slice(0, 80);
    }

    if (rows.length) {
      // One batched statement per tick. At 25 symbols x 3 venues that is ~75 rows per 5
      // minutes = ~21,600 writes/day, inside D1's free 100,000 rows-written/day.
      const insert = env.DB.prepare("INSERT INTO funding_snapshot (symbol, venue, apr, at) VALUES (?1, ?2, ?3, ?4)");
      await env.DB.batch(rows.map((r) => insert.bind(...r)));

      await env.DB.prepare("DELETE FROM funding_snapshot WHERE at < ?1")
        .bind(at - RETAIN_HOURS * 3_600_000)
        .run();
    }

    result.ok = rows.length > 0;
    if (!result.ok) result.error = "upstream returned no usable funding rows";

    /* Bulk refreshes are STAGGERED — at most one kind per invocation — and CHUNKED, at most
       CHUNK symbols per invocation.

       A free Worker allows 50 subrequests per invocation. At 25 symbols a whole sweep was
       25 + 2 and fitted; at 49 it is 51 and does not, and the failure mode is the tick being
       dropped with nothing on /status to say why. So a sweep now walks the symbol list a
       chunk at a time, carrying its cursor in the meta record, and only stamps the cycle
       complete when it wraps. A gate that has come due therefore starts a cycle; a cycle
       already in progress continues regardless of the gate, so a sweep can never stall
       half-finished. */
    try {
      /* THE WEEKLY REPORT COMES FIRST, and takes the tick. It is roughly 140 subrequests
         against a 50-per-invocation ceiling, so it walks itself across consecutive ticks and
         the sweeps stand aside while it does — about twenty minutes, once a week. */
      const step = await stepReport(env);
      if (step) { result.report = step; throw SKIP_SWEEPS; }

      const syms = nowPublished;

      /**
       * Chunked sweep. Returns how many symbols were written this invocation, or undefined if
       * this sweep had nothing to do (which is how the caller knows to try the next one).
       *
       * TWO THINGS THIS GOT WRONG BEFORE, both invisible from the outside:
       *
       * 1. THE CURSOR INDEXED A LIST SORTED BY OPEN INTEREST. That list reorders between
       *    invocations, so slice(24, 48) on the second chunk was not the continuation of
       *    slice(0, 24) on the first — adjacent ranks swap constantly. Symbols were skipped
       *    and others fetched twice, and the result looked exactly like "it works". The cycle
       *    list is now FROZEN into the meta record when the cycle starts and walked from
       *    there, so the cursor means something for the whole cycle.
       *
       * 2. A SYMBOL ENTERING COVERAGE WAITED FOR THE NEXT GATE. Its page went live at once,
       *    but daily candles are on a 12-hour gate, so a freshly covered contract could serve
       *    a chart-shaped hole for half a day with nothing anywhere to say why. A missing
       *    series is not a stale refresh, it is a hole, and it now jumps the queue: `h` records
       *    which symbols have data, and anything absent from it is filled first.
       */
      const sweep = async (
        key: string,
        hours: number,
        write: (sym: string) => Promise<boolean>,
        extra = 0,
        over: string[] = syms,
      ): Promise<number | undefined> => {
        const scope = over;
        const m = (await env.SNAPSHOT.get(key, "json")) as
          | { u?: number; i?: number; l?: string[]; h?: string[]; f?: number }
          | null;
        const have = new Set(m?.h ?? []);
        const room = Math.max(1, CHUNK - extra);

        const run = async (slice: string[]) => {
          const done: string[] = [];
          const oks = await Promise.all(slice.map((s) => write(s).catch(() => false)));
          oks.forEach((ok, i) => { if (ok) done.push(slice[i]); });
          return done;
        };

        const cursor = m?.i ?? 0;
        const inCycle = cursor > 0;

        /* Holes first — but a hole that cannot be filled must not become a stop.
           The first version of this returned as soon as anything was missing, which meant a
           single symbol whose fetch failed every time would sit in `missing` forever, retry on
           every 5-minute tick, and — because the caller runs at most one sweep kind per
           invocation — silently prevent the ordinary refresh of everything else, permanently.
           Found by stepping the worker through a cold start locally, not by reading it.

           So a fill that achieves nothing backs off, and the tick falls through to the normal
           cycle. A fill that makes progress is allowed to continue on the next tick. */
        const stalledSince = m?.f ?? 0;
        const stalled = stalledSince > 0 && Date.now() - stalledSince < FILL_BACKOFF_MS;
        if (!inCycle && !stalled) {
          const missing = scope.filter((s) => !have.has(s));
          if (missing.length) {
            const done = await run(missing.slice(0, room));
            for (const s of done) have.add(s);
            /* On a genuinely cold store the fill IS the first full cycle, so stamp it rather
               than immediately re-fetching all of it under the ordinary gate. */
            const coldComplete = !m?.u && scope.every((s) => have.has(s));
            await env.SNAPSHOT.put(key, JSON.stringify({
              u: coldComplete ? Date.now() : (m?.u ?? 0),
              i: 0,
              l: m?.l,
              h: [...have],
              f: done.length ? 0 : Date.now(),
              filled: done.length,
            }));
            return done.length;
          }
        }

        const due = !m?.u || Date.now() - m.u > hours * 3_600_000;
        if (!inCycle && !due) return undefined;

        const list = inCycle && m?.l?.length ? m.l : scope;
        const done = await run(list.slice(cursor, cursor + room));
        for (const s of done) have.add(s);

        const next = cursor + Math.min(room, Math.max(0, list.length - cursor));
        const wrapped = next >= list.length;

        if (wrapped) {
          /* A cycle just covered the whole set, so `have` is exactly the set with data —
             anything else is a leftover from a contract that dropped out of coverage. Its
             keys would otherwise sit in KV forever. */
          const covered = new Set(scope);
          for (const s of have) {
            if (!covered.has(s)) {
              await env.SNAPSHOT.delete(`${key.split(":")[0]}:${s}`).catch(() => {});
              have.delete(s);
            }
          }
        }

        await env.SNAPSHOT.put(key, JSON.stringify({
          u: wrapped ? Date.now() : (m?.u ?? 0),
          i: wrapped ? 0 : next,
          l: wrapped ? undefined : list,
          h: [...have],
          written: done.length,
        }));
        return done.length;
      };

      const hourly = await sweep("hourly:meta", HOURLY_REFRESH_HOURS, async (s) => {
        const c = await fetchHourly(s);
        await env.SNAPSHOT.put(`hourly:${s}`, JSON.stringify(c));
        return true;
      });
      if (hourly !== undefined) result.hourly = hourly;
      else {
        /* Each pass fetches the newest window for its chunk and ALSO pages one step further
           back for a rotating slice of 6 — a refresh alone only accumulates forward, and the
           rotation is what deepens history. The 6 are counted against the chunk so the
           ceiling holds. */
        const since = Date.now() - 19 * 86_400_000;
        const rot = (await env.SNAPSHOT.get("funding:rot", "json")) as { c?: number } | null;
        const cursor = rot?.c ?? 0;
        let deep = 0;
        const funding = await sweep("funding:meta", FUNDING_REFRESH_HOURS, async (s) => {
          const prev = ((await env.SNAPSHOT.get(`funding:${s}`, "json")) as FundingPoint[] | null) ?? [];
          let merged = mergeFunding(prev, await fetchFundingHistory(s, since));
          const idx = syms.indexOf(s);
          if (deep < 6 && (idx - cursor + syms.length) % syms.length < 6 && merged.length) {
            deep++;
            try { merged = mergeFunding(await fetchFundingHistory(s, merged[0][0] - 21 * 86_400_000), merged); } catch { /* depth is optional */ }
          }
          await env.SNAPSHOT.put(`funding:${s}`, JSON.stringify(merged));
          return true;
        }, 6);
        if (funding !== undefined) {
          result.funding = funding;
          await env.SNAPSHOT.put("funding:rot", JSON.stringify({ c: (cursor + 6) % Math.max(1, syms.length) }));
        } else {
          const candles = await sweep("candles:meta", CANDLE_REFRESH_HOURS, async (s) => {
            const c = await fetchCandles(s);
            await env.SNAPSHOT.put(`candles:${s}`, JSON.stringify(c));
            return true;
          });
          if (candles !== undefined) result.candles = candles;
          else {
            /* Coinbase spot candles for the coin pages. Two granularities per coin — hourly
               and daily — which the site aggregates into 1H/4H and 1D/1W exactly as it does
               for the perpetual series. Ten coins is twenty fetches, one chunk. */
            const cb = await sweep("cb:meta", HOURLY_REFRESH_HOURS, async (s) => {
              const c = COINS.find((x) => x.symbol === s);
              if (!c) return false;
              const [h, d] = await Promise.all([fetchSpotCandles(c.product, 3600), fetchSpotCandles(c.product, 86400)]);
              await env.SNAPSHOT.put(`cbh:${s}`, JSON.stringify(h));
              await env.SNAPSHOT.put(`cbd:${s}`, JSON.stringify(d));
              return true;
            }, 10, COINS.map((c) => c.symbol));
            if (cb !== undefined) result.spot = cb;
          }
        }
      }
    } catch (e) {
      if (e !== SKIP_SWEEPS) result.candleError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
    }
  } catch (e) {
    // A thrown upstream error carries its status in the message ("hyperliquid 503").
    const msg = e instanceof Error ? e.message : String(e);
    const m = /(\d{3})/.exec(msg);
    result.status = m ? Number(m[1]) : 0;
    result.error = msg.slice(0, 200);
  }

  result.ms = Date.now() - started;

  // The canary write is itself wrapped: a failure to record a failure must not mask it,
  // and must never turn a data problem into an unhandled rejection in a cron.
  try {
    await env.DB.prepare(
      "INSERT INTO upstream_check (at, source, status, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(
        started,
        "hyperliquid",
        result.status,
        result.ms,
        result.ok ? 1 : 0,
        JSON.stringify({ symbols: result.symbols, rows: result.rows, venues: result.venues, error: result.error }),
      )
      .run();
    await env.DB.prepare("DELETE FROM upstream_check WHERE at < ?1")
      .bind(started - CANARY_RETAIN_HOURS * 3_600_000)
      .run();
  } catch {
    // swallowed on purpose — see above
  }

  return result;
}

// Minimal ambient types so this file compiles without @cloudflare/workers-types.
interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}
interface ScheduledController {
  scheduledTime: number;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}
