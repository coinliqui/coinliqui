/**
 * THE DAILY CROSS-VENUE COMPARISON. See src/lib/venue-agreement.ts for what it measures.
 *
 * ONE D1 QUERY AND ONE KV WRITE A DAY. The query reads about three million rows (measured
 * 16 October 2026: 3,100,595), which is why it runs here once rather than in a page on every view.
 * The cadence is read from the record's own attemptAt, as worker/gsc-export.ts does it, and a
 * failed attempt is stamped too, so an error waits for tomorrow rather than retrying every tick.
 * The write lives in this file, not ingest.ts: one a day, outside the per-tick arithmetic that
 * verify-live recomputes from ingest.ts's write sites.
 */
import { VENUE_AGREE_KEY, type AgreeRow, type VenueAgreement } from "../src/lib/venue-agreement.ts";
import type { D1Like } from "../src/lib/flips.ts";

const EVERY_MS = 20 * 3_600_000;
const WINDOW_MS = 30 * 86_400_000;
const HOUR = 3_600_000;

export interface VenueAgreeEnv {
  SNAPSHOT: { get(key: string, type: "json"): Promise<unknown>; put(key: string, value: string): Promise<void> };
  DB: D1Like;
}

export function venueAgreeDue(prior: Pick<VenueAgreement, "attemptAt"> | null, now: number): boolean {
  const last = prior && typeof prior.attemptAt === "number" ? prior.attemptAt : 0;
  return now - last >= EVERY_MS;
}

export const VENUE_AGREE_SQL = `
  WITH h AS (
    SELECT symbol, venue, CAST(at / ${HOUR} AS INTEGER) AS hr, AVG(apr) AS apr
      FROM funding_snapshot WHERE at >= ?1 GROUP BY symbol, venue, hr
  )
  SELECT a.symbol AS symbol, b.venue AS venue, COUNT(*) AS n,
         SUM(CASE WHEN (a.apr > 0 AND b.apr < 0) OR (a.apr < 0 AND b.apr > 0) THEN 1 ELSE 0 END) AS opp,
         AVG(ABS(a.apr - b.apr)) AS gap, MIN(a.hr) AS first
    FROM h a JOIN h b ON a.symbol = b.symbol AND a.hr = b.hr
   WHERE a.venue = 'HlPerp' AND b.venue != 'HlPerp'
   GROUP BY a.symbol, b.venue`;

/** Returns a short label when it did work, null when there was nothing to do. */
export async function stepVenueAgreement(env: VenueAgreeEnv, now = Date.now()): Promise<string | null> {
  let prior: VenueAgreement | null = null;
  try { prior = (await env.SNAPSHOT.get(VENUE_AGREE_KEY, "json")) as VenueAgreement | null; } catch { /* unreadable = none */ }
  if (!venueAgreeDue(prior, now)) return null;
  try {
    const { results } = await env.DB.prepare(VENUE_AGREE_SQL).bind(now - WINDOW_MS)
      .all<{ symbol: string; venue: string; n: number; opp: number; gap: number; first: number }>();
    const rs = results ?? [];
    const rows: AgreeRow[] = rs
      .filter((r) => r.n > 0 && Number.isFinite(r.gap))
      .map((r) => [r.symbol, r.venue, r.n, r.opp, Math.round(r.gap * 1e6) / 1e6]);
    const from = rs.length ? Math.min(...rs.map((r) => r.first)) * HOUR : now - WINDOW_MS;
    const doc: VenueAgreement = { v: 1, at: now, attemptAt: now, from, rows };
    await env.SNAPSHOT.put(VENUE_AGREE_KEY, JSON.stringify(doc));
    return `venue-agreement: ${rows.length} contract-venue pairs`;
  } catch (e) {
    /* What is there stays; the attempt is stamped so the next try is tomorrow. */
    const msg = e instanceof Error ? e.message : String(e);
    const keep: VenueAgreement = prior && prior.v === 1
      ? { ...prior, attemptAt: now, error: msg.slice(0, 200) }
      : { v: 1, at: 0, attemptAt: now, from: 0, rows: [], error: msg.slice(0, 200) };
    await env.SNAPSHOT.put(VENUE_AGREE_KEY, JSON.stringify(keep));
    return `venue-agreement: failed (${msg.slice(0, 80)})`;
  }
}
