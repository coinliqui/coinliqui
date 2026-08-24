#!/usr/bin/env node
/**
 * WHAT MOVED, AND WHAT HELD, BETWEEN TWO MOMENTS.
 *
 * EVERY OTHER CHECK IN THIS REPOSITORY READS ONE MOMENT. The gate renders 45 routes and asks
 * whether the markup is right; verify-live asks what the open internet receives; coin-charts asks
 * whether a chart is a chart. All of them photograph the site. None of them watches it.
 *
 * THE DEFECT THAT PROVED THE GAP. Re-basing /coins onto the perpetual changed what the server
 * rendered and left the client attributes declaring spot. Nothing served spot, so the overlay's
 * freeze guard fired permanently and the ENTIRE live layer on ten pages went inert — price,
 * change, mark and the page clock, all frozen. The markup was correct. Every check passed. It was
 * found by opening a page and watching it for two pulls, and it would have stayed found only by
 * luck.
 *
 * WHAT THIS PROBE IS, AND WHAT IT DELIBERATELY IS NOT. It is not a headless browser: this project
 * adds no dependencies, and a browser in the deploy path is a large thing to maintain for one
 * question. Instead it checks the two halves that together make the overlay work, from ordinary
 * HTTP:
 *
 *   THE CONTRACT — every `data-repaint` kind the live HTML declares must be satisfiable by the live
 *   payload. That is exactly what broke: markup said `last`, payload had no `spot`. The kinds are
 *   read from the RENDERED page rather than from templates, because three of the six are emitted
 *   through expressions and a source grep undercounts them.
 *
 *   THE MOVEMENT — poll the payload until it demonstrably changes, then confirm that what should
 *   hold held. A payload that never moves is a dead cron; a payload whose SHAPE moves is a
 *   contract break; a payload that loses symbols between two readings a minute apart is a
 *   coverage collapse.
 *
 * Between them, an inert overlay is caught by the contract half before it ships, and a dead feed
 * is caught by the movement half. Neither is visible in a single moment.
 *
 * POLLING RATHER THAN SLEEPING, because a fixed 60-second wait would fail whenever the
 * one-minute cron missed a tick — punishing the deploy for upstream jitter and training whoever
 * sees it to re-run until green. It polls until movement appears and gives up at three minutes,
 * which is long enough that "nothing moved" means something is actually wrong.
 *
 *   node scripts/behaviour-live.mjs [origin]
 *   node scripts/behaviour-live.mjs --blind
 */
const ORIGIN = (process.argv.find((a) => a.startsWith("http")) ?? "https://coinliqui.com").replace(/\/$/, "");
const UA = "Mozilla/5.0 (+https://coinliqui.com/about; coinliqui-selfcheck)";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/**
 * WHAT EACH OVERLAY KIND NEEDS FROM THE PAYLOAD.
 *
 * Declared here rather than inferred, because inferring it from interact.js means parsing control
 * flow and would be its own source of quiet wrongness. Declaring it means it can go stale — so
 * the kinds are cross-checked against the branches interact.js actually has, in both directions,
 * by kindsAgree() below. A kind in the markup with no branch is a cell that never repaints; a
 * branch with no kind is dead code of the sort that froze ten pages.
 */
const NEEDS = {
  mark: (d, sym) => Number.isFinite(d.mark?.[sym]),
  chgmark: (d, sym) => Number.isFinite(d.mark?.[sym]),
  apr: (d, sym, venue) => Number.isFinite(d.apr?.[sym]?.[venue]),
  carry: (d, sym, venue) => Number.isFinite(d.apr?.[sym]?.[venue]),
  dir: (d, sym, venue) => Number.isFinite(d.apr?.[sym]?.[venue]),
  spread: (d, sym) => Object.values(d.apr?.[sym] ?? {}).filter(Number.isFinite).length > 1,
};

export function kindsAgree(interactSrc, declared) {
  const branches = new Set([...interactSrc.matchAll(/kind === "([a-z]+)"/g)].map((m) => m[1]));
  const out = [];
  for (const k of Object.keys(declared)) if (!branches.has(k)) out.push(`this probe knows a kind "${k}" that interact.js has no branch for`);
  for (const k of branches) if (!declared[k]) out.push(`interact.js handles a kind "${k}" this probe does not know how to satisfy`);
  return out;
}

/** Every live cell the page declares, from the rendered HTML. */
export function declaredCells(html) {
  const out = [];
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\bdata-repaint="([a-z]+)"[^>]*>/g)) {
    const tag = m[0];
    const sym = (tag.match(/\bdata-sym="([^"]*)"/) ?? [])[1];
    const venue = (tag.match(/\bdata-venue="([^"]*)"/) ?? [])[1];
    if (sym) out.push({ kind: m[1], sym, venue });
  }
  return out;
}

/** Cells the payload cannot repaint — the shape that froze ten pages. */
export function unsatisfiable(cells, payload) {
  const bad = [];
  for (const c of cells) {
    const need = NEEDS[c.kind];
    if (!need) { bad.push(`${c.kind}:${c.sym} — no rule for this kind`); continue; }
    if (!need(payload, c.sym, c.venue)) bad.push(`${c.kind}:${c.sym}${c.venue ? "@" + c.venue : ""}`);
  }
  return [...new Set(bad)];
}

/** What must have moved, and what must have held, between two readings. */
export function compare(a, b) {
  const moved = [], held = [];
  /* IT WATCHED `at` AND SAID "THE ONE-MINUTE TICK". `at` was the newest of the two stores, so
     while the live tick was the newer one it did advance every minute and the sentence was
     accidentally true. `at` is now the OLDER of the two — the conservative page-wide clock the
     server already renders — and it moves on the five-minute snapshot, so this failed a
     181-second observation window on a perfectly healthy feed the first time it ran.
     The payload publishes `liveAt` for exactly this: the one-minute tick's own clock, separate
     from the snapshot's, so each can be observed without a proxy. Watching the field whose name
     matches the claim is the fix, and it is a stricter check than the old one — `at` could have
     advanced on the snapshot alone while the live tick was dead. */
  if (!(b.liveAt > a.liveAt)) moved.push(`liveAt did not advance (${a.liveAt} -> ${b.liveAt}) — the one-minute tick is not writing`);
  const marksChanged = Object.keys(b.mark ?? {}).filter((s) => a.mark?.[s] !== undefined && a.mark[s] !== b.mark[s]).length;
  if (marksChanged === 0) moved.push("not one of the marks changed — the feed is being rewritten with identical values, or not at all");
  const ka = Object.keys(a).sort().join(","), kb = Object.keys(b).sort().join(",");
  if (ka !== kb) held.push(`the payload's shape changed between two readings: "${ka}" -> "${kb}"`);
  if (JSON.stringify(a.sources) !== JSON.stringify(b.sources)) held.push("the attribution block changed between two readings");
  const sa = Object.keys(a.mark ?? {}).length, sb = Object.keys(b.mark ?? {}).length;
  if (sb < sa) held.push(`coverage fell from ${sa} to ${sb} symbols inside one minute`);
  return { moved, held, marksChanged };
}

if (process.argv.includes("--blind")) {
  const P = (at, mark, extra = {}) => ({ at, liveAt: at, snapAt: at, sources: { mark: "Hyperliquid" }, mark, apr: { BTC: { HlPerp: 0.1, BinPerp: 0.2 } }, ...extra });
  const base = P(1000, { BTC: 100, ETH: 50 });
  let bad = 0;
  let ran = 0;
  const check = (name, got, want) => {
    ran++;
    const hit = want === null ? got.length === 0 : got.some((g) => want.test(g));
    if (!hit) { bad++; console.log(`  BLIND  ${name}`); console.log(`         got: ${got.join(" | ") || "(clean)"}`); }
    else console.log(`  ok     ${want ? "FIRES " : "SILENT"} ${name}`);
  };

  console.log("\n  the contract between markup and payload");
  check("a clean page", unsatisfiable(declaredCells('<b data-repaint="mark" data-sym="BTC">x</b>'), base), null);
  /* THE DEFECT VERBATIM: the coin pages declared spot kinds after the payload stopped carrying
     spot, and every cell went inert. This is that page against that payload. */
  check("markup declares a kind the payload cannot serve",
        unsatisfiable(declaredCells('<b data-repaint="last" data-sym="BTC">x</b>'), base), /no rule for this kind/);
  check("a symbol the payload does not carry",
        unsatisfiable(declaredCells('<b data-repaint="mark" data-sym="DOGE">x</b>'), base), /mark:DOGE/);
  check("an apr cell whose venue is absent",
        unsatisfiable(declaredCells('<b data-repaint="apr" data-sym="BTC" data-venue="BybitPerp">x</b>'), base), /apr:BTC@BybitPerp/);
  check("a spread cell with only one venue quoting",
        unsatisfiable(declaredCells('<b data-repaint="spread" data-sym="ETH">x</b>'), base), /spread:ETH/);
  check("a cell with no symbol is not a live cell",
        unsatisfiable(declaredCells('<b data-repaint="mark">x</b>'), base), null);

  console.log("\n  what must move");
  check("a healthy pair", compare(base, P(2000, { BTC: 101, ETH: 50 })).moved, null);
  check("the one-minute tick's clock did not advance", compare(base, P(1000, { BTC: 101, ETH: 50 })).moved, /liveAt did not advance/);
  /* THE BLIND CASE FOR THE FIELD SWAP: the snapshot clock moving must NOT satisfy a check about
     the one-minute tick. Before this, `at` advancing was the whole test, and a dead live tick
     beside a healthy snapshot would have read as green. */
  check("the snapshot advanced while the one-minute tick stood still",
        compare(P(1000, { BTC: 100, ETH: 50 }), { ...P(2000, { BTC: 101, ETH: 50 }), liveAt: 1000 }).moved,
        /liveAt did not advance/);
  check("every mark identical", compare(base, P(2000, { BTC: 100, ETH: 50 })).moved, /not one of the marks changed/);

  console.log("\n  what must hold");
  check("a healthy pair", compare(base, P(2000, { BTC: 101, ETH: 50 })).held, null);
  /* THE KEY HAS TO BE DELETED, NOT SET UNDEFINED — `{apr: undefined}` still appears in
     Object.keys, so the first version of this fixture tested nothing about shape and fired on
     coverage instead, because it had also dropped a symbol. The fixture was wrong; the check was
     right. Coverage is held constant here so only one thing is being asserted. */
  check("the payload lost a key", compare(base, (() => { const x = P(2000, { BTC: 101, ETH: 50 }); delete x.apr; return x; })()).held, /shape changed/);
  check("attribution changed mid-flight",
        compare(base, P(2000, { BTC: 101, ETH: 50 }, { sources: { mark: "Somebody else" } })).held, /attribution block changed/);
  check("coverage collapsed", compare(base, P(2000, { BTC: 101 })).held, /coverage fell from 2 to 1/);

  /* THE NUMBER WAS TYPED AND THE CASES WERE COUNTED BY HAND. It said 15; there are 13 check()
     calls, and 15 corresponds to no quantity this file computes. A hand-typed count in a
     success line is a claim about coverage that nothing maintains — add a case and the line
     under-reports, delete two and it over-reports, and either way it reads as authoritative.
     check() counts itself now. */
  console.log(bad ? `\n  ${bad} BLIND SPOT(S)\n` : `\n  ${ran} cases: the contract and the movement both fail when they should\n`);
  process.exit(bad ? 1 : 0);
}

/* ------------------------------------------------------------------------------- the live run
   GUARDED, BECAUSE IMPORTING THIS FILE FOR ITS EXPORTS USED TO RUN IT. The functions above are
   the useful part — a fault-injection script imported unsatisfiable() to prove this probe would
   have caught the inert-overlay regression, and got a three-minute polling run against production
   as a side effect of an import. An ES module has no natural main, so the entry point has to be
   asserted rather than assumed. */
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (!invokedDirectly) {
  /* imported for its exports; do nothing */
} else {
let failures = 0;
const bad = (m) => { failures++; console.log("   FAIL  " + m); };
const ok = (m) => console.log("   ok    " + m);
const get = async (path, json = false) => {
  const r = await fetch(`${ORIGIN}${path}${path.includes("?") ? "&" : "?"}cb=${Date.now()}`, {
    headers: { "user-agent": UA, accept: json ? "application/json" : ACCEPT },
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return json ? r.json() : r.text();
};

console.log(`=== ${ORIGIN} — what moves and what holds ===\n`);

console.log("0. the probe's own map matches the client's branches");
{
  const src = await get("/interact.js");
  const drift = kindsAgree(src, NEEDS);
  drift.length ? drift.forEach(bad) : ok(`${Object.keys(NEEDS).length} overlay kinds, and interact.js has a branch for each`);
}

console.log("\n1. every live cell on every sampled page can be repainted");
const PAGES = ["/", "/coins", "/coins/bitcoin", "/funding", "/funding/btc", "/watchlist"];
const first = await get("/api/live.json", true);
let cellTotal = 0;
for (const p of PAGES) {
  const cells = declaredCells(await get(p));
  cellTotal += cells.length;
  const dead = unsatisfiable(cells, first);
  if (!cells.length) { ok(`${p} declares no live cells`); continue; }
  dead.length
    ? bad(`${p}: ${dead.length} of ${cells.length} live cell(s) cannot be repainted — ${dead.slice(0, 4).join(", ")}`)
    : ok(`${p} ${String(cells.length).padStart(3)} live cell(s), all satisfiable`);
}

console.log("\n2. the payload actually moves, and holds its shape while it does");
{
  const started = Date.now();
  let second = first, moved = null;
  while (Date.now() - started < 180_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    second = await get("/api/live.json", true);
    moved = compare(first, second);
    if (!moved.moved.length) break;
  }
  const waited = Math.round((Date.now() - started) / 1000);
  moved.moved.length
    ? moved.moved.forEach((m) => bad(`${m} — after ${waited}s`))
    : ok(`the feed moved within ${waited}s: clock advanced, ${moved.marksChanged} of ${Object.keys(second.mark).length} marks changed`);
  moved.held.length
    ? moved.held.forEach(bad)
    : ok("shape, attribution and coverage all held across the two readings");
}

console.log(`\n${failures ? `${failures} FAILURES` : `${cellTotal} live cells checked, and the feed behind them moves`}\n`);
process.exit(failures ? 1 : 0);
}
