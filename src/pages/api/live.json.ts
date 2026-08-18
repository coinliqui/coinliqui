import type { APIRoute } from "astro";
import { getSpot } from "../../lib/coins.ts";
import { getSnapshot, getLive } from "../../lib/hyperliquid.ts";

/**
 * The live layer, and the only network call any page makes after it has loaded.
 *
 * SAME ORIGIN, deliberately — and the reason changed while the design stayed right. It used
 * to be that /privacy promised no off-origin request on page read; that claim is retired and
 * analytics now runs. The engineering reasons are the ones that survive it: subscribing a
 * browser straight to Hyperliquid or Coinbase would put a third-party dependency in the render
 * path of every page, expose their rate limits to our traffic shape, and hand a vendor the
 * timing of every reader. So the browser talks only to this site, and this site reads what the
 * cron already wrote to KV — one request, one origin, one failure mode we control.
 *
 * It is a LAYER, never a source. Every figure on every page is server-rendered at first byte;
 * this exists to move the two that move fast enough to matter. If it 404s, times out or is
 * blocked, the page keeps the numbers it was served with and says so.
 *
 * WHAT IS IN HERE AND WHY. `spot` and `mark` and `apr` are on the one-minute cron because
 * they move at that scale; open interest and volume are not, because they moved 0.005–0.063%
 * in two minutes and are displayed to three significant figures. `at` and `snapAt` are both
 * returned so a page can label each figure with its own real age rather than one page-wide
 * timestamp that is only true of some of them.
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  const [spot, live, snap] = await Promise.all([
    getSpot(env?.SNAPSHOT, import.meta.env.DEV),
    getLive(env?.SNAPSHOT),
    getSnapshot(env?.SNAPSHOT, import.meta.env.DEV),
  ]);

  /* Fall back to the snapshot's marks when the minute tick has not written yet — a page that
     has just deployed should still update, one clock slower, rather than not at all. */
  const mark: Record<string, number> = {};
  for (const p of snap.perps) mark[p.symbol] = p.markPx;
  Object.assign(mark, live?.mark ?? {});

  const apr: Record<string, Record<string, number>> = {};
  for (const p of snap.perps) {
    const v: Record<string, number> = {};
    for (const f of p.venues) if (Number.isFinite(f.apr)) v[f.venue] = f.apr;
    if (Object.keys(v).length) apr[p.symbol] = v;
  }
  for (const [s, v] of Object.entries(live?.apr ?? {})) apr[s] = { ...(apr[s] ?? {}), ...(v as Record<string, number>) };

  return new Response(
    JSON.stringify({
      at: Math.max(spot?.at ?? 0, live?.at ?? 0, snap.fetchedAt),
      spotAt: spot?.at ?? 0,
      liveAt: live?.at ?? 0,
      snapAt: snap.fetchedAt,
      spot: spot?.q ?? {},
      mark,
      apr,
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
