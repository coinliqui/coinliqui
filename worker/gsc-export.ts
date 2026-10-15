/**
 * SEARCH CONSOLE, READABLE FROM THE OPERATOR'S MACHINE WITHOUT THE KEY BEING THERE.
 *
 * The service-account key lives in one place: this worker's GSC_SA_KEY secret. On 15 October
 * 2026 a question about a cliff in impressions could only be answered by reading Search Console
 * in a browser, because the one local reader (scripts/gsc-report.mjs) wanted the key exported
 * into the shell. The operator's ruling: the key does not go on the laptop — a copy there is
 * exactly the leak the pre-push guard exists to stop.
 *
 * So the worker reads, and KV carries the result. Once a day it writes `gsc:export`: the daily
 * series and the page/query detail behind it. scripts/gsc.mjs reads that record with the
 * wrangler OAuth login already on the machine — short-lived, scoped to this Cloudflare account,
 * and refreshed by wrangler itself. No new secret exists, and no HTTP path serves the record:
 * reading it takes the account, not a URL.
 *
 * DAILY, NOT WEEKLY, AND THAT IS THE LESSON IT CARRIES. The weekly report's eight-day windows
 * turned a one-night cliff (31.08 → 01.09.2026: 70 → 26 impressions, position 63 → 14) into
 * "550 → 290 over two readings", which read as slow decay and pointed at the wrong cause.
 *
 * FIVE SUBREQUESTS A DAY: one token exchange, four Search Analytics calls. The cadence is read
 * from the record itself (see worker/corroborate.ts for why not a separate key), and a failed
 * attempt is stamped too, so an error is retried tomorrow rather than on every five-minute tick.
 */
import { gscToken } from "./report.ts";

export const GSC_EXPORT_KEY = "gsc:export";
/** Twenty hours, not twenty-four, so the run does not creep later by a tick every day. */
const GSC_EXPORT_EVERY_MS = 20 * 3_600_000;
/** Search Console publishes the previous day's data in the early UTC morning. */
const GSC_EXPORT_FROM_HOUR_UTC = 6;
/** The daily totals reach back this far; the API keeps sixteen months. */
const GSC_DAYS_SERIES = 180;
/** Page × day and query × day: long enough for a four-weeks-against-four-weeks comparison. */
const GSC_DAYS_DETAIL = 56;
const GSC_DAYS_PAIRS = 28;
/** The API's ceiling per call. A response that fills it is a floor, and the record says so. */
export const GSC_ROW_LIMIT = 25_000;

/** [key1, key2?, clicks, impressions, position] with dates as YYYY-MM-DD and pages as paths. */
export type Row = (string | number)[];
export interface GscExport {
  v: 1;
  at: number;
  /** When the last attempt ran, successful or not; the cadence is read from this. */
  attemptAt: number;
  site: string;
  /** Days the API marks as still filling in — read the last two with that in mind. */
  dataState: "all";
  series: { start: string; end: string; rows: Row[] };
  pageDate: { start: string; end: string; rows: Row[]; truncated: boolean };
  queryDate: { start: string; end: string; rows: Row[]; truncated: boolean };
  queryPage: { start: string; end: string; rows: Row[]; truncated: boolean };
  error?: string;
}

export interface GscExportEnv {
  SNAPSHOT: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  SITE_ORIGIN?: string;
  GSC_SA_KEY?: string;
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether a run is due. Pure, so the cases can pin the cadence without a clock. */
function gscExportDue(prior: Pick<GscExport, "attemptAt"> | null, now: number): boolean {
  if (new Date(now).getUTCHours() < GSC_EXPORT_FROM_HOUR_UTC) return false;
  const last = prior && typeof prior.attemptAt === "number" ? prior.attemptAt : 0;
  return now - last >= GSC_EXPORT_EVERY_MS;
}

/** Search Analytics rows → compact rows. Pages lose the origin; everything else is kept. */
function compactRows(rows: { keys: string[]; clicks: number; impressions: number; position: number }[], origin: string): Row[] {
  return rows.map((r) => [
    ...r.keys.map((k) => (k.startsWith(origin) ? k.slice(origin.length) || "/" : k)),
    r.clicks, r.impressions, Math.round(r.position * 10) / 10,
  ]);
}

/** Returns a short label when it did work, null when there was nothing to do. */
export async function stepGscExport(env: GscExportEnv, now = Date.now()): Promise<string | null> {
  if (!env.GSC_SA_KEY) return null;
  let prior: GscExport | null = null;
  try { prior = (await env.SNAPSHOT.get(GSC_EXPORT_KEY, "json")) as GscExport | null; } catch { /* unreadable = none */ }
  if (!gscExportDue(prior, now)) return null;

  const origin = (env.SITE_ORIGIN || "https://coinliqui.com").replace(/\/$/, "");
  const site = `sc-domain:${new URL(origin).hostname}`;
  const end = iso(now - DAY);
  const span = (days: number) => ({ start: iso(now - days * DAY), end });

  try {
    const token = await gscToken(env.GSC_SA_KEY);
    const query = async (dimensions: string[], days: number) => {
      const w = span(days);
      const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ startDate: w.start, endDate: w.end, dimensions, rowLimit: GSC_ROW_LIMIT, dataState: "all" }),
      });
      const j = (await r.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position: number }[]; error?: { code: number; message: string } };
      if (j.error) throw new Error(`${dimensions.join("×")}: ${j.error.code} ${j.error.message}`);
      const rows = j.rows ?? [];
      return { ...w, rows: compactRows(rows, origin), truncated: rows.length >= GSC_ROW_LIMIT };
    };
    const series = await query(["date"], GSC_DAYS_SERIES);
    const pageDate = await query(["page", "date"], GSC_DAYS_DETAIL);
    const queryDate = await query(["query", "date"], GSC_DAYS_DETAIL);
    const queryPage = await query(["query", "page"], GSC_DAYS_PAIRS);
    const doc: GscExport = {
      v: 1, at: now, attemptAt: now, site, dataState: "all",
      series: { start: series.start, end: series.end, rows: series.rows },
      pageDate, queryDate, queryPage,
    };
    await env.SNAPSHOT.put(GSC_EXPORT_KEY, JSON.stringify(doc));
    const cut = [pageDate, queryDate, queryPage].some((x) => x.truncated) ? ", a detail table hit the row limit" : "";
    return `gsc-export: ${series.rows.length} days, ${pageDate.rows.length} page-days, ${queryDate.rows.length} query-days, ${queryPage.rows.length} pairs${cut}`;
  } catch (e) {
    /* The data already there stays; the attempt is stamped so the next try is tomorrow. */
    const msg = e instanceof Error ? e.message : String(e);
    const keep: GscExport = prior && prior.v === 1
      ? { ...prior, attemptAt: now, error: msg }
      : { v: 1, at: 0, attemptAt: now, site, dataState: "all",
          series: { start: "", end: "", rows: [] },
          pageDate: { start: "", end: "", rows: [], truncated: false },
          queryDate: { start: "", end: "", rows: [], truncated: false },
          queryPage: { start: "", end: "", rows: [], truncated: false },
          error: msg };
    await env.SNAPSHOT.put(GSC_EXPORT_KEY, JSON.stringify(keep));
    return `gsc-export: failed — ${msg.slice(0, 160)}`;
  }
}
