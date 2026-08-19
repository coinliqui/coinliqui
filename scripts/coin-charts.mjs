#!/usr/bin/env node
/**
 * EVERY COIN PAGE, EVERY TIMEFRAME, ON THE LIVE SITE.
 *
 * The chart on a coin page is server-rendered SVG, so "does it render" is answerable without a
 * browser — but only if the question is asked properly. A panel can be present, an axis can be
 * drawn, a polyline can exist, and the thing a reader sees can still be wrong in ways markup
 * presence does not detect: two points where there should be three hundred, a flat line because
 * every close is identical, an axis scaled to a range the data does not occupy, a newest bar
 * from last week, or a stated bar count that disagrees with the bars actually plotted.
 *
 * So this reads the DATA the chart was drawn from — the crosshair payload, which is by design
 * the same array the SVG was generated from, so the two cannot disagree — and asks whether it
 * is a chart. Six timeframes on ten pages is sixty renders, which is exactly the number nobody
 * checks by hand and therefore the number that has never been checked.
 *
 * WHAT "MISLEADINGLY SPARSE" MEANS HERE, because it is the assertion with judgement in it. A
 * short series is not a defect: spot history is fourteen days hourly and about a year daily, so
 * 4H legitimately holds 88 bars rather than the 180 the timeframe table allows for. The defect
 * would be drawing 88 bars while telling the reader something else. The page prints its own
 * count ("88 4-hour bars"), so the test is that the printed count equals the plotted count —
 * the page saying what it has, rather than the page having what it claims.
 *
 *   node scripts/coin-charts.mjs [origin]
 *   node scripts/coin-charts.mjs --blind     # prove every assertion above can fail
 */
const ORIGIN = (process.argv.find((a) => a.startsWith("http")) ?? "https://coinliqui.com").replace(/\/$/, "");
const BLIND = process.argv.includes("--blind");

/* Identify honestly and ask the way a browser asks. The accept header is load-bearing for
   other reasons on this site (see scripts/verify-live.mjs); here it is simply correct. */
const UA = "Mozilla/5.0 (+https://coinliqui.com/about; coinliqui-selfcheck)";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/* SPOT HAS NO 15-MINUTE SERIES, so a coin page offers six of the eight timeframes. That is not
   a shortfall to be tolerated — it is the correct set, and a page offering 15m would be a button
   that empties the chart. Both directions are asserted. */
const EXPECTED_TFS = ["1h", "4h", "12h", "1d", "1w", "1m"];
const NOMINAL_MS = { "1h": 3.6e6, "4h": 1.44e7, "12h": 4.32e7, "1d": 8.64e7, "1w": 6.048e8, "1m": 2.592e9 };
const UNAVAILABLE_TF = "15m";   // offered on perp pages, impossible on spot
const FALLBACK_TF = "1h";       // what an unavailable timeframe must resolve to
const DEFAULT_TF = "1d";        // what an unparseable one must resolve to

let failures = 0;
const bad = (m) => { failures++; console.log("   FAIL  " + m); };
const ok = (m) => console.log("   ok    " + m);

async function get(path) {
  const r = await fetch(`${ORIGIN}${path}${path.includes("?") ? "&" : "?"}cb=${Date.now()}${Math.random().toString(36).slice(2)}`, {
    headers: { "user-agent": UA, accept: ACCEPT, "accept-language": "en-GB,en;q=0.9" },
  });
  return { status: r.status, body: await r.text() };
}

/* ---------------------------------------------------------------------------------------
   PARSE. Everything the assertions need, pulled out once, so a mutated copy of this object
   is a fixture and the assertions do not have to know they are being lied to.
   --------------------------------------------------------------------------------------- */
export function parsePage(html) {
  const buttons = [...html.matchAll(/<button[^>]*data-tf="([^"]+)"[^>]*aria-pressed="(true|false)"/g)]
    .map((m) => ({ tf: m[1], pressed: m[2] === "true" }));
  const svgs = [...html.matchAll(/data-xhair="cpts-([^"]+)"/g)].map((m) => m[1]);
  const rangeM = html.match(/data-prange="([-\d.eE]+),([-\d.eE]+)"/);
  const plotM = html.match(/data-plot="([\d,]+)"/);
  const axxM = html.match(/data-axx="([\d.]+)"/);
  const jsonM = [...html.matchAll(/<script type="application\/json" id="cpts-([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)];
  const statM = html.match(/over <b[^>]*data-tfstat[^>]*>([^<]*)</);
  let points = null;
  if (jsonM.length === 1) { try { points = JSON.parse(jsonM[0][2]); } catch { points = "unparseable"; } }
  return {
    buttons,
    active: buttons.find((b) => b.pressed)?.tf ?? null,
    svgTfs: svgs,
    prange: rangeM ? [Number(rangeM[1]), Number(rangeM[2])] : null,
    plot: plotM ? plotM[1].split(",").map(Number) : null,
    axx: axxM ? Number(axxM[1]) : null,
    jsonTfs: jsonM.map((m) => m[1]),
    points,
    stat: statM ? statM[1].trim() : null,
  };
}

/* One pure function, so the blind cases exercise the same code the live sweep does. Returns a
   list of complaints; empty means the chart on that page at that timeframe is a chart. */
export function chartFaults(p, wantTf, now = Date.now()) {
  const f = [];
  const T = 1, H = 3, L = 4, C = 5;

  const offered = p.buttons.map((b) => b.tf);
  const missing = EXPECTED_TFS.filter((t) => !offered.includes(t));
  const extra = offered.filter((t) => !EXPECTED_TFS.includes(t));
  if (missing.length) f.push(`timeframe button(s) absent: ${missing.join(", ")}`);
  if (extra.length) f.push(`timeframe button(s) offered that spot cannot serve: ${extra.join(", ")}`);
  if (p.buttons.filter((b) => b.pressed).length !== 1) f.push(`${p.buttons.filter((b) => b.pressed).length} timeframes marked active — exactly one must be`);
  if (p.active !== wantTf) f.push(`asked for tf=${wantTf}, page rendered tf=${p.active} — the switch did not switch`);

  if (p.svgTfs.length !== 1) f.push(`${p.svgTfs.length} chart panels rendered — exactly one must be`);
  else if (p.svgTfs[0] !== p.active) f.push(`panel is cpts-${p.svgTfs[0]} while the active timeframe is ${p.active}`);
  if (p.jsonTfs.length !== 1) f.push(`${p.jsonTfs.length} crosshair payloads — exactly one must be`);
  else if (p.jsonTfs[0] !== p.active) f.push(`payload is cpts-${p.jsonTfs[0]} while the active timeframe is ${p.active}`);

  if (p.points === "unparseable") { f.push("crosshair payload is not valid JSON"); return f; }
  if (!Array.isArray(p.points)) { f.push("no crosshair payload at all — the panel has no data behind it"); return f; }
  if (p.points.length < 2) { f.push(`${p.points.length} plotted point(s) — that is not a chart`); return f; }

  /* THE STATED COUNT IS THE PROMISE. A short series is honest; a wrong number beside it is not. */
  const stated = Number((p.stat ?? "").match(/^([\d,]+)/)?.[1].replace(/,/g, "") ?? NaN);
  if (!Number.isFinite(stated)) f.push(`the page states no bar count ("${p.stat}")`);
  else if (stated !== p.points.length) f.push(`page says ${stated} bars, ${p.points.length} are plotted`);

  const closes = p.points.map((q) => q[C]);
  const lows = p.points.map((q) => q[L]);
  const highs = p.points.map((q) => q[H]);
  if (!closes.every((v) => Number.isFinite(v) && v > 0)) f.push("a plotted close is not a positive finite number");
  const distinct = new Set(closes).size;
  if (distinct < 3) f.push(`${distinct} distinct close(s) across ${closes.length} bars — that is a flat line, not a price`);
  const lo = Math.min(...lows), hi = Math.max(...highs);
  if (hi > 0 && (hi - lo) / hi < 1e-6) f.push(`price range is ${((hi - lo) / hi * 100).toFixed(6)}% of price — nothing to see`);

  /* THE AXIS MUST BE SCALED TO THE DATA, PADDED BY EXACTLY THE STATED AMOUNT.
     The first version of this asserted the range EQUALLED the data's own min and max, and
     reported 60 failures across every page and both chart modes — a defect so uniform it could
     only be the check. src/lib/series.ts:157 pads by 4.5% of the span on each side, with the
     low clamped at zero, so a line never touches the panel edge. That is a deliberate design
     value, so the assertion is the design value rather than a tolerance band: a padding change
     is a decision and should have to be made here too. Too wide and the line flattens inside
     its own panel; too narrow and it clips. */
  const PAD = 0.045;
  if (!p.prange) f.push("the panel declares no price range");
  else {
    const sp = hi - lo;
    const wantLo = Math.max(0, lo - sp * PAD), wantHi = hi + sp * PAD;
    const tol = Math.max(sp * 1e-6, Math.abs(hi) * 1e-9);
    if (Math.abs(p.prange[0] - wantLo) > tol || Math.abs(p.prange[1] - wantHi) > tol)
      f.push(`axis range [${p.prange[0]}, ${p.prange[1]}] is not the data's [${lo}, ${hi}] padded by ${PAD * 100}% — expected [${wantLo}, ${wantHi}]`);
  }

  const ts = p.points.map((q) => q[T]);
  if (!ts.every((v, i) => i === 0 || v > ts[i - 1])) f.push("timestamps are not strictly increasing — bars are out of order or duplicated");
  const nominal = NOMINAL_MS[p.active] ?? NOMINAL_MS[wantTf];
  const age = now - ts[ts.length - 1];
  if (age > nominal + 3 * 3.6e6) f.push(`newest bar opened ${(age / 3.6e6).toFixed(1)}h ago — stale for a ${p.active} chart`);
  if (age < -60_000) f.push(`newest bar is ${(-age / 6e4).toFixed(0)} min in the future`);

  const xs = p.points.map((q) => q[0]);
  if (!xs.every((v, i) => i === 0 || v > xs[i - 1])) f.push("plotted x coordinates are not increasing — the picture is not the series");
  /* data-plot IS [x, y, WIDTH, HEIGHT], not [x0, y0, x1, y1]. Read as corners it puts the right
     edge at 1164 instead of 1180 and every page fails by sixteen pixels — which is what it did.
     src/lib/series.ts builds it from plotX/plotW and publishes the right edge separately as
     data-axx; the two agreeing is now part of the assertion rather than an assumption. */
  if (p.plot) {
    const [x0, , w] = p.plot, x1 = x0 + w;
    if (p.axx !== null && p.axx !== x1) f.push(`data-axx=${p.axx} disagrees with the plot box right edge ${x1}`);
    if (xs[0] < x0 - 1 || xs[xs.length - 1] > x1 + 1) f.push(`points fall outside the plot box ${x0}..${x1}: ${xs[0]}..${xs[xs.length - 1]}`);
  }
  return f;
}

/* Gaps are REPORTED, not failed, and the OLDEST one is excluded because it is arithmetic rather
   than data. aggregate() in src/lib/series.ts buckets BACKWARDS from the newest bar, so the
   first bucket is whatever is left over and is short by construction — which is why every
   aggregated timeframe showed exactly one off-nominal gap per page, on all ten pages, in the
   first run. One identical anomaly everywhere is a property of the code, not of the market.
   An INTERIOR off-nominal gap is different: that is a hole in the upstream hourly or daily
   series, worth naming and not worth failing a page over. */
export function gapReport(points, tf) {
  const nominal = NOMINAL_MS[tf];
  const gaps = points.slice(1).map((q, i) => q[1] - points[i][1]);
  const interior = gaps.slice(1);
  const off = interior.filter((g) => Math.abs(g - nominal) > nominal * 0.05);
  const leadShort = gaps.length && Math.abs(gaps[0] - nominal) > nominal * 0.05;
  return { off: off.length, total: interior.length, leadShort,
           worstH: off.length ? Math.max(...off.map((g) => Math.abs(g - nominal))) / 3.6e6 : 0 };
}

if (BLIND) {
  /* ------------------------------------------------------------------------------------
     THE HALF THAT PROVES THE OTHER HALF. Sixty green rows mean nothing unless each assertion
     has been shown to go red. One clean fixture, then one mutation per assertion.
     ------------------------------------------------------------------------------------ */
  const t0 = Date.UTC(2026, 7, 18, 0, 0, 0);
  const clean = {
    buttons: EXPECTED_TFS.map((tf) => ({ tf, pressed: tf === "1h" })),
    active: "1h", svgTfs: ["1h"], jsonTfs: ["1h"],
    plot: [16, 16, 1164, 476], axx: 1180,
    points: Array.from({ length: 24 }, (_, i) => [16 + i * 40, t0 + i * 3.6e6, 100 + i, 101 + i, 99 + i, 100.5 + i, 5, null, 200]),
    /* lows 99..122, highs 101..124 -> span 25, padded 4.5% each side */
    prange: [99 - 25 * 0.045, 124 + 25 * 0.045],
    stat: "24 hourly bars",
  };
  const NOW = t0 + 24 * 3.6e6;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cases = [
    ["the clean fixture stays silent", clean, null],
    ["a timeframe button missing", (() => { const c = clone(clean); c.buttons = c.buttons.filter((b) => b.tf !== "12h"); return c; })(), /button\(s\) absent/],
    ["a button spot cannot serve", (() => { const c = clone(clean); c.buttons.push({ tf: "15m", pressed: false }); return c; })(), /cannot serve/],
    ["two timeframes marked active", (() => { const c = clone(clean); c.buttons[2].pressed = true; return c; })(), /marked active/],
    ["the switch did not switch", (() => { const c = clone(clean); c.active = "4h"; c.svgTfs = ["4h"]; c.jsonTfs = ["4h"]; return c; })(), /did not switch/],
    ["panel and payload disagree", (() => { const c = clone(clean); c.svgTfs = ["4h"]; return c; })(), /panel is cpts-4h/],
    ["two panels rendered", (() => { const c = clone(clean); c.svgTfs = ["1h", "4h"]; return c; })(), /chart panels rendered/],
    ["no payload at all", (() => { const c = clone(clean); c.points = null; return c; })(), /no crosshair payload/],
    ["payload is not JSON", (() => { const c = clone(clean); c.points = "unparseable"; return c; })(), /not valid JSON/],
    ["a single point", (() => { const c = clone(clean); c.points = c.points.slice(0, 1); return c; })(), /not a chart/],
    ["stated count disagrees", (() => { const c = clone(clean); c.stat = "300 hourly bars"; return c; })(), /page says 300 bars/],
    ["no stated count", (() => { const c = clone(clean); c.stat = "hourly bars"; return c; })(), /states no bar count/],
    ["a flat line", (() => { const c = clone(clean); c.points.forEach((q) => { q[3] = 100; q[4] = 100; q[5] = 100; }); c.prange = [100, 100]; return c; })(), /flat line/],
    ["a close that is not a number", (() => { const c = clone(clean); c.points[5][5] = null; return c; })(), /not a positive finite number/],
    ["axis wider than the data", (() => { const c = clone(clean); c.prange = [0, 1000]; return c; })(), /is not the data's/],
    ["axis unpadded — the line touches the edge", (() => { const c = clone(clean); c.prange = [99, 124]; return c; })(), /is not the data's/],
    ["data-axx disagrees with the plot box", (() => { const c = clone(clean); c.axx = 1164; return c; })(), /disagrees with the plot box/],
    ["no axis range", (() => { const c = clone(clean); c.prange = null; return c; })(), /declares no price range/],
    ["bars out of order", (() => { const c = clone(clean); const t = c.points[3][1]; c.points[3][1] = c.points[9][1]; c.points[9][1] = t; return c; })(), /not strictly increasing/],
    ["a stale newest bar", (() => { const c = clone(clean); c.points.forEach((q) => { q[1] -= 9 * 3.6e6; }); return c; })(), /stale for a 1h chart/],
    ["a bar in the future", (() => { const c = clone(clean); c.points[c.points.length - 1][1] = NOW + 2 * 3.6e6; return c; })(), /in the future/],
    ["x coordinates not increasing", (() => { const c = clone(clean); c.points[7][0] = 5; return c; })(), /x coordinates are not increasing/],
    ["points outside the plot box", (() => { const c = clone(clean); c.points[0][0] = -50; return c; })(), /outside the plot box/],
    ["a point past the right edge", (() => { const c = clone(clean); c.points[c.points.length - 1][0] = 1200; return c; })(), /outside the plot box/],
  ];
  let blind = 0;
  for (const [name, fixture, want] of cases) {
    const f = chartFaults(fixture, "1h", NOW);
    const hit = want ? f.some((m) => want.test(m)) : f.length === 0;
    if (!hit) { blind++; console.log(`  BLIND  ${name}`); console.log(`         got: ${f.length ? f.join(" | ") : "(silent)"}`); }
    else console.log(`  ok     ${want ? "FIRES  " : "SILENT "} ${name}`);
  }
  console.log(blind ? `\n  ${blind} BLIND SPOT(S)\n` : `\n  ${cases.length} cases: every assertion fires on its fault and the clean fixture stays silent\n`);
  process.exit(blind ? 1 : 0);
}

/* ---------------------------------------------------------------------------------------
   THE LIVE SWEEP.
   --------------------------------------------------------------------------------------- */
console.log(`=== ${ORIGIN} — every coin page, every timeframe ===\n`);

const sm = await get("/sitemaps/coins.xml");
const slugs = [...sm.body.matchAll(/<loc>[^<]*\/coins\/([^<\/]+)<\/loc>/g)].map((m) => m[1]);
if (!slugs.length) { bad("no coin pages found in /sitemaps/coins.xml — nothing was verified"); process.exit(1); }
console.log(`1. ${slugs.length} coin pages x ${EXPECTED_TFS.length} timeframes = ${slugs.length * EXPECTED_TFS.length} renders\n`);

const rows = [];
for (const slug of slugs) {
  for (const tf of EXPECTED_TFS) {
    const r = await get(`/coins/${slug}?tf=${tf}`);
    if (r.status !== 200) { bad(`/coins/${slug}?tf=${tf} returned ${r.status}`); continue; }
    const p = parsePage(r.body);
    const f = chartFaults(p, tf);
    const g = Array.isArray(p.points) && p.points.length > 1 ? gapReport(p.points, tf) : null;
    rows.push({ slug, tf, n: Array.isArray(p.points) ? p.points.length : 0, stat: p.stat, faults: f, gaps: g,
                newestH: Array.isArray(p.points) && p.points.length ? (Date.now() - p.points[p.points.length - 1][1]) / 3.6e6 : NaN });
    if (f.length) f.forEach((m) => bad(`/coins/${slug}?tf=${tf} — ${m}`));
  }
}
if (!rows.some((r) => r.faults.length)) ok(`all ${rows.length} renders: one panel, one payload, the requested timeframe, a real varying series, an axis that matches it, and a current newest bar`);

console.log("\n2. what each timeframe actually holds");
for (const tf of EXPECTED_TFS) {
  const rs = rows.filter((r) => r.tf === tf);
  if (!rs.length) continue;
  const ns = rs.map((r) => r.n);
  const offs = rs.reduce((a, r) => a + (r.gaps?.off ?? 0), 0);
  const same = new Set(ns).size === 1;
  console.log(`   ${tf.padEnd(4)} ${same ? `${ns[0]} bars on all ${rs.length}` : `${Math.min(...ns)}-${Math.max(...ns)} bars`}`.padEnd(34)
    + `newest ${Math.max(...rs.map((r) => r.newestH)).toFixed(1)}h old at worst`.padEnd(30)
    + (offs ? `${offs} interior gap(s) in the upstream series` : "no interior gaps")
    + (rs.every((r) => r.gaps?.leadShort) ? " · oldest bucket short by construction" : ""));
}
const short = rows.filter((r) => r.n < 20);
console.log("\n3. sparse series, and whether the page says so");
if (!short.length) ok("no coin/timeframe holds fewer than 20 bars");
else for (const r of short) {
  const stated = Number((r.stat ?? "").match(/^([\d,]+)/)?.[1].replace(/,/g, "") ?? NaN);
  stated === r.n ? ok(`/coins/${r.slug}?tf=${r.tf} plots ${r.n} bars and says "${r.stat}" — short, and stated`)
    : bad(`/coins/${r.slug}?tf=${r.tf} plots ${r.n} bars while saying "${r.stat}"`);
}

console.log("\n4. a timeframe spot cannot serve, and an unparseable one");
for (const slug of slugs.slice(0, 3)) {
  for (const [ask, want, why] of [[UNAVAILABLE_TF, FALLBACK_TF, "no 15-minute spot series exists"], ["bogus", DEFAULT_TF, "unparseable"]]) {
    const p = parsePage((await get(`/coins/${slug}?tf=${ask}`)).body);
    if (p.active !== want) bad(`/coins/${slug}?tf=${ask} rendered ${p.active}, expected the ${want} fallback (${why})`);
    else if (p.buttons.some((b) => b.tf === ask)) bad(`/coins/${slug} offers a tf=${ask} button while rendering ${p.active}`);
    else if (chartFaults(p, want).length) bad(`/coins/${slug}?tf=${ask} fell back to ${want} but drew a broken chart`);
    else ok(`/coins/${slug}?tf=${ask} -> ${want}, a real chart, and no button offering ${ask}`);
  }
}

console.log("\n5. the other chart mode, at the default timeframe");
for (const slug of slugs) {
  const p = parsePage((await get(`/coins/${slug}?tf=${DEFAULT_TF}&cx=line`)).body);
  const f = chartFaults(p, DEFAULT_TF);
  f.length ? f.forEach((m) => bad(`/coins/${slug} line mode — ${m}`)) : null;
}
if (!failures) ok(`line mode holds on all ${slugs.length} pages`);

console.log(failures ? `\n${failures} FAILURES\n` : `\nall checks passed\n`);
process.exit(failures ? 1 : 0);
