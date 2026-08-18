#!/usr/bin/env node
/**
 * Zone configuration for coinliqui.com, as code rather than as clicks.
 *
 * Everything in DEPLOY.md steps 9–12 that the Cloudflare API will accept. Each action
 * reports on its own line and a refusal does not abort the run — the point is to end with
 * an accurate list of what the API set and what is left to click, rather than a stack trace
 * halfway through.
 *
 *   CF_ZONE_TOKEN=... node scripts/configure-zone.mjs [--dry]
 *
 * The token is read from the environment and never written anywhere. It needs, scoped to
 * this zone only: Zone Read, Zone Settings Edit, DNS Edit, Bot Management Edit,
 * Dynamic Redirect Edit, Email Routing Rules Edit, Analytics Read.
 *
 * Account-level calls (Pages custom domains, R2, email destinations) use the wrangler
 * OAuth token already on this machine, which is why they are not in the ask above.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/* NOT A SECRET, AND NOT FREE EITHER. An account id is an identifier rather than a credential —
   knowing it grants nothing, and Cloudflare prints them in its own examples. But it is a
   permanent, unrotatable handle on the owner's account, and it appears here only because two
   scripts need it in a URL path, so it costs nothing to take it from the environment instead
   of publishing it. The resource ids in wrangler.toml are a different case and stay: wrangler
   requires them to deploy at all, every public Cloudflare project commits them, and they
   confer no access. */
const ACCOUNT = process.env.CF_ACCOUNT_ID;
if (!ACCOUNT) { console.error("CF_ACCOUNT_ID is required — the Cloudflare account these calls address. Not defaulted on purpose."); process.exit(1); }
const APEX = "coinliqui.com";
const WWW = `www.${APEX}`;
const PROJECT = "coinliqui";
const BUCKET = "coinliqui-og";
const IMG = `img.${APEX}`;
/* NO DEFAULT. This carried a personal mailbox address as a fallback, in a PUBLIC repository —
   a private address published as surely as if it had been printed on a page. The destination is
   now required from the environment, and the script refuses to run without it rather than
   quietly reaching for someone's inbox. */
const FORWARD_TO = process.env.EMAIL_TO;
if (!FORWARD_TO && !process.argv.includes("--dry")) {
  console.error("EMAIL_TO is required — the address Email Routing should forward to. Not defaulted on purpose.");
  process.exit(1);
}
const DRY = process.argv.includes("--dry");

const zoneToken = process.env.CF_ZONE_TOKEN;
const acctToken = (() => {
  try {
    const s = readFileSync(`${homedir()}/.wrangler/config/default.toml`, "utf8");
    return /oauth_token\s*=\s*"([^"]+)"/.exec(s)?.[1] ?? null;
  } catch { return null; }
})();

const API = "https://api.cloudflare.com/client/v4";
async function cf(path, { method = "GET", body, token = zoneToken } = {}) {
  if (!token) return { success: false, errors: [{ message: "no token available for this call" }] };
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  try { return await r.json(); } catch { return { success: false, errors: [{ message: `HTTP ${r.status}` }] }; }
}

const results = [];
async function step(label, want, fn) {
  if (DRY) { console.log(`  DRY   ${label}  ->  ${want}`); return; }
  let res;
  try { res = await fn(); } catch (e) { res = { success: false, errors: [{ message: String(e) }] }; }
  const ok = res?.success === true;
  const why = ok ? "" : "  " + (res?.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
  results.push({ label, ok, why });
  console.log(`  ${ok ? "set  " : "CLICK"} ${label.padEnd(42)} ${want}${why}`);
  return res;
}

const zone = await (async () => {
  const r = await cf(`/zones?name=${APEX}`);
  return r.success && r.result?.[0] ? r.result[0] : null;
})();
if (!zone) {
  console.error(`No zone for ${APEX}, or the token cannot read it. Add the domain first.`);
  process.exit(1);
}
const Z = zone.id;
console.log(`zone ${APEX}  ${Z}  status=${zone.status}\n`);

console.log("9. domain and TLS");
await step("custom domain (apex)", APEX, () =>
  cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`, { method: "POST", body: { name: APEX }, token: acctToken }));
await step("custom domain (www)", WWW, () =>
  cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`, { method: "POST", body: { name: WWW }, token: acctToken }));
await step("SSL mode", "Full (strict)", () =>
  cf(`/zones/${Z}/settings/ssl`, { method: "PATCH", body: { value: "strict" } }));
await step("Always Use HTTPS", "on", () =>
  cf(`/zones/${Z}/settings/always_use_https`, { method: "PATCH", body: { value: "on" } }));
await step("Minimum TLS", "1.2", () =>
  cf(`/zones/${Z}/settings/min_tls_version`, { method: "PATCH", body: { value: "1.2" } }));
await step("www -> apex redirect", "301, query preserved", () =>
  cf(`/zones/${Z}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, {
    method: "PUT",
    body: {
      name: "redirects",
      rules: [{
        description: "www to apex",
        expression: `(http.host eq "${WWW}")`,
        action: "redirect",
        action_parameters: {
          from_value: {
            status_code: 301,
            target_url: { expression: `concat("https://${APEX}", http.request.uri.path)` },
            preserve_query_string: true,
          },
        },
      }],
    },
  }));

/* 10. The settings that decide whether this project is visible at all. Cloudflare has
   blocked AI crawlers by default on new zones since July 2025, so every one of these is
   a change away from the default, not a confirmation of it. */
console.log("\n10. crawler access");
await step("Bot Fight Mode", "OFF", () =>
  cf(`/zones/${Z}/bot_management`, { method: "PUT", body: { fight_mode: false } }));
await step("AI bots protection", "disabled", () =>
  cf(`/zones/${Z}/bot_management`, { method: "PUT", body: { ai_bots_protection: "disabled" } }));
await step("AI Labyrinth / crawler protection", "disabled", () =>
  cf(`/zones/${Z}/bot_management`, { method: "PUT", body: { crawler_protection: "disabled" } }));
await step("Browser Integrity Check", "OFF", () =>
  cf(`/zones/${Z}/settings/browser_check`, { method: "PATCH", body: { value: "off" } }));
await step("Security Level", "medium", () =>
  cf(`/zones/${Z}/settings/security_level`, { method: "PATCH", body: { value: "medium" } }));
/* Managed robots.txt is NOT a zone setting — the live zone answers "Undefined zone setting"
   for that name. It is `is_robots_txt_managed` inside the bot_management object, which is
   where Cloudflare also keeps the AI controls. Measured on the zone, not taken from docs. */
await step("Managed robots.txt", "OFF", () =>
  cf(`/zones/${Z}/bot_management`, { method: "PUT", body: { is_robots_txt_managed: false } }));
await step("content bots protection", "disabled", () =>
  cf(`/zones/${Z}/bot_management`, { method: "PUT", body: { content_bots_protection: "disabled" } }));

console.log("\n11. email routing");
await step("destination address", FORWARD_TO, () =>
  cf(`/accounts/${ACCOUNT}/email/routing/addresses`, { method: "POST", body: { email: FORWARD_TO }, token: acctToken }));
await step("enable email routing", "on", () =>
  cf(`/zones/${Z}/email/routing/enable`, { method: "POST", body: {} }));
await step("rule: hello@", `-> ${FORWARD_TO}`, () =>
  cf(`/zones/${Z}/email/routing/rules`, {
    method: "POST",
    body: {
      name: "hello", enabled: true,
      matchers: [{ type: "literal", field: "to", value: `hello@${APEX}` }],
      actions: [{ type: "forward", value: [FORWARD_TO] }],
    },
  }));
await step("catch-all", `-> ${FORWARD_TO}`, () =>
  cf(`/zones/${Z}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: { enabled: true, matchers: [{ type: "all" }], actions: [{ type: "forward", value: [FORWARD_TO] }] },
  }));

console.log("\n12. r2");
await step("R2 public domain", IMG, () =>
  cf(`/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/domains/custom`, {
    method: "POST", body: { domain: IMG, zoneId: Z, enabled: true }, token: acctToken,
  }));

if (!DRY) {
  const click = results.filter((r) => !r.ok);
  console.log(`\n${results.length - click.length}/${results.length} set by API.`);
  if (click.length) {
    console.log("Left to click in the dashboard:");
    for (const c of click) console.log(`  - ${c.label}${c.why}`);
  }
}
