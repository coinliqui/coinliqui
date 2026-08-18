import { fetchSnapshot, fetchLive } from "../src/lib/hyperliquid.ts";
import { fetchCandles, fetchHourly, fetchM15, fetchFundingHistory, mergeFunding, type FundingPoint } from "../src/lib/candles.ts";
import { orderSweeps } from "../src/lib/sweep-order.ts";
import { stepIndexNow, publishedUrls } from "./indexnow.ts";
import { readFlips, writeCachedFlips, type D1Like } from "../src/lib/flips.ts";
import { stepReport, stepProbe } from "./report.ts";
import { COINS, fetchSpot, fetchSpotCandles } from "../src/lib/coins.ts";

/**
 * Ingest worker. Runs on a 5-minute cron, writes the current snapshot to KV (which the
 * pages server-render from) and appends funding history to D1 (which the flip feed reads).
 *
 * CPU budget: the free tier allows 10ms per invocation. Network wait does not count, so
 * the only CPU spent here is JSON parsing and the writes. Margin tables are deliberately
 * NOT fetched here — they change rarely and are committed at build time, which keeps 232
 * extra requests off this path.
 *
 * THE FAILURE MODE THIS GUARDS AGAINST IS SILENCE. If the upstream starts refusing
 * requests, or quietly stops returning one venue, nothing breaks loudly: pages keep
 * serving the last good snapshot and only the timestamp drifts. So every run records
 * what it saw — status, latency, and per-venue row counts — into upstream_check, and
 * /status renders it. A venue falling out of coverage is visible as a count going to
 * zero while the run still reports ok.
 */

interface Env {
  SNAPSHOT: KVNamespace;
  DB: D1Database;
  /* Optional, for the weekly indexation report. Absent means the report still runs and says
     which section it could not produce and how to enable it — never a silent gap. */
  SITE_ORIGIN?: string;
  GSC_SA_KEY?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ZONE_ID?: string;
}

/** Snapshots older than this are pruned; the flip feed only looks back 24h. */
const RETAIN_HOURS = 72;

/**
 * WRITE BUDGET, measured rather than assumed, at 49 published contracts:
 *
 *   snapshot   288/day (every tick)
 *   hourly     49 x 12 cycles + 36 cursor writes = 624/day
 *   funding    49 x  4 cycles + 16               = 212/day
 *   candles    49 x  2 cycles +  6               = 104/day
 *   total    ~1,228/day  =  ~36,800/month
 *
 * That is 3.7% of the 1,000,000 writes/month included with Workers Paid, which this account
 * is on. It is NOT inside the free tier — and the free tier's 1,000/day is an ACCOUNT ceiling
 * shared with everything else on the account, which in this case is already spending 450-610
 * a day of it. Both numbers were read from the KV analytics API, not estimated.
 *
 * Daily candles change once a day, so the 5-minute tick refreshing them would be 7,200
 * pointless upstream calls a day.
 *
 * THE 49 IN THE FIRST LINE IS AN EXPIRY DATE. This budget is correct only while the published
 * set and the sweep cadences stay near what they were when it was measured, and it scales with
 * both. scripts/verify-live.mjs section 15 recomputes it from the LIVE published count and from
 * the constants below — read out of this file, not copied into that one — and fails at 25% of
 * quota rather than at 100%. Measured headroom: 3.7% today, 12.3% with every sweep hourly, 13.9%
 * at the full 232-contract universe, 53.1% at both, which trips.
 *
 * The trigger exists because a note exactly like this one, in src/lib/hyperliquid.ts, justified
 * leaving two funding fields unreconciled on a measurement that later stopped being true — and
 * the note asking the next person not to touch it was what stood in the way.
 */
const CANDLE_REFRESH_HOURS = 12;
/* Every 2 hours. The liquidation map's right edge is only as current as this, and a 6-hour
   gate meant the newest drawn bar could be seven hours behind a mark price that was five
   minutes old. Daily, hourly and funding are on SEPARATE cadences, and each sweep is chunked,
   so a single invocation never approaches the 50-subrequest ceiling. */
const HOURLY_REFRESH_HOURS = 2;
/* The 15-minute series refreshes on the same 2-hour gate as the hourly one. It is the shortest
   data this site holds, so a slower gate would leave the newest bars of the shortest chart the
   stalest thing on the page — the opposite of what a reader opening 15m is asking for. */
const M15_REFRESH_HOURS = 2;
/** HL's own funding history, 500 rows a call, merged into what is stored so depth grows. */
const FUNDING_REFRESH_HOURS = 6;
/** Canary rows are small but unbounded, so they are pruned on the same schedule. */
const CANARY_RETAIN_HOURS = 168;
/** Symbols per invocation. 24 + the snapshot's 2 + the funding rotation's 6 = 32, inside the
    50-subrequest-per-invocation ceiling with room for a retry. At 49 contracts a full sweep
    is three invocations — fifteen minutes — which is why the cycle list has to be frozen. */
const CHUNK = 24;
/** How long a priority fill that wrote nothing stands down for, so one unfetchable contract
    cannot hold the ordinary refresh cycle hostage. Two ticks' worth plus margin. */
const FILL_BACKOFF_MS = 10 * 60_000;

/**
 * BUILD STAMP. `worker-dist/ingest.bundle.js` is pasted into the dashboard by hand, so the
 * deployed worker can silently be older than the site that reads its output — and the
 * symptom (a chart panel that never fills, a timestamp that drifts) looks nothing like a
 * stale paste. The worker writes this on every run and /status compares it with the value
 * the site was built with.
 *
 * NO LONGER TYPED BY HAND. It used to be a string here and a matching string in
 * src/lib/version.ts, with a comment saying to bump both "when you change this file" — and
 * "this file" was the hole. The worker bundles src/lib/hyperliquid.ts and src/lib/coins.ts,
 * so a change to either alters what the worker DOES while touching neither place the stamp
 * lived. That happened twice in one day (a bounded retry in info(), another in fetchSpot())
 * and /status reported "worker bundle current" both times: a staleness guard going green
 * while stale. scripts/stamp-worker.mjs now hashes the worker's whole dependency closure.
 */
import { WORKER_BUILD } from "./build-stamp.ts";

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    /* The one-minute cron does spot and nothing else. Everything the contract pages depend on
       stays on the five-minute tick, so a Coinbase hiccup or a busier schedule cannot reach it. */
    if (event.cron === "* * * * *") {
      ctx.waitUntil(minute(env));
      return;
    }
    ctx.waitUntil(run(env));
  },

  // Manual trigger, used once after deploy to warm KV before DNS is pointed at the site,
  // and useful for smoke-testing afterwards.
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const path = url.pathname;
    /* Manual trigger for the weekly report, so it can be exercised without waiting for a
       Monday. Same slice machine, just forced to start. */
    if (path === "/report") {
      const steps: string[] = [];
      for (let n = 0; n < 12; n++) {
        const s = await stepReport(env, n === 0 && url.searchParams.has("force"));
        if (!s) break;
        steps.push(s);
        if (s.startsWith("report: complete")) break;
      }
      return new Response(JSON.stringify({ steps }, null, 2) + "\n", { headers: { "content-type": "application/json" } });
    }
    if (path !== "/ingest") return new Response("not found", { status: 404 });
    const r = await run(env);
    return new Response(JSON.stringify(r, null, 2) + "\n", {
      status: r.ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    });
  },
};

interface RunResult {
  ok: boolean;
  ms: number;
  status: number;
  rows: number;
  symbols: number;
  venues: Record<string, number>;
  error?: string;
  candles?: number;
  hourly?: number;
  m15?: number;
  probe?: string;
  /** What the IndexNow step did, including when it did nothing — a silent step is one nobody
   *  notices has stopped working. */
  indexnow?: string;
  /** What the flip precompute did, so a stalled feed is visible in the run log. */
  flips?: string;
  funding?: number;
  candleError?: string;
  /** Minutes since each bulk sweep last completed a full cycle — the only way a 2h/6h/12h
   *  cadence is observable without reading fifty KV keys by hand. */
  sweepAgeMin?: Record<string, number>;
  /** The set of published contracts changed this run — a URL was added or retired. */
  coverageChanged?: boolean;
  /** A slice of the weekly indexation report ran instead of the bulk sweeps. */
  report?: string;
  /** Coins whose spot candles were refreshed this tick. */
  spot?: number;
  /** Coinbase was unreachable; coin pages keep their last spot price. */
  spotError?: string;
}

/** The shape every sweep keeps in KV: last full cycle, cursor, frozen list, symbols with data,
 *  failure-backoff stamp, and the first error of a fruitless pass. */
interface SweepMeta { u?: number; i?: number; l?: string[]; h?: string[]; f?: number; e?: string }

/** Sentinel: not an error, just "this tick was spent on the report". */
const SKIP_SWEEPS = Symbol("skip-sweeps");

/**
 * The minute tick. Three subrequests, two writes, and nothing the five-minute pipeline
 * depends on — so a Coinbase or Hyperliquid hiccup here cannot reach the snapshot, the
 * funding history or the sweeps.
 *
 * The two halves are written separately and wrapped separately on purpose: spot comes from
 * Coinbase and marks come from Hyperliquid, and one venue being down must not blank the
 * other's numbers on a page that shows both side by side.
 */
/**
 * THE MINUTE TICK, AND IT NOW SAYS WHETHER IT WORKED.
 *
 * Both branches swallowed their errors and recorded nothing. That is right for the FALLBACK —
 * a Coinbase hiccup should leave the coin pages on their last quote rather than take the tick
 * down — but it meant the one-minute path had no observability whatsoever. /data-sources
 * promises that mark and funding refresh every minute, and nothing anywhere could tell you
 * whether they had.
 *
 * That mattered more than it looked: the five-minute ingest has been failing on HTTP 429 for
 * 307 of 857 runs since 14 August, all of them on the FIRST call, so the upstream is rate
 * limiting this Worker's egress — and the minute tick calls the same two endpoints sixty times
 * an hour without recording a thing. A page could have been serving a mark it labelled
 * "updates every minute" that had not updated in an hour, and the only evidence would have
 * been a number that looked plausible.
 *
 * Failures are still swallowed for the READER — that behaviour was correct — and now written
 * down for whoever is diagnosing.
 */
async function minute(env: Env): Promise<void> {
  const started = Date.now();
  let spotErr = "", liveErr = "";
  try {
    await env.SNAPSHOT.put("spot", JSON.stringify(await fetchSpot()));
  } catch (e) {
    spotErr = (e instanceof Error ? e.message : String(e)).slice(0, 60);
  }
  try {
    const published = ((await env.SNAPSHOT.get("published:set", "json")) as string[] | null) ?? [];
    if (published.length) await env.SNAPSHOT.put("live", JSON.stringify(await fetchLive(published)));
  } catch (e) {
    liveErr = (e instanceof Error ? e.message : String(e)).slice(0, 60);
  }

  /* EVERY TICK, NOT ONLY THE FAILURES.
   *
   * Recording only failures has the exact blind spot that made the five-minute ingest look
   * healthier than it was: a tick that never fires cannot record that it failed. Counting
   * failures gave 36%; counting against EXPECTED ticks gave 47% succeeding. The difference was
   * entirely ticks that produced no row at all.
   *
   * So the minute tick writes a row every time, ok=1 or ok=0, and its success rate becomes
   * rows-with-ok / expected-ticks — a number that can only be computed with a positive signal.
   * 1,440 rows a day, aged out by the same 168-hour retention as everything else in this table,
   * which is about 10k rows: nothing against D1's included write allowance, and the cheapest
   * honest way to check a claim printed on fifty pages.
   *
   * Wrapped, as ever: a failure to record a failure must never become an unhandled rejection
   * in a cron. */
  try {
    const m = /(\d{3})/.exec(liveErr || spotErr);
    await env.DB.prepare(
      "INSERT INTO upstream_check (at, source, status, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(started, "minute", spotErr || liveErr ? (m ? Number(m[1]) : 0) : 200, Date.now() - started,
            spotErr || liveErr ? 0 : 1,
            JSON.stringify({ spotError: spotErr || undefined, liveError: liveErr || undefined }))
      .run();
  } catch { /* swallowed on purpose — see above */ }
}

async function run(env: Env): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { ok: false, ms: 0, status: 0, rows: 0, symbols: 0, venues: {} };

  try {
    /* Only when it CHANGES. Writing this every five minutes cost 288 KV writes a day —
       nearly a third of the free-tier budget — to restate a constant. Reads are 100k/day. */
    {
      const prev = (await env.SNAPSHOT.get("worker:build", "json")) as { build?: string } | null;
      if (prev?.build !== WORKER_BUILD) {
        await env.SNAPSHOT.put("worker:build", JSON.stringify({ build: WORKER_BUILD, at: Date.now() }));
      }
    }
    /* The set that already has live URLs, so the coverage floor can be hysteretic. Read
       before the fetch, written back only when it changes — see OI_RETIRE_FLOOR. */
    const publishedKey = "published:set";
    const prevPublished = ((await env.SNAPSHOT.get(publishedKey, "json")) as string[] | null) ?? [];

    const snap = await fetchSnapshot(prevPublished);
    result.status = 200;
    result.symbols = snap.perps.length;

    /* A PLAUSIBILITY FLOOR, because "the upstream failed" and "the upstream answered nonsense"
       need the same response and only one of them throws.
     *
     * info() checks the HTTP status and then trusts the body. Fed a 200 with an empty universe,
     * with contexts full of nulls, or with markPx as the string "n/a", fetchSnapshot returns a
     * perfectly well-formed snapshot containing ZERO contracts — exercised directly against the
     * real function, all three produced perps=0 — and the line below would have written it over
     * the healthy one. The site would then serve fifty empty pages from a snapshot whose
     * timestamp says it is seconds old.
     *
     * The partial case is worse because it is quieter: a response carrying one contract instead
     * of fifty leaves rows.length > 0, so result.ok stays TRUE and /status reports a healthy
     * ingest while forty-nine contracts have silently vanished.
     *
     * So a collapse is refused rather than recorded after the fact. The previous snapshot stays
     * in KV and ages visibly — which is the failure mode this site already knows how to show,
     * on every page, in the freshness pill. A stale number that says it is stale beats a fresh
     * number that is wrong. The threshold is half of the previously published set, and it only
     * applies once there IS a meaningful set, so first boot and genuine growth are unaffected. */
    const prevCount = prevPublished.length;
    const collapsed = snap.perps.length === 0 || (prevCount >= 10 && snap.perps.length < prevCount / 2);
    if (collapsed) result.error = `refused: coverage collapsed ${prevCount} -> ${snap.perps.length}`;

    const nowPublished = snap.perps.map((p) => p.symbol);
    /* NOT ON A COLLAPSE. This is the coverage DECISION, and it is stickier than the snapshot:
       rewriting it to the degenerate set would retire the missing contracts, and their indexed
       URLs would begin returning 404 on the strength of one bad upstream response. URLs are
       promises; a transient is not a reason to break fifty of them. */
    if (!collapsed && nowPublished.slice().sort().join(",") !== prevPublished.slice().sort().join(",")) {
      await env.SNAPSHOT.put(publishedKey, JSON.stringify(nowPublished));
      result.coverageChanged = true;
    }

    const at = snap.fetchedAt;
    const rows: [string, string, number, number][] = [];
    for (const p of snap.perps) {
      for (const v of p.venues) {
        if (Number.isFinite(v.apr)) {
          rows.push([p.symbol, v.venue, v.apr, at]);
          result.venues[v.venue] = (result.venues[v.venue] ?? 0) + 1;
        }
      }
    }
    result.rows = rows.length;

    // KV first: the site reads from it, and it is the write that matters most — which is
    // exactly why a collapsed snapshot must not reach it. The previous one stays and ages
    // visibly instead.
    if (!collapsed) await env.SNAPSHOT.put("snapshot", JSON.stringify(snap));

    /* SPOT, every tick, in one subrequest. Coinbase's /products/stats returns the whole
       exchange at once, so the ten coin pages cost one call rather than ten. Wrapped on its
       own: a Coinbase outage must degrade the coin pages to their last spot price, never
       take down a tick that the fifty contract pages depend on. */
    try {
      await env.SNAPSHOT.put("spot", JSON.stringify(await fetchSpot()));
    } catch (e) {
      result.spotError = (e instanceof Error ? e.message : String(e)).slice(0, 80);
    }

    if (rows.length) {
      // One batched statement per tick. At 25 symbols x 3 venues that is ~75 rows per 5
      // minutes = ~21,600 writes/day, inside D1's free 100,000 rows-written/day.
      // History is append-only; a collapsed read must not enter it or the flip feed and every
      // future comparison inherit the gap as though it were market data.
      const insert = env.DB.prepare("INSERT INTO funding_snapshot (symbol, venue, apr, at) VALUES (?1, ?2, ?3, ?4)");
      if (!collapsed) await env.DB.batch(rows.map((r) => insert.bind(...r)));

      await env.DB.prepare("DELETE FROM funding_snapshot WHERE at < ?1")
        .bind(at - RETAIN_HOURS * 3_600_000)
        .run();
    }

    /* SWEEP FRESHNESS, carried on the run row so a 2h/6h/12h cadence is observable at all.
       Each sweep stamps `u` on its meta when a full cycle completes; without surfacing it,
       the only way to know whether the charts are being refreshed on the interval
       /data-sources declares is to read fifty KV keys by hand. */
    try {
      const ages: Record<string, number> = {};
      for (const [name, key] of [["hourly", "hourly:meta"], ["funding", "funding:meta"], ["candles", "candles:meta"], ["m15", "m15:meta"]] as const) {
        const m = (await env.SNAPSHOT.get(key, "json")) as { u?: number } | null;
        if (m?.u) ages[name] = Math.round((Date.now() - m.u) / 60000);
      }
      if (Object.keys(ages).length) result.sweepAgeMin = ages;
    } catch { /* observability must never break the thing it observes */ }

    result.ok = !collapsed && rows.length > 0;
    if (!result.ok && !result.error) result.error = "upstream returned no usable funding rows";

    /* Bulk refreshes are STAGGERED — at most one kind per invocation — and CHUNKED, at most
       CHUNK symbols per invocation.

       A free Worker allows 50 subrequests per invocation. At 25 symbols a whole sweep was
       25 + 2 and fitted; at 49 it is 51 and does not, and the failure mode is the tick being
       dropped with nothing on /status to say why. So a sweep now walks the symbol list a
       chunk at a time, carrying its cursor in the meta record, and only stamps the cycle
       complete when it wraps. A gate that has come due therefore starts a cycle; a cycle
       already in progress continues regardless of the gate, so a sweep can never stall
       half-finished. */
    try {
      /* THE WEEKLY REPORT COMES FIRST, and takes the tick. It is roughly 140 subrequests
         against a 50-per-invocation ceiling, so it walks itself across consecutive ticks and
         the sweeps stand aside while it does — about twenty minutes, once a week. */
      /* A pending one-shot inspection runs before the sweeps and never competes with them:
         it is a single subrequest, it clears its own request key, and it happens at most once
         per probe written. Placed here so a diagnostic can never starve the ingest. */
      const probe = await stepProbe(env);
      if (probe) result.probe = probe;

      const step = await stepReport(env);
      if (step) { result.report = step; throw SKIP_SWEEPS; }

      /* THE FLIP FEED IS COMPUTED HERE, ONCE, INSTEAD OF ON EVERY HOMEPAGE RENDER.
         Same function, same SQL, same rows — only the caller moved. It ran per reader before,
         which the meter showed as 64.5M D1 rows read per day against a 83,808-row table: the
         one cost line on this project that scaled with traffic, on a project whose entire
         current work is to increase traffic. A failure here leaves the previous value in place
         until it ages out, at which point the page says "warming" rather than showing a stale
         feed as current. */
      try {
        /* D1Like is the structural subset flips.ts needs; the worker's D1Database is wider and
             the compiler will not narrow it implicitly. Asserting to the interface the callee
             declares is honest — it is exactly the shape being used. */
        const flips = await readFlips(env.DB as unknown as D1Like, 24);
        if (flips.status !== "no-store") {
          await writeCachedFlips(env.SNAPSHOT, flips, Date.now());
          result.flips = flips.status === "ready" ? `${flips.total} flip(s), ${flips.rows.length} shown` : flips.status;
        } else {
          result.flips = "no-store";
        }
      } catch (e) {
        result.flips = `threw (${e instanceof Error ? e.message : String(e)})`;
      }

      /* ANNOUNCED ONLY WHEN THE SET OF PUBLISHED URLS CHANGES — see worker/indexnow.ts for
         why that, and not "the page changed". Placed after the report and before the sweeps
         so a submission can never delay data collection, and so a failure here is a logged
         line rather than a lost pass: nothing a reader sees depends on it. */
      try {
        result.indexnow = await stepIndexNow(env, publishedUrls(env.SITE_ORIGIN || "https://coinliqui.com", nowPublished, []));
      } catch (e) {
        result.indexnow = `indexnow: threw (${e instanceof Error ? e.message : String(e)})`;
      }

      const syms = nowPublished;

      /**
       * Chunked sweep. Returns how many symbols were written this invocation, or undefined if
       * this sweep had nothing to do (which is how the caller knows to try the next one).
       *
       * TWO THINGS THIS GOT WRONG BEFORE, both invisible from the outside:
       *
       * 1. THE CURSOR INDEXED A LIST SORTED BY OPEN INTEREST. That list reorders between
       *    invocations, so slice(24, 48) on the second chunk was not the continuation of
       *    slice(0, 24) on the first — adjacent ranks swap constantly. Symbols were skipped
       *    and others fetched twice, and the result looked exactly like "it works". The cycle
       *    list is now FROZEN into the meta record when the cycle starts and walked from
       *    there, so the cursor means something for the whole cycle.
       *
       * 2. A SYMBOL ENTERING COVERAGE WAITED FOR THE NEXT GATE. Its page went live at once,
       *    but daily candles are on a 12-hour gate, so a freshly covered contract could serve
       *    a chart-shaped hole for half a day with nothing anywhere to say why. A missing
       *    series is not a stale refresh, it is a hole, and it now jumps the queue: `h` records
       *    which symbols have data, and anything absent from it is filled first.
       */
      const sweep = async (
        key: string,
        hours: number,
        write: (sym: string) => Promise<boolean>,
        extra = 0,
        over: string[] = syms,
        preloaded: SweepMeta | null | undefined = undefined,
      ): Promise<number | undefined> => {
        const scope = over;
        /* The scheduler above has already read every meta to decide the order; re-reading here
           would cost one subrequest per sweep per tick for a value we are holding. */
        const m = preloaded !== undefined
          ? preloaded
          : ((await env.SNAPSHOT.get(key, "json")) as SweepMeta | null);
        const have = new Set(m?.h ?? []);
        const room = Math.max(1, CHUNK - extra);

        /* WHY A SWEEP FAILED USED TO BE UNKNOWABLE. `write(s).catch(() => false)` swallowed
           every per-symbol error, so a sweep that failed on ALL of its symbols wrote nothing
           and looked exactly like one that had not run yet: no error on /status, no note in
           the run log, no key in KV. Found the hard way — a new sweep produced zero rows for
           half an hour and the only way to tell "broken" from "not its turn" was to reason
           about the scheduler.

           The first error is kept and stored on the meta record. One message is enough to
           name the cause and costs nothing; keeping all of them would just be the same string
           twenty-four times. */
        let firstErr = "";
        const run = async (slice: string[]) => {
          const done: string[] = [];
          const oks = await Promise.all(slice.map((s) =>
            write(s).catch((e) => {
              if (!firstErr) firstErr = `${s}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`;
              return false;
            })));
          oks.forEach((ok, i) => { if (ok) done.push(slice[i]); });
          return done;
        };

        const cursor = m?.i ?? 0;
        const inCycle = cursor > 0;

        /* Holes first — but a hole that cannot be filled must not become a stop.
           The first version of this returned as soon as anything was missing, which meant a
           single symbol whose fetch failed every time would sit in `missing` forever, retry on
           every 5-minute tick, and — because the caller runs at most one sweep kind per
           invocation — silently prevent the ordinary refresh of everything else, permanently.
           Found by stepping the worker through a cold start locally, not by reading it.

           So a fill that achieves nothing backs off, and the tick falls through to the normal
           cycle. A fill that makes progress is allowed to continue on the next tick. */
        const stalledSince = m?.f ?? 0;
        const stalled = stalledSince > 0 && Date.now() - stalledSince < FILL_BACKOFF_MS;
        if (!inCycle && !stalled) {
          const missing = scope.filter((s) => !have.has(s));
          if (missing.length) {
            const done = await run(missing.slice(0, room));
            for (const s of done) have.add(s);
            /* On a genuinely cold store the fill IS the first full cycle, so stamp it rather
               than immediately re-fetching all of it under the ordinary gate. */
            const coldComplete = !m?.u && scope.every((s) => have.has(s));
            await env.SNAPSHOT.put(key, JSON.stringify({
              u: coldComplete ? Date.now() : (m?.u ?? 0),
              i: 0,
              l: m?.l,
              h: [...have],
              f: done.length ? 0 : Date.now(),
              filled: done.length,
              e: done.length ? undefined : firstErr || undefined,
            }));
            return done.length;
          }
        }

        const due = !m?.u || Date.now() - m.u > hours * 3_600_000;
        if (!inCycle && !due) return undefined;

        const list = inCycle && m?.l?.length ? m.l : scope;
        const done = await run(list.slice(cursor, cursor + room));
        for (const s of done) have.add(s);

        const next = cursor + Math.min(room, Math.max(0, list.length - cursor));
        const wrapped = next >= list.length;

        if (wrapped) {
          /* A cycle just covered the whole set, so `have` is exactly the set with data —
             anything else is a leftover from a contract that dropped out of coverage. Its
             keys would otherwise sit in KV forever. */
          const covered = new Set(scope);
          for (const s of have) {
            if (!covered.has(s)) {
              await env.SNAPSHOT.delete(`${key.split(":")[0]}:${s}`).catch(() => {});
              have.delete(s);
            }
          }
        }

        await env.SNAPSHOT.put(key, JSON.stringify({
          u: wrapped ? Date.now() : (m?.u ?? 0),
          i: wrapped ? 0 : next,
          l: wrapped ? undefined : list,
          h: [...have],
          written: done.length,
          e: done.length ? undefined : firstErr || undefined,
        }));
        return done.length;
      };

      /* Funding pages one step further back for a rotating slice of six each pass; a refresh
         alone only accumulates forward, and the rotation is what deepens history. */
      const since = Date.now() - 19 * 86_400_000;
      const rot = (await env.SNAPSHOT.get("funding:rot", "json")) as { c?: number } | null;
      const rotCursor = rot?.c ?? 0;
      let deep = 0;

      /* ONE SWEEP PER TICK, CHOSEN BY STATE RATHER THAN BY POSITION IN THIS FILE.
         These used to be a chain of `else`s, which made source order into priority and gave
         every sweep a hard dependency on every sweep above it. A fifth added at the end
         produced nothing for half an hour while four ahead of it took the ticks. Now the most
         starved eligible sweep goes — see orderSweeps() for the rule and its pathologies.

         Metas are read ONCE here and handed to sweep(), rather than each sweep re-reading its
         own: five extra KV reads a tick would be five extra subrequests against the ceiling
         that CHUNK is sized for, and the ordering needs them all anyway. */
      const jobs: { name: keyof RunResult; key: string; hours: number; extra?: number; over?: string[]; write: (s: string) => Promise<boolean>; after?: () => Promise<void> }[] = [
        { name: "hourly", key: "hourly:meta", hours: HOURLY_REFRESH_HOURS, write: async (s) => {
            await env.SNAPSHOT.put(`hourly:${s}`, JSON.stringify(await fetchHourly(s))); return true; } },
        { name: "funding", key: "funding:meta", hours: FUNDING_REFRESH_HOURS, extra: 6, write: async (s) => {
            const prev = ((await env.SNAPSHOT.get(`funding:${s}`, "json")) as FundingPoint[] | null) ?? [];
            let merged = mergeFunding(prev, await fetchFundingHistory(s, since));
            const idx = syms.indexOf(s);
            if (deep < 6 && (idx - rotCursor + syms.length) % syms.length < 6 && merged.length) {
              deep++;
              try { merged = mergeFunding(await fetchFundingHistory(s, merged[0][0] - 21 * 86_400_000), merged); } catch { /* depth is optional */ }
            }
            await env.SNAPSHOT.put(`funding:${s}`, JSON.stringify(merged)); return true; },
          after: async () => { await env.SNAPSHOT.put("funding:rot", JSON.stringify({ c: (rotCursor + 6) % Math.max(1, syms.length) })); } },
        { name: "candles", key: "candles:meta", hours: CANDLE_REFRESH_HOURS, write: async (s) => {
            await env.SNAPSHOT.put(`candles:${s}`, JSON.stringify(await fetchCandles(s))); return true; } },
        { name: "spot", key: "cb:meta", hours: HOURLY_REFRESH_HOURS, extra: 10, over: COINS.map((c) => c.symbol), write: async (s) => {
            const c = COINS.find((x) => x.symbol === s);
            if (!c) return false;
            const [h, d] = await Promise.all([fetchSpotCandles(c.product, 3600), fetchSpotCandles(c.product, 86400)]);
            await env.SNAPSHOT.put(`cbh:${s}`, JSON.stringify(h));
            await env.SNAPSHOT.put(`cbd:${s}`, JSON.stringify(d));
            return true; } },
        { name: "m15", key: "m15:meta", hours: M15_REFRESH_HOURS, write: async (s) => {
            await env.SNAPSHOT.put(`m15:${s}`, JSON.stringify(await fetchM15(s))); return true; } },
      ];

      const metas = await Promise.all(jobs.map((j) => env.SNAPSHOT.get(j.key, "json") as Promise<SweepMeta | null>));
      const byKey = new Map(jobs.map((j, i) => [j.key, metas[i]]));
      const order = orderSweeps(
        jobs.map((j, i) => ({
          name: j.key,
          hours: j.hours,
          lastCycle: metas[i]?.u ?? 0,
          cursor: metas[i]?.i ?? 0,
          stalledSince: metas[i]?.f ?? 0,
        })),
        Date.now(),
        FILL_BACKOFF_MS,
      );

      for (const chosen of order) {
        const j = jobs.find((x) => x.key === chosen.name)!;
        const n = await sweep(j.key, j.hours, j.write, j.extra ?? 0, j.over ?? syms, byKey.get(j.key) ?? null);
        if (n === undefined) continue;
        (result as unknown as Record<string, number>)[j.name] = n;
        await j.after?.();
        break;
      }
    } catch (e) {
      if (e !== SKIP_SWEEPS) result.candleError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
    }
  } catch (e) {
    // A thrown upstream error carries its status in the message ("hyperliquid 503").
    const msg = e instanceof Error ? e.message : String(e);
    const m = /(\d{3})/.exec(msg);
    result.status = m ? Number(m[1]) : 0;
    result.error = msg.slice(0, 200);
  }

  result.ms = Date.now() - started;

  // The canary write is itself wrapped: a failure to record a failure must not mask it,
  // and must never turn a data problem into an unhandled rejection in a cron.
  try {
    await env.DB.prepare(
      "INSERT INTO upstream_check (at, source, status, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(
        started,
        "hyperliquid",
        result.status,
        result.ms,
        result.ok ? 1 : 0,
        JSON.stringify({ symbols: result.symbols, rows: result.rows, venues: result.venues, error: result.error, sweepAgeMin: result.sweepAgeMin }),
      )
      .run();
    await env.DB.prepare("DELETE FROM upstream_check WHERE at < ?1")
      .bind(started - CANARY_RETAIN_HOURS * 3_600_000)
      .run();
  } catch {
    // swallowed on purpose — see above
  }

  return result;
}

// Minimal ambient types so this file compiles without @cloudflare/workers-types.
interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
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
  cron: string;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}
