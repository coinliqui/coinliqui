import type { APIRoute } from "astro";
import { getSpot } from "../../lib/coins.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";

/**
 * The live layer, and the only network call a coin page makes after it has loaded.
 *
 * SAME ORIGIN, deliberately. Hyperliquid and Coinbase both publish WebSocket feeds a browser
 * could subscribe to directly, and either would be a request to another domain on every page
 * view — which /privacy says does not happen. So the browser talks only to this site, and this
 * site reads the value the cron already wrote to KV. No third party learns that you are here.
 *
 * It is a LAYER, never a source. Every figure on a coin page is server-rendered at first byte;
 * this endpoint exists to move them afterwards. If it 404s, times out, or is blocked, the page
 * keeps the numbers it was served with and nothing shifts.
 *
 * No cookie, no identifier, no body. `no-store` because a five-second-old price served from a
 * cache is the one thing this must not do.
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  const [spot, snap] = await Promise.all([
    getSpot(env?.SNAPSHOT, import.meta.env.DEV),
    getSnapshot(env?.SNAPSHOT, import.meta.env.DEV),
  ]);

  const mark: Record<string, number> = {};
  for (const p of snap.perps) mark[p.symbol] = p.markPx;

  return new Response(
    JSON.stringify({
      at: spot?.at ?? 0,
      markAt: snap.fetchedAt,
      spot: spot?.q ?? {},
      mark,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    },
  );
};
