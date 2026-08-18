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

export const INDEXNOW_KEY = "a7f3c19e84b24d6fa0e5b17c93d82f46";

const ENDPOINT = "https://api.indexnow.org/indexnow";
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
export function publishedUrls(origin: string, symbols: string[], coinSlugs: string[]): string[] {
  return [
    `${origin}/`,
    `${origin}/funding`,
    `${origin}/coins`,
    `${origin}/open-interest`,
    `${origin}/liquidations`,
    `${origin}/unlocks`,
    `${origin}/tools`,
    ...symbols.map((s) => `${origin}/funding/${s.toLowerCase()}`),
    ...coinSlugs.map((c) => `${origin}/coins/${c}`),
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

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: fresh }),
    });
    /* 200 and 202 both mean received. Anything else is worth seeing in the log rather than
       swallowing — but never worth failing the run for, since nothing a reader sees depends
       on it. */
    if (res.ok) {
      await env.SNAPSHOT.put(STATE_KEY, JSON.stringify(current));
      return `indexnow: submitted ${fresh.length} new URL(s), HTTP ${res.status} — ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? " …" : ""}`;
    }
    return `indexnow: endpoint returned HTTP ${res.status}, state left unchanged so the same URLs retry next pass`;
  } catch (e) {
    return `indexnow: submission failed (${e instanceof Error ? e.message : String(e)}), state left unchanged`;
  }
}
