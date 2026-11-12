#!/usr/bin/env node
/**
 * THE SITE'S OWN POSTHOG EVENTS, ON WHAT THEY MAY CARRY.
 *
 * public/analytics.js raises named events for funnels and cohorts (12 November 2026). /privacy
 * promises that nothing a reader types reaches PostHog: not a calculator's figures, not the search
 * text, not which coins are pinned. These cases feed the event builders the inputs that would leak
 * if a builder copied what it was given, and fail if any typed value comes back in a property.
 * A source check covers the parts that read the DOM: no `.value` is read anywhere in the events.
 *
 * The blind half runs the same cases through the obvious first version — send the link as written
 * and the calculator's parameters as they are — and must fail.
 *
 *   node scripts/analytics-cases.mjs
 *   node scripts/analytics-cases.mjs --blind
 */
import { readFileSync } from "node:fs";
import * as real from "../public/analytics.js";

const blind = process.argv.includes("--blind");
const naive = {
  ...real,
  linkEvent: (href, origin, area) => ({ event: "link_clicked", props: { target: href, area } }),
  toolResult: (path, search) => ({ tool: path, ...Object.fromEntries(new URLSearchParams(search)) }),
};
const m = blind ? naive : real;
const ORIGIN = "https://coinliqui.com";
const TYPED = ["12500", "37.5", "0.0042", "my-secret-note"];
const leaks = (o) => TYPED.filter((t) => JSON.stringify(o ?? {}).includes(t));

let bad = 0;
const ok = (cond, what) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${what}`); if (!cond) bad++; };

console.log(`\nanalytics events carry nothing a reader typed${blind ? "  [BLIND: links and parameters sent as given]" : ""}\n`);
const tr = m.toolResult("/tools/liquidation-price", "?entry=12500&lev=37.5&mm=0.0042&utm_source=chatgpt.com");
ok(tr && leaks(tr).length === 0, "a calculator's result reports the tool, never the figures typed into it");
ok(tr && tr.fields === 3, "and counts the fields filled, leaving the campaign tag out");
ok(m.toolResult("/funding/btc", "?tf=7d") === null, "a contract page's own time switch is not a calculator result");
ok(m.toolResult("/tools/leverage", "?utm_source=x") === null, "a link's campaign tag alone is not a question asked");
const inl = m.linkEvent("/tools/leverage?size=12500&note=my-secret-note", ORIGIN, "body");
ok(inl && inl.event === "link_clicked" && inl.props.target === "/tools/leverage" && !leaks(inl).length,
  "an internal link with figures in it reports the path only");
const out = m.linkEvent("https://www.bybit.com/trade?amount=12500", ORIGIN, "body");
ok(out && out.event === "outbound_clicked" && out.props.host === "www.bybit.com" && !leaks(out).length,
  "an outbound link reports the host only");
ok(m.linkEvent("mailto:x@y.z", ORIGIN, "footer") === null, "a mail link is not a page and is not sent");
ok(m.pageType("/liquidations/sweep") === "liq_tool" && m.pageType("/liquidations/eth") === "liq_coin" && m.pageType("/") === "home",
  "pages are typed from their path");
ok(m.subjectOf("/tools/leverage") === "" && m.subjectOf("/funding/BTC") === "btc", "only coin and contract pages have a subject");

const src = readFileSync(new URL("../public/analytics.js", import.meta.url), "utf8");
const events = src.slice(src.indexOf("THE SITE'S OWN EVENTS"), src.indexOf("let started"));
ok(!/\.value\b/.test(events), "the event code reads no form field's value (search text, calculator input)");
ok(/watchlist_changed", \{ action:/.test(events) && !/data-sym|dataset\.sym/.test(events), "a pin reports pin or unpin, never the coin");
ok(/send\("search_started"\)/.test(events), "search_started carries no properties");

if (blind) {
  if (!bad) { console.error("\nBLIND: the naive version passed. These cases cannot see a leak."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against sending links and parameters as given`);
  process.exit(0);
}
if (bad) { console.error(`\nanalytics cases FAILED: ${bad}`); process.exit(1); }
console.log("\nanalytics cases: every event carries paths, hosts, counts and labels — nothing typed");
