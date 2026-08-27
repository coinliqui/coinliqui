/**
 * INDEXNOW — TELL THE ENGINES ABOUT A URL THAT DID NOT EXIST BEFORE, AND ONLY THEN.
 *
 * Measured on 18 August 2026: Bing zero results for this domain, DuckDuckGo zero, Brave zero,
 * Yandex zero, Marginalia zero. Only Google had indexed anything. IndexNow is the one submission
 * route that reaches several of those at once, needs no account, and is a documented protocol
 * rather than a form — its own FAQ says a submission "will be shared across all IndexNow-enabled
 * search engines", which today means Bing, Yandex, Seznam, Naver and Yep. Fixing Bing also fixes
 * DuckDuckGo, which serves Bing's index.
 *
 * WHAT COUNTS AS A CHANGE, which is the entire design question here.
 *
 * Every page on this site changes every five minutes, because the prices move. Submitting on
 * that basis would announce ~78 URLs twelve times an hour forever, which is indistinguishable
 * from spam and would earn the domain the treatment spam earns. Bing's own guidance is explicit
 * that this is for new, updated or deleted content, and the protocol documents a 200 as meaning
 * only that the URL was RECEIVED — it is not a ranking lever and cannot be used as one.
 *
 * So the signal is the URL SET, not the content behind it. A contract crossing the open-interest
 * floor creates a page that genuinely did not exist yesterday; a coin reaching its publication
 * date does the same. A price tick does not. The worker keeps a fingerprint of the published set
 * in KV and submits only what appeared since the last submission, which for a stable day means
 * submitting nothing at all — the correct behaviour, and the one that makes the submission
 * meaningful on the day it does fire.
 *
 * The key is deliberately not a secret. IndexNow authenticates by asking the host to serve the
 * key at a known path, so publishing it IS the mechanism; there is nothing to protect and a
 * comment saying otherwise would mislead whoever reads this next.
 */

import { STATIC_ROUTES, liqMapPaths } from "../src/lib/routes.ts";
import { liveCoins } from "../src/lib/coins.ts";

export const INDEXNOW_KEY = "a7f3c19e84b24d6fa0e5b17c93d82f46";

/**
 * EVERY PARTICIPATING ENDPOINT, NOT JUST THE AGGREGATOR.
 *
 * The protocol says a submission to any one endpoint is shared with the rest, and that is the
 * whole appeal of it. But "is shared with" is somebody else's fan-out, and this project's only
 * account-free route into the indexes that are NOT Google runs through it — which makes it the
 * one dependency here worth not having a single point of failure in.
 *
 * Measured directly, 19 August 2026, one URL each: api.indexnow.org 200, www.bing.com 200,
 * yandex.com 202, search.seznam.cz 200, searchadvisor.naver.com 200. Yandex answering 202 while
 * the aggregator answers 200 is the reason this is a list: they are independent services, not
 * mirrors, and a 200 from the aggregator is not evidence that any of the others received
 * anything.
 *
 * Cost is four extra subrequests on a run that only happens when the URL set changes.
 */
/* EXPORTED because scripts/indexnow-drain.mjs posts to the same endpoints from a non-Cloudflare
   address when the Microsoft pair throttles the Worker. It carried its own hand-written copy of
   this list, as a `POST_TO` map keyed by hostname, with a comment saying it "mirrors ENDPOINTS in
   worker/indexnow.ts". A mirror is a copy, and this file has already paid for one: see the header
   of src/lib/routes.ts for the two sitemap lists that drifted 22 URLs apart. */
export const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
  "https://yandex.com/indexnow",
  "https://search.seznam.cz/indexnow",
  "https://searchadvisor.naver.com/indexnow",
];
/* One submission may carry many URLs; the protocol caps a batch at 10,000 and this site will
   never approach it. Capped anyway so a bug that invents URLs cannot become a flood. */
const MAX_URLS = 200;
/* THE KEY WAS CALLED indexnow:submitted AND HOLDS NOTHING OF THE SORT. Its value is
   { known, pending, backoff, sentAt } — and `known`, the field an operator would read as the
   submitted set, carries its own comment saying "Every URL ever seen published. Advances
   unconditionally; it is a record, not a receipt." The name was the last copy of the same claim
   the quiet-pass log line used to make.

   Renamed rather than annotated, and migrated rather than reset: a rename that dropped the
   state would re-baseline, and re-baselining is precisely the condition that used to print
   "all previously submitted and accepted" after zero submissions. So the old key is still read
   when the new one is absent, and only the new one is ever written. */
export const STATE_KEY = "indexnow:state";
/* NOT exported, unlike STATE_KEY. The drain has no business reading the legacy key — reading
   it is the defect this cycle exists to fix — and an export nothing outside this file calls is
   dead code that still deploys, which the gate says so within one run. */
const LEGACY_STATE_KEY = "indexnow:submitted";

/**
 * THE NAME AN ENDPOINT IS FILED UNDER IN `pending` AND `backoff`, AND IT IS NOT THE URL.
 *
 * `https://www.bing.com/indexnow` is filed as `bing.com`. The drain script re-derived that
 * mapping by hand and got it right; the point of exporting it is that "got it right once" is
 * not a property anything can check. Now there is one function and both callers use it.
 */
export const endpointLabel = (endpoint: string) => new URL(endpoint).hostname.replace(/^www\./, "");

export interface IndexNowEnv {
  /* Structural, matching ReportEnv rather than the Cloudflare KVNamespace global — the worker's
     tsconfig does not carry the workers-types lib, and every other file here types it this way. */
  SNAPSHOT: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  SITE_ORIGIN?: string;
}

/** Every URL the site currently publishes that is worth announcing. */
/**
 * THE COIN SLUGS ARE NO LONGER A PARAMETER, AND THAT IS THE FIX.
 *
 * They were, and the single call site passed a literal `[]`, so all ten coin pages sat outside
 * the announced set from the day the template shipped. Adding the argument back correctly would
 * have left the same defect one typo away, and the check written to catch it could not see it:
 * the check calls this function, not the call site, so it agreed with a caller that was wrong.
 *
 * Which coins are published is not something a caller knows better than liveCoins() does — it is
 * a pure function of the coin table and the clock, exactly as the coins sitemap computes it. So
 * the parameter is removed rather than validated, and there is nothing left to pass wrongly.
 * `symbols` stays a parameter because it genuinely comes from the live snapshot.
 *
 * `now` is injectable so a test can pin the publication cutoff.
 */
export function publishedUrls(origin: string, symbols: string[], now = Date.now()): string[] {
  /* THE STATIC HALF WAS A SECOND, INDEPENDENT LIST and it had drifted 22 URLs behind the
     sitemaps — see src/lib/routes.ts for what that cost. It now reads the same module the
     sitemap routes read, and scripts/../smoke compares the result against the RENDERED
     sitemaps in both directions, so a new route cannot ship announced-but-unlisted or
     listed-but-unannounced. */
  return [
    ...STATIC_ROUTES.map((r) => `${origin}${r === "/" ? "/" : r}`),
    ...symbols.map((s) => `${origin}/funding/${s.toLowerCase()}`),
    /* The per-contract liquidation maps, from the same rule the sitemap applies — see
       liqMapPaths in src/lib/routes.ts. Fifty finished pages lived behind `?symbol=` at
       one URL until 27 August 2026; IndexNow could no more announce them than a crawler
       could find them, because neither submits a <select>. */
    ...liqMapPaths(symbols).map((path) => `${origin}${path}`),
    ...liveCoins(now).map((c) => `${origin}/coins/${c.slug}`),
  ];
}

/**
 * Submit only URLs not submitted before. Returns a line for the run log — including when it
 * does nothing, because "no new URLs" is the expected result and a silent step is one nobody
 * notices has broken.
 */
/**
 * THE STATE IS PER-ENDPOINT, BECAUSE A SHARED ONE LOSES WHATEVER THE FAN-OUT DROPPED.
 *
 * The first version of the fan-out advanced one global set the moment ANY endpoint accepted,
 * on the reasoning that one index having the URLs is the objective. Its first real run refuted
 * that within the hour: announcing the twenty-two previously-unannounced URLs returned
 * `api.indexnow.org 429, bing.com 429, yandex.com 200, search.seznam.cz 200,
 * searchadvisor.naver.com 200` — three accepted, so the state advanced, so those twenty-two
 * URLs would never have been offered to Bing again. Bing is the endpoint that matters most here:
 * it is the index behind DuckDuckGo, Yahoo and Ecosia, and it is the one this project has no
 * other account-free route into.
 *
 * So `known` records what has ever been published — that is what makes the first run a baseline
 * rather than a bulk dump — and each endpoint carries its own backlog of what it has not yet
 * accepted. An endpoint that 429s gets the same URLs again next pass; one that accepted does
 * not. The whole state stays a single KV value.
 */
export interface IndexNowState {
  /** Every URL ever seen published. Advances unconditionally; it is a record, not a receipt. */
  known: string[];
  /** Per endpoint hostname, URLs offered and not yet accepted. */
  pending?: Record<string, string[]>;
  /**
   * Per endpoint hostname, how many consecutive refusals and the earliest instant to try again.
   *
   * THIS EXISTS BECAUSE THE BACKLOG WITHOUT IT WAS ABUSE. The per-endpoint backlog fixed a real
   * defect — an endpoint that refused never saw those URLs again — and introduced a worse one:
   * an endpoint that refuses PERMANENTLY got the same 22-URL payload every five minutes, 288
   * times a day, for ever. That is exactly the re-announce-on-every-pass pattern the baseline
   * rule exists to prevent, aimed at somebody else's endpoint instead of our own state.
   *
   * And the refusal here IS permanent-ish, which measurement established rather than guesswork:
   * api.indexnow.org and www.bing.com returned 429 to the Worker three times over ninety
   * minutes, while the BYTE-IDENTICAL 22-URL payload returned 200 from a laptop. Same host,
   * same key, same URL list, same minute — only the source IP differed. Both are Microsoft-run,
   * and they are throttling Cloudflare's shared Workers egress, not this site. Yandex, Seznam
   * and Naver accept the same payload from the same Worker.
   *
   * Third time this project has hit that class: Binance 403s from CF egress, and the ingest
   * cron had to be phase-shifted off :00 and :30 because failure rates doubled there — same
   * shared address, same contention. It is worth treating as a known property of the platform
   * rather than rediscovering.
   *
   * So the endpoints stay in the list — the shared IP's load varies and a window may open — but
   * the retry rate decays: 5 minutes, then 10, 20, 40 … capped at 12 hours.
   */
  backoff?: Record<string, { fails: number; nextAt: number }>;
  /**
   * WHEN AN ENDPOINT LAST ACCEPTED ANYTHING. Absent means no endpoint ever has.
   *
   * `known` advances unconditionally — its own comment two fields up says "it is a record, not
   * a receipt" — and the quiet-pass log line was printed from it and called it a receipt:
   * "nothing new (N URLs published, all previously submitted and accepted)". Measured with a
   * fresh state and no network: pass 1 returns "first run, recorded 3 URLs as the baseline
   * WITHOUT SUBMITTING", pass 2 returns "all previously submitted and accepted", and zero POSTs
   * were made across both. Two lines in one log, one tick apart, contradicting each other.
   *
   * It matters because of who reads it. An operator scanning the run log for why nothing is
   * indexed sees "submitted and accepted" and looks elsewhere; the truth in that state is that
   * no URL on this site has ever been announced to any endpoint. This field is the difference
   * between the two, and it is one timestamp rather than a per-URL ledger because the question
   * is "has this ever worked", not "which URL went where".
   */
  sentAt?: number;
}

/** 5 minutes doubling per consecutive refusal, capped at 12 hours. */
export const retryDelayMs = (fails: number) => Math.min(5 * 60_000 * 2 ** Math.max(0, fails - 1), 12 * 3_600_000);

/** Old state was a bare array of URLs. Read either shape; write only the new one. */
const readState = (raw: unknown): IndexNowState | null =>
  Array.isArray(raw) ? { known: raw as string[] } :
  raw && typeof raw === "object" && Array.isArray((raw as IndexNowState).known) ? (raw as IndexNowState) : null;

export async function stepIndexNow(env: IndexNowEnv, current: string[]): Promise<string> {
  const origin = env.SITE_ORIGIN || "https://coinliqui.com";
  const host = new URL(origin).host;

  let st: IndexNowState | null;
  /* The migration has to be a REASON TO WRITE, not merely a successful read. The quiet path
     below writes only when something moved, so on a site with no new URLs the new key would
     never appear and the rename would be cosmetic for ever. Measured: the first version read
     the legacy key correctly and left the store holding only `indexnow:submitted`. */
  let fromLegacy = false;
  try {
    st = readState(await env.SNAPSHOT.get(STATE_KEY, "json"));
    if (!st) {
      st = readState(await env.SNAPSHOT.get(LEGACY_STATE_KEY, "json"));
      if (st) fromLegacy = true;
    }
  } catch {
    /* An unreadable state file must not cause a resubmission of everything. Treating it as
       "everything already sent" fails closed: the worst case is a genuinely new URL going
       unannounced for one pass, against announcing all of them on every pass. */
    return "indexnow: state unreadable, skipped";
  }

  /* FIRST RUN IS NOT A CHANGE. With no state, every URL looks new; announcing all of them at
     once is the one submission pattern that reads as a bulk dump. Record them and say so. */
  if (!st || !st.known.length) {
    await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current } satisfies IndexNowState));
    return `indexnow: first run, recorded ${current.length} URLs as the baseline without submitting`;
  }

  /* Carried through every write below. Absent on a state written before this field existed,
     which reads as "never accepted" — the conservative direction, and self-correcting on the
     first successful send. */
  let sentAt = st.sentAt;
  const known = new Set(st.known);
  const fresh = current.filter((u) => !known.has(u));
  const pending = { ...(st.pending ?? {}) };
  const backoff = { ...(st.backoff ?? {}) };
  const label = endpointLabel;
  const now = Date.now();

  /* What each endpoint is owed: whatever it never accepted, plus whatever is new. Capped per
     endpoint, and the cap drops the OLDEST of a backlog rather than the newest — a URL that has
     been waiting is the one at risk of never being announced at all. */
  const owed = new Map<string, string[]>();
  const held: string[] = [];
  for (const e of ENDPOINTS) {
    const name = label(e);
    const back = (pending[name] ?? []).filter((u) => current.includes(u));
    const list = [...new Set([...back, ...fresh])].slice(-MAX_URLS);
    if (!list.length) continue;
    /* IN BACKOFF, AND SKIPPED EVEN IF SOMETHING NEW ARRIVED. Bundling a new URL in as an
       excuse to retry early is how a decaying rate becomes no rate at all — the new URL will
       still be owed when the window opens, because the backlog is what carries it.

       THE BACKLOG DID NOT CARRY IT. That last clause described the intent and the code did the
       opposite: it `continue`d without writing `list` into pending[name], while `known` advanced
       to `current` a few lines below. So a URL that first appeared while an endpoint was in
       backoff was dropped from that endpoint's backlog AND was no longer new on the next pass —
       never announced to it, permanently, with no symptom anywhere. Every coin page that crossed
       the coverage floor during a Bing backoff window is in that category.
       The assignment below is the sentence above, actually performed. */
    const b = backoff[name];
    if (b && b.nextAt > now) {
      pending[name] = list;
      held.push(`${name} in backoff for ${Math.round((b.nextAt - now) / 60_000)}m`);
      continue;
    }
    owed.set(e, list);
  }

  if (!owed.size) {
    /* `known` still advances: a URL that appeared and vanished between passes must not be
       treated as new when it returns without having been announced. */
    /* WRITE WHENEVER EITHER HALF MOVED, not only when something was fresh. With the backoff
       branch now filling pending[], a pass that produces no fresh URLs can still have changed
       the backlog — and dropping that write would put the URL back where it just came from. */
    if (fresh.length || held.length || fromLegacy) await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current, pending, backoff, ...(sentAt ? { sentAt } : {}) } satisfies IndexNowState));
    if (held.length) return `indexnow: nothing sent — ${held.join(", ")}`;
    /* WHAT owed.size === 0 ACTUALLY MEANS: no endpoint has a backlog and nothing is fresh. It
       says nothing about whether anything was ever sent, which is why the sentence no longer
       claims it and reads `sentAt` for that half instead. */
    return sentAt
      ? `indexnow: nothing new (${current.length} URLs published, none owed to any endpoint; last accepted ${new Date(sentAt).toISOString().slice(0, 16).replace("T", " ")} UTC)`
      : `indexnow: nothing new (${current.length} URLs published, none owed — but nothing has ever been accepted by any endpoint, so this is a recorded baseline rather than a completed submission)`;
  }

  const results: string[] = [];
  let accepted = 0;
  for (const [endpoint, list] of owed) {
    const name = label(endpoint);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: list }),
      });
      /* 200 and 202 both mean received. Anything else is worth seeing in the log rather than
         swallowing — but never worth failing the run for, since nothing a reader sees depends
         on it. */
      if (res.ok) {
        accepted++;
        sentAt = now;
        delete pending[name];
        delete backoff[name];
        results.push(`${name} ${res.status}`);
      } else {
        pending[name] = list;
        const fails = (backoff[name]?.fails ?? 0) + 1;
        backoff[name] = { fails, nextAt: now + retryDelayMs(fails) };
        results.push(`${name} ${res.status}+${list.length} owed, next in ${Math.round(retryDelayMs(fails) / 60_000)}m`);
      }
    } catch (e) {
      pending[name] = list;
      const fails = (backoff[name]?.fails ?? 0) + 1;
      backoff[name] = { fails, nextAt: now + retryDelayMs(fails) };
      results.push(`${name} ${e instanceof Error ? e.message.slice(0, 32) : "failed"}+${list.length} owed, next in ${Math.round(retryDelayMs(fails) / 60_000)}m`);
    }
  }

  await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ known: current, pending, backoff, ...(sentAt ? { sentAt } : {}) } satisfies IndexNowState));
  const owedTotal = Object.keys(pending).length;
  const head = fresh.length ? `submitted ${fresh.length} new URL(s)` : `retried a backlog`;
  return `indexnow: ${head} to ${accepted}/${owed.size} endpoints [${results.join(", ")}]` +
    (held.length ? `, skipped: ${held.join(", ")}` : "") +
    (owedTotal ? `, ${owedTotal} endpoint(s) still owed` : "") +
    (fresh.length ? ` — ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? " …" : ""}` : "");
}
