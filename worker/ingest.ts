import { fetchSnapshot } from "../src/lib/hyperliquid.ts";

/**
 * Ingest worker. Runs on a 5-minute cron, writes the current snapshot to KV (which the
 * pages server-render from) and appends funding history to D1 (which the flip feed reads).
 *
 * CPU budget: the free tier allows 10ms per invocation. Network wait does not count, so
 * the only CPU spent here is JSON parsing and the writes. Margin tables are deliberately
 * NOT fetched here — they change rarely and are committed at build time, which keeps 232
 * extra requests off this path.
 */

interface Env {
  SNAPSHOT: KVNamespace;
  DB: D1Database;
}

/** Snapshots older than this are pruned; the flip feed only looks back 24h. */
const RETAIN_HOURS = 72;

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger, useful for the first run and for smoke-testing after deploy.
  async fetch(req: Request, env: Env) {
    if (new URL(req.url).pathname !== "/ingest") return new Response("not found", { status: 404 });
    const n = await run(env);
    return new Response(`ok, ${n} funding rows\n`, { headers: { "content-type": "text/plain" } });
  },
};

async function run(env: Env): Promise<number> {
  const snap = await fetchSnapshot();
  await env.SNAPSHOT.put("snapshot", JSON.stringify(snap));

  const at = snap.fetchedAt;
  const rows: [string, string, number, number][] = [];
  for (const p of snap.perps) {
    for (const v of p.venues) {
      if (Number.isFinite(v.apr)) rows.push([p.symbol, v.venue, v.apr, at]);
    }
  }
  if (!rows.length) return 0;

  // One batched statement per tick. At 25 symbols x 3 venues that is ~75 rows per 5
  // minutes = ~21,600 writes/day, inside D1's free 100,000 rows-written/day.
  const insert = env.DB.prepare("INSERT INTO funding_snapshot (symbol, venue, apr, at) VALUES (?1, ?2, ?3, ?4)");
  await env.DB.batch(rows.map((r) => insert.bind(...r)));

  await env.DB.prepare("DELETE FROM funding_snapshot WHERE at < ?1")
    .bind(at - RETAIN_HOURS * 3_600_000)
    .run();

  return rows.length;
}

// Minimal ambient types so this file compiles without @cloudflare/workers-types.
interface KVNamespace {
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
