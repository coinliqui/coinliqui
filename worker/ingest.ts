import { fetchSnapshot } from "../src/lib/hyperliquid.ts";
import { fetchCandles, fetchHourly, fetchFundingHistory, mergeFunding, type FundingPoint } from "../src/lib/candles.ts";

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
}

/** Snapshots older than this are pruned; the flip feed only looks back 24h. */
const RETAIN_HOURS = 72;

/**
 * Daily candles change once a day, so refreshing them on the 5-minute tick would be 7,200
 * pointless upstream calls a day. Refresh every 6 hours instead: 4 refreshes x 25 symbols
 * = 100 extra upstream calls and ~104 KV writes daily, against a 1,000 writes/day free
 * limit already carrying 288 snapshot writes. The 25 fetches sit inside one invocation's
 * 50-subrequest budget alongside the 2 snapshot calls.
 */
const CANDLE_REFRESH_HOURS = 12;
/** Hourly candles drive the liquidation map and move faster, so they refresh more often.
 *  Daily and hourly are on SEPARATE cadences so a single tick never exceeds the
 *  50-subrequest ceiling: 25 fetches + the 2 snapshot calls, never 50 + 2. */
/* Every 2 hours, not 6. The liquidation map's right edge is only as current as this, and a
   6-hour gate meant the newest drawn bar could be seven hours behind a mark price that was
   five minutes old. Not 1 hour: 26 writes x 24 is 624/day, which with the snapshot's 288
   puts KV at 1069 against a free-tier ceiling of 1000. Measured, not guessed. */
const HOURLY_REFRESH_HOURS = 2;
/** HL's own funding history, 500 rows a call, merged into what is stored so depth grows. */
const FUNDING_REFRESH_HOURS = 6;
/** Canary rows are small but unbounded, so they are pruned on the same schedule. */
const CANARY_RETAIN_HOURS = 168;
/** Symbols per invocation. 24 + the snapshot's 2 + the funding rotation's 6 = 32, inside
    the free Worker's 50-subrequest ceiling with room for a retry. */
const CHUNK = 24;

/**
 * BUILD STAMP. `worker-dist/ingest.bundle.js` is pasted into the dashboard by hand, so the
 * deployed worker can silently be older than the site that reads its output — and the
 * symptom (a chart panel that never fills, a timestamp that drifts) looks nothing like a
 * stale paste. The worker writes this on every run and /status compares it with the value
 * the site was built with.
 *
 * BUMP BOTH when you change this file: here and EXPECTED_WORKER_BUILD in src/lib/version.ts.
 */
const WORKER_BUILD = "2026-08-14d";

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger, used once after deploy to warm KV before DNS is pointed at the site,
  // and useful for smoke-testing afterwards.
  async fetch(req: Request, env: Env) {
    const path = new URL(req.url).pathname;
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
}

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
    const snap = await fetchSnapshot();
    result.status = 200;
    result.symbols = snap.perps.length;

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
      const syms = snap.perps.map((p) => p.symbol);

      /** Chunked sweep. Returns how many symbols were written this invocation. */
      const sweep = async (
        key: string,
        hours: number,
        write: (sym: string) => Promise<boolean>,
        extra = 0,
      ): Promise<number | undefined> => {
        const m = (await env.SNAPSHOT.get(key, "json")) as { u?: number; i?: number } | null;
        const cursor = m?.i ?? 0;
        const due = !m?.u || Date.now() - m.u > hours * 3_600_000;
        if (cursor === 0 && !due) return undefined;          // cycle complete and not yet due

        const room = Math.max(1, CHUNK - extra);
        const slice = syms.slice(cursor, cursor + room);
        let n = 0;
        for (const ok of await Promise.all(slice.map((sym) => write(sym).catch(() => false)))) if (ok) n++;

        const next = cursor + slice.length;
        const wrapped = next >= syms.length;
        await env.SNAPSHOT.put(key, JSON.stringify({
          u: wrapped ? Date.now() : (m?.u ?? 0),
          i: wrapped ? 0 : next,
          written: n,
        }));
        return n;
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
        }
      }
    } catch (e) {
      result.candleError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
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
