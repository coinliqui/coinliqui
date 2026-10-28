/* =========================================================================================
   WHO ARRIVED, AND FROM WHERE — decided from what the browser itself says about the navigation.

   A browser that loads a page because a person asked it to sends Sec-Fetch-Mode: navigate and
   Sec-Fetch-Dest: document, and Sec-Fetch-Site says where the navigation started: "none" when it
   was typed, bookmarked or opened from an app; "cross-site" when it came from another site's
   link; "same-origin" when it came from a page of this one. Crawlers and fetchers almost never
   send these headers, and the user-agent test below catches the ones that do. So an arrival is
   counted without JavaScript, without a cookie and without sampling — the three things that made
   the October fall unreadable (see migrations/0004_entry_day.sql).

   The source is the utm_source a link carried (ChatGPT appends utm_source=chatgpt.com), else the
   referring host, else "(none)". Only the host is kept, never a full referrer.

   PURE ON PURPOSE: scripts/entry-cases.mjs runs this exact function against the requests it must
   count and the ones it must not, and fails a classifier that counts every page load.
   ========================================================================================= */
export interface Entry { day: string; path: string; src: string; how: "direct" | "external" | "internal"; device: "mobile" | "desktop" }

/** Agents that are not a person reading, including the ones that send browser-like headers. */
const AGENT = /bot|crawl|spider|slurp|fetch|preview|headless|lighthouse|pagespeed|chatgpt|gpt|claude|anthropic|perplexity|bytespider|petal|yandex|baidu|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\//i;

/** A name the deploy's own live check carries, so its arrivals can be told apart and left out. */
export const SELF_CHECK = "coinliqui-selfcheck";

export function classifyEntry(
  req: { method: string; url: string; headers: { get(name: string): string | null } },
  res: { status: number; contentType: string },
  canonicalOrigin: string,
  now = Date.now(),
): Entry | null {
  if (req.method !== "GET" || res.status !== 200 || !res.contentType.includes("text/html")) return null;
  const url = new URL(req.url);
  if (url.origin !== canonicalOrigin) return null;
  const h = req.headers;
  if (h.get("sec-fetch-mode") !== "navigate" || h.get("sec-fetch-dest") !== "document") return null;
  /* A prefetch or prerender is the browser guessing, not a person arriving. */
  if (h.get("sec-purpose") || h.get("purpose") || h.get("x-moz") === "prefetch") return null;
  const ua = h.get("user-agent") ?? "";
  if (!ua || AGENT.test(ua)) return null;
  const site = h.get("sec-fetch-site");
  const how = site === "none" ? "direct" : site === "same-origin" ? "internal" : site === "cross-site" || site === "same-site" ? "external" : null;
  if (!how) return null;
  let refHost = "";
  try { refHost = h.get("referer") ? new URL(h.get("referer")!).host : ""; } catch { /* a malformed referrer is no referrer */ }
  const utm = (url.searchParams.get("utm_source") ?? "").trim().toLowerCase().slice(0, 60);
  const src = how === "internal" ? "(site)" : utm || (refHost && refHost !== url.host ? refHost.toLowerCase().slice(0, 80) : "(none)");
  return {
    day: new Date(now).toISOString().slice(0, 10),
    path: url.pathname.slice(0, 120),
    src,
    how,
    device: /Mobi|Android|iPhone|iPad/.test(ua) ? "mobile" : "desktop",
  };
}

export const ENTRY_UPSERT =
  "INSERT INTO entry_day (day, path, src, how, device, n) VALUES (?1, ?2, ?3, ?4, ?5, 1) " +
  "ON CONFLICT (day, path, src, how, device) DO UPDATE SET n = n + 1";
