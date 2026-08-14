import { toApr, type Venue, type VenueFunding } from "./funding.ts";
import type { MarginTable } from "./margin.ts";

const INFO = "https://api.hyperliquid.xyz/info";

/** Only symbols above this notional open interest get an entity page (rule 3: no thin pages). */
export const OI_NOTIONAL_FLOOR = 5_000_000;
/** Phase 0 caps the entity set; phase 1 raises it to the full set above the floor. */
export const PHASE0_SYMBOL_CAP = 25;

export interface Perp {
  symbol: string;
  markPx: number;
  oraclePx: number;
  prevDayPx: number;
  change24h: number;
  openInterest: number; // base units
  oiNotional: number; // USD
  dayNtlVlm: number; // USD
  premium: number;
  maxLeverage: number;
  marginTableId: number;
  /** Hyperliquid's own current hourly funding, annualised. */
  hlApr: number;
  venues: VenueFunding[];
  aprSpread: number | null;
}

export interface Snapshot {
  fetchedAt: number;
  perps: Perp[];
  /** Every symbol above the floor, before the phase-0 cap. */
  eligibleCount: number;
  universeCount: number;
  /**
   * False only before the ingest worker has ever written to KV. Pages must check this
   * and return a 503 rather than render with an empty perps array — see coldStart().
   */
  available: boolean;
}

async function info<T>(body: unknown): Promise<T> {
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`hyperliquid ${r.status}`);
  return (await r.json()) as T;
}

type MetaAndCtxs = [
  { universe: { name: string; maxLeverage: number; szDecimals: number; marginTableId: number }[] },
  {
    funding: string;
    openInterest: string;
    prevDayPx: string;
    dayNtlVlm: string;
    premium: string;
    oraclePx: string;
    markPx: string;
    midPx: string;
  }[],
];

type PredictedFundings = [string, [string, { fundingRate: string; nextFundingTime: number; fundingIntervalHours: number } | null][]][];

const n = (x: unknown) => (typeof x === "string" || typeof x === "number" ? Number(x) : NaN);

/** Fetch and normalise. Two upstream calls, no key, no other data source. */
export async function fetchSnapshot(): Promise<Snapshot> {
  const [meta, predicted] = await Promise.all([
    info<MetaAndCtxs>({ type: "metaAndAssetCtxs" }),
    info<PredictedFundings>({ type: "predictedFundings" }),
  ]);

  const [{ universe }, ctxs] = meta;
  const predictedBySymbol = new Map(predicted);

  const all: Perp[] = universe.map((u, i) => {
    const c = ctxs[i] ?? ({} as MetaAndCtxs[1][number]);
    const markPx = n(c.markPx);
    const openInterest = n(c.openInterest);
    const prevDayPx = n(c.prevDayPx);

    const venues: VenueFunding[] = (predictedBySymbol.get(u.name) ?? [])
      .filter(([, v]) => v && Number.isFinite(Number(v.fundingRate)))
      .map(([venue, v]) => {
        const rate = Number(v!.fundingRate);
        const intervalHours = v!.fundingIntervalHours;
        return {
          venue: venue as Venue,
          rate,
          intervalHours,
          apr: toApr(rate, intervalHours),
          nextFundingTime: v!.nextFundingTime ?? null,
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
      aprSpread: aprs.length >= 2 ? Math.max(...aprs) - Math.min(...aprs) : null,
    };
  });

  const eligible = all
    .filter((p) => Number.isFinite(p.oiNotional) && p.oiNotional >= OI_NOTIONAL_FLOOR)
    .sort((a, b) => b.oiNotional - a.oiNotional);

  return {
    available: true,
    fetchedAt: Date.now(),
    perps: eligible.slice(0, PHASE0_SYMBOL_CAP),
    eligibleCount: eligible.length,
    universeCount: all.length,
  };
}

/** Margin tables change rarely; fetched at build time and committed. */
export async function fetchMarginTable(id: number): Promise<MarginTable> {
  const raw = await info<{ description: string; marginTiers: { lowerBound: string; maxLeverage: number }[] }>({
    type: "marginTable",
    id,
  });
  return {
    description: raw.description,
    marginTiers: raw.marginTiers.map((t) => ({ lowerBound: Number(t.lowerBound), maxLeverage: t.maxLeverage })),
  };
}

const EMPTY: Snapshot = { fetchedAt: 0, perps: [], eligibleCount: 0, universeCount: 0, available: false };

/**
 * Read the current snapshot.
 *
 * PRODUCTION READS KV AND NOTHING ELSE. There is deliberately no upstream fallback on
 * the request path: a fallback would mean that an upstream outage — the moment the API
 * is slowest — becomes a synchronous dependency of every page render, converting a
 * stale-data problem into a site-down problem. With KV as the only source, an outage can
 * do exactly one thing: make the timestamp on the page older. That is the whole design.
 *
 * A failed KV read is treated the same as an empty one. It must not throw, because a
 * page that cannot read data should degrade, not 500.
 *
 * `devReadThrough` is passed as `import.meta.env.DEV` by pages — a literal Vite replaces
 * with `false` at build time. The local Cloudflare adapter supplies an EMPTY KV namespace
 * in dev, so without it the whole site would 503 locally. It is a parameter rather than an
 * ambient flag so that the production behaviour is visible at every call site.
 */
export async function getSnapshot(kv?: KVNamespace, devReadThrough = false): Promise<Snapshot> {
  if (!kv) {
    try {
      return await fetchSnapshot();
    } catch {
      return EMPTY;
    }
  }
  try {
    const cached = (await kv.get("snapshot", "json")) as Snapshot | null;
    if (cached && Array.isArray(cached.perps) && cached.perps.length) {
      return { ...cached, available: true };
    }
  } catch {
    // fall through
  }

  // PRODUCTION STOPS HERE. No upstream call is reachable from a request.
  if (!devReadThrough) return EMPTY;

  // Dev only: the local KV starts empty, so read through to the API to keep the site usable.
  try {
    return await fetchSnapshot();
  } catch {
    return EMPTY;
  }
}

export interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/**
 * The response every page returns when the snapshot store has never been written.
 *
 * 503 + Retry-After is the correct signal for a temporary, self-resolving condition:
 * Google's guidance is explicit that 503 preserves rankings across short outages where
 * a 200-with-empty-content or a 404 would not. This state exists only between deploying
 * and the first successful cron tick, and is not reachable once ingest has run once.
 */
export function coldStart(): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex"><title>Collecting data</title>` +
      `<style>body{background:#16181b;color:#e6e8ec;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;` +
      `display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}` +
      `p{color:#9aa1ab;max-width:44ch}</style></head><body><div>` +
      `<h1 style="font-size:19px;font-weight:600;margin:0 0 8px">Collecting data</h1>` +
      `<p>The first snapshot has not been written yet. This resolves within a few minutes of ` +
      `deployment and does not require any action.</p></div></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": "120",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    },
  );
}
