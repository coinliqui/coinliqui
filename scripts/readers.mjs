#!/usr/bin/env node
/**
 * WHO ACTUALLY READ THE SITE — without a dashboard, and without a login.
 *
 * WHY THIS EXISTS. The reader analytics live in the Cloudflare dashboard, and the operator
 * signed up for Cloudflare with GitHub social login. GitHub then flagged the account, so the
 * login route is unavailable while the appeal sits in a queue somebody else controls. The
 * ACCOUNT is fine — not suspended, no 2FA lock, and the API answers normally — but the only
 * published way to look at the numbers went through a door that will not open.
 *
 * A measurement that depends on a third party's login is a measurement that can be taken away.
 * This reads the same figures over the API, with the wrangler OAuth token already on this
 * machine, and prints them. It needs no dashboard, no API token created by hand, and nothing
 * the operator has to sign into.
 *
 * THE SITE TAG IS RESOLVED BY HOSTNAME, NEVER FROM THE BEACON. The `token` in the injected
 * <script data-cf-beacon> tag is NOT the site tag the data lands under: on this site the markup
 * carries e81f315a… while every recorded pageload arrives under 0dd9cf22…. Reading the token out
 * of the page and filtering on it returns an empty result set that looks exactly like "nobody
 * visited" — which it did, twice, before the two were compared. So the host is the key.
 *
 * TODAY IS READ AT HOUR GRANULARITY, and that is not decoration. The daily rollup lags: measured
 * on 27 August 2026, four pageloads were visible per-minute within seconds and still absent from
 * the by-date aggregate half an hour later. A report that only asked for days would have shown a
 * live site as silent.
 *
 *   node scripts/readers.mjs [--days 30]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const HOST = "coinliqui.com";
const DAYS = Math.max(1, Math.min(90, Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 30));

const cfg = `${homedir()}/.wrangler/config/default.toml`;
let src = "";
try { src = readFileSync(cfg, "utf8"); } catch {
  console.error(`no ${cfg} — run: npx wrangler login`);
  process.exit(1);
}
const token = (src.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
const expiry = (src.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1];
if (!token) { console.error("no oauth_token in the wrangler config — run: npx wrangler login"); process.exit(1); }
if (expiry && Date.parse(expiry) < Date.now()) {
  /* The credential lesson this project learned three times: check the timestamp before
     reasoning about permissions. Any wrangler command refreshes it. */
  console.error(`the wrangler token lapsed ${Math.round((Date.now() - Date.parse(expiry)) / 1000)}s ago — run: npx wrangler whoami, then this again`);
  process.exit(1);
}

const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const gql = async (query, variables) => {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: H, body: JSON.stringify({ query, variables }),
  }).then((x) => x.json());
  if (r.errors) { console.error(`graphql: ${JSON.stringify(r.errors).slice(0, 400)}`); process.exit(1); }
  return r.data.viewer.accounts[0];
};

const accounts = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: H }).then((r) => r.json());
if (!accounts.success) { console.error(`accounts: ${JSON.stringify(accounts.errors).slice(0, 300)}`); process.exit(1); }
const ACCOUNT = accounts.result[0].id;

const iso = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const pad = (n, w) => String(n).padStart(w);

console.log(`\n=== Readers · ${HOST} · last ${DAYS} days ===\n`);

/* ---- 1. by day, split bot from human -------------------------------------------------- */
const byDay = await gql(`query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
  rumPageloadEventsAdaptiveGroups(limit:500, filter:{datetime_geq:$s, datetime_leq:$e}, orderBy:[date_ASC]){
    count sum{visits} dimensions{date requestHost bot}
  }
}}}`, { a: ACCOUNT, s: iso(DAYS), e: iso(0) });

const days = new Map();
for (const g of byDay.rumPageloadEventsAdaptiveGroups) {
  if (g.dimensions.requestHost !== HOST) continue;
  const d = g.dimensions.date;
  const row = days.get(d) ?? { human: 0, bot: 0, visits: 0 };
  /* `bot` is Cloudflare's own classification of the client that ran the beacon. A script that
     does not execute JavaScript never appears here at all, so this column is small by
     construction — it is the ones that DO run it. */
  if (g.dimensions.bot) row.bot += g.count; else { row.human += g.count; row.visits += g.sum.visits; }
  days.set(d, row);
}
console.log("1. page views per day");
if (!days.size) {
  console.log("   no pageloads recorded in this window at all");
} else {
  console.log("   date         views   visits   (bot)");
  for (const [d, r] of [...days].sort()) console.log(`   ${d}  ${pad(r.human, 6)}  ${pad(r.visits, 7)}  ${pad(r.bot, 6)}`);
  const tot = [...days.values()].reduce((a, r) => ({ h: a.h + r.human, v: a.v + r.visits }), { h: 0, v: 0 });
  console.log(`   ${"total".padEnd(11)}  ${pad(tot.h, 6)}  ${pad(tot.v, 7)}`);
}

/* ---- 2. today, at the hour, because the daily rollup lags ------------------------------ */
const today = await gql(`query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
  rumPageloadEventsAdaptiveGroups(limit:200, filter:{datetime_geq:$s, datetime_leq:$e}, orderBy:[datetimeHour_ASC]){
    count dimensions{datetimeHour requestHost}
  }
}}}`, { a: ACCOUNT, s: iso(1), e: iso(0) });
const hours = today.rumPageloadEventsAdaptiveGroups.filter((g) => g.dimensions.requestHost === HOST);
console.log("\n2. the last 24 hours, by hour");
console.log(hours.length
  ? "   " + hours.map((g) => `${g.dimensions.datetimeHour.slice(11, 16)} ${g.count}`).join("   ")
  : "   nothing in the last 24 hours");
console.log("   (this is the honest reading for today — the by-date table above lags behind it)");

/* ---- 3. what they read, where they came from, where they are --------------------------- */
const facet = async (dim, label, n = 10) => {
  const d = await gql(`query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
    rumPageloadEventsAdaptiveGroups(limit:200, filter:{datetime_geq:$s, datetime_leq:$e}, orderBy:[count_DESC]){
      count dimensions{${dim} requestHost}
    }
  }}}`, { a: ACCOUNT, s: iso(DAYS), e: iso(0) });
  const rows = d.rumPageloadEventsAdaptiveGroups.filter((g) => g.dimensions.requestHost === HOST);
  console.log(`\n${label}`);
  if (!rows.length) { console.log("   nothing recorded"); return; }
  for (const g of rows.slice(0, n)) console.log(`   ${pad(g.count, 5)}  ${String(g.dimensions[dim] ?? "—") || "(none)"}`);
};
await facet("requestPath", "3. most read pages");
/* An empty refererHost is a direct arrival — typed, bookmarked, or from an app that strips it.
   Printed rather than dropped: on a site with no inbound links that row IS the finding. */
await facet("refererHost", "4. where they came from  (blank = direct or referrer stripped)");
await facet("countryName", "5. countries", 8);
await facet("deviceType", "6. devices", 5);

/* THE ACCOUNT NAME IS NOT PRINTED, AND THAT IS DELIBERATE. Cloudflare names a personal account
   after the email that created it, so `accounts.result[0].name` is the operator's private
   mailbox — the exact string that was harvested out of this project's git metadata once already.
   Console output gets pasted into issues and screenshots. The account id is enough to say which
   account answered, and it is an identifier rather than a contact route. */
console.log(`\nRead over the API with the wrangler OAuth token — no dashboard login involved.`);
console.log(`Account ${ACCOUNT.slice(0, 8)}… · site resolved by host, not by the beacon token.\n`);
