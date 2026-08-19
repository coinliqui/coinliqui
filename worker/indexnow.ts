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

import { STATIC_ROUTES } from "../src/lib/routes.ts";
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
const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
  "https://yandex.com/indexnow",
  "https://search.seznam.cz/indexnow",
  "https://searchadvisor.naver.com/indexnow",
];
/* One submission may carry many URLs; the protocol caps a batch at 10,000 and this site will
   never approach it. Capped anyway so a bug that invents URLs cannot become a flood. */
const MAX_URLS = 200;
const STATE_KEY = "indexnow:submitted";

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
    ...liveCoins(now).map((c) => `${origin}/coins/${c.slug}`),
  ];
}

/**
 * Submit only URLs not submitted before. Returns a line for the run log — including when it
 * does nothing, because "no new URLs" is the expected result and a silent step is one nobody
 * notices has broken.
 */
export async function stepIndexNow(env: IndexNowEnv, current: string[]): Promise<string> {
  const origin = env.SITE_ORIGIN || "https://coinliqui.com";
  const host = new URL(origin).host;

  let seen: string[] = [];
  try {
    seen = ((await env.SNAPSHOT.get(STATE_KEY, "json")) as string[] | null) ?? [];
  } catch {
    /* An unreadable state file must not cause a resubmission of everything. Treating it as
       "everything already sent" fails closed: the worst case is a genuinely new URL going
       unannounced for one pass, against announcing all of them on every pass. */
    return "indexnow: state unreadable, skipped";
  }

  const known = new Set(seen);
  const fresh = current.filter((u) => !known.has(u)).slice(0, MAX_URLS);
  if (!fresh.length) return `indexnow: nothing new (${current.length} URLs published, all previously submitted)`;

  /* FIRST RUN IS NOT A CHANGE. With no state, every URL looks new; announcing all of them at
     once is the one submission pattern that reads as a bulk dump. Record them and say so. */
  if (!seen.length) {
    await env.SNAPSHOT.put(STATE_KEY, JSON.stringify(current));
    return `indexnow: first run, recorded ${current.length} URLs as the baseline without submitting`;
  }

  const payload = JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: fresh });
  const results: string[] = [];
  let accepted = 0;
  for (const endpoint of ENDPOINTS) {
    const label = new URL(endpoint).hostname.replace(/^www\./, "");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: payload,
      });
      /* 200 and 202 both mean received. Anything else is worth seeing in the log rather than
         swallowing — but never worth failing the run for, since nothing a reader sees depends
         on it. */
      if (res.ok) accepted++;
      results.push(`${label} ${res.status}`);
    } catch (e) {
      results.push(`${label} ${e instanceof Error ? e.message.slice(0, 40) : "failed"}`);
    }
  }
  /* STATE ADVANCES ONLY IF SOMETHING RECEIVED IT. One acceptance is enough — the URLs have
     reached an index and re-announcing them is noise. Zero acceptances leaves the state alone
     so the same set retries next pass, which is the behaviour that made a silent outage
     recoverable rather than permanent. */
  if (accepted) {
    await env.SNAPSHOT.put(STATE_KEY, JSON.stringify(current));
    return `indexnow: submitted ${fresh.length} new URL(s) to ${accepted}/${ENDPOINTS.length} endpoints [${results.join(", ")}] — ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? " …" : ""}`;
  }
  return `indexnow: no endpoint accepted [${results.join(", ")}], state left unchanged so the same URLs retry next pass`;
}
