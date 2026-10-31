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
//   person_profiles "identified_only" and identify() is never called, so no person profile exists.
//   disable_session_recording        recordings cannot run in cookieless_mode "always" (posthog-js
//                                    throws if asked), and this site would not want them anyway.
//   capture_pageview / pageleave     a page view on load, and a page leave when the reader goes.
//   autocapture                      left at its default (on): clicks on links and buttons.
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
const TOKEN = "phc_s8RLYXFxEE89DCb3hnRoRdSCDTPauLCTnwJMAt2j9nfR"; // gitleaks:allow — public project token, see above

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
  person_profiles: "identified_only",
  disable_session_recording: true,
  capture_pageview: true,
  capture_pageleave: true,
  before_send: (event) => (event ? bare(event) : event),
};

let started = false;
const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"];
function start() {
  if (started) return;
  started = true;
  EVENTS.forEach((e) => removeEventListener(e, start, { passive: true }));
  /* PostHog's official HTML snippet, unchanged: a stub that queues calls and inserts
     https://eu-assets.i.posthog.com/static/array.js with async. */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(TOKEN, CONFIG);
}
EVENTS.forEach((e) => addEventListener(e, start, { passive: true, once: true }));
const schedule = () => {
  if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1200);
  setTimeout(start, 3000);
};
if (document.readyState === "complete") schedule();
else addEventListener("load", schedule, { once: true });
