/**
 * THE ONLY EXTERNAL CLAIM THIS SITE MAKES ABOUT ITSELF, AND THE PROOF THAT IT RESOLVES.
 *
 * `sameAs` used to be a compile-time constant. On 20 August 2026 it was found to be publishing
 * https://github.com/coinliqui/coinliqui on all 79 pages, in the visible /about link and in
 * llms.txt, while an anonymous GET of that URL returned 404 — the repository is public, but its
 * owning account is under a spam flag and GitHub hides a flagged account's pages from anyone not
 * signed in as its owner. The site's single piece of external corroboration resolved to "no such
 * thing" for every reader, every crawler and every answer engine, and an extraction model asked
 * to assess the domain named that repository as the FIRST of three ways to verify us.
 *
 * The flag will be lifted. Publishing the link again must not then depend on somebody
 * remembering, so it does not: the ingest worker fetches each candidate once a day and records
 * what a signed-out reader gets, and this module decides what the site is allowed to say.
 *
 * THREE RULES, AND EACH ONE CLOSES A WAY THIS COULD GO WRONG:
 *
 *   1. ALLOW-LIST. Only a URL in CANDIDATES can ever be published. The decision now travels
 *      through KV, so KV can now put markup on 79 pages; this makes that impossible rather than
 *      unlikely. A record for any other URL is ignored no matter what it says.
 *
 *   2. FRESHNESS. An `ok` older than MAX_AGE_MS does not count. A stored yes from three weeks
 *      ago is not evidence that the link works today, and a probe that has quietly stopped
 *      running would otherwise leave the claim standing for ever — the same "unobservable rather
 *      than impossible" shape this project keeps finding in its own fixes.
 *
 *   3. ABSENCE IS SILENCE. No record, an unreadable record, a failed probe: publish nothing.
 *      The safe direction is under-claiming, and section 17 of verify-live independently fetches
 *      whatever does get published, so a wrong `ok` fails the next deploy rather than shipping.
 */

/** What the site would publish, IF a signed-out reader can reach it. Never published unchecked. */
export const CANDIDATES = ["https://github.com/coinliqui/coinliqui"] as const;

/** Where the worker leaves its findings. One key, one array, rewritten whole. */
export const REACH_KEY = "identity:reach";

/** How often the worker re-checks. Once a day: a spam-flag appeal takes days, not minutes, and
 *  one request a day to a URL we own is not something any host could mistake for abuse. */
export const PROBE_EVERY_MS = 24 * 3_600_000;

/** After this, a stored `ok` is no longer evidence. Seven days is seven missed daily probes. */
export const MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface Reach {
  url: string;
  /** True only for a 2xx to an anonymous GET. A 403 is not reachable: a reader who cannot read
   *  it cannot verify us, and why they cannot is not the point. */
  ok: boolean;
  /** null means the request never got an answer — a different fact from any status code. */
  status: number | null;
  at: number;
}

/** Records the worker wrote, and the clock. Returns the URLs the site may publish, in the order
 *  CANDIDATES declares them — never in the order KV happens to hold them. */
export function publishable(records: unknown, now: number): string[] {
  if (!Array.isArray(records)) return [];
  const byUrl = new Map<string, Reach>();
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Partial<Reach>;
    if (typeof rec.url !== "string" || rec.ok !== true || typeof rec.at !== "number") continue;
    byUrl.set(rec.url, rec as Reach);
  }
  return CANDIDATES.filter((u) => {
    const r = byUrl.get(u);
    return !!r && now - r.at <= MAX_AGE_MS && now - r.at >= 0;
  });
}

/** What /status prints, so a probe that has stopped or is being refused is visible rather than
 *  silently withholding the link for ever. Covers candidates with no record at all. */
export function reachRows(records: unknown, now: number): { url: string; state: string; detail: string }[] {
  const arr = Array.isArray(records) ? (records as Partial<Reach>[]) : [];
  return CANDIDATES.map((url) => {
    const r = arr.find((x) => x && x.url === url);
    if (!r || typeof r.at !== "number") return { url, state: "never checked", detail: "no probe has run" };
    const ageH = Math.round((now - r.at) / 3_600_000);
    const age = ageH < 48 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
    if (r.ok !== true) return { url, state: "unreachable", detail: `${r.status === null || r.status === undefined ? "no answer" : `HTTP ${r.status}`}, checked ${age}` };
    if (now - r.at > MAX_AGE_MS) return { url, state: "stale", detail: `last good check ${age}, past the ${Math.round(MAX_AGE_MS / 86_400_000)}-day limit` };
    return { url, state: "published", detail: `HTTP ${r.status}, checked ${age}` };
  });
}

/** The narrow slice of a KV binding this needs. Written structurally so the same function
 *  serves the site's `KVNamespace` and the worker's hand-declared binding type. */
type JsonStore = { get(key: string, type: "json"): Promise<unknown> };

/**
 * What the site may publish, read from KV at render time.
 *
 * THE COST, STATED RATHER THAN WAVED AT: one extra KV read per rendered page. The site already
 * reads `snapshot` on every request, so this roughly doubles reads — at today's ~10-15k
 * requests a day, mostly crawlers, that is ~30k against a 100,000/day free allowance. If that
 * ratio ever stops being comfortable the answer is a cacheTtl on this read, not a stale
 * compile-time constant: the whole point is that the claim tracks reality without a deploy.
 *
 * Absence, an unreadable value and a throw all return [] — see rule 3 in the header.
 */
export async function publishedSameAs(kv: JsonStore | null | undefined, now = Date.now()): Promise<string[]> {
  if (!kv) return [];
  try {
    return publishable(await kv.get(REACH_KEY, "json"), now);
  } catch {
    return [];
  }
}
