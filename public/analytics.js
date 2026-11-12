// PRODUCT ANALYTICS: POSTHOG, EU CLOUD, COOKIELESS. Installed 31 October 2026 on the operator's
// instruction, replacing Google Analytics 4, which came out of the site the same day.
//
// WHY A FILE AND NOT AN INLINE BLOCK. Every page here carries a wire budget (scripts/verify-live.mjs,
// section 11) and several sit a few hundred bytes under it. An inline loader is paid on every page
// view; this file is fetched once, from this origin, and cached under its ?v= hash like the other
// scripts in public/. The page carries one <script type="module"> tag, which never blocks rendering.
//
// WHAT IT ASKS POSTHOG FOR, option by option:
//   cookieless_mode "always"         no cookie, no localStorage, no sessionStorage. PostHog counts a
//                                    unique visitor per day from a hash of the IP address, the user
//                                    agent and a salt that rotates daily, and stores neither the IP nor
//                                    the hash's inputs. The project-side cookieless setting is on too.
//   disable_session_recording        recordings cannot run in cookieless_mode "always" (posthog-js
//                                    throws if asked), and this site would not want them anyway.
//   capture_pageview / pageleave     a page view on load, and a page leave when the reader goes.
//   autocapture                      left at its default (on): clicks on links and buttons.
//   person_profiles "always"         (changed 12 November 2026, see THE SITE'S OWN EVENTS below) a
//                                    profile per daily hash, so cohorts and funnels can be built. It
//                                    holds nothing but what the events carry, and lasts one day:
//                                    the hash it is keyed by changes when the salt does.
//
// THE QUERY STRING DOES NOT LEAVE. The calculators submit as GET, so the figures a reader types are
// in the page's own URL. Google Analytics sent them until 31 August 2026, and /privacy promises that
// every counter here sees the origin and the path and nothing else. before_send rewrites every URL in
// an event (current URL, referrer, the URLs inside web-vitals payloads, and the page addresses that
// heatmap data is keyed by — keys, not values, so a value-only rewrite let /tools/…?size=… through)
// to origin + path. utm_source and
// the other campaign fields are read from the URL by posthog-js before this runs and travel as their own
// properties, so where a reader came from is kept and what they typed is not.
//
// THE WATCHLIST'S TABLE BODY CARRIES ph-no-capture. Autocapture would otherwise send "Pin BTC" with
// each press, and a click on a pinned row (pins sit on top) would say which coin is pinned, while
// /watchlist promises that the list never leaves the browser.
//
// LOADED AFTER THE PAGE HAS SETTLED. array.js is about 108 KB brotli and 340 KB of JavaScript to
// parse, on pages that are 7-90 KB in total. It is fetched on the first scroll, tap, key or pointer
// press, or when the browser goes idle after load, or 3 s after load, whichever comes first: the same
// trigger the Google tag had, for the same measured reason (src/lib/site.ts).
//
// The project token below is PUBLIC BY DESIGN: it ships to every browser and can only write events,
// never read them. gitleaks' generic rule reads any long string beside the word TOKEN as a secret, so
// the line carries gitleaks:allow — reviewed 31 October 2026, the same judgement .gitleaksignore
// records for the IndexNow key. Hosts: eu-assets.i.posthog.com serves the library, eu.i.posthog.com receives events.
// Both are named in the CSP in src/middleware.ts.
const TOKEN = "phc_B5wDvq5GLEoH6h7oUrSXup2KGNV6nquYH4V3eetWKhJr"; // gitleaks:allow — public project token, see above

const bare = (v) => {
  if (typeof v === "string") {
    if (!/^https?:\/\//i.test(v)) return v;
    try { const u = new URL(v); return u.origin + u.pathname; } catch { return v; }
  }
  if (v && typeof v === "object" && !(v instanceof Date)) {
    for (const k of Object.keys(v)) {
      const key = bare(k);
      const val = bare(v[k]);
      if (key === k) v[k] = val;
      else {
        delete v[k];
        // Two heatmap pages that differed only in their query string become one.
        v[key] = Array.isArray(v[key]) && Array.isArray(val) ? v[key].concat(val) : val;
      }
    }
  }
  return v;
};

const CONFIG = {
  api_host: "https://eu.i.posthog.com",
  ui_host: "https://eu.posthog.com",
  cookieless_mode: "always",
  person_profiles: "always",
  disable_session_recording: true,
  capture_pageview: true,
  capture_pageleave: true,
  before_send: (event) => (event ? bare(event) : event),
};


/* THE SITE'S OWN EVENTS (12 November 2026, on the operator's instruction: funnels, cohorts and
   dashboards in PostHog). Autocapture says "a link was clicked"; these say what the reader did, in
   names a funnel can be built from. Every property is chosen from what the page already shows or
   its address already says. NOTHING A READER TYPES IS SENT: not the search text, not a calculator's
   figures (the result page reports how many fields were filled, never what), and not which coin is
   pinned (watchlist_changed carries pin or unpin and nothing else). scripts/analytics-cases.mjs
   holds these rules, with a blind half that must fail on a version sending the query.

     page context (on every event)   page_type, subject — from the path
     link_clicked                    target path, area (nav, footer, related, search, body)
     outbound_clicked                host, area
     search_started                  once per page, on the first character typed
     search_result_clicked           target path, rank
     tool_result_viewed              tool, fields (a count) — a calculator or map answered a query
     timeframe_changed               group, control, value — a button's own label key (24h, 7d…)
     table_sorted                    column — the header's own words
     chart_explored                  chart — once per chart per page, on the first touch
     watchlist_changed               action: pin | unpin
     text_copied                     nothing but the page context */
const SEG = (path, i) => path.split("/").filter(Boolean)[i] ?? "";
export function pageType(path) {
  const a = SEG(path, 0), b = SEG(path, 1);
  if (!a) return "home";
  if (a === "coins") return b ? "coin" : "coins_index";
  if (a === "funding") return b ? "funding_contract" : "funding_index";
  if (a === "liquidations") return !b ? "liquidations" : b === "survival" || b === "sweep" ? "liq_tool" : "liq_coin";
  if (a === "tools") return b ? "tool" : "tools_index";
  if (a === "learn") return "learn";
  if (a === "methodology") return "methodology";
  if (a === "status") return "status";
  if (["watchlist", "open-interest", "unlocks"].includes(a)) return a.replace("-", "_");
  if (["about", "privacy", "terms", "data-sources", "retired"].includes(a)) return "info";
  return "other";
}
/** The coin or contract a page is about, from its path: /coins/solana → solana, /funding/btc → btc. */
export function subjectOf(path) {
  const t = pageType(path);
  return t === "coin" || t === "funding_contract" || t === "liq_coin" ? SEG(path, 1).toLowerCase().slice(0, 40) : "";
}
/** Pages whose query string is a reader's question; anything else's is a link's. */
const TOOL = (path) => ["tool", "liq_tool", "liquidations", "unlocks"].includes(pageType(path));
const CAMPAIGN = /^(utm_|gclid$|fbclid$|ref$)/;
/** On load: did a calculator or the map answer a question? Says how many fields, never what. */
export function toolResult(path, search) {
  if (!TOOL(path)) return null;
  const keys = [...new URLSearchParams(search).keys()].filter((k) => !CAMPAIGN.test(k));
  return keys.length ? { tool: path.replace(/\/+$/, "") || "/", fields: new Set(keys).size } : null;
}
/** A click on a link: inside the site the target path, outside it the host. Never a query. */
export function linkEvent(href, origin, area) {
  let u;
  try { u = new URL(href, origin); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.origin === origin) return { event: "link_clicked", props: { target: u.pathname.slice(0, 120), area } };
  return { event: "outbound_clicked", props: { host: u.hostname.slice(0, 80), area } };
}
/** Which part of the page a click came from. `el` needs closest() only. */
export function areaOf(el) {
  if (el.closest("#qr")) return "search";
  if (el.closest("footer")) return "footer";
  if (el.closest("nav, header")) return "nav";
  if (el.closest(".cards")) return "related";
  return "body";
}
const short = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

/* Events wait for the library rather than fetching it early: an event raised before start() sits
   here and is handed over by start(), so the load trigger above stays what it was. */
const pending = [];
function send(event, props = {}) {
  if (!started) return void pending.push([event, props]);
  window.posthog.capture(event, props, { transport: "sendBeacon" });
}
function wire() {
  const path = location.pathname;
  context = { page_type: pageType(path), subject: subjectOf(path) };
  const tr = toolResult(path, location.search);
  if (tr) send("tool_result_viewed", tr);

  const charted = new Set();
  let searched = false;
  addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const pin = el.closest("button.pin");
    if (pin) return send("watchlist_changed", { action: pin.getAttribute("aria-pressed") === "true" ? "unpin" : "pin" });
    const tf = el.closest("[data-tf], [data-mode]");
    if (tf) return send("timeframe_changed", {
      group: short(tf.closest("[data-tfgroup]")?.getAttribute("data-tfgroup")),
      control: tf.hasAttribute("data-tf") ? "tf" : "mode",
      value: short(tf.getAttribute("data-tf") ?? tf.getAttribute("data-mode")),
    });
    const sort = el.closest(".th-sort");
    if (sort) return send("table_sorted", { column: short(sort.textContent) });
    const a = el.closest("a[href]");
    if (!a) return;
    if (a.closest("#qr")) {
      const rank = [...a.parentElement.querySelectorAll("a")].indexOf(a) + 1;
      return send("search_result_clicked", { target: new URL(a.href).pathname.slice(0, 120), rank });
    }
    const ev = linkEvent(a.getAttribute("href"), location.origin, areaOf(a));
    if (ev) send(ev.event, ev.props);
  }, { capture: true });
  addEventListener("input", (e) => {
    if (searched || !(e.target instanceof Element) || e.target.id !== "q") return;
    searched = true;
    send("search_started");
  }, { capture: true });
  addEventListener("pointerdown", (e) => {
    const svg = e.target instanceof Element ? e.target.closest("svg") : null;
    if (!svg || svg.closest("a, button, nav")) return;
    const name = short(svg.getAttribute("data-heat") ? "liquidation-map" : svg.getAttribute("class") || svg.getAttribute("aria-label") || "chart");
    if (charted.has(svg)) return;
    charted.add(svg);
    send("chart_explored", { chart: name });
  }, { capture: true, passive: true });
  addEventListener("copy", () => send("text_copied"));
}

let started = false;
let context = null;
const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"];
function start() {
  if (started) return;
  started = true;
  EVENTS.forEach((e) => removeEventListener(e, start, { passive: true }));
  /* PostHog's official HTML snippet, unchanged: a stub that queues calls and inserts
     https://eu-assets.i.posthog.com/static/array.js with async. */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(TOKEN, CONFIG);
  if (context) window.posthog.register(context);
  pending.splice(0).forEach(([e, p]) => send(e, p));
}
if (typeof document !== "undefined") {
EVENTS.forEach((e) => addEventListener(e, start, { passive: true, once: true }));
const schedule = () => {
  if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1200);
  setTimeout(start, 3000);
};
if (document.readyState === "complete") schedule();
else addEventListener("load", schedule, { once: true });
wire();
}
