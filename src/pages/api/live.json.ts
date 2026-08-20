import type { APIRoute } from "astro";
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
  const [live, snap] = await Promise.all([
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

  /* SPOT IS GONE FROM THIS PAYLOAD, ON PURPOSE, AND CAN COME BACK IN ONE LINE.
     Removed 19 August 2026 with the licensing question still open rather than after it closed,
     because the rule is that unconfirmed permission resolves toward removal. This endpoint was
     the sharpest form of the question a compliance audit raised: not display of a third party's
     market data on a page, but MACHINE-READABLE REDISTRIBUTION of it to anybody who requests a
     URL. Attribution — which this payload now carries for what remains — mitigates a display
     question and does not answer a redistribution one.

     WHAT IT COST, stated rather than minimised: the spot price, the 24-hour change and the
     basis stop moving while a reader watches. Every one of them is still server-rendered at
     first byte, still current to the minute at page load, and still stamped with its own age.
     A convenience, not a figure.

     WHAT IT DID NOT COST: `mark` and `apr` are Hyperliquid's and stay. See interact.js — the
     overlay freezes mark alongside spot on any page that prints a spot-derived figure, because
     a mark that moves beside a spot that does not is two prices for one asset both looking
     current, which is a defect this codebase has already fixed once.

     THERE IS NO CHEAP REVERSAL ANY MORE, and the note that stood here claiming one was wrong in
     a way worth recording. It said interact.js "needs no change — it already paints spot when
     the payload carries it and freezes when it does not". That client-side spot handling has
     since been deleted, along with the freeze guard that went with it, because keeping it did
     active harm: the coin pages were re-based onto the perpetual and kept the old `data-spot`
     attribute names, so the guard fired permanently and froze their entire overlay. Dead code
     kept for a reversal is not free, and this one cost the ten pages it was meant to protect.
     Restoring spot would now mean the ingest, the payload, the client branches and the guard —
     and it would first mean a licence this project has established it does not have.

     ATTRIBUTION STAYS IN THE PAYLOAD for what is left. The HTML footer credits our sources and
     reaches nothing that reads JSON, so until `sources` existed the one representation a third
     party could actually consume named nobody. */
  return new Response(
    JSON.stringify({
      /* The clocks of what this payload actually delivers. `at` used to include the spot cron's
         stamp, which would now claim page-wide freshness for the one figure the overlay no
         longer refreshes. */
      at: Math.max(live?.at ?? 0, snap.fetchedAt),
      liveAt: live?.at ?? 0,
      snapAt: snap.fetchedAt,
      sources: { mark: "Hyperliquid", apr: "Hyperliquid (incl. Binance and Bybit rates it republishes)" },
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
