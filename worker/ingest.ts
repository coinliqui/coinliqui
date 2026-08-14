import { fetchSnapshot } from "../src/lib/hyperliquid.ts";
import { fetchCandles, fetchHourly } from "../src/lib/candles.ts";

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
const HOURLY_REFRESH_HOURS = 6;
/** Canary rows are small but unbounded, so they are pruned on the same schedule. */
const CANARY_RETAIN_HOURS = 168;

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
  candleError?: string;
}

async function run(env: Env): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { ok: false, ms: 0, status: 0, rows: 0, symbols: 0, venues: {} };

  try {
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

    // Candles feed the survival map. Failure here must never fail the ingest: the funding
    // history is the asset that cannot be backfilled, candles can be re-fetched any time.
    try {
      const meta = (await env.SNAPSHOT.get("candles:meta", "json")) as { u: number } | null;
      const stale = !meta || Date.now() - meta.u > CANDLE_REFRESH_HOURS * 3_600_000;
      if (stale) {
        const syms = snap.perps.map((p) => p.symbol);
        const sets = await Promise.all(
          syms.map((sym) => fetchCandles(sym).then((c) => [sym, c] as const).catch(() => null)),
        );
        let written = 0;
        for (const entry of sets) {
          if (!entry) continue;
          await env.SNAPSHOT.put(`candles:${entry[0]}`, JSON.stringify(entry[1]));
          written++;
        }
        await env.SNAPSHOT.put("candles:meta", JSON.stringify({ u: Date.now(), symbols: syms, written }));
        result.candles = written;
      }

      const hmeta = (await env.SNAPSHOT.get("hourly:meta", "json")) as { u: number } | null;
      if (!hmeta || Date.now() - hmeta.u > HOURLY_REFRESH_HOURS * 3_600_000) {
        const syms = snap.perps.map((p) => p.symbol);
        const sets = await Promise.all(
          syms.map((sym) => fetchHourly(sym).then((c) => [sym, c] as const).catch(() => null)),
        );
        let written = 0;
        for (const entry of sets) {
          if (!entry) continue;
          await env.SNAPSHOT.put(`hourly:${entry[0]}`, JSON.stringify(entry[1]));
          written++;
        }
        await env.SNAPSHOT.put("hourly:meta", JSON.stringify({ u: Date.now(), written }));
        result.hourly = written;
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
