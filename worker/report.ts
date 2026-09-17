/**
 * The weekly indexation report, running on the ingest cron instead of GitHub Actions.
 *
 * WHY IT MOVED. The Actions version needed a token with `workflow` scope to push its own
 * workflow file, which is a credential created by hand for the sole purpose of installing
 * the thing that needs it. This Worker already runs on a schedule, already holds the
 * bindings, and already has a KV namespace to write to. Moving the report here deletes a
 * dependency, a credential and a YAML file rather than working around all three.
 *
 * WHY IT IS A STATE MACHINE. A full report is roughly 140 subrequests — one URL Inspection
 * call per URL is unavoidable, that API has no batch form — and a Worker invocation allows
 * 50. So the run is sliced across consecutive ticks, carrying its accumulated lines in KV,
 * exactly the way the candle sweeps carry their cursor. It starts on the first tick after
 * 07:00 UTC on a Monday and finishes about twenty minutes later. Search Console lags ~2 days,
 * so the search tables cover the SEARCH_WINDOW_DAYS ending SEARCH_LAG_DAYS before the run —
 * for a Monday run, Saturday to Saturday, NOT the ISO week the report is named for. See
 * searchWindow() below for why this sentence no longer says "the whole of the previous week".
 *
 * Each section degrades to a stated reason rather than failing the run: the useful property
 * of a weekly instrument is that it always produces something readable on the day.
 *
 *   A. COVERAGE   no credentials. What exists per template, and whether a crawler can fetch it.
 *   B. SEARCH     GSC service account in the GSC_SA_KEY secret.
 *   C. CRAWLERS   Cloudflare token with Analytics:Read in CF_ANALYTICS_TOKEN.
 */

import TERMS from "../src/data/terms-baseline.json" with { type: "json" };
import { extremeBy } from "../src/lib/extreme.ts";

/* THE SHAPE OF THE STORED DOC, SO A PAGE CAN TELL WHICH WORDING IT IS READING.
   The report is written once a week and read for the seven days after, so a correction to its
   words reaches the page a week late and only after the worker is deployed. Docs without this
   field were written before the 16 September 2026 corrections below, and /status/indexation
   prints those corrections beside them instead of letting the old sentences stand alone. */
export const REPORT_FORMAT = 2;

/* =========================================================================================
   THE SEARCH WINDOW, NAMED ONCE AND READ BY THE PAGE THAT DESCRIBES IT.

   The page intro said "Search Console lags about two days, so a Monday run covers the whole of
   the previous week", and the band table and One push away both said "this week". Measured 16
   September 2026 on https://coinliqui.com/status/indexation, report 2026-W38 generated Monday
   2026-09-14: the Search performance heading read "2026-09-05 to 2026-09-12" — eight days
   inclusive, Saturday of W36 to Saturday of W37, with Sunday 13 left out. The lag the sentence
   cited is precisely why Sunday cannot be in it.

   The dates are unchanged: `now - 9 days` to `now - 2 days` is what this computed before, and
   changing the span would make this week's impressions incomparable with every earlier week's.
   The WORDS changed, and they come from these two numbers, so the page and the tables cannot
   describe different windows again.
   ========================================================================================= */
export const SEARCH_LAG_DAYS: number = 2;
export const SEARCH_WINDOW_DAYS: number = 8;
export function searchWindow(at: number): { start: string; end: string } {
  const day = 86_400_000;
  const end = at - SEARCH_LAG_DAYS * day;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(end - (SEARCH_WINDOW_DAYS - 1) * day), end: iso(end) };
}
/** Search Analytics rows per call. A response that fills it is a floor, not a count. */
const QUERY_ROW_LIMIT = 500;
/** Readings kept in index:history — twenty-six weekly runs is six months. */
export const HISTORY_KEEP = 26;

export interface ReportEnv {
  SNAPSHOT: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  SITE_ORIGIN?: string;
  GSC_SA_KEY?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ZONE_ID?: string;
}

/** One dated observation of how much of the site Google has indexed. Kept as a SERIES so
 *  "deferred" can be told from "rejected" — a single snapshot cannot separate them. */
export interface IndexPoint {
  at: number;
  total: number;
  indexed: number;
  byTemplate: [name: string, indexed: number, total: number][];
}

/* THE SERIES TABLE, WRITTEN IN ONE PLACE FOR TWO READERS. The worker prints it under the
   not-indexed list, and /status/indexation prints the same rows under a report stored before the
   worker printed them (2026-W38 and earlier said "watch the series below" over no series). One
   function, so the table a reader is sent to looks the same whichever of the two drew it.
   A change of zero reads "unchanged": "0 indexed" beside "4/6" reads as a count of zero. */
export function indexHistoryRows(history: readonly IndexPoint[], earliest: string): string[] {
  const out = ["| Reading | Indexed | Change since the reading before |", "|---|---:|---|"];
  history.forEach((h, n) => {
    const older = history[n + 1];
    const d = older ? h.indexed - older.indexed : null;
    const change = d === null || !older
      ? earliest
      : `${d === 0 ? "unchanged" : `${d > 0 ? "+" : "−"}${Math.abs(d)} indexed`}${older.total !== h.total ? `; covered set ${older.total} → ${h.total}` : ""}`;
    out.push(`| ${new Date(h.at).toISOString().slice(0, 10)} | ${h.indexed}/${h.total} (${share(h.indexed, h.total)}) | ${change} |`);
  });
  return out;
}

interface Template {
  name: string;
  urls: string[];
  ok?: number;
  indexed?: number;
  tally?: Record<string, number>;
  /** WHICH url, not how many. See the coverage section for why a count was not enough. */
  failures?: [url: string, first: number, retry: number][];
  /** Every URL Google did NOT report as indexed, with Google's own words for why. */
  notIndexed?: [url: string, verdict: string, coverageState: string][];
  /** The child sitemap's own status. A template with zero URLs and a 200 is a real empty
      template; zero URLs and a 5xx is a fetch that failed, and section A used to print the
      two identically as `0 | 0/0`. */
  status?: number;
}
interface State {
  week: string;
  /* HOW MUCH THE COVERED SET MOVED, carried out of the coverage phase so section B can say
     whether its own averages are comparable to last week's. It was computed, printed and
     thrown away, and section B went on presenting an impression-weighted average as if the
     thing being averaged had not changed size underneath it. */
  joined?: number;
  prevUrls?: number;
  phase: "coverage" | "inspect" | "search" | "crawlers" | "done";
  i: number;
  lines: string[];
  templates: Template[];
  startedAt: number;
  token?: string;
  tokenAt?: number;
  /** WHEN the sitemap index was fetched — not what it returned. See the coverage phase. */
  sitemapsAt?: number;
  /** Every URL this reading covered, sorted. Stored on the doc so the NEXT reading can name
   *  what joined and what left instead of comparing two identical counts. */
  urls?: string[];
  /** Kept only when that fetch produced no templates, so section A can say why. */
  indexStatus?: number;
  indexHead?: string;
}

/* HOW LONG A RUN MAY HOLD THE TICK BEFORE IT IS ABANDONED.
   Every step of this machine returns a truthy label, and the caller reads that as "the report
   has this tick": it skips the flip precompute, the IndexNow step and all four candle sweeps
   until this function returns undefined. A whole run is about twenty minutes. So a run that
   cannot finish is not a slow report, it is a stopped ingest — and the state carrying it
   survives in KV until the next Monday, which is up to seven days of no chart refreshes with
   /status cheerfully reporting a report in progress.
   Two hours is six times the normal run and small against a weekly cadence. It is a bound on
   the RUN rather than a fix for the one way it stalled, because the next stall will not be
   that one. */
const RUN_CEILING_MS = 2 * 3_600_000;

/* A CRAWLER'S NAME, AND OURS AFTER IT.
   The crawler name is not decoration: nothing in src/ branches on user-agent, so what this
   actually tests is the EDGE — whether Cloudflare challenges a client calling itself GPTBot.
   The suffix is there because these 79 requests per run land in the same zone analytics that
   section C reads, and a report whose section A feeds its own section C is an instrument
   measuring itself. Section C counts only clients Cloudflare verified, which makes that
   impossible by construction; this makes it legible to a human reading a UA breakdown too. */
const UA = "GPTBot/1.1 (+https://coinliqui.com/status/indexation; coinliqui-selfcheck)";
/** Well inside the 50-per-invocation ceiling, with room for the tick's own snapshot calls. */
const SLICE = 20;

export const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
};

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));
/* A SHARE OF A TOTAL, not the rate formatter of the same name in public/shared.js. Two
   arguments, no decimals, a different question. Renamed because a colliding name is its own
   hazard: a reader who knows pct() from the site would read this as that. */
const share = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");

/**
 * A Google service-account access token, signed in the Worker.
 *
 * node:crypto's createSign is not available here, so the RS256 signature is done with
 * WebCrypto: the PEM is unwrapped to DER, imported as PKCS#8, and signed with
 * RSASSA-PKCS1-v1_5. Same JWT, same exchange, no dependency.
 */
async function gscToken(rawKey: string): Promise<string> {
  const key = JSON.parse(rawKey) as { client_email: string; private_key: string };
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const iat = Math.floor(Date.now() / 1000);
  const body =
    `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    b64urlStr(JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: iat + 3600,
      iat,
    }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(body));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${body}.${b64url(sig)}`,
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`token exchange failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

/** One (user-agent x verified-category) row as Cloudflare's analytics returns it. */
export interface RawGroup { count: number; dimensions: { userAgent?: string; verifiedBotCategory?: string } }

/** The crawlers worth a row. Order is the order they are printed in. */
export const CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
  "PerplexityBot", "Perplexity-User", "Googlebot", "bingbot", "Applebot", "Amazonbot",
] as const;

/**
 * Split crawler traffic into what was VERIFIED and what merely CLAIMED the name.
 *
 * Pure, and exported, so scripts/report-cases.mjs can run the case that matters: a fixture in
 * which every request carries a crawler's user-agent and none is verified must report zero
 * verified, not the claimed total. That is the exact shape this section shipped with, and no
 * test that only checked "does it produce a table" would have caught it.
 */
/**
 * WHICH COLUMN A URL BELONGS IN, and it is not the one the first version used.
 *
 * The summary table was headed "Crawled, not indexed | Discovered, not crawled | Other" and
 * the numbers under it were Google's VERDICT enum — NEUTRAL, FAIL, VERDICT_UNSPECIFIED —
 * which says whether indexing succeeded and nothing at all about crawling. Measured on the
 * 2026-W34 report: the row for `funding-symbols` read "8 crawled, not indexed", and the
 * per-URL table directly beneath it, which prints Google's own coverageState verbatim, showed
 * seven of those eight as *Discovered — currently not indexed* and one as *URL is unknown to
 * Google*. Not one had been crawled.
 *
 * The two halves of one instrument disagreed, and they prescribe opposite work. "Crawled, not
 * indexed" is a judgement about the page and the answer is to change it. "Discovered, not
 * crawled" is a queue and the answer is to wait. "Unknown to Google" means the URL was never
 * discovered at all, and the answer is the sitemap or IndexNow. A reader acting on the summary
 * would have rewritten fifty pages Google has never fetched.
 *
 * So the buckets come from coverageState, which is the field that carries the fact. PASS still
 * decides "indexed", because that is what the verdict is for. Anything unrecognised falls to
 * `other` and is named individually in the table below — a catch-all is honest only while the
 * detail is printed beside it.
 */
export type CoverageBucket = "indexed" | "crawled" | "discovered" | "unknown" | "other";
export function coverageBucket(verdict: string | undefined, coverageState: string | undefined): CoverageBucket {
  if (verdict === "PASS") return "indexed";
  const c = (coverageState ?? "").toLowerCase();
  if (c.includes("crawled")) return "crawled";
  if (c.includes("discovered")) return "discovered";
  if (c.includes("unknown")) return "unknown";
  return "other";
}

export function tallyCrawlers(groups: RawGroup[]): {
  rows: { name: string; verified: number; claimed: number }[];
  verifiedTotal: number;
  claimedTotal: number;
} {
  const rows = CRAWLERS.map((name) => {
    let verified = 0, claimed = 0;
    for (const g of groups) {
      if (!(g.dimensions?.userAgent || "").includes(name)) continue;
      claimed += g.count;
      /* Non-empty is the whole test. Cloudflare returns the CATEGORY it verified the client
         into ("AI Crawler", "Search Engine Crawler"); an unverified client returns "". */
      if (g.dimensions?.verifiedBotCategory) verified += g.count;
    }
    return { name, verified, claimed };
  });
  return {
    rows,
    verifiedTotal: rows.reduce((a, r) => a + r.verified, 0),
    claimedTotal: rows.reduce((a, r) => a + r.claimed, 0),
  };
}

/**
 * Advance the report by one slice. Returns a short label when it did work, undefined when
 * there is nothing to do — so the caller can fall through to the ordinary sweeps.
 */
export async function stepReport(env: ReportEnv, force = false): Promise<string | undefined> {
  const origin = env.SITE_ORIGIN || "https://coinliqui.com";
  const site = `sc-domain:${new URL(origin).hostname}`;
  const now = new Date();
  const week = isoWeek(now);

  let st = (await env.SNAPSHOT.get("report:state", "json")) as State | null;

  if (!st || st.week !== week) {
    // Monday, 07:00 UTC or later, and not already produced this week.
    const due = force || (now.getUTCDay() === 1 && now.getUTCHours() >= 7);
    if (!due) return undefined;
    const done = (await env.SNAPSHOT.get(`report:${week}`, "json")) as unknown;
    if (done && !force) return undefined;
    st = { week, phase: "coverage", i: 0, lines: [], templates: [], startedAt: Date.now() };
    st.lines.push(`# Indexation — ${week}`);
    st.lines.push(`\n${origin} · started ${now.toISOString().slice(0, 16).replace("T", " ")} UTC\n`);
  }
  if (st.phase === "done") return undefined;

  /* THE CEILING, CHECKED BEFORE ANY WORK. Publishing what the run did manage is deliberate:
     an abandoned report that names the phase it died in is a finding, and a deleted state is
     the only thing that lets the sweeps run again. */
  if (Date.now() - st.startedAt > RUN_CEILING_MS) {
    const mins = Math.round((Date.now() - st.startedAt) / 60_000);
    st.lines.push(`\n> **Abandoned after ${mins} minutes in phase \`${st.phase}\`.**`);
    st.lines.push(`> A run holds the ingest tick — flips, IndexNow and all four candle sweeps`);
    st.lines.push(`> stand aside while it walks. It is ended here so they resume. Everything`);
    st.lines.push(`> above is what it completed before that.`);
    /* An abandoned run carries its list too. Otherwise one stalled week silently resets the
       comparison and the next reading reports "no previous list" as though the series began. */
    const partial = { week: st.week, at: Date.now(), tookMs: Date.now() - st.startedAt, md: st.lines.join("\n") + "\n", urls: st.urls ?? [], format: REPORT_FORMAT };
    await env.SNAPSHOT.put(`report:${st.week}`, JSON.stringify(partial));
    await env.SNAPSHOT.put("report:latest", JSON.stringify(partial));
    await env.SNAPSHOT.delete("report:state");
    return `report: abandoned in ${st.phase} after ${mins}m`;
  }

  const say = (s = "") => st!.lines.push(s);
  const get = async (path: string) => {
    const r = await fetch(origin + path, { headers: { "user-agent": UA } });
    return { status: r.status, body: await r.text() };
  };
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

  /* ---------------------------------------------------------------- A. coverage */
  if (st.phase === "coverage") {
    /* NOT `!st.templates.length`. That tests whether the list is empty; the question is whether
       the fetch has happened. The two differ in precisely the case that matters — a
       sitemap-index answering with anything that is not parseable XML (a 5xx HTML error page, a
       challenge interstitial, an empty body) matches no <loc>, so the list stays empty, so the
       next tick asks again, and the tick after that. The step returns a truthy label every
       time, which the caller treats as "the report has the tick", so a single bad response from
       our own edge stops flips, IndexNow and all four candle sweeps until the following Monday.
       Recording WHEN the fetch happened cannot be confused with what it returned. */
    if (!st.sitemapsAt) {
      const idx = await get("/sitemap-index.xml");
      for (const m of locs(idx.body)) {
        const b = await get(m);
        st.templates.push({ name: m.replace("/sitemaps/", "").replace(".xml", ""), urls: locs(b.body), status: b.status });
      }
      st.sitemapsAt = Date.now();
      st.i = 0;
      if (!st.templates.length) {
        /* Degraded into the section's own words rather than retried into a stall. Section A is
           the one section with no credentials and so no legitimate reason to be missing; the
           status and the first bytes are what make it actionable a week later. */
        st.indexStatus = idx.status;
        st.indexHead = idx.body.slice(0, 160).replace(/\s+/g, " ");
      }
      await env.SNAPSHOT.put("report:state", JSON.stringify(st));
      return "report: sitemaps";
    }

    /* THE CURSOR WALKS URLS, NOT TEMPLATES.
       The first version did one template per slice and capped each at 40 URLs, so the
       50-URL contract template was checked 40 times and reported "40/50" — which the very
       next line turns into "10 URLs are not fetchable by a crawler." A false alarm in the
       instrument built to catch real ones is worse than no instrument, and it appeared on
       the first run. The cursor is now a flat index over every URL in every template, so a
       template is only ever reported once it has been checked in full. */
    const flat: { t: Template; u: string }[] = st.templates.flatMap((t) => t.urls.map((u) => ({ t, u })));
    const end = Math.min(flat.length, st.i + SLICE * 2);
    for (let n = st.i; n < end; n++) {
      const { t, u } = flat[n];
      const first = (await get(u || "/")).status;
      if (first === 200) { t.ok = (t.ok ?? 0) + 1; continue; }
      /* RETRIED ONCE, AND BOTH STATUSES KEPT. A cold isolate returning one 5xx and a page that
         is permanently broken produce the same count and want opposite responses, and the
         count cannot tell them apart. The retry is what separates them; recording both is what
         lets a reader see which happened without re-running anything. */
      const again = (await get(u || "/")).status;
      if (again === 200) t.ok = (t.ok ?? 0) + 1;
      (t.failures ??= []).push([u || "/", first, again]);
    }
    st.i = end;
    if (st.i >= flat.length) {
      say("## A. Coverage\n");
      say("What exists, and whether a crawler can still fetch it. No credentials — this section always runs.\n");
      if (!st.templates.length) {
        /* An empty table reads as "nothing is wrong". This is the one outcome section A cannot
           have and still be section A, so it says so instead of printing a header with no rows. */
        say(`**The sitemap index produced no templates, so nothing could be checked.**`);
        say(`\n\`GET ${origin}/sitemap-index.xml\` → **${st.indexStatus ?? "?"}**, first bytes: \`${st.indexHead ?? ""}\``);
        say(`\nEvery URL on this site is enumerated from that document. Until it parses, coverage`);
        say(`is unmeasured rather than good. Sections below still ran.`);
      } else {
      say("| Template | URLs | Fetchable as GPTBot |");
      say("|---|---:|---:|");
      for (const t of st.templates) {
        /* A template with no URLs and a 200 is genuinely empty; one with no URLs and a 5xx is a
           sitemap that failed to fetch. `0 | 0/0` printed both the same, and the second is a
           section-A failure hiding inside a full-marks row. */
        const note = t.urls.length === 0 && t.status !== 200 ? ` — sitemap returned ${t.status ?? "?"}` : "";
        say(`| \`${t.name}\`${note} | ${t.urls.length} | ${t.ok ?? 0}/${t.urls.length} |`);
      }
      const total = st.templates.reduce((a, x) => a + x.urls.length, 0);
      const okAll = st.templates.reduce((a, x) => a + (x.ok ?? 0), 0);
      say(`| **total** | **${total}** | **${okAll}/${total}** |`);
      const dead = st.templates.filter((t) => t.urls.length === 0 && t.status !== 200);
      if (dead.length) say(`\n**${dead.length} sitemap${dead.length > 1 ? "s" : ""} could not be read**, so those templates are unmeasured, not empty.`);

      /* WHICH URLS, NOT HOW MANY. Two consecutive readings both said "50 funding-symbols" while
         the set underneath had rotated — MORPHO crossed the open-interest floor on 21 August
         and something else fell below it — and neither report could say what. The count is
         stable precisely when churn is invisible, so a page appearing in the unindexed list
         reads as a page that lost ground when it may simply be three days old.
         The list is stored on the doc and diffed against the previous one. */
      const nowUrls = st.templates.flatMap((t) => t.urls.map((u) => u || "/")).sort();
      st.urls = nowUrls;
      const prevDoc = (await env.SNAPSHOT.get("report:latest", "json")) as { week?: string; urls?: string[] } | null;
      const prevUrls = Array.isArray(prevDoc?.urls) ? prevDoc!.urls : null;
      say("\n### What the covered set did since the last reading\n");
      if (!prevUrls) {
        /* ABSENCE IS NOT "NOTHING CHANGED", and an empty diff would say exactly that. The
           previous reading predates this list, so there is nothing to compare and the report
           says so rather than printing a reassuring blank. */
        say(`The previous reading (${prevDoc?.week ?? "none on record"}) carries no URL list, so there is nothing to compare`);
        say(`this one against. From the next reading on, this section names what joined and what left.`);
      } else {
        const prevSet = new Set(prevUrls);
        const joined = nowUrls.filter((u) => !prevSet.has(u));
        const nowSet = new Set(nowUrls);
        const left = prevUrls.filter((u) => !nowSet.has(u));
        if (!joined.length && !left.length) {
          say(`No change against ${prevDoc?.week ?? "the previous reading"}: the same ${nowUrls.length} URLs, not merely the same count.`);
        } else {
          st.joined = joined.length;
          st.prevUrls = prevUrls.length;
          say(`Against ${prevDoc?.week ?? "the previous reading"} — ${prevUrls.length} URLs then, ${nowUrls.length} now.\n`);
          if (joined.length) say(`**Joined (${joined.length}):** ${joined.map((u) => `\`${u}\``).join(", ")}`);
          if (left.length) say(`\n**Left (${left.length}):** ${left.map((u) => `\`${u}\``).join(", ")}`);
          say(`\nA URL that joined since the last reading has not had time to be indexed, and will`);
          say(`appear below as *Discovered — currently not indexed* for reasons that are not about the page.`);
        }
      }
      }
      /* THE COUNT WAS THE WHOLE REPORT, AND THE COUNT IS NOT ACTIONABLE.
         The first run of this section said "1 URLs are not fetchable by a crawler. Nothing
         below matters until that is zero" and did not say which URL. By the time anyone read
         it the page answered 200 again, so the finding could neither be acted on nor dismissed
         — the report had produced an alarm and destroyed the only evidence for it. This project
         has a standing rule about verifying diffs rather than counts; the instrument written to
         enforce it broke it. */
      const failed = st.templates.flatMap((t) => (t.failures ?? []).map((f) => [t.name, ...f] as [string, string, number, number]));
      if (failed.length) {
        const hard = failed.filter(([, , , retry]) => retry !== 200);
        say(`\n**${hard.length} URLs are not fetchable by a crawler.** Nothing below matters until that is zero.`);
        if (failed.length > hard.length) say(`${failed.length - hard.length} more failed once and succeeded on an immediate retry — transient, recorded rather than alarmed on.`);
        say("");
        say("| URL | Template | First | Retry |");
        say("|---|---|---:|---:|");
        for (const [tpl, u, first, retry] of failed.slice(0, 25)) say(`| \`${u}\` | \`${tpl}\` | ${first} | ${retry} |`);
        if (failed.length > 25) say(`\n…and ${failed.length - 25} more.`);
      }
      say("\n## B. Search Console\n");
      st.phase = env.GSC_SA_KEY ? "inspect" : "search";
      st.i = 0;
      if (!env.GSC_SA_KEY) {
        say("Not available: GSC_SA_KEY is not set.\n");
        say("To enable, in order:\n");
        /* THE RUNBOOK CAME OUT OF THE PUBLISHED REPORT. This block printed the console
           steps, the property name, the required permission level and the exact
           `wrangler secret put` command — and /status/indexation renders this report on the
           open web. It is noindex, but noindex is not access control, and the page is
           fetchable by anyone who asks for it. None of it is a credential; all of it is a
           map of which credentials exist and how they are installed, written for an
           operator and published to everyone. Setup lives in DEPLOY.md, which is where
           whoever needs it is already looking. */
        say("Setup for this section is in DEPLOY.md.\n");
        say("Owner, not Full. Search Analytics (section B2) works for any verified user, but the");
        say("URL Inspection API used for the per-template indexed share is owner-only and returns");
        say("PERMISSION_DENIED for a Full user. Adding a service account as a delegated owner is");
        say("supported on Domain properties and does not affect DNS verification.\n");
        say("Nothing about the site itself changes; this only lets the weekly report read data.");
        st.phase = "crawlers";
      } else {
        say("### Indexed share, per template\n");
        say("| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Unknown to Google | Other |");
        say("|---|---:|---:|---:|---:|---:|");
      }
      st.i = 0;
    }
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return `report: coverage ${st.i || flat.length}/${flat.length} urls`;
  }

  /* ---------------------------------------------------------------- B. inspection */
  if (st.phase === "inspect") {
    try {
      if (!st.token || Date.now() - (st.tokenAt ?? 0) > 45 * 60_000) {
        st.token = await gscToken(env.GSC_SA_KEY!);
        st.tokenAt = Date.now();
      }
      /* Same flat cursor as coverage, and for the same reason: one URL Inspection call per
         URL, no batch form, and 66 of them will not fit in one invocation. A template's row
         is written only once every URL under it has been inspected. */
      const flat: { t: Template; u: string }[] = st.templates.flatMap((t) => t.urls.map((u) => ({ t, u })));
      const end = Math.min(flat.length, st.i + SLICE);
      for (let n = st.i; n < end; n++) {
        const { t, u } = flat[n];
        const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
          method: "POST",
          headers: { authorization: `Bearer ${st.token}`, "content-type": "application/json" },
          body: JSON.stringify({ inspectionUrl: origin + (u || "/"), siteUrl: site }),
        });
        const j = (await r.json()) as any;
        const res = j?.inspectionResult?.indexStatusResult ?? {};
        const v = res.verdict;
        const k = coverageBucket(v, res.coverageState);
        (t.tally ??= { indexed: 0, crawled: 0, discovered: 0, unknown: 0, other: 0 })[k]++;
        /* THE SAME LESSON AS SECTION A, ONE SECTION LATER. The first time this ran it produced
           "65/79 indexed" and named none of the fourteen — a number that says work is needed and
           withholds the only thing needed to do it. Google returns its own reason per URL
           (coverageState: "Discovered - currently not indexed", "Crawled - currently not
           indexed", "Excluded by 'noindex' tag"), and those reasons want opposite responses. */
        if (k !== "indexed") {
          (t.notIndexed ??= []).push([u || "/", String(v ?? j?.error?.message ?? "no verdict"), String(res.coverageState ?? "—")]);
        }
      }
      st.i = end;
      if (st.i >= flat.length) {
        for (const t of st.templates) {
          const q = t.tally ?? { indexed: 0, crawled: 0, discovered: 0, unknown: 0, other: 0 };
          t.indexed = q.indexed;
          say(`| \`${t.name}\` | ${q.indexed}/${t.urls.length} (${share(q.indexed, t.urls.length)}) | ${q.crawled} | ${q.discovered} | ${q.unknown} | ${q.other} |`);
        }
        /* A SNAPSHOT CANNOT ANSWER THE QUESTION THIS DATA GETS ASKED.
           Four URLs came back "Discovered - currently not indexed" and the obvious causes were
           all tested and all failed: the unindexed pages are not thinner than the indexed ones
           (/tools at 210 words is indexed, /tools/position-size at 488 is not), not less linked
           (/tools/funding-cost has one inbound link and is indexed, /tools/position-size has
           three and is not), and not victims of a bad canonical (every one self-canonicalises).
           On a four-day-old domain the honest reading is that Google is deferring, and the only
           thing that can confirm or refute that is MOVEMENT.
           So each completed inspection appends a dated row here. Twenty-six of them is six
           months of weekly runs, which is enough to tell "deferred" from "rejected" — and small
           enough to stay one KV value. */
        const point: IndexPoint = {
          at: Date.now(),
          total: flat.length,
          indexed: st.templates.reduce((n, t) => n + (t.indexed ?? 0), 0),
          byTemplate: st.templates.map((t) => [t.name, t.indexed ?? 0, t.urls.length] as [string, number, number]),
        };
        /* A STORE THAT COULD NOT BE READ IS NOT AN EMPTY STORE. The first version of the table
           below shared one flag for "could not read" and "could not write", and a mocked
           throwing get() (16 September 2026) printed "1 reading, of the last 26 the store
           keeps" over a single row marked "— earliest kept", when older readings may well have
           existed and simply were not reachable. So the read and the write are separate now:
           `stored` is null only when the read failed, and a failed read is never followed by a
           write — one point written over an unreadable value would erase six months. Every
           sentence and the last row's label are chosen from those two facts. */
        let stored: IndexPoint[] | null = null;
        try {
          const prev = await env.SNAPSHOT.get("index:history", "json");
          stored = prev === null ? [] : Array.isArray(prev) ? (prev as IndexPoint[]) : null;
        } catch { /* unreadable: stays null. The history is an observation, never a reason to fail the report */ }
        let wrote = false;
        if (stored) {
          try {
            await env.SNAPSHOT.put("index:history", JSON.stringify([point, ...stored].slice(0, HISTORY_KEEP)));
            wrote = true;
          } catch { /* reported below */ }
        }
        /* What the store holds after this run: the trimmed list when the write landed, the
           untouched old list plus this reading when it did not, this reading alone when the old
           list could not be read. */
        const history: IndexPoint[] = !stored ? [point] : wrote ? [point, ...stored].slice(0, HISTORY_KEEP) : [point, ...stored];

        /* "WATCH THE SERIES BELOW" POINTED AT NOTHING. Measured 16 September 2026 on
           https://coinliqui.com/status/indexation (report 2026-W38): the sentence under the
           11-URL list sent the reader to a series, and nothing below it was one — the history
           above was written to KV every week and rendered by no route at all, so the one
           instrument that can tell a queue from a rejection was invisible to the person told to
           use it. The series is now printed directly under the sentence, from the same list
           this run read and wrote, so the sentence and its referent are written in one place. */
        const missing = st.templates.flatMap((t) => (t.notIndexed ?? []).map((n) => [t.name, ...n] as [string, string, string, string]));
        if (missing.length) {
          say(`\n**The ${missing.length} URL${missing.length === 1 ? "" : "s"} Google has not indexed**, with its own reason for each. ` +
            "Read the reason before acting: *Discovered — currently not indexed* is a queue, and the answer is usually to wait " +
            "and watch the indexed-share series below this table; *Crawled — currently not indexed* is a judgement about the page, " +
            "and the answer is to change the page.\n");
          say("| URL | Template | Verdict | Google's coverage state |");
          say("|---|---|---|---|");
          for (const [tpl, u, v, cov] of missing.slice(0, 40)) say(`| \`${u}\` | \`${tpl}\` | ${v} | ${cov} |`);
          if (missing.length > 40) say(`\n…and ${missing.length - 40} more.`);
        }
        const readings = `${history.length} reading${history.length === 1 ? "" : "s"}`;
        say("\n### Indexed share, reading by reading\n");
        if (!stored) {
          say("One row per completed inspection, newest first. The stored series could not be read on this run, so only this " +
            "run's reading is listed and earlier readings may exist. Nothing was written back, so the stored series is unchanged.");
        } else if (!wrote) {
          say(`One row per completed inspection, newest first: ${readings}. This run's reading could not be stored, so it is ` +
            "listed here but the next run will not compare against it.");
        } else {
          say(`One row per completed inspection, newest first: ${readings}. The store keeps the last ${HISTORY_KEEP}.` +
            (history.length === 1 ? " This is the first reading in the series; movement shows from the next one." : ""));
        }
        say("");
        for (const row of indexHistoryRows(history,
          !stored ? "— earlier readings could not be read"
          : history.length === 1 ? "— first reading"
          : "— earliest kept")) say(row);
        st.phase = "search";
        st.i = 0;
      }
      await env.SNAPSHOT.put("report:state", JSON.stringify(st));
      return `report: inspect ${st.i || flat.length}/${flat.length} urls`;
    } catch (e) {
      say(`\nInspection stopped: ${e instanceof Error ? e.message : String(e)}`);
      st.phase = "search";
    }
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return "report: inspect halted";
  }

  /* ---------------------------------------------------------------- B2. performance */
  if (st.phase === "search") {
    if (env.GSC_SA_KEY) {
      try {
        if (!st.token || Date.now() - (st.tokenAt ?? 0) > 45 * 60_000) {
          st.token = await gscToken(env.GSC_SA_KEY);
          st.tokenAt = Date.now();
        }
        const api = async (url: string, payload: unknown) =>
          (await (await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${st!.token}`, "content-type": "application/json" },
            body: JSON.stringify(payload),
          })).json()) as any;
        const { start, end } = searchWindow(Date.now());
        const dates = `from ${start} to ${end}`;
        const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
        const sa = await api(base, { startDate: start, endDate: end, dimensions: ["page"], rowLimit: QUERY_ROW_LIMIT });
        const rows: any[] = sa.rows || [];
        const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
        say(`\n### Search performance, ${start} to ${end}\n`);
        if (!rows.length) {
          say("No impressions yet. Expected before roughly week 4 — a new domain has no history to weigh.");
        } else {
          say("| Template | Impressions | Clicks | Avg position | Pages with impressions |");
          say("|---|---:|---:|---:|---:|");
          const line = (label: string, r: any[], of: string) => {
            const imp = r.reduce((a, x) => a + x.impressions, 0);
            const pos = imp ? r.reduce((a, x) => a + x.position * x.impressions, 0) / imp : 0;
            say(`| ${label} | ${imp} | ${r.reduce((a, x) => a + x.clicks, 0)} | ${pos ? pos.toFixed(1) : "—"} | ${r.length}${of} |`);
          };
          const inTemplates = new Set<string>();
          for (const t of st.templates) {
            const set = new Set(t.urls.map((u) => origin + (u || "/")));
            set.forEach((u) => inTemplates.add(u));
            line(`\`${t.name}\``, rows.filter((x) => set.has(x.keys[0])), `/${t.urls.length}`);
          }
          /* A TOTAL ROW, because the band table below now compares itself with this one and a
             reader should not have to add ten numbers to check it. Pages outside every sitemap
             get their own row so the total is everything Search Console returned by page. */
          const outside = rows.filter((x) => !inTemplates.has(x.keys[0]));
          if (outside.length) line("not in a sitemap", outside, "");
          const pageImp = rows.reduce((a, x) => a + x.impressions, 0);
          const pageClicks = rows.reduce((a, x) => a + x.clicks, 0);
          line("**total**", rows, outside.length ? "" : `/${inTemplates.size}`);
          const pageCut = rows.length >= QUERY_ROW_LIMIT;
          if (pageCut) say(`\nSearch Console returned its ${QUERY_ROW_LIMIT}-row limit, so these totals are a floor.`);
          /* =====================================================================================
             AVERAGE POSITION IS NOT COMPARABLE TO LAST WEEK WHEN THE COVERED SET GREW, and this
             report spent a week telling its reader the opposite. Its own guide said "position
             before impressions — average position per template moves earlier and more honestly",
             and on 31 August 2026 that sentence was actively misleading: 54 URLs joined, every
             template's average collapsed — /liquidations from 40.2 to 263.5 — while impressions
             rose 35%. A template that starts surfacing for more queries surfaces for the DEEP
             ones first, and an impression-weighted average falls without a single existing query
             losing a place.

             THE CAVEAT GOES WHERE THE NUMBER IS. A warning in a guide at the foot of the page is
             read once; a line under the table is read by whoever is looking at the figure it is
             about. It prints only when the condition holds, so it does not become furniture. */
          if (st!.joined) {
            say(`\n> **These averages are not comparable to the previous reading.** ${plural(st!.joined, "URL", "URLs")} joined the`);
            say(`> covered set since it, taking the total from ${st!.prevUrls ?? "?"} to ${st!.urls?.length ?? "?"}. A template that`);
            say(`> starts appearing for more queries appears for the deepest ones first, so an`);
            say(`> impression-weighted average falls even when no existing query lost a place.`);
            say(`> The band table below counts queries rather than weighting them, and is the`);
            say(`> half of this section that survives a change in the covered set.`);
          }

          const q = await api(base, { startDate: start, endDate: end, dimensions: ["query"], rowLimit: QUERY_ROW_LIMIT });
          if (q.rows?.length) {
            /* =================================================================================
               "TOP QUERIES" WAS SEARCH CONSOLE'S ORDER, CUT AT FIFTEEN, UNDER A RANKING HEADING.
               Measured 16 September 2026 on https://coinliqui.com/status/indexation (2026-W38):
               the 15-row table held one query with a click and fourteen at zero clicks running
               alphabetically, "1000flokiinr perpetual" to "btc liquidation heatmaps" — the API's
               default order is by clicks, and a tie on zero is no order at all. The band table in
               the same report counted 36 queries; the 20 hidden ones in the 51+ band held 30
               impressions, so at least one hidden query had been seen more often than nine of the
               rows shown, and the one query in 4–10 was not shown at all. The comment below said
               the table was "sorted by impressions". It was not sorted by anything.
               Now it is, by a rule the report prints, with the count shown against the count
               named, and a cut that lands inside a tie says so rather than implying a winner. */
            /* A FULL RESPONSE IS A FLOOR IN EVERY FIGURE DRAWN FROM IT, not only in the count.
               The first pass put "at least" before the query count and printed the band
               impressions, band clicks and the One push away count as exact from the same
               capped responses (verifier, 16 September 2026; unreachable at this week's 36
               queries, reachable the week the site has 500). Search Console fills a capped
               response in its own order, by clicks, so a zero-click query with many impressions
               is the first thing a cap drops — which "most impressions first" would otherwise
               hide. `queryCut` and `pairCut` below are read by every sentence that counts. */
            const named = q.rows as QueryRow[];
            const queryCut = named.length >= QUERY_ROW_LIMIT;
            const atLeast = (cut: boolean, n: number, one: string, many: string) => `${cut ? "at least " : ""}${plural(n, one, many)}`;
            const top = queriesByImpressions(named, 15);
            say("\n### Queries by impressions\n");
            say([
              queryCut
                ? `${top.shown.length} of the first ${named.length} queries Search Console returned ${dates}, most impressions first. That is its row limit and it fills the limit in order of clicks, so more queries may exist, and one with more impressions and no clicks could be among them.`
                : top.shown.length < named.length
                  ? `${top.shown.length} of ${named.length} queries Search Console named ${dates}, most impressions first.`
                  : named.length === 1
                    ? `The one query Search Console named ${dates}.`
                    : `All ${named.length} queries Search Console named ${dates}, most impressions first.`,
              named.length > 1 ? "Equal impressions go to more clicks, then the better average position, then alphabetical order." : "",
              top.tie ? `The cut falls inside a tie: ${plural(top.tie.count, "query", "queries")} had ${plural(top.tie.value, "impression", "impressions")}, and ${top.tie.shown} of them ${top.tie.shown === 1 ? "is" : "are"} listed.` : "",
              top.shown.length < named.length ? `The band table below counts every one ${queryCut ? "returned" : "of them"}.` : "",
            ].filter(Boolean).join(" ") + "\n");
            say("| Query | Impressions | Clicks | Position |");
            say("|---|---:|---:|---:|");
            for (const r of top.shown) say(`| ${r.keys[0]} | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);

            /* =================================================================================
               WHERE THE SITE ACTUALLY STANDS, WHICH THE IMPRESSIONS TABLE DOES NOT SAY.

               That table is sorted by impressions, so it answers "what is this site SEEN for".
               Every row in it has sat between position 36 and 81 since the domain existed, and
               a reader of the report could not tell from it whether that is the whole picture
               or the visible tail of something better. It was also capped at 25 rows fetched
               and 15 printed, so the question could not be answered by looking harder either.

               WHY THE BANDS ARE THESE BANDS. Click-through collapses with depth: position 1-3
               takes most of the clicks, 4-10 takes most of the rest, and page two is close to
               nothing — this site's own numbers say the same thing, 720 impressions and 5
               clicks in the week to 22 August at an average position in the thirties. So the
               boundaries are drawn where the CONSEQUENCE changes, not at round numbers: what
               is on page one, what is at the top of page two and could reach page one, and
               what is far enough away that on-page work will not move it.

               THIS IS THE ONE SECTION THAT SUGGESTS AN ACTION. Everything else in this report
               measures what was served or received. A query sitting at 11-25 with real
               impressions is a page that is already relevant and is losing to something
               beatable, and for a domain with no external links that band is the only one
               worth spending a week on. The rest is waiting.

               "EVERY QUERY SEARCH CONSOLE RECORDED THIS WEEK" WAS NEITHER. Measured 16 September
               2026 on the same report: the bands summed to 36 queries, 54 impressions and 1
               click, while the page table above them, same dates, summed to 542 impressions and
               3 clicks. Search Console leaves anonymised queries out of any query breakdown, so
               a reader took 33 of 36 queries at 51+ for the whole picture when about nine tenths
               of the page-table impressions were outside it. The sentence now counts
               what the table holds and sets it against the page totals computed above, in the
               same run, from the same window.
               ================================================================================= */
            const bands = positionBands(named);
            const bandImp = bands.reduce((a, b) => a + b.impressions, 0);
            const bandClicks = bands.reduce((a, b) => a + b.clicks, 0);
            say("\n### Where the queries sit\n");
            say([
              queryCut
                ? `At least ${named.length} queries Search Console named ${dates} (the first ${named.length} it returned, its row limit), by the position each averaged: ${atLeast(true, bandImp, "impression", "impressions")}, ${atLeast(true, bandClicks, "click", "clicks")}. Every band below is a floor.`
                : `${named.length === 1 ? "The one query" : `The ${named.length} queries`} Search Console named ${dates}, by the position ${named.length === 1 ? "it" : "each"} averaged: ${plural(bandImp, "impression", "impressions")}, ${plural(bandClicks, "click", "clicks")}.`,
              pageImp > bandImp || pageClicks > bandClicks
                ? `That is not every search. The page total above is ${atLeast(pageCut, pageImp, "impression", "impressions")} and ${atLeast(pageCut, pageClicks, "click", "clicks")}: Search Console leaves out queries too rare to name without identifying who searched${queryCut ? ", this list stops at its row limit," : ","} and the page table counts a search once for each page it showed.`
                : "",
              "Impressions say how often Google showed the page; clicks say how often that mattered.",
            ].filter(Boolean).join(" ") + "\n");
            say("| Position | Queries | Impressions | Clicks | What that band means |");
            say("|---|---:|---:|---:|---|");
            for (const b of bands) {
              say(`| ${b.label} | ${b.queries} | ${b.impressions} | ${b.clicks} | ${b.note} |`);
            }

            /* THE PAGE IS FETCHED WITH THE QUERY, because "improve this query" is not an
               instruction anybody can act on. A second dimension turns it into a page to edit.
               One extra call, inside the same authenticated session. */
            const qp = await api(base, {
              startDate: start, endDate: end, dimensions: ["query", "page"], rowLimit: QUERY_ROW_LIMIT,
            });
            /* COUNTED UNCAPPED, LISTED CAPPED. nearMisses() stops at twenty, and the sentence
               counted what it returned, so a twenty-first pair would have been reported as
               twenty. */
            const pairs = (qp.rows || []) as QueryRow[];
            const pairCut = pairs.length >= QUERY_ROW_LIMIT;
            const nearAll = nearMisses(pairs, Infinity);
            const near = nearAll.slice(0, 20);
            say("\n### One push away\n");
            if (!near.length) {
              say(pairCut
                ? `None of the first ${pairs.length} query-page pairs Search Console returned ${dates} averaged a position between 11 and 25. ` +
                  "That is its row limit, so pairs beyond it were not checked — see the band table above for where the named queries sit."
                : `No query-page pair Search Console named ${dates} averaged a position between 11 and 25. Nothing here is close enough ` +
                  "that writing more of the same page would move it — see the band table above for where the named queries actually are.");
            } else {
              /* PAIRS, NOT QUERIES. The call two lines up asks for dimensions ["query", "page"],
                 so Search Console returns one row per query-and-URL pair and one query ranking
                 on two URLs is two rows. The sentence counted rows and called them queries. The
                 table underneath has always had a Page column, so the words now match it. */
              say(`${pairCut ? "At least " : ""}${nearAll.length} query-page pair${nearAll.length === 1 ? " is" : "s are"} on page two or three ${dates}${near.length < nearAll.length ? `; the ${near.length} most-seen are listed` : ""}.` +
                (pairCut ? ` Search Console returned its ${QUERY_ROW_LIMIT}-row limit of pairs, so more may exist.` : "") +
                ` ${nearAll.length === 1 ? "That is a page" : "These are the pages"} where the site is already relevant and is losing to something beatable.\n`);
              say("| Query | Page | Impressions | Clicks | Position |");
              say("|---|---|---:|---:|---:|");
              for (const r of near) {
                const path = (() => { try { return new URL(r.keys[1]).pathname; } catch { return r.keys[1]; } })();
                say(`| ${r.keys[0]} | \`${path}\` | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);
              }
            }
          }
        }
      } catch (e) {
        say(`\nSearch performance not available: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    st.phase = "crawlers";
    await env.SNAPSHOT.put("report:state", JSON.stringify(st));
    return "report: search";
  }

  /* ---------------------------------------------------------------- C. crawlers */
  say("\n## C. Crawler fetches\n");
  try {
    /* NAME THE ONE THAT IS MISSING. This said "CF_ANALYTICS_TOKEN or CF_ZONE_ID is not set"
       while knowing perfectly well which — and it published that to /status/indexation after
       CF_ZONE_ID had been set, so the page told a reader to install a secret that was already
       installed. An error message that lists its own possibilities is a count, not a diff. */
    const absent = [
      !env.CF_ANALYTICS_TOKEN && "CF_ANALYTICS_TOKEN",
      !env.CF_ZONE_ID && "CF_ZONE_ID",
    ].filter(Boolean);
    if (absent.length) throw new Error(`${absent.join(" and ")} ${absent.length > 1 ? "are" : "is"} not set`);

    /* SEVEN ONE-DAY WINDOWS, NOT ONE SEVEN-DAY WINDOW.
       This section had never produced a single number, and the reason was not the missing
       token. The zone is on the Free plan, where httpRequestsAdaptiveGroups refuses any range
       wider than a day: `cannot request a time range wider than 1d, but your query time range
       spans 1w`. The moment the credential arrived it would have failed with a message about
       time ranges and been read as a credential problem. Retention allows about eight days
       back, so seven daily queries cover the same week and are accepted. */
    const day = 86_400_000;
    const groups: RawGroup[] = [];
    let windows = 0;
    for (let d = 0; d < 7; d++) {
      const to = new Date(Date.now() - d * day).toISOString();
      const from = new Date(Date.now() - (d + 1) * day).toISOString();
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: `query($zone:String!,$from:Time!,$to:Time!){viewer{zones(filter:{zoneTag:$zone}){
            httpRequestsAdaptiveGroups(limit:1000, filter:{datetime_geq:$from, datetime_lt:$to}, orderBy:[count_DESC]){
              count dimensions{userAgent verifiedBotCategory} }}}}`,
          variables: { zone: env.CF_ZONE_ID, from, to },
        }),
      });
      const j = (await r.json()) as any;
      /* A window older than retention is not an error worth failing the section for — it is the
         edge of the data. Only fail if EVERY window failed, which is what a real fault looks like. */
      if (j.errors?.length) { if (d === 0) throw new Error(j.errors.map((e: any) => e.message).join("; ")); continue; }
      const g = j.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
      if (g.length) { windows++; groups.push(...g); }
    }

    const t = tallyCrawlers(groups);
    say(`Last ${windows} day(s), from Cloudflare's edge — the only place a named crawler is visible at all,`);
    say("since Googlebot runs no JavaScript and never appears in Google Analytics.\n");

    /* VERIFIED, NOT CLAIMED. A user-agent string is an assertion by the client, and this site
       measured what happens when an instrument believes it: over five days 13,314 requests
       arrived wearing a named crawler's user-agent and Cloudflare verified 1,205 of them. The
       gap was not an attack — 11,882 came from the IP of the laptop scripts/verify-live.mjs
       runs on, which impersonates thirteen crawlers on purpose to test how the edge treats
       them. Counting names would have reported this project's own test suite as crawler
       interest, on the section the report itself calls the leading indicator. Both columns are
       printed because the GAP is the finding; the left column is the one to read. */
    say("| Crawler | Verified fetches | Requests claiming the name |");
    say("|---|---:|---:|");
    for (const row of t.rows) say(`| ${row.name} | ${row.verified || "—"} | ${row.claimed || "—"} |`);
    say(`| **total** | **${t.verifiedTotal}** | **${t.claimedTotal}** |`);
    if (!t.verifiedTotal) {
      say("\nNo VERIFIED crawler seen yet. Normal in the first fortnight; past week 3, re-run verify-live before assuming it is a ranking problem.");
    }
    if (t.claimedTotal > t.verifiedTotal) {
      const pct1 = ((t.verifiedTotal / t.claimedTotal) * 100).toFixed(1);
      say(`\n${pct1}% of the requests carrying a crawler's name were verified as that crawler. Most of the`);
      say("remainder is this project's own verification harness, which impersonates every crawler");
      say("deliberately; the rest is credential scanners wearing whatever name is handy.");
    }
    say("\nA note for anyone reading the zone dashboard instead: roughly a fifth of this zone's");
    say("requests are Cloudflare's own early-hints prefetcher, which receives a 504 every time and");
    say("never reaches the origin. It makes the zone's 5xx rate read about 20% while the Pages");
    say("Function's own error count is zero. Neither number is wrong; they count different things.");
  } catch (e) {
    /* THIS IS A DECISION, NOT AN UNFINISHED SETUP STEP, and the old wording said the opposite.
       It read "Not available: CF_ANALYTICS_TOKEN is not set. Setup for this section is in
       DEPLOY.md", which tells a reader there is a task outstanding. On 31 August 2026 the owner
       declined to put a long-lived analytics credential inside a service that runs unattended
       every five minutes, which is the right instinct: the least privilege a running process
       can hold is none. The zone analytics are readable from the operator's own machine with
       the wrangler OAuth token that is already there, so the measurement moved rather than
       being dropped — see scripts/crawlers.mjs.

       WHAT IS GENUINELY LOST is accumulation. `npm run crawlers` samples one day, because the
       free plan refuses a wider range; this section would have kept a weekly series. That is a
       real cost and it is named here rather than glossed. */
    say(`Not collected here: ${e instanceof Error ? e.message : String(e)}.\n`);
    say("**By decision, not omission.** A long-lived analytics credential inside a worker that");
    say("runs unattended every five minutes is a key carried for no good reason, so the zone");
    say("analytics are read from the operator's machine instead — `npm run crawlers`, using the");
    say("wrangler OAuth token already there. Nothing was handed to this worker.\n");
    say("What that costs: this section would have kept a weekly series, and the local reader");
    say("samples a single day — the free plan refuses a wider range. The first sample, taken");
    say("2026-08-31, is why it matters at all: ~819 VERIFIED AI-side fetches a day against");
    say("Googlebot's 19, and 704 requests wearing a crawler's name that Cloudflare could not");
    say("verify. None of it reaches Search Console, GA4 or the pageview counter, because a");
    say("crawler runs no JavaScript.");
  }

  /* ---------------------------------------------------------------------------------------
     SECTION D — HOW OLD IS OUR READING OF THE DOCUMENTS THE SITE DEPENDS ON.

     scripts/terms-watch.mjs counts these days and fails the gate when one is overdue, which is
     the right enforcement and the wrong surface: it is a file somebody has to remember to open.
     The one failure mode a single-sourced site cannot detect technically — Hyperliquid adding an
     API-scoped clause — has no symptom except a human noticing, so the counter belongs where the
     owner already looks once a week.

     NO NETWORK CALL, deliberately, for the reason written at length in terms-watch.mjs: fetching
     app.hyperliquid.xyz/terms from this worker would have the service making automated recurring
     requests to the Interface, which is the one act that document binds on. This reads a
     committed JSON file and subtracts two dates.
     --------------------------------------------------------------------------------------- */
  say("\n## D. Legal reading age\n");
  {
    const DAY = 86_400_000;
    const rows = (TERMS.documents as any[]).map((d) => {
      const read = Date.parse(`${d.readAt}T00:00:00Z`);
      const every = Number.isInteger(d.reviewEveryDays) ? d.reviewEveryDays : TERMS.reviewEveryDaysDefault;
      const days = Number.isFinite(read) ? Math.floor((Date.now() - read) / DAY) : null;
      return { id: d.id, days, every, due: days === null || days > every, dated: d.lastUpdatedOnDocument };
    });
    /* A TIE NAMED ONE DOCUMENT. Measured 16 September 2026 on
       https://coinliqui.com/status/indexation (2026-W38): "Oldest reading: 26 days
       (hyperliquid-tou)" above a table in which all three documents read 26d — every readAt in
       terms-baseline.json is 2026-08-19, a date with no time, so nothing separates them. The
       reduce kept the first row on equality, and the sentence implied the other two had been
       read more recently. extremeBy() has no single item to name when the set is tied, so this
       cannot print a winner that is not one. A document never read outranks any age, and is
       named as such rather than as a very large number of days. The tied sentence counts from
       generation, not "ago": the doc is read for a week after it is written, and "ago" would be
       a day short by Tuesday. */
    const never = rows.filter((r) => r.days === null);
    const aged = extremeBy(rows.filter((r) => r.days !== null), (r) => r.days as number, "max");
    const daysOf = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
    const lead = never.length
      ? `Never read: ${never.map((r) => r.id).join(", ")}.`
      : aged.kind === "none"
        ? "No documents on record."
        : aged.kind === "unique"
          ? `Oldest reading: ${daysOf(aged.value)} (${aged.item.id}).`
          : aged.items.length === aged.of
            ? `All ${aged.of} documents were last read on the same day, ${daysOf(aged.value)} before this report was generated.`
            : `Oldest reading: ${daysOf(aged.value)}, shared by ${aged.items.map((r) => r.id).join(", ")}.`;
    const due = rows.filter((r) => r.due);
    say(`**${lead}** ` +
        `${due.length ? `${due.length} document${due.length === 1 ? " is" : "s are"} overdue.` : "Nothing overdue."}\n`);
    say("| Document | Read | Window | Dated on the document |");
    say("|---|---:|---:|---|");
    for (const r of rows) {
      say(`| ${r.due ? "**" : ""}${r.id}${r.due ? "**" : ""} | ${r.days === null ? "never" : `${r.days}d`} | ${r.every}d | ${r.dated} |`);
    }
    if (due.length) {
      say("\nOpen each in a browser and update `src/data/terms-baseline.json`. A plain fetch is not a");
      say("reading: both documents that matter here served a shell or a 403 to one, and an automated");
      say("watcher would have reported no change indefinitely.");
    }
  }

  say("\n## What to read first\n");
  say("1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.");
  say("2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently");
  say("   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.");
  say("3. **Average position is only comparable when the covered set is.** The guidance here used");
  say("   to be \"position before impressions — it moves earlier and more honestly\", and the week");
  say("   of 31 August 2026 refuted it: 54 URLs joined, every template's average collapsed —");
  say("   /liquidations from 40.2 to 263.5 — and not one existing query had lost a place. A");
  say("   template that starts appearing for more queries appears for the deepest ones first.");
  say("   Read the BAND table instead when URLs joined: it counts queries rather than weighting");
  say("   them by impressions, so a query moving from 51+ into 11-25 is a real move either way.");
  say("4. **Crawler fetches are the leading indicator.** If they are zero, nothing downstream can");
  say("   move, and the cause is access rather than quality.");
  say("5. **\"One push away\" is the only section that suggests an action.** Everything else here");
  say("   measures what was served or received. A query at position 11–25 is a page that is");
  say("   already relevant and losing to something beatable; for a domain with no external links");
  say("   that band is the only one on-page work can move. An empty section means the honest");
  say("   answer this week is to keep writing and wait — read the band table above it for why.");
  say("6. **Section D is the one nothing else can catch.** Every other failure on this site has a");
  say("   technical symptom. A change to the terms this site depends on has none — the pages keep");
  say("   rendering perfectly — so the only detector is somebody re-reading the document.");

  const doc = { week: st.week, at: Date.now(), tookMs: Date.now() - st.startedAt, md: st.lines.join("\n") + "\n", urls: st.urls ?? [], format: REPORT_FORMAT };
  await env.SNAPSHOT.put(`report:${st.week}`, JSON.stringify(doc));
  await env.SNAPSHOT.put("report:latest", JSON.stringify(doc));
  await env.SNAPSHOT.delete("report:state");
  return `report: complete (${st.week})`;
}


/**
 * ONE URL INSPECTION, ON DEMAND, THROUGH THE WORKER'S OWN CREDENTIAL.
 *
 * Search Console questions keep arriving without a local key — deliberately, because the key
 * lives in a secret and a second copy on a laptop is a second thing to leak. But a single
 * unrepeatable reading is not evidence, and twice now a diagnosis has stalled on being unable
 * to ask Google the same question twice.
 *
 * Driven by KV rather than by an HTTP route: writing `probe:inspect` asks for one inspection,
 * the answer lands in `probe:result`, and the request key is DELETED whether the call succeeds
 * or fails. No public surface, no way to queue work by hitting a URL, and no way for a
 * forgotten probe to keep spending quota — it is one call, once, per request written.
 */
export async function stepProbe(env: ReportEnv): Promise<string | null> {
  if (!env.GSC_SA_KEY) return null;
  /* The request is JSON — {"url": "..."} — rather than a bare string, because the binding's
     read signature is typed for it and a probe is not worth widening an interface for. */
  let url: string | null = null;
  try {
    const req = (await env.SNAPSHOT.get("probe:inspect", "json")) as { url?: string } | null;
    url = typeof req?.url === "string" ? req.url : null;
  } catch { return null; }
  if (!url) return null;

  /* Cleared FIRST. If the inspection throws, the probe must not retry on every tick for ever —
     that is how a diagnostic becomes a quota leak. */
  try { await env.SNAPSHOT.delete("probe:inspect"); } catch { /* best effort */ }

  const out: Record<string, unknown> = { url, at: Date.now() };
  try {
    const token = await gscToken(env.GSC_SA_KEY);
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ inspectionUrl: url.trim(), siteUrl: "sc-domain:coinliqui.com" }),
    });
    const j = (await r.json()) as any;
    out.status = r.status;
    if (j?.error) out.error = `${j.error.code} ${j.error.message}`;
    else {
      const i = j?.inspectionResult?.indexStatusResult ?? {};
      out.verdict = i.verdict;
      out.coverageState = i.coverageState;
      out.robotsTxtState = i.robotsTxtState;
      out.indexingState = i.indexingState;
      out.lastCrawlTime = i.lastCrawlTime ?? null;
      out.googleCanonical = i.googleCanonical ?? null;
      out.userCanonical = i.userCanonical ?? null;
      out.pageFetchState = i.pageFetchState ?? null;
      out.referringUrls = i.referringUrls ?? null;
      out.sitemap = i.sitemap ?? null;
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
  }
  try { await env.SNAPSHOT.put("probe:result", JSON.stringify(out)); } catch { /* best effort */ }
  return String(out.coverageState ?? out.error ?? "done");
}

/**
 * WHERE A WEEK'S QUERIES SIT, AND WHICH OF THEM ARE CLOSE ENOUGH TO BE WORTH A WEEK.
 *
 * EXPORTED SO THEY CAN BE FALSIFIED. The Search Console half of this report has no fixture
 * coverage at all — the harness in scripts/report-cases.mjs mocks fetch by pathname and
 * cannot sign the service-account JWT the live path needs, so every line of it has only ever
 * run in production, once a week, unattended. The two things most likely to be wrong here are
 * the band boundaries and the near-miss filter, and neither needs a credential to test. They
 * are pure functions over rows now, and scripts/report-cases.mjs holds the cases.
 *
 * THE BOUNDARIES ARE DRAWN WHERE THE CONSEQUENCE CHANGES, not at round numbers. Click-through
 * collapses with depth: 1-3 takes most of the clicks, 4-10 most of the rest, page two is close
 * to nothing. This site's own week to 22 August says the same — 720 impressions, 5 clicks, an
 * average position in the thirties. `position` from Search Console is an AVERAGE and therefore
 * fractional, so every boundary is a half: `> 10.5` is "worse than tenth on average", and a
 * query averaging exactly 10.0 belongs on page one rather than at the top of page two.
 */
export const POSITION_BANDS: { label: string; lo: number; hi: number; note: string }[] = [
  { label: "1–3", lo: 0, hi: 3.5, note: "page one, above the fold — where clicks actually happen" },
  { label: "4–10", lo: 3.5, hi: 10.5, note: "page one" },
  { label: "11–25", lo: 10.5, hi: 25.5, note: "page two and three — the only band on-page work can move" },
  { label: "26–50", lo: 25.5, hi: 50.5, note: "seen, not read" },
  { label: "51+", lo: 50.5, hi: Infinity, note: "counted, and that is all" },
];

export interface QueryRow { keys: string[]; impressions: number; clicks: number; position: number }

/** One row per band, in band order, including the bands nothing landed in — an absent band
 *  reads as "no data" and the truthful reading is "nothing is there". */
export function positionBands(rows: QueryRow[]): { label: string; note: string; queries: number; impressions: number; clicks: number }[] {
  return POSITION_BANDS.map((b) => {
    const inBand = (rows ?? []).filter((r) => r.position > b.lo && r.position <= b.hi);
    return {
      label: b.label, note: b.note, queries: inBand.length,
      impressions: inBand.reduce((a, r) => a + r.impressions, 0),
      clicks: inBand.reduce((a, r) => a + r.clicks, 0),
    };
  });
}

/**
 * The queries shown under "Queries by impressions": most impressions first, then more clicks,
 * then the better average position, then alphabetical — the rule the report prints above the
 * table. Pure and exported for the same reason as the two above.
 *
 * A CUT INSIDE A TIE IS RETURNED, NOT HIDDEN. When the first row left out has as many
 * impressions as the last row kept, which of the tied rows made the list was decided by the
 * tie-breaks, not by impressions, and the caller prints that.
 */
function queriesByImpressions(rows: QueryRow[], limit: number): {
  shown: QueryRow[];
  tie: { value: number; count: number; shown: number } | null;
} {
  const sorted = [...(rows ?? [])].sort((a, b) =>
    b.impressions - a.impressions || b.clicks - a.clicks || a.position - b.position || String(a.keys[0]).localeCompare(String(b.keys[0])));
  const shown = sorted.slice(0, limit);
  const next = sorted[shown.length];
  const edge = shown[shown.length - 1];
  if (!next || !edge || next.impressions !== edge.impressions) return { shown, tie: null };
  return {
    shown,
    tie: {
      value: edge.impressions,
      count: sorted.filter((r) => r.impressions === edge.impressions).length,
      shown: shown.filter((r) => r.impressions === edge.impressions).length,
    },
  };
}

/**
 * The queries on page two or three, most-seen first, capped.
 *
 * SORTED BY IMPRESSIONS AND THEN BY POSITION, not by position alone. A query at 11.2 that
 * Google showed twice is a worse use of a week than one at 24 it showed forty times; the
 * question this table answers is where the traffic is, not where the ranking is.
 */
export function nearMisses(rows: QueryRow[], limit = 20): QueryRow[] {
  return (rows ?? [])
    .filter((r) => r.position > 10.5 && r.position <= 25.5)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, limit);
}
