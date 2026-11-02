/* =========================================================================================
   WHO ARRIVED, AND FROM WHERE — counted only when the browser confirms it.

   VERSION 2, 2 NOVEMBER 2026. The first version counted a page's HTML request whenever it carried
   a browser's Sec-Fetch headers. Measured on Cloudflare's request log for 30 October: one
   user-agent string (Chrome 142 on macOS) fetched map and funding pages 24 hours a day, 8-12 an
   hour, from sixteen countries, and in the whole day asked for no stylesheet, script or image —
   a scraper sending real browser headers. It made 430-470 "direct" arrivals a day out of a site
   whose JavaScript counter saw about twelve. A header can be sent by anything.

   What a page-fetching scraper does not do is load the page. So the HTML request now only DECIDES
   what an arrival would be (classifyEntry below) and writes it into a 1x1 image at the end of the
   document; the count happens when the browser asks for that image (classifyBeacon). No script,
   no cookie, no sampling, and a client that takes the HTML and leaves is never counted.

   The navigation rules are unchanged: Sec-Fetch-Mode navigate and Sec-Fetch-Dest document;
   Sec-Fetch-Site says typed or bookmarked ("none"), from another site ("cross-site") or from this
   one ("same-origin"); the source is utm_source, else the referring host. Only the host is kept.

   PURE ON PURPOSE: scripts/entry-cases.mjs runs both functions on request sequences, and fails the
   first version, which counted the scraper.
   ========================================================================================= */
export interface Entry { day: string; path: string; src: string; how: "direct" | "external" | "internal"; device: "mobile" | "desktop"; country: string }

/** Agents that are not a person reading, including the ones that send browser-like headers — and this
 *  site's own checks, which drive a real Chrome across every page and sign their user-agent. */
const AGENT = /coinliqui-selfcheck|bot|crawl|spider|slurp|fetch|preview|headless|lighthouse|pagespeed|chatgpt|gpt|claude|anthropic|perplexity|bytespider|petal|yandex|baidu|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\//i;

/** A name the deploy's own live check carries, so its arrivals can be told apart and left out. */
export const SELF_CHECK = "coinliqui-selfcheck";

export function classifyEntry(
  req: { method: string; url: string; headers: { get(name: string): string | null } },
  res: { status: number; contentType: string },
  canonicalOrigin: string,
  now = Date.now(),
  /** two-letter code from Cloudflare's request.cf.country; "??" when absent */
  country = "??",
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
    country: /^[A-Z]{2}$/.test(country) ? country : "??",
  };
}

export const ENTRY_UPSERT =
  "INSERT INTO entry_day (day, path, src, how, device, country, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1) " +
  "ON CONFLICT (day, path, src, how, device, country) DO UPDATE SET n = n + 1";

/* ---------------------------------------------------------------- the confirmation */

export const BEACON_PATH = "/arrive";
const HOW = new Set(["direct", "external", "internal"]);

/** The image URL a counted page carries: what the HTML request decided, nothing about the person. */
export function beaconUrl(e: Entry): string {
  const q = new URLSearchParams({ p: e.path, s: e.src, h: e.how });
  return `${BEACON_PATH}?${q.toString()}`;
}

/**
 * The arrival, counted when a browser fetches the page's image. The image request must be what a
 * browser sends for an <img> on this site's own page — destination image, same origin, a referrer
 * on the canonical origin — from an agent that is not on the list above. Device and country come
 * from this request; page, source and kind from what the page's own request decided.
 */
export function classifyBeacon(
  req: { method: string; url: string; headers: { get(name: string): string | null } },
  canonicalOrigin: string,
  now = Date.now(),
  country = "??",
): Entry | null {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  if (url.origin !== canonicalOrigin || url.pathname !== BEACON_PATH) return null;
  const h = req.headers;
  if (h.get("sec-fetch-dest") !== "image" || h.get("sec-fetch-site") !== "same-origin") return null;
  let ref: URL | null = null;
  try { ref = h.get("referer") ? new URL(h.get("referer")!) : null; } catch { ref = null; }
  if (!ref || ref.origin !== canonicalOrigin) return null;
  const ua = h.get("user-agent") ?? "";
  if (!ua || AGENT.test(ua)) return null;
  const path = url.searchParams.get("p") ?? "", src = url.searchParams.get("s") ?? "", how = url.searchParams.get("h") ?? "";
  if (!path.startsWith("/") || path.length > 120 || !src || src.length > 80 || !HOW.has(how)) return null;
  return {
    day: new Date(now).toISOString().slice(0, 10),
    path, src, how: how as Entry["how"],
    device: /Mobi|Android|iPhone|iPad/.test(ua) ? "mobile" : "desktop",
    country: /^[A-Z]{2}$/.test(country) ? country : "??",
  };
}

/** The 1x1 transparent GIF the beacon answers with — never cached, so every arrival asks again. */
export const BEACON_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
