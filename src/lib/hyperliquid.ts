import { toApr, type Venue, type VenueFunding } from "./funding.ts";
import type { MarginTable } from "./margin.ts";

const INFO = "https://api.hyperliquid.xyz/info";

/** Only symbols above this notional open interest get an entity page (rule 3: no thin pages). */
export const OI_NOTIONAL_FLOOR = 5_000_000;

/**
 * A published contract is NOT dropped the moment it dips back under the floor — it is dropped
 * when it falls under this lower one.
 *
 * Without the gap, a contract sitting near $5M oscillates in and out of the set on ordinary
 * market noise, and every oscillation 404s a URL that Google has already crawled and indexed.
 * That is an expensive, entirely silent way to lose coverage: nothing in the build fails,
 * nothing on the site looks wrong, the page simply stops existing and comes back later.
 *
 * The gap is 30%, which is wider than a day's move in open interest on anything in this band
 * and narrower than a genuine collapse in interest.
 */
export const OI_RETIRE_FLOOR = 3_500_000;

/**
 * Hard ceiling on the entity set. 50 rather than "everything above the floor" so that a burst
 * of new listings cannot silently multiply the page count, the sweep length and the publishing
 * rate all at once. The eligible count moves with the market; the live figure is rendered
 * from snap.eligibleCount on /, /funding and /data-sources rather than repeated here, because
 * a number written into a comment is a number that goes stale silently.
 */
export const SYMBOL_CAP = 50;

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

/**
 * ONE RETRY, ON RATE LIMITING ONLY.
 *
 * 307 of 857 ingest runs returned HTTP 429 between 14 and 17 August — 36% — and every one of
 * them carried symbols:0, rows:0, meaning the limit hit this call and the whole run aborted
 * before fetching anything. The site's egress is a shared Cloudflare address and the budget
 * measured out at ~432 requests an hour to this one host, dominated by the chunked sweeps; the
 * snapshot fetch is simply the call that arrives after the burst.
 *
 * Deliberately ONE retry, not a loop, and only for 429 and 502. A retry that keeps going turns
 * a genuine upstream outage into a slow cron and a quiet site — the failure this whole audit
 * is about, reintroduced by the fix for a different one. If the second attempt fails the error
 * propagates exactly as before and the run is recorded as failed.
 *
 * 1200ms because network wait does not count toward the Worker CPU limit, so it is free here,
 * and one second is the shortest delay that means anything against a per-minute window.
 */
async function info<T>(body: unknown): Promise<T> {
  const send = () =>
    fetch(INFO, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let r = await send();
  if (r.status === 429 || r.status === 502) {
    await new Promise((res) => setTimeout(res, 1200));
    r = await send();
  }
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

/**
 * Fetch and normalise. Two upstream calls, no key, no other data source.
 *
 * `published` is the set that already has live URLs, supplied by the ingest worker from KV.
 * It is what makes the floor hysteretic: a contract already in it survives down to
 * OI_RETIRE_FLOOR instead of vanishing the first time it slips under OI_NOTIONAL_FLOOR.
 */
export async function fetchSnapshot(published: string[] = []): Promise<Snapshot> {
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
      /* BOTH INPUTS TO toApr(), NOT JUST THE RATE. This filtered on fundingRate alone and then
         annualised with `v.fundingIntervalHours`, unchecked — so an upstream row carrying a
         finite rate and a missing or zero interval produced apr: NaN, which reaches the reader
         as the literal string "NaN" in the Settlements/year column of the page whose entire
         subject is how that annualisation is done. The condition tested one value and the code
         acted on two. */
      .filter(([, v]) => v && Number.isFinite(Number(v.fundingRate))
        && Number.isFinite(Number(v.fundingIntervalHours)) && Number(v.fundingIntervalHours) > 0)
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
      /* ONE HYPERLIQUID FUNDING NUMBER. There used to be two, on purpose, and the measurement
         that justified it expired.
 
         The note this replaces said: `hlApr` is metaAndAssetCtxs.funding, the rate for the
         interval NOW IN PROGRESS, while `venues` comes from predictedFundings, each venue's
         published rate for the NEXT interval — the only source that exists for Binance and
         Bybit and therefore the only basis on which venues can be compared. Both were labelled
         "funding". That was checked rather than assumed, across all 232 contracts: 188
         identical, worst disagreement 0.31pp, "none exceeding 1pp, and NO sign flips". On
         rates running to ±85% that was noise, so the two were left alone, and the note asked
         the next person not to unify them and call it a fix.
 
         Both bounds are now false. Measured live at one snapshot instant (2026-08-18T07:02:11Z,
         a single <time> stamp shared by /, /watchlist and /funding): 21 of 49 published coins
         disagreed, worst 12.0pp — PENDLE at -6.10% against +5.90% — and THREE contracts
         disagreed in SIGN. MON, JUP and PENDLE were painted green on /watchlist and red on
         /funding at the same second: the site told one reader shorts pay longs and another
         longs pay shorts, about the same contract on the same venue, in the one visual language
         reserved for that single meaning.
 
         There was a second contradiction inside a single row, independent of any drift.
         `aprSpread` below is max-min over `venues`, and /watchlist printed it in the column
         beside `hlApr`, which is not a member of that array. PENDLE: venues 5.90 / 2.48 / 10.95
         gives the 8.47% that was printed — but with -6.10% in the Hyperliquid column the spread
         would be 17.05%. Two adjacent cells of one row could not both be true.
 
         So `hlApr` is now Hyperliquid's entry in the same array the spread is computed from,
         and every page quotes one number. Nothing computed on the current-interval meaning —
         all six consumers were display — so this changes what is shown and not what is derived.
         The next-interval rate is also the honest one to colour: it is the payment that has not
         happened yet, which is what a reader deciding whether to hold is asking about. */
      hlApr: venues.find((v) => v.venue === "HlPerp")?.apr ?? NaN,
      venues,
      aprSpread: aprs.length >= 2 ? Math.max(...aprs) - Math.min(...aprs) : null,
    };
  });

  const live = new Set(published);
  const eligible = all
    .filter(
      (p) =>
        Number.isFinite(p.oiNotional) &&
        (p.oiNotional >= OI_NOTIONAL_FLOOR || (live.has(p.symbol) && p.oiNotional >= OI_RETIRE_FLOOR)),
    )
    .sort((a, b) => b.oiNotional - a.oiNotional);

  return {
    available: true,
    fetchedAt: Date.now(),
    perps: eligible.slice(0, SYMBOL_CAP),
    // Reported on the site as "N of M clear the floor", so it counts the ENTRY floor only —
    // a number inflated by contracts kept alive on hysteresis would not match its own label.
    eligibleCount: all.filter((p) => Number.isFinite(p.oiNotional) && p.oiNotional >= OI_NOTIONAL_FLOOR).length,
    universeCount: all.length,
  };
}

/* =========================================================================================
   THE LIVE OVERLAY — the two figures that move fast enough to be worth a minute's work.

   Measured rather than assumed, over two minutes on five contracts:

     mark price       0.002% – 0.057%     moves on every tick, and it is the headline
                                          number on all fifty contract pages
     funding APR      0.00 – 1.27 pp      SOL moved 1.27pp on Hyperliquid and Binance moved
                                          0.15pp; both are visible at the 2dp these are
                                          printed to, and funding is what this site is about
     open interest    0.005% – 0.063%     invisible at the three significant figures it is
                                          displayed to. Polling it would be motion for its
                                          own sake
     24h volume       same                same

   So the minute cron carries mark and funding, open interest and volume stay on the
   five-minute snapshot, and the pages SAY which is which rather than implying one clock.
   ========================================================================================= */
export interface LiveSet {
  at: number;
  /** symbol -> mark price */
  mark: Record<string, number>;
  /** symbol -> venue -> annualised rate */
  apr: Record<string, Partial<Record<Venue, number>>>;
}

export async function fetchLive(symbols: string[]): Promise<LiveSet> {
  const want = new Set(symbols);
  const [meta, predicted] = await Promise.all([
    info<MetaAndCtxs>({ type: "metaAndAssetCtxs" }),
    info<PredictedFundings>({ type: "predictedFundings" }),
  ]);
  const [{ universe }, ctxs] = meta;
  const bySymbol = new Map(predicted);
  const out: LiveSet = { at: Date.now(), mark: {}, apr: {} };
  universe.forEach((u, i) => {
    if (!want.has(u.name)) return;
    const mk = n(ctxs[i]?.markPx);
    if (Number.isFinite(mk)) out.mark[u.name] = mk;
    const venues: Partial<Record<Venue, number>> = {};
    for (const [venue, v] of bySymbol.get(u.name) ?? []) {
      if (!v) continue;
      const a = toApr(Number(v.fundingRate), Number(v.fundingIntervalHours));
      if (Number.isFinite(a)) venues[venue as Venue] = a;
    }
    if (Object.keys(venues).length) out.apr[u.name] = venues;
  });
  return out;
}

/**
 * THE FRESHNESS PILL IS A PROMISE ABOUT THE WHOLE PAGE, so it has to be made by the slowest
 * store on it, not the fastest.
 *
 * The coin templates passed `spotSet?.at ?? snap.fetchedAt` - the newest of the stores they
 * read. Spot is written every minute and the snapshot every five, so the pill said "Updated 0
 * min ago" directly above open interest and funding rates that could be five minutes old.
 * Sampled against production the two clocks ran 180-240s apart, and the gap peaks at the full
 * 300s just before a rotation. Nothing on the page was wrong; the sentence describing all of
 * it was.
 *
 * Taking the oldest understates freshness on the fast figures instead, which is the error to
 * prefer: a reader who trusts the pill is never told a number is newer than it is. Zeroes and
 * nullish stamps are dropped rather than treated as the epoch, or one missing store would
 * date the page to 1970.
 */
export function oldestStamp(...stamps: (number | null | undefined)[]): number | undefined {
  const real = stamps.filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s > 0);
  return real.length ? Math.min(...real) : undefined;
}

export async function getLive(kv: KVNamespace | undefined): Promise<LiveSet | null> {
  try {
    const v = (await kv?.get("live", "json")) as LiveSet | null;
    if (v?.mark && Object.keys(v.mark).length) return v;
  } catch { /* fall through */ }
  return null;
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
 * Look a contract up by name, CASE-INSENSITIVELY.
 *
 * Hyperliquid denominates some contracts in thousands and names them with a lower-case
 * prefix: kPEPE, kBONK, kSHIB. Every page here was calling .toUpperCase() on the requested
 * symbol and comparing it to the exact upstream name, so KPEPE never matched kPEPE. The
 * contract pages 404'd — on URLs their own sitemap had just published — and the pages that
 * take a ?symbol= query did something quieter and worse: they fell back to BTC and rendered
 * a complete, plausible, wrong page under the heading the reader asked for.
 *
 * It only surfaced when the coverage floor let the first k-prefixed contract in, which is
 * exactly the kind of bug that waits for a config change to appear.
 */
export const findPerp = (perps: Perp[], want: string | null | undefined): Perp | undefined => {
  if (!want) return undefined;
  const k = want.toLowerCase();
  return perps.find((p) => p.symbol.toLowerCase() === k);
};

/**
 * THE CONTRACT AND ITS TIER TABLE, CHOSEN TOGETHER — because they were being chosen apart.
 *
 * Four templates carried the identical pair of lines:
 *
 *     const perp  = findPerp(snap.perps, q.get("symbol")) ?? snap.perps[0];
 *     const table = tables[String(perp.marginTableId)];
 *
 * The existence test is on the LIVE snapshot; the table comes from a JSON file committed at the
 * last build. They are different sources with different update paths, and nothing made them
 * agree. `tierFor` and `liquidationPrice` both read `table.marginTiers` unguarded, so a contract
 * whose tier table is not in the committed file does not degrade — it throws a TypeError at
 * render, and five indexed URLs answer 500.
 *
 * Today the two sets match exactly: upstream declares 3, 5, 10, 20 and 51-56, and the file holds
 * all ten. That is a fact about today. The worker publishes a new contract the moment it crosses
 * the open-interest floor, with no redeploy involved, so the window between upstream adding a
 * tier table and this repository committing one is a window in which those pages are broken.
 *
 * And the way out was itself broken: `npm run gen:margin` pointed at a `.ts` file that has never
 * existed — the generator is `.mjs` — so the only command that refreshes the tables threw
 * MODULE_NOT_FOUND, and had since the data was committed. Invisible until the day you need it.
 *
 * So a contract with no tier table is simply not a candidate. That is the same rule the site
 * already applies below the coverage floor: a page that cannot compute half of what it exists to
 * say should not be that page. Returning the pair together is what stops the two decisions
 * drifting apart again.
 */
export function pickPerp<T>(
  perps: Perp[],
  want: string | null | undefined,
  tables: Record<string, T>,
): { perp: Perp; table: T } | null {
  const usable = perps.filter((p) => Object.prototype.hasOwnProperty.call(tables, String(p.marginTableId)));
  const perp = findPerp(usable, want) ?? usable[0];
  return perp ? { perp, table: tables[String(perp.marginTableId)] } : null;
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
    /* NO BINDING. In dev that is normal and we read through so the site is usable.
       In PRODUCTION it means the Pages KV binding is missing, misnamed, or was added
       without the re-deploy that attaches it — and reading through would hide that behind
       a site that looks perfect while calling the upstream API on every single request.
       That is the failure you would not diagnose from the symptom, so it fails visibly:
       an empty snapshot, which the page turns into a 503 cold-start notice. */
    if (!devReadThrough) return EMPTY;
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
/**
 * THE COPY USED TO PROMISE THAT THIS RESOLVES ITSELF.
 *
 * It said "This resolves within a few minutes of deployment and does not require any action" —
 * true for a first deploy, which is the case it was written for, and false for the case that
 * actually matters now. This page renders on 18 routes whenever the snapshot is absent OR the
 * store cannot be read, and getSnapshot collapses both into the same EMPTY value. Since 19
 * August 2026 the site has one upstream, so a sustained failure would serve that reassurance
 * indefinitely, to readers and to crawlers, while nothing resolved.
 *
 * Same defect class as the cadence claim the freshness module replaced: an unconditional promise
 * about the future, printed by a page that cannot see the future. The wording now describes the
 * state and names both causes without predicting which one it is.
 */
export function coldStart(): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex"><title>Collecting data</title>` +
      `<style>body{background:#16181b;color:#e6e8ec;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;` +
      `display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}` +
      `p{color:#9aa1ab;max-width:44ch}</style></head><body><div>` +
      `<h1 style="font-size:19px;font-weight:600;margin:0 0 8px">Collecting data</h1>` +
      `<p>No snapshot is available, so there is nothing to render here yet. On a first deploy ` +
      `that clears itself once the ingest runs. It also appears if the data store cannot be ` +
      `read, which does not.</p></div></body></html>`,
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
