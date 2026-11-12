#!/usr/bin/env node
/**
 * POSTHOG'S SIDE OF THE ANALYTICS: THE DASHBOARD, THE FUNNELS AND THE COHORTS, AS CODE.
 *
 * public/analytics.js sends the events (12 November 2026); this script builds what reads them, in
 * project 328468 ("Coinliqui") on the EU cloud. It is idempotent: every object is found by its name and updated
 * in place, so running it twice leaves one of each, and editing a definition here and running it
 * again is how a funnel is changed.
 *
 * The key is a PostHog PERSONAL API key (phx_…), scoped to this project with insight, cohort and
 * dashboard write. It is read from the environment or from .dev.vars (gitignored) and never printed.
 *
 *   POSTHOG_PERSONAL_API_KEY=… node scripts/posthog-setup.mjs        (or put it in .dev.vars)
 *   node scripts/posthog-setup.mjs --dry                               prints what it would send
 *
 * WHAT A COHORT MEANS HERE. The site is cookieless: PostHog keys a visitor by a hash of IP, user
 * agent and a salt that changes daily, so a "person" is one visitor for one day. A cohort is
 * therefore "visitors who did X on the day they did it", never "people who came back".
 */
import { readFileSync, existsSync } from "node:fs";

const HOST = "https://eu.posthog.com";
/* 328468 "Coinliqui" is the project the site's public token writes to (checked 12 November 2026
   against the project's own token). 328340 "Sites + Wobl" is another project in the same
   organisation, shared by the owner's other sites; nothing from this site has gone there since 31 October. */
const PROJECT = 328468;
const dry = process.argv.includes("--dry");
const key = process.env.POSTHOG_PERSONAL_API_KEY ??
  (existsSync(".dev.vars") ? /^POSTHOG_PERSONAL_API_KEY=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim() : undefined);
if (!key && !dry && !process.argv.includes("--plan")) {
  console.error("No POSTHOG_PERSONAL_API_KEY in the environment or .dev.vars. Create one at\n" +
    `${HOST}/settings/user-api-keys (scopes: insight, cohort, dashboard — write; project ${PROJECT}),\n` +
    "put POSTHOG_PERSONAL_API_KEY=phx_… in .dev.vars, and run this again. Or --dry to see the definitions.");
  process.exit(2);
}

const api = async (method, path, body) => {
  if (dry && method !== "GET") { console.log(`  [dry] ${method} ${path}\n${JSON.stringify(body, null, 2).replace(/^/gm, "        ")}`); return { id: 0 }; }
  if (dry) return { results: [] };
  const r = await fetch(`${HOST}/api/projects/${PROJECT}${path}`, {
    method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
const findByName = async (kind, name) => {
  let url = `/${kind}/?limit=200&search=${encodeURIComponent(name)}`;
  const page = await api("GET", url);
  return (page.results ?? []).find((x) => x.name === name && !x.deleted) ?? null;
};
const upsert = async (kind, name, body) => {
  const found = await findByName(kind, name);
  const out = found ? await api("PATCH", `/${kind}/${found.id}/`, { name, ...body }) : await api("POST", `/${kind}/`, { name, ...body });
  console.log(`  ${found ? "updated" : "created"}  ${kind.slice(0, -1).padEnd(9)} ${name}${out.id ? `  #${out.id}` : ""}`);
  return out;
};

/* ---- the building blocks ---- */
const prop = (key, value, operator = "exact") => ({ key, value: Array.isArray(value) ? value : [value], operator, type: "event" });
/* EVERY SERIES IS HELD TO THIS SITE'S HOST, so a preview host, localhost or another site that
   borrowed the token never mixes into the figures. */
const SITE = { key: "$host", value: ["coinliqui.com"], operator: "exact", type: "event" };
const ev = (event, props = [], name) => ({ kind: "EventsNode", event, name: name ?? event, custom_name: name, properties: [SITE, ...props] });
const pv = (pageTypes, name) => ev("$pageview", [prop("page_type", pageTypes)], name);
const RANGE = { date_from: "-30d" };
const trends = (series, extra = {}) => ({ kind: "InsightVizNode", source: { kind: "TrendsQuery", series, interval: "day", dateRange: RANGE, ...extra } });
const funnel = (series, windowMinutes = 30) => ({
  kind: "InsightVizNode",
  source: { kind: "FunnelsQuery", series, dateRange: RANGE, funnelsFilter: { funnelWindowInterval: windowMinutes, funnelWindowIntervalUnit: "minute", funnelVizType: "steps" } },
});
const byProp = (breakdown) => ({ breakdownFilter: { breakdown, breakdown_type: "event" } });
const OWN = ["link_clicked", "outbound_clicked", "search_started", "search_result_clicked", "tool_result_viewed",
  "timeframe_changed", "table_sorted", "chart_explored", "watchlist_changed", "text_copied"];

/* ---- cohorts: visitor-days that did something ---- */
const did = (event, times = 1) => times === 1
  ? { type: "behavioral", key: event, value: "performed_event", event_type: "events", time_value: 30, time_interval: "day", event_filters: [SITE] }
  : { type: "behavioral", key: event, value: "performed_event_multiple", event_type: "events", operator: "gte", operator_value: times, time_value: 30, time_interval: "day", event_filters: [SITE] };
const cohort = (description, ...criteria) => ({
  description, is_static: false,
  filters: { properties: { type: "OR", values: [{ type: "AND", values: criteria }] } },
});
const COHORTS = {
  "Calculator users": cohort("Visitor-days on which a calculator or the liquidation map answered a question (tool_result_viewed).", did("tool_result_viewed")),
  "Searchers": cohort("Visitor-days that used the site search.", did("search_started")),
  "Chart explorers": cohort("Visitor-days that touched a chart or switched its time range.", did("chart_explored")),
  "Left for an exchange or source": cohort("Visitor-days that followed a link off the site.", did("outbound_clicked")),
  "Watchlist users": cohort("Visitor-days that pinned or unpinned a coin.", did("watchlist_changed")),
  "Read 3+ pages": cohort("Visitor-days with three or more page views.", did("$pageview", 3)),
  "Bounced (1 page)": cohort("Visitor-days with exactly one page view that followed no internal link.",
    { type: "behavioral", key: "$pageview", value: "performed_event_multiple", event_type: "events", operator: "exact", operator_value: 1, time_value: 30, time_interval: "day", event_filters: [SITE] },
    { ...did("link_clicked"), negation: true }),
};

/* ---- insights ---- */
const INSIGHTS = [
  ["Readers per day", trends([ev("$pageview", [], "Page views"), { ...ev("$pageview", [], "Visitors"), math: "dau" }])],
  ["Page views by page type", trends([ev("$pageview")], byProp("page_type"))],
  ["Page views by referring site", trends([ev("$pageview")], { breakdownFilter: { breakdown: "$referring_domain", breakdown_type: "event" } })],
  ["Arrivals from ChatGPT and other AI", trends([ev("$pageview", [prop("$referring_domain", "chatgpt|perplexity|claude|gemini|copilot", "regex")])], { breakdownFilter: { breakdown: "$referring_domain", breakdown_type: "event" } })],
  ["Page views by device", trends([ev("$pageview")], { breakdownFilter: { breakdown: "$device_type", breakdown_type: "event" } })],
  ["Page views by country", trends([ev("$pageview")], { breakdownFilter: { breakdown: "$geoip_country_code", breakdown_type: "event" } })],
  ["Top coins and contracts", trends([ev("$pageview", [prop("subject", "", "is_set")])], { ...byProp("subject"), trendsFilter: { display: "ActionsBarValue" } })],
  ["What readers do (site events)", trends(OWN.map((e) => ev(e)))],
  ["Calculator answers by tool", trends([ev("tool_result_viewed")], { ...byProp("tool"), trendsFilter: { display: "ActionsBarValue" } })],
  ["Outbound clicks by host", trends([ev("outbound_clicked")], { ...byProp("host"), trendsFilter: { display: "ActionsBarValue" } })],
  ["Internal links by area", trends([ev("link_clicked")], byProp("area"))],
  ["Most followed internal links", trends([ev("link_clicked")], { ...byProp("target"), trendsFilter: { display: "ActionsBarValue" } })],
  ["Time switches used", trends([ev("timeframe_changed")], { ...byProp("value"), trendsFilter: { display: "ActionsBarValue" } })],
  ["How far readers scroll (page leave)", trends([{ ...ev("$pageleave"), math: "median", math_property: "$prev_pageview_max_scroll_percentage" }], byProp("page_type"))],
  ["Page load (LCP, p75)", trends([{ ...ev("$web_vitals"), math: "p75", math_property: "$web_vitals_LCP_value" }], byProp("page_type"))],
  ["Readers by cohort", trends([{ ...ev("$pageview"), math: "dau" }], { breakdownFilter: { breakdown_type: "cohort", breakdown: "COHORTS" } })],
  /* funnels: one visitor within 30 minutes */
  ["Funnel: landing → second page", funnel([ev("$pageview", [], "Any page"), ev("link_clicked", [prop("area", ["body", "related", "nav"])], "Follows an internal link"), ev("$pageview", [], "Second page")])],
  ["Funnel: coin page → calculator answer", funnel([pv(["coin", "funding_contract", "liq_coin"], "Coin or contract page"), pv(["tool", "tools_index"], "Calculator page"), ev("tool_result_viewed", [], "Calculator answered")])],
  ["Funnel: funding table → contract → exchange", funnel([pv("funding_index", "Funding table"), pv("funding_contract", "Contract page"), ev("outbound_clicked", [], "Leaves for a venue or source")])],
  ["Funnel: liquidation map → explored → asked", funnel([pv(["liquidations", "liq_coin"], "Liquidation page"), ev("chart_explored", [], "Touches the map or chart"), ev("tool_result_viewed", [], "Asks the map a question")])],
  ["Funnel: search → result → page", funnel([ev("search_started", [], "Starts typing"), ev("search_result_clicked", [], "Picks a result"), ev("$pageview", [], "Lands on it")], 5)],
  ["Funnel: home → coin → funding", funnel([pv("home", "Home"), pv(["coin", "coins_index"], "Coins"), pv(["funding_index", "funding_contract"], "Funding")])],
  ["Funnel: learn → tool", funnel([pv("learn", "Guide"), pv(["tool", "liq_tool"], "Tool page"), ev("tool_result_viewed", [], "Tool answered")])],
];

const DASH = "Coinliqui — readers";
const DASH_BODY = {
  description: "Built by scripts/posthog-setup.mjs from the events in public/analytics.js, coinliqui.com only. Cookieless: a visitor is one browser for one day.",
  pinned: true,
};
if (!process.argv.includes("--plan")) console.log(`\nPostHog project ${PROJECT} on ${HOST}${dry ? "  [dry run: nothing is sent]" : ""}\n`);
/* --plan prints every definition as JSON, for a runner that holds a PostHog session instead of a key. */
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ project: PROJECT, cohorts: COHORTS, dashboard: { name: DASH, ...DASH_BODY }, insights: INSIGHTS }));
  process.exit(0);
}
const cohortIds = [];
for (const [name, body] of Object.entries(COHORTS)) cohortIds.push((await upsert("cohorts", name, body)).id);

const dash = await upsert("dashboards", DASH, DASH_BODY);
for (const [name, query] of INSIGHTS) {
  const q = JSON.parse(JSON.stringify(query));
  if (q.source.breakdownFilter?.breakdown === "COHORTS") q.source.breakdownFilter.breakdown = cohortIds.filter(Boolean);
  await upsert("insights", name, { query: q, dashboards: dash.id ? [dash.id] : [], saved: true });
}
console.log(`\n${Object.keys(COHORTS).length} cohorts, ${INSIGHTS.length} insights on one dashboard${dash.id ? `: ${HOST}/project/${PROJECT}/dashboard/${dash.id}` : ""}`);
