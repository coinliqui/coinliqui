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
 * 07:00 UTC on a Monday (Search Console lags ~2 days, so a Monday run covers the whole of
 * the previous week) and finishes about twenty minutes later.
 *
 * Each section degrades to a stated reason rather than failing the run: the useful property
 * of a weekly instrument is that it always produces something readable on the day.
 *
 *   A. COVERAGE   no credentials. What exists per template, and whether a crawler can fetch it.
 *   B. SEARCH     GSC service account in the GSC_SA_KEY secret.
 *   C. CRAWLERS   Cloudflare token with Analytics:Read in CF_ANALYTICS_TOKEN.
 */

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
interface IndexPoint {
  at: number;
  total: number;
  indexed: number;
  byTemplate: [name: string, indexed: number, total: number][];
}

interface Template { name: string; urls: string[]; ok?: number; indexed?: number; tally?: Record<string, number> }
interface State {
  week: string;
  phase: "coverage" | "inspect" | "search" | "crawlers" | "done";
  i: number;
  lines: string[];
  templates: Template[];
  startedAt: number;
  token?: string;
  tokenAt?: number;
}

const UA = "GPTBot/1.1";
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
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");

/**
 * A Google service-account access token, signed in the Worker.
 *
 * node:crypto's createSign is not available here, so the RS256 signature is done with
 * WebCrypto: the PEM is unwrapped to DER, imported as PKCS#8, and signed with
 * RSASSA-PKCS1-v1_5. Same JWT, same exchange, no dependency.
 */
export async function gscToken(rawKey: string): Promise<string> {
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

  const say = (s = "") => st!.lines.push(s);
  const get = async (path: string) => {
    const r = await fetch(origin + path, { headers: { "user-agent": UA } });
    return { status: r.status, body: await r.text() };
  };
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

  /* ---------------------------------------------------------------- A. coverage */
  if (st.phase === "coverage") {
    if (!st.templates.length) {
      const idx = await get("/sitemap-index.xml");
      for (const m of locs(idx.body)) {
        const b = await get(m);
        st.templates.push({ name: m.replace("/sitemaps/", "").replace(".xml", ""), urls: locs(b.body) });
      }
      st.i = 0;
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
      t.ok = (t.ok ?? 0) + ((await get(u || "/")).status === 200 ? 1 : 0);
    }
    st.i = end;
    if (st.i >= flat.length) {
      say("## A. Coverage\n");
      say("What exists, and whether a crawler can still fetch it. No credentials — this section always runs.\n");
      say("| Template | URLs | Fetchable as GPTBot |");
      say("|---|---:|---:|");
      for (const t of st.templates) say(`| \`${t.name}\` | ${t.urls.length} | ${t.ok ?? 0}/${t.urls.length} |`);
      const total = st.templates.reduce((a, x) => a + x.urls.length, 0);
      const okAll = st.templates.reduce((a, x) => a + (x.ok ?? 0), 0);
      say(`| **total** | **${total}** | **${okAll}/${total}** |`);
      if (okAll < total) say(`\n**${total - okAll} URLs are not fetchable by a crawler.** Nothing below matters until that is zero.`);
      say("\n## B. Search Console\n");
      st.phase = env.GSC_SA_KEY ? "inspect" : "search";
      st.i = 0;
      if (!env.GSC_SA_KEY) {
        say("Not available: GSC_SA_KEY is not set.\n");
        say("To enable, in order:\n");
        say("1. Google Cloud console: create a project, enable the **Google Search Console API**,");
        say("   create a **service account**, and download a **JSON key**.");
        say("2. Search Console -> the `coinliqui.com` Domain property -> Settings -> Users and");
        say("   permissions -> Add user: paste the service account's `client_email`, permission");
        say("   **Owner**.");
        say("3. `npx wrangler secret put GSC_SA_KEY` and paste the whole JSON key file.\n");
        say("Owner, not Full. Search Analytics (section B2) works for any verified user, but the");
        say("URL Inspection API used for the per-template indexed share is owner-only and returns");
        say("PERMISSION_DENIED for a Full user. Adding a service account as a delegated owner is");
        say("supported on Domain properties and does not affect DNS verification.\n");
        say("Nothing about the site itself changes; this only lets the weekly report read data.");
        st.phase = "crawlers";
      } else {
        say("### Indexed share, per template\n");
        say("| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Other |");
        say("|---|---:|---:|---:|---:|");
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
        const v = j?.inspectionResult?.indexStatusResult?.verdict;
        const k = v === "PASS" || v === "NEUTRAL" || v === "FAIL" ? v : "other";
        (t.tally ??= { PASS: 0, NEUTRAL: 0, FAIL: 0, other: 0 })[k]++;
      }
      st.i = end;
      if (st.i >= flat.length) {
        for (const t of st.templates) {
          const q = t.tally ?? { PASS: 0, NEUTRAL: 0, FAIL: 0, other: 0 };
          t.indexed = q.PASS;
          say(`| \`${t.name}\` | ${q.PASS}/${t.urls.length} (${pct(q.PASS, t.urls.length)}) | ${q.NEUTRAL} | ${q.FAIL} | ${q.other} |`);
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
        try {
          const prev = ((await env.SNAPSHOT.get("index:history", "json")) as IndexPoint[] | null) ?? [];
          const point: IndexPoint = {
            at: Date.now(),
            total: flat.length,
            indexed: st.templates.reduce((n, t) => n + (t.indexed ?? 0), 0),
            byTemplate: st.templates.map((t) => [t.name, t.indexed ?? 0, t.urls.length] as [string, number, number]),
          };
          await env.SNAPSHOT.put("index:history", JSON.stringify([point, ...prev].slice(0, 26)));
        } catch { /* the history is an observation, never a reason to fail the report */ }
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
        const end = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
        const start = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
        const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
        const sa = await api(base, { startDate: start, endDate: end, dimensions: ["page"], rowLimit: 500 });
        const rows: any[] = sa.rows || [];
        say(`\n### Search performance, ${start} to ${end}\n`);
        if (!rows.length) {
          say("No impressions yet. Expected before roughly week 4 — a new domain has no history to weigh.");
        } else {
          say("| Template | Impressions | Clicks | Avg position | Pages with impressions |");
          say("|---|---:|---:|---:|---:|");
          for (const t of st.templates) {
            const set = new Set(t.urls.map((u) => origin + (u || "/")));
            const r = rows.filter((x) => set.has(x.keys[0]));
            const imp = r.reduce((a, x) => a + x.impressions, 0);
            const pos = imp ? r.reduce((a, x) => a + x.position * x.impressions, 0) / imp : 0;
            say(`| \`${t.name}\` | ${imp} | ${r.reduce((a, x) => a + x.clicks, 0)} | ${pos ? pos.toFixed(1) : "—"} | ${r.length}/${t.urls.length} |`);
          }
          const q = await api(base, { startDate: start, endDate: end, dimensions: ["query"], rowLimit: 25 });
          if (q.rows?.length) {
            say("\n### Top queries\n");
            say("| Query | Impressions | Clicks | Position |");
            say("|---|---:|---:|---:|");
            for (const r of q.rows.slice(0, 15)) say(`| ${r.keys[0]} | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);
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
    if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) throw new Error("CF_ANALYTICS_TOKEN or CF_ZONE_ID is not set");
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($zone:String!,$since:Time!){viewer{zones(filter:{zoneTag:$zone}){
          httpRequestsAdaptiveGroups(limit:200, filter:{datetime_geq:$since}, orderBy:[count_DESC]){
            count dimensions{userAgent} }}}}`,
        variables: { zone: env.CF_ZONE_ID, since },
      }),
    });
    const j = (await r.json()) as any;
    if (j.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join("; "));
    const groups: any[] = j.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
    say("Last 7 days, from Cloudflare's edge — the only place a named crawler is visible at all,");
    say("since Googlebot runs no JavaScript and never appears in Google Analytics.\n");
    say("| Crawler | Requests |");
    say("|---|---:|");
    let any = false;
    for (const w of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
      "PerplexityBot", "Perplexity-User", "Googlebot", "bingbot", "Applebot", "Amazonbot"]) {
      const n = groups.filter((g) => (g.dimensions?.userAgent || "").includes(w)).reduce((a, g) => a + g.count, 0);
      if (n) any = true;
      say(`| ${w} | ${n || "—"} |`);
    }
    if (!any) say("\nNo named crawler seen yet. Normal in the first fortnight; past week 3, re-run verify-live before assuming it is a ranking problem.");
  } catch (e) {
    say(`Not available: ${e instanceof Error ? e.message : String(e)}.\n`);
    say("To enable: a Cloudflare token scoped to this zone with **Analytics → Read**, then");
    say("`npx wrangler secret put CF_ANALYTICS_TOKEN` and `npx wrangler secret put CF_ZONE_ID`.");
  }

  say("\n## What to read first\n");
  say("1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.");
  say("2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently");
  say("   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.");
  say("3. **Position before impressions.** Impressions on a new domain arrive late and jump around;");
  say("   average position per template moves earlier and more honestly.");
  say("4. **Crawler fetches are the leading indicator.** If they are zero, nothing downstream can");
  say("   move, and the cause is access rather than quality.");

  const doc = { week: st.week, at: Date.now(), tookMs: Date.now() - st.startedAt, md: st.lines.join("\n") + "\n" };
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
