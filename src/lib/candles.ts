/**
 * Daily candles, and the survival counterfactual computed from them.
 *
 * WHY THIS EXISTS. A liquidation heatmap of the usual kind needs the distribution of open
 * positions by leverage and entry price. No venue publishes it, which is why products that
 * draw one ship several "models" and ask you to pick. There is, however, an adjacent
 * question that is fully answerable from public data:
 *
 *     "A position opened on day D at leverage L and held H days — did the rules close it?"
 *
 * That is a counterfactual over the ACTUAL price path, not over hypothetical positions.
 * Each cell is independently true or false, nothing is weighted, and no distribution is
 * assumed. It is checkable against the candle series printed on the page.
 */

/** ONE canonical tuple everywhere: [time, open, high, low, close, volume].
 *  Positional indexing across four call sites is how off-by-one bugs get shipped, so the
 *  positions are named and every consumer uses the names. */
export const T = 0, O = 1, H = 2, L = 3, C = 4, V = 5;
export type Candle = [t: number, o: number, h: number, l: number, c: number, v: number];

export interface CandleSet {
  /** epoch ms of the write */
  u: number;
  d: Candle[];
}

const INFO = "https://api.hyperliquid.xyz/info";

/** Days retained in KV. The page shows fewer; the surplus lets the hold window slide. */
export const CANDLE_DAYS = 800;
/** Hours retained for the liquidation map. 14 days at 1h resolution. */
export const CANDLE_HOURS = 720;

export async function fetchCandles(symbol: string, days = CANDLE_DAYS): Promise<CandleSet> {
  const end = Date.now();
  const start = end - days * 86_400_000;
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1d", startTime: start, endTime: end } }),
  });
  if (!r.ok) throw new Error(`candles ${symbol} ${r.status}`);
  const raw = (await r.json()) as { t: number; o: string; h: string; l: string; c: string; v: string }[];
  // Hyperliquid backfills pre-launch days as zero-volume price marks. Those are not this
  // venue's traded data and must never be presented as such — drop them.
  // Hyperliquid backfills pre-launch days as zero-volume, zero-trade price marks. They are
  // not this venue's traded data and must never be drawn as such.
  const d: Candle[] = raw
    .filter((c) => Number(c.v) > 0)
    .map((c) => [c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v)]);
  return { u: Date.now(), d };
}

/** Hourly candles carry VOLUME too: the liquidation model weights each bar by how much
 *  actually traded in it, which is the one part of "when were positions opened" that is
 *  observable rather than assumed. */
export type HourCandle = Candle;

export async function fetchHourly(symbol: string, hours = CANDLE_HOURS): Promise<{ u: number; d: HourCandle[] }> {
  const end = Date.now();
  const start = end - hours * 3_600_000;
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1h", startTime: start, endTime: end } }),
  });
  if (!r.ok) throw new Error(`hourly ${symbol} ${r.status}`);
  const raw = (await r.json()) as { t: number; o: string; h: string; l: string; c: string; v: string }[];
  const d: HourCandle[] = raw
    .filter((c) => Number(c.v) > 0)
    .map((c) => [c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v)]);
  return { u: Date.now(), d };
}

interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/**
 * Same contract as getSnapshot: production reads KV and nothing else, so an upstream
 * outage can only make the data older. Returns null when nothing has been written yet —
 * the caller degrades the section rather than the page.
 */
export async function getCandles(kv: KVLike | undefined, symbol: string, devReadThrough = false): Promise<CandleSet | null> {
  if (kv) {
    try {
      const v = (await kv.get(`candles:${symbol}`, "json")) as CandleSet | null;
      if (v && Array.isArray(v.d) && v.d.length > 20) return v;
    } catch {
      /* fall through */
    }
    if (!devReadThrough) return null;
  }
  try {
    return await fetchCandles(symbol);
  } catch {
    return null;
  }
}

export interface Cell {
  /** index into the entry-day array */
  i: number;
  /** null when the position was still open at the end of the hold window */
  liqDay: number | null;
}

export interface LevelResult {
  L: number;
  threshold0: number;
  cells: Cell[];
  tested: number;
  liquidated: number;
  medianDays: number | null;
}

export interface Grid {
  entries: Candle[];
  levels: LevelResult[];
  holdDays: number;
  side: "long" | "short";
  /** first and last entry day, epoch ms */
  from: number;
  to: number;
}

/**
 * For each leverage and each entry day, walk forward `holdDays` and find the first day the
 * high/low crosses the maintenance-margin threshold for a position opened at that close.
 *
 * Only entry days with a FULL hold window are evaluated. Without that, recent columns would
 * look artificially safe purely because less time has passed — a censoring artefact that
 * would make the right-hand edge of the chart a lie.
 */
export function survivalGrid(opts: {
  candles: Candle[];
  mmf: number;
  levels: number[];
  holdDays: number;
  side: "long" | "short";
  maxEntries: number;
}): Grid {
  const { candles, mmf, levels, holdDays, side, maxEntries } = opts;
  const usable = candles.length - holdDays;
  const startIdx = Math.max(0, usable - maxEntries);
  const entries = candles.slice(startIdx, Math.max(startIdx, usable));

  const out: LevelResult[] = levels.map((L) => {
    const cells: Cell[] = [];
    const days: number[] = [];
    for (let e = 0; e < entries.length; e++) {
      const abs = startIdx + e;
      const close = candles[abs][C];
      const threshold = side === "long" ? (close * (1 - 1 / L)) / (1 - mmf) : (close * (1 + 1 / L)) / (1 + mmf);
      let liqDay: number | null = null;
      for (let j = abs + 1; j <= abs + holdDays && j < candles.length; j++) {
        const crossed = side === "long" ? candles[j][3] <= threshold : candles[j][2] >= threshold; // [3]=low [2]=high
        if (crossed) {
          liqDay = j - abs;
          days.push(liqDay);
          break;
        }
      }
      cells.push({ i: e, liqDay });
    }
    days.sort((a, b) => a - b);
    return {
      L,
      threshold0: entries.length ? (side === "long" ? (entries[entries.length - 1][C] * (1 - 1 / L)) / (1 - mmf) : (entries[entries.length - 1][C] * (1 + 1 / L)) / (1 + mmf)) : 0,
      cells,
      tested: entries.length,
      liquidated: days.length,
      medianDays: days.length ? days[Math.floor(days.length / 2)] : null,
    };
  });

  return {
    entries,
    levels: out,
    holdDays,
    side,
    from: entries.length ? entries[0][0] : 0,
    to: entries.length ? entries[entries.length - 1][0] : 0,
  };
}

export async function getHourly(kv: KVLike | undefined, symbol: string, devReadThrough = false): Promise<{ u: number; d: HourCandle[] } | null> {
  if (kv) {
    try {
      const v = (await kv.get(`hourly:${symbol}`, "json")) as { u: number; d: HourCandle[] } | null;
      if (v && Array.isArray(v.d) && v.d.length > 24) return v;
    } catch {
      /* fall through */
    }
    if (!devReadThrough) return null;
  }
  try {
    return await fetchHourly(symbol);
  } catch {
    return null;
  }
}

/* =========================================================================================
   FUNDING HISTORY

   Hyperliquid publishes its OWN funding rate hourly back to 2023-05-12, 500 rows per call.
   That is a different thing from the cross-venue history this site records itself, and the
   chart must say which is which rather than blurring them: HL's own rate has years of
   depth; the three-venue comparison only begins when our cron started.

   Sign flips for HL are derivable from this series directly — no recorded history needed.
   ========================================================================================= */
export type FundingPoint = [t: number, rate: number];

export async function fetchFundingHistory(symbol: string, sinceMs: number): Promise<FundingPoint[]> {
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "fundingHistory", coin: symbol, startTime: sinceMs }),
  });
  if (!r.ok) throw new Error(`fundingHistory ${symbol} ${r.status}`);
  const raw = (await r.json()) as { time: number; fundingRate: string }[];
  return raw.map((x) => [x.time, Number(x.fundingRate)] as FundingPoint).filter((x) => Number.isFinite(x[1]));
}

/** Newest 500 rows merged into whatever is stored, so depth ACCUMULATES across refreshes. */
export function mergeFunding(prev: FundingPoint[], next: FundingPoint[], cap = 4000): FundingPoint[] {
  const m = new Map<number, number>();
  for (const [t, v] of prev) m.set(t, v);
  for (const [t, v] of next) m.set(t, v);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).slice(-cap).map(([t, v]) => [t, v] as FundingPoint);
}

export async function getFunding(kv: KVLike | undefined, symbol: string, devReadThrough = false): Promise<FundingPoint[] | null> {
  if (kv) {
    try {
      const v = (await kv.get(`funding:${symbol}`, "json")) as FundingPoint[] | null;
      if (Array.isArray(v) && v.length > 24) return v;
    } catch {
      /* fall through */
    }
    if (!devReadThrough) return null;
  }
  try {
    return await fetchFundingHistory(symbol, Date.now() - 30 * 86_400_000);
  } catch {
    return null;
  }
}

/** Leverage ladder for the grid: dense at the top where the differences bite. */
export function gridLevels(maxLeverage: number, rows = 12): number[] {
  const set = new Set<number>();
  for (let i = 0; i < rows; i++) {
    const f = 1 - i / (rows - 1);
    // squared spacing keeps more rows near the maximum, where survival changes fastest
    const L = Math.round(2 + (maxLeverage - 2) * f * f);
    if (L >= 2 && L <= maxLeverage) set.add(L);
  }
  return [...set].sort((a, b) => b - a);
}
