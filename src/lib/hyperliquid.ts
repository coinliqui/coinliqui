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

/**
 * Read the current snapshot.
 * Production: KV, written every 5 minutes by the ingest worker, so the number is in the
 * server-rendered HTML at first byte. Dev: straight to the upstream API.
 */
export async function getSnapshot(kv?: KVNamespace): Promise<Snapshot> {
  if (kv) {
    const cached = await kv.get("snapshot", "json");
    if (cached) return cached as Snapshot;
  }
  return fetchSnapshot();
}

export interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}
