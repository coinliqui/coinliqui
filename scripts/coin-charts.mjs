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

/* ALL EIGHT TIMEFRAMES NOW, AND THIS LINE ASSERTED SIX UNTIL 19 AUGUST 2026.
   The note that stood here said spot had no fifteen-minute series, so a coin page offering 15m
   would be a button that empties the chart — correct at the time, and asserted in both
   directions. Coinbase was then removed and the pages re-based on Hyperliquid's perpetual
   series, which does carry 15-minute bars, so the pages started offering 15m and 30m and this
   check failed sixty times on correct behaviour.
   That is the third time in this repository a check has had to be edited because the decision it
   encoded changed rather than because it was wrong — see the twice-rewritten CSP section in
   verify-live.mjs. Worth stating plainly: a check that encodes a decision is a liability the day
   the decision moves, and the failure looks identical whether the site broke or the rule did.
   The only defence is that it fails LOUDLY and uniformly, which this did. */
const EXPECTED_TFS = ["15m", "30m", "1h", "4h", "12h", "1d", "1w", "1m"];
const NOMINAL_MS = { "15m": 9e5, "30m": 1.8e6, "1h": 3.6e6, "4h": 1.44e7, "12h": 4.32e7, "1d": 8.64e7, "1w": 6.048e8, "1m": 2.592e9 };
/* HOW OFTEN THE SERIES BEHIND EACH TIMEFRAME IS ACTUALLY REFETCHED, from worker/ingest.ts:
   M15_REFRESH_HOURS and HOURLY_REFRESH_HOURS are 2, CANDLE_REFRESH_HOURS is 12.

   THE STALENESS BOUND HAS TO INCLUDE THIS AND DID NOT. It was nominal + 3h, which held while the
   coin pages drew Coinbase candles on a 2-hour sweep, and failed 46 renders the moment they were
   re-based onto Hyperliquid's 12-hour daily sweep — the newest daily bar opened 28.7h ago against
   a 27h limit. Measured rather than assumed: at 04:40 UTC the series had last been written 722
   minutes earlier, which was before the current day's bar existed upstream. That is the pipeline
   working exactly as designed.

   A bar cannot be newer than the last sweep, and the last sweep can be a full interval old, so
   the honest ceiling is bar duration + refresh interval + slack. Writing it as a guess would have
   meant relaxing a threshold until the red went away; writing it from the ingest's own constants
   means it moves when the cadence moves and not otherwise. */
const REFRESH_MS = { "15m": 2 * 3.6e6, "30m": 2 * 3.6e6, "1h": 2 * 3.6e6, "4h": 2 * 3.6e6, "12h": 2 * 3.6e6, "1d": 12 * 3.6e6, "1w": 12 * 3.6e6, "1m": 12 * 3.6e6 };
const SLACK_MS = 3.6e6;
const DEFAULT_TF = "1d";        // what an unparseable timeframe must resolve to
const DEFAULT_VIEW = "candle";  // and what a page offering a view control must default to

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
  /* TWO PREFIXES, BECAUSE THERE ARE TWO TEMPLATES. Coin pages emit `cpts-<tf>` and contract
     pages emit `pts-<tf>`. This parser knew only the first, so the moment the sweep was widened
     to the fifty contract pages it reported "0 chart panels rendered" on every one of them —
     1,208 failures in eight seconds, uniform across every page and timeframe. A defect that
     uniform is the instrument, not the site: the charts were fine and the parser was blind. */
  const svgs = [...html.matchAll(/data-xhair="c?pts-([^"]+)"/g)].map((m) => m[1]);
  const rangeM = html.match(/data-prange="([-\d.eE]+),([-\d.eE]+)"/);
  const plotM = html.match(/data-plot="([\d,]+)"/);
  const axxM = html.match(/data-axx="([\d.]+)"/);
  const jsonM = [...html.matchAll(/<script type="application\/json" id="c?pts-([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)];
  /* THE BAR COUNT IS RENDERED TWO WAYS. Coin pages put the word "over" outside the element —
     `over <b data-tfstat>220 daily bars</b>` — and contract pages put it inside:
     `<b data-tfstat> over 220 daily bars </b>`. A regex anchored on the coin shape reported
     "the page states no bar count" on all 400 contract renders. So: take every data-tfstat
     element and pick the one that actually carries a count, rather than assuming where the
     surrounding prose sits. */
  const statM = [...html.matchAll(/<[a-z]+\b[^>]*\bdata-tfstat\b[^>]*>([^<]*)</g)]
    .map((m) => m[1].replace(/^\s*over\s+/i, "").trim())
    .find((t) => /^[\d,]+\s+\S+.*\bbars?\b/i.test(t));
  let points = null;
  if (jsonM.length === 1) { try { points = JSON.parse(jsonM[0][2]); } catch { points = "unparseable"; } }
  /* THE VIEW AXIS, WHICH NOTHING HERE HAD EVER LOOKED AT.
     Every one of these pages offers Candles and Line, so a page has sixteen panels and this
     sweep exercised eight. Half of what a reader can reach was unmeasured — and the half that
     is harder to eyeball, because a line chart drawn from the wrong series still looks like a
     line chart. */
  const modes = [...html.matchAll(/<button[^>]*data-mode="([^"]+)"[^>]*aria-pressed="(true|false)"/g)]
    .map((m) => ({ mode: m[1], pressed: m[2] === "true" }));
  /* THE PANEL KEY IS A CONTRACT WITH THE CLIENT, not decoration. public/interact.js caches and
     reveals panels by the literal string `${tf}.${view}` — `have(key)`, `p.dataset.tfpanel ===
     key`. If the server ever emitted a different shape the fetch would succeed, the panel would
     be appended, nothing would match, and the reader would keep the chart they already had with
     no error anywhere. That is precisely "the chart only ever shows one timeframe", and it
     would pass every assertion in this file as it stood. */
  const panelKeys = [...html.matchAll(/data-tfpanel="([^"]+)"/g)].map((m) => m[1]);
  const activePanel = (/data-tfpanel="([^"]+)"[^>]*\sdata-on/.exec(html) ?? [, null])[1];
  return {
    buttons,
    modes,
    activeMode: modes.find((m) => m.pressed)?.mode ?? null,
    panelKeys,
    activePanel,
    active: buttons.find((b) => b.pressed)?.tf ?? null,
    svgTfs: svgs,
    prange: rangeM ? [Number(rangeM[1]), Number(rangeM[2])] : null,
    plot: plotM ? plotM[1].split(",").map(Number) : null,
    axx: axxM ? Number(axxM[1]) : null,
    jsonTfs: jsonM.map((m) => m[1]),
    points,
    stat: statM ?? null,
  };
}

/* One pure function, so the blind cases exercise the same code the live sweep does. Returns a
   list of complaints; empty means the chart on that page at that timeframe is a chart. */
export function chartFaults(p, wantTf, now = Date.now(), expected = EXPECTED_TFS, wantView = null) {
  const f = [];
  const T = 1, H = 3, L = 4, C = 5;

  const offered = p.buttons.map((b) => b.tf);
  const missing = expected.filter((t) => !offered.includes(t));
  const extra = offered.filter((t) => !EXPECTED_TFS.includes(t));
  if (missing.length) f.push(`timeframe button(s) absent: ${missing.join(", ")}`);
  if (extra.length) f.push(`timeframe button(s) offered that no series can serve: ${extra.join(", ")}`);
  if (p.buttons.filter((b) => b.pressed).length !== 1) f.push(`${p.buttons.filter((b) => b.pressed).length} timeframes marked active — exactly one must be`);
  if (p.active !== wantTf) f.push(`asked for tf=${wantTf}, page rendered tf=${p.active} — the switch did not switch`);

  /* THE VIEW, AND THE KEY THE CLIENT MATCHES ON. Only checked when a view was asked for, so a
     page with no Candles/Line control is not held to a control it does not have. */
  /* THE PANEL KEY IS CHECKED EITHER WAY. With a view control the client keys panels `tf.view`;
     without one, by the bare timeframe. Both are contracts with public/interact.js, and the
     failure is identical and silent in both cases. */
  const wantKey = wantView ? `${wantTf}.${wantView}` : wantTf;
  if (p.activePanel !== undefined) {
    if (p.activePanel !== wantKey) f.push(`the live panel is keyed "${p.activePanel}", and public/interact.js reveals panels by the literal "${wantKey}" — a reader clicking this would keep the chart they already had`);
    if (p.panelKeys.filter((k) => k === wantKey).length !== 1) f.push(`${p.panelKeys.filter((k) => k === wantKey).length} panels keyed "${wantKey}" — exactly one must be`);
  }
  if (wantView) {
    const offeredModes = p.modes.map((m) => m.mode);
    if (!offeredModes.includes(wantView)) f.push(`no "${wantView}" control: offers ${offeredModes.join(", ") || "none"}`);
    if (p.modes.filter((m) => m.pressed).length !== 1) f.push(`${p.modes.filter((m) => m.pressed).length} views marked active — exactly one must be`);
    if (p.activeMode !== wantView) f.push(`asked for view=${wantView}, page rendered view=${p.activeMode}`);
  }
  /* And a page that offers no view control must not be silently serving one. */
  if (!wantView && p.modes.length) f.push(`no view was asked for, but the page offers ${p.modes.map((m) => m.mode).join(", ")} — the sweep and the page disagree about what this page is`);

  if (p.svgTfs.length !== 1) f.push(`${p.svgTfs.length} chart panels rendered — exactly one must be`);
  else if (p.svgTfs[0] !== p.active) f.push(`panel is ${p.svgTfs[0]} while the active timeframe is ${p.active}`);
  if (p.jsonTfs.length !== 1) f.push(`${p.jsonTfs.length} crosshair payloads — exactly one must be`);
  else if (p.jsonTfs[0] !== p.active) f.push(`payload is ${p.jsonTfs[0]} while the active timeframe is ${p.active}`);

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
  const tf = p.active ?? wantTf;
  const nominal = NOMINAL_MS[tf] ?? NOMINAL_MS[wantTf];
  const limit = nominal + (REFRESH_MS[tf] ?? 2 * 3.6e6) + SLACK_MS;
  const age = now - ts[ts.length - 1];
  if (age > limit) f.push(`newest bar opened ${(age / 3.6e6).toFixed(1)}h ago — over the ${(limit / 3.6e6).toFixed(0)}h ceiling for a ${tf} chart (${(nominal / 3.6e6).toFixed(0)}h bar + ${((REFRESH_MS[tf] ?? 7.2e6) / 3.6e6).toFixed(0)}h sweep + 1h)`);
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
    modes: [{ mode: "candle", pressed: true }, { mode: "line", pressed: false }],
    activeMode: "candle",
    panelKeys: ["1h.candle", "4h.candle"],
    activePanel: "1h.candle",
  };
  const NOW = t0 + 24 * 3.6e6;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cases = [
    ["the clean fixture stays silent", clean, null],
    ["a timeframe button missing", (() => { const c = clone(clean); c.buttons = c.buttons.filter((b) => b.tf !== "12h"); return c; })(), /button\(s\) absent/],
    /* "15m" USED TO BE THE UNSERVABLE KEY HERE and it is now a real timeframe, so this fixture
       went silent the moment the pages re-based onto the perpetual series — a blind case that
       had quietly stopped testing anything. Caught by running the file. The key below is not in
       TIMEFRAMES at all, which is the property the case actually needs. */
    ["a button for a timeframe that does not exist", (() => { const c = clone(clean); c.buttons.push({ tf: "5m", pressed: false }); return c; })(), /no series can serve/],
    /* Index 2 was "12h" when the list held six timeframes and is "1h" now — the one already
       pressed in the clean fixture — so this mutation changed nothing and the case went silent.
       Selecting by KEY rather than by position cannot rot the same way. */
    ["two timeframes marked active", (() => { const c = clone(clean); c.buttons.find((b) => b.tf === "1d").pressed = true; return c; })(), /marked active/],
    ["the switch did not switch", (() => { const c = clone(clean); c.active = "4h"; c.svgTfs = ["4h"]; c.jsonTfs = ["4h"]; return c; })(), /did not switch/],
    ["panel and payload disagree", (() => { const c = clone(clean); c.svgTfs = ["4h"]; return c; })(), /panel is 4h/],
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
    /* 9h was enough when the limit was nominal+3h. With the sweep interval in the ceiling a 1h
       chart tolerates 1+2+1 = 4h, so the fixture has to clear that and does — but it is written
       relative to the limit rather than as a magic number, so relaxing the ceiling cannot
       silently relax the case with it. */
    ["a stale newest bar", (() => { const c = clone(clean); c.points.forEach((q) => { q[1] -= 9 * 3.6e6; }); return c; })(), /over the 4h ceiling for a 1h chart/],
    ["a bar in the future", (() => { const c = clone(clean); c.points[c.points.length - 1][1] = NOW + 2 * 3.6e6; return c; })(), /in the future/],
    ["x coordinates not increasing", (() => { const c = clone(clean); c.points[7][0] = 5; return c; })(), /x coordinates are not increasing/],
    ["points outside the plot box", (() => { const c = clone(clean); c.points[0][0] = -50; return c; })(), /outside the plot box/],
    ["a point past the right edge", (() => { const c = clone(clean); c.points[c.points.length - 1][0] = 1200; return c; })(), /outside the plot box/],
  ];
  /* THE VIEW AXIS. Only asserted when a view was asked for, so these run with wantView set —
     the clean fixture must stay silent under both callers, which is the first case. */
  const viewCases = [
    ["the clean fixture stays silent with a view asked for", clean, null],
    ["asked for line, served candles", clean, /asked for view=line/, "line"],
    ["no view control at all", (() => { const c = clone(clean); c.modes = []; c.activeMode = null; return c; })(), /no "candle" control/],
    ["both views marked active", (() => { const c = clone(clean); c.modes[1].pressed = true; return c; })(), /views marked active/],
    /* THE ONE THAT WOULD HAVE PASSED EVERYTHING ELSE. Right timeframe, right view, right chart,
       and a panel key the client cannot match — so the fetch succeeds, the panel is appended,
       nothing is revealed, and the reader keeps the chart they already had. Silent everywhere. */
    ["the panel key the client matches on is wrong", (() => { const c = clone(clean); c.panelKeys = ["1h", "4h.candle"]; c.activePanel = "1h"; return c; })(), /reveals panels by the literal "1h.candle"/],
    ["two panels share the live key", (() => { const c = clone(clean); c.panelKeys = ["1h.candle", "1h.candle"]; return c; })(), /2 panels keyed/],
  ];
  /* THE CONTRACT-PAGE SHAPE: no view control, panels keyed by the bare timeframe. Fifty of the
     sixty pages are this, and asserting the coin shape against them is what produced 3,980
     failures on a site where every chart was fine. */
  const bare = clone(clean);
  bare.modes = []; bare.activeMode = null;
  bare.panelKeys = ["1h", "4h"]; bare.activePanel = "1h";
  const bareCases = [
    ["a page with no view control is silent when none is asked for", bare, null],
    ["...and its panel key is still checked", (() => { const c = clone(bare); c.activePanel = "1h.candle"; c.panelKeys = ["1h.candle"]; return c; })(), /reveals panels by the literal "1h"/],
    ["...and a view control appearing where none is expected is a finding", (() => { const c = clone(bare); c.modes = [{ mode: "line", pressed: true }]; return c; })(), /the sweep and the page disagree/],
  ];
  let blind = 0;
  for (const [name, fixture, want] of cases) {
    /* The clean fixture models a COIN page, which carries a Candles/Line control, so the whole
       base suite is asked for a view. Contract pages are the other shape and get their own
       cases below — running the base suite with no view asked for would be modelling neither. */
    const f = chartFaults(fixture, "1h", NOW, EXPECTED_TFS, "candle");
    const hit = want ? f.some((m) => want.test(m)) : f.length === 0;
    if (!hit) { blind++; console.log(`  BLIND  ${name}`); console.log(`         got: ${f.length ? f.join(" | ") : "(silent)"}`); }
    else console.log(`  ok     ${want ? "FIRES  " : "SILENT "} ${name}`);
  }
  for (const [name, fixture, want, view] of viewCases) {
    const f = chartFaults(fixture, "1h", NOW, EXPECTED_TFS, view ?? "candle");
    const hit = want ? f.some((m) => want.test(m)) : f.length === 0;
    if (!hit) { blind++; console.log(`  BLIND  ${name}`); console.log(`         got: ${f.length ? f.join(" | ") : "(silent)"}`); }
    else console.log(`  ok     ${want ? "FIRES  " : "SILENT "} ${name}`);
  }
  for (const [name, fixture, want] of bareCases) {
    const f = chartFaults(fixture, "1h", NOW, EXPECTED_TFS, null);
    const hit = want ? f.some((m) => want.test(m)) : f.length === 0;
    if (!hit) { blind++; console.log(`  BLIND  ${name}`); console.log(`         got: ${f.length ? f.join(" | ") : "(silent)"}`); }
    else console.log(`  ok     ${want ? "FIRES  " : "SILENT "} ${name}`);
  }
  const total = cases.length + viewCases.length + bareCases.length;
  console.log(blind ? `\n  ${blind} BLIND SPOT(S)\n` : `\n  ${total} cases: every assertion fires on its fault and the clean fixture stays silent\n`);
  process.exit(blind ? 1 : 0);
}

/* ---------------------------------------------------------------------------------------
   THE LIVE SWEEP, ACROSS BOTH PAGE FAMILIES.

   It covered the ten coin pages only. The fifty contract pages draw from the same three series
   and had never been swept at all — a template verified once and a template verified sixty times
   are the same template, and the untested one is where a gap would sit unnoticed.

   EXPECTATIONS ARE PER PAGE, NOT GLOBAL. A page is asserted against WHAT IT OFFERS: every button
   it shows must render a real chart. Which timeframes it offers is a separate question, reported
   as a matrix rather than failed on, because a symbol that genuinely has no 15-minute history
   upstream should not fail a deploy — it should be visible.

   GUARDED, like scripts/behaviour-live.mjs, so importing the assertions above does not run a
   five-hundred-render sweep as a side effect of an import.
   --------------------------------------------------------------------------------------- */
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
console.log(`=== ${ORIGIN} — every chart on the site, every timeframe it offers ===\n`);

const pageSet = async (sitemap, prefix) => {
  const sm = await get(sitemap);
  return [...sm.body.matchAll(new RegExp(`<loc>[^<]*${prefix}([^<\\/]+)</loc>`, "g"))].map((m) => m[1]);
};
const coins = await pageSet("/sitemaps/coins.xml", "/coins/");
const syms = await pageSet("/sitemaps/funding-symbols.xml", "/funding/");
if (!coins.length || !syms.length) { bad(`page discovery failed: ${coins.length} coins, ${syms.length} contracts`); process.exit(1); }

/* Bounded concurrency. Our own origin, but a burst of five hundred is a shape worth not making
   even against infrastructure we own. */
const pool = async (items, n, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
};

const FAMILIES = [
  { name: "coin", base: "/coins/", ids: coins },
  { name: "contract", base: "/funding/", ids: syms },
];

console.log(`1. what each page offers (${coins.length} coin + ${syms.length} contract pages)\n`);
const offered = {};
/* WHICH VIEWS, READ FROM THE PAGE RATHER THAN ASSUMED. The first version of the view sweep took
   ["candle","line"] as given and produced 3,980 failures — every contract page, every timeframe.
   The charts were fine: only the ten coin pages carry a Candles/Line control, and the fifty
   contract pages key their panels by the bare timeframe because there is no second axis to name.
   Assuming a fixed set instead of reading what the page offers is the same mistake this file
   already carries two comments about. */
const views = {};
for (const fam of FAMILIES) {
  const got = await pool(fam.ids, 6, async (id) => {
    const p = parsePage((await get(`${fam.base}${id}`)).body);
    return [p.buttons.map((b) => b.tf), p.modes.map((m) => m.mode)];
  });
  fam.ids.forEach((id, k) => { offered[`${fam.name}:${id}`] = got[k][0]; views[`${fam.name}:${id}`] = got[k][1]; });
}
const viewCounts = [...new Set(Object.values(views).map((v) => v.join("+") || "none"))];
console.log(`   ---   view controls offered: ${viewCounts.join(" / ")}`);
const allOffer = Object.values(offered).every((o) => o.length === EXPECTED_TFS.length);
console.log(allOffer
  ? `   ok    every one of the ${Object.keys(offered).length} pages offers all ${EXPECTED_TFS.length} timeframes`
  : `   ---   coverage is uneven; see the matrix in section 3`);

/* BOTH VIEWS. Every page carries a Candles/Line control and this sweep only ever asked for the
   default, so half of what a reader can reach — the half where a wrong series still looks like a
   plausible chart — was never rendered by anything. */
const jobs = [];
for (const fam of FAMILIES) for (const id of fam.ids) for (const tf of offered[`${fam.name}:${id}`])
  for (const view of (views[`${fam.name}:${id}`].length ? views[`${fam.name}:${id}`] : [null])) jobs.push({ fam, id, tf, view });
console.log(`\n2. ${jobs.length} renders — every page against every timeframe it offers, in both views\n`);

const rows = await pool(jobs, 6, async ({ fam, id, tf, view }) => {
  const path = `${fam.base}${id}?tf=${tf}${view ? `&view=${view}` : ""}`;
  const r = await get(path);
  if (r.status !== 200) return { fam: fam.name, id, tf, view, n: 0, faults: [`returned ${r.status}`], path };
  const p = parsePage(r.body);
  const exp = offered[`${fam.name}:${id}`];
  const f = chartFaults(p, tf, Date.now(), exp, view);
  const g = Array.isArray(p.points) && p.points.length > 1 ? gapReport(p.points, tf) : null;
  return { fam: fam.name, id, tf, view, path, stat: p.stat, faults: f, gaps: g,
           n: Array.isArray(p.points) ? p.points.length : 0,
           newestH: Array.isArray(p.points) && p.points.length ? (Date.now() - p.points[p.points.length - 1][1]) / 3.6e6 : NaN };
});
for (const r of rows) if (r.faults.length) r.faults.forEach((m) => bad(`${r.path} — ${m}`));
if (!rows.some((r) => r.faults.length)) ok(`all ${rows.length} renders: one panel, one payload, the requested timeframe, a real varying series, an axis that matches it, and a current newest bar`);

console.log("\n3. bars held, by timeframe and family");
for (const fam of ["coin", "contract"]) {
  for (const tf of EXPECTED_TFS) {
    const rs = rows.filter((r) => r.fam === fam && r.tf === tf && r.n);
    if (!rs.length) continue;
    const ns = rs.map((r) => r.n);
    const offs = rs.reduce((a, r) => a + (r.gaps?.off ?? 0), 0);
    console.log(`   ${fam.padEnd(9)} ${tf.padEnd(4)} ${new Set(ns).size === 1 ? `${ns[0]} bars on all ${rs.length}` : `${Math.min(...ns)}-${Math.max(...ns)} bars over ${rs.length}`}`.padEnd(46)
      + `newest ${Math.max(...rs.map((r) => r.newestH)).toFixed(1)}h at worst`.padEnd(26)
      + (offs ? `${offs} interior gap(s)` : "no interior gaps"));
  }
}

console.log("\n4. the thinnest pages");
const byId = {};
for (const r of rows) { const k = `${r.fam}:${r.id}`; (byId[k] ??= []).push(r); }
const thin = Object.entries(byId)
  .map(([k, rs]) => ({ k, min: Math.min(...rs.map((r) => r.n)), tfs: rs.length }))
  .filter((x) => x.min < 60 || x.tfs < EXPECTED_TFS.length)
  .sort((a, b) => a.min - b.min);
if (!thin.length) ok(`no page holds fewer than 60 bars on any timeframe it offers`);
else for (const t of thin.slice(0, 12)) console.log(`   ---   ${t.k.padEnd(22)} ${t.tfs}/${EXPECTED_TFS.length} timeframes, thinnest ${t.min} bars`);

console.log("\n5. sparse series, and whether the page says so");
const short = rows.filter((r) => r.n && r.n < 20);
if (!short.length) ok("no page/timeframe holds fewer than 20 bars");
else for (const r of short) {
  const stated = Number((r.stat ?? "").match(/^([\d,]+)/)?.[1].replace(/,/g, "") ?? NaN);
  stated === r.n ? ok(`${r.path} plots ${r.n} and says "${r.stat}" — short, and stated`)
    : bad(`${r.path} plots ${r.n} while saying "${r.stat}"`);
}

console.log("\n6. an unparseable timeframe falls back honestly");
for (const fam of FAMILIES) for (const id of fam.ids.slice(0, 2)) {
  const key = `${fam.name}:${id}`;
  /* The view a page falls back to is part of the same question, and only pages that HAVE a view
     control are asked it — the fifty contract pages have none. */
  const wantView = views[key].length ? DEFAULT_VIEW : null;
  const p = parsePage((await get(`${fam.base}${id}?tf=bogus`)).body);
  if (p.active !== DEFAULT_TF) bad(`${fam.base}${id}?tf=bogus rendered ${p.active}, expected ${DEFAULT_TF}`);
  else if (chartFaults(p, DEFAULT_TF, Date.now(), offered[key], wantView).length) bad(`${fam.base}${id}?tf=bogus fell back but drew a broken chart: ${chartFaults(p, DEFAULT_TF, Date.now(), offered[key], wantView).join(" | ")}`);
  else ok(`${fam.base}${id}?tf=bogus -> ${DEFAULT_TF}${wantView ? `/${wantView}` : ""}, a real chart`);
}

console.log(failures ? `\n${failures} FAILURES\n` : `\nall checks passed — ${rows.length} renders across ${Object.keys(byId).length} pages\n`);
process.exit(failures ? 1 : 0);
}
