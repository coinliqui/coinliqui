/**
 * ONE REQUEST A DAY, TO ASK WHETHER THE LINK THIS SITE PUBLISHES ABOUT ITSELF STILL RESOLVES.
 *
 * See src/lib/corroboration.ts for why this exists. The short version: the site's only external
 * corroboration returned 404 to every signed-out reader for days while all 79 pages asserted it
 * existed, and no instrument here noticed, because every instrument here reads our own origin.
 *
 * WHAT IT DOES AND WHY NO HOST COULD MISTAKE IT FOR ABUSE: one anonymous GET, of one URL that
 * belongs to this project, at most once every 24 hours, from a user-agent that names the site
 * and links to a page explaining it. That is a fraction of what a single reader costs the same
 * host by opening the page once.
 *
 * IT RUNS BEFORE THE SWEEPS AND CANNOT STARVE THEM: one subrequest, rate-limited by a stored
 * timestamp, and any failure is recorded as a failure rather than retried.
 */
import { CANDIDATES, REACH_KEY, PROBE_EVERY_MS, type Reach } from "../src/lib/corroboration.ts";

export interface CorroborateEnv {
  SNAPSHOT: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
}

const UA = "Mozilla/5.0 (compatible; coinliqui-linkcheck/1.0; +https://coinliqui.com/about)";

/** Returns a short label when it did work, null when there was nothing to do. */
export async function stepCorroborate(env: CorroborateEnv, now = Date.now()): Promise<string | null> {
  if (!CANDIDATES.length) return null;

  let prior: Reach[] = [];
  try {
    const raw = await env.SNAPSHOT.get(REACH_KEY, "json");
    if (Array.isArray(raw)) prior = raw as Reach[];
  } catch { /* an unreadable record is the same as none: re-probe and overwrite */ }

  /* THE CADENCE IS DERIVED FROM THE RECORDS THEMSELVES, not from a separate "last run" key.
     A second key is a second thing that can be deleted, leaving the probe either stuck or
     unbounded; the newest record already carries the only timestamp that matters. */
  const newest = prior.reduce((m, r) => (r && typeof r.at === "number" && r.at > m ? r.at : m), 0);
  if (newest && now - newest < PROBE_EVERY_MS) return null;

  const out: Reach[] = [];
  for (const url of CANDIDATES) {
    try {
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      /* The body is drained and discarded. Some hosts only fail after the headers, and an
         unread body holds the connection open for the rest of the invocation. */
      try { await r.arrayBuffer(); } catch { /* nothing to do with it either way */ }
      out.push({ url, ok: r.status >= 200 && r.status < 300, status: r.status, at: now });
    } catch {
      /* status null is "never got an answer", which publishable() treats exactly like a
         refusal — under-claiming — and reachRows() prints as "no answer" so a worker that
         cannot reach the host at all is visible rather than indistinguishable from a 404. */
      out.push({ url, ok: false, status: null, at: now });
    }
  }

  await env.SNAPSHOT.put(REACH_KEY, JSON.stringify(out));
  const good = out.filter((r) => r.ok).length;
  return `corroborate: ${good}/${out.length} reachable (${out.map((r) => `${new URL(r.url).pathname.slice(1)} ${r.status ?? "no answer"}`).join(", ")})`;
}
