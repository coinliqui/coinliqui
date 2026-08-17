#!/usr/bin/env node
/**
 * THE ONE PIECE OF ORDERING LOGIC ON THIS SITE THAT RUNS IN THE BROWSER.
 *
 * /watchlist renders all 50 rows server-side in open-interest order and then lets the client
 * reorder them. Everything else here is server-rendered and therefore covered by the smoke
 * test's HTML assertions; this is not, so it needs its own harness.
 *
 * The defect this was written for: paint() re-read the row array from the DOM, so "unpinned"
 * silently meant "wherever the last paint left you" rather than "where the server put you".
 * Pin MON, unpin MON, and MON stayed at row 1 above BTC with 1/113th of its open interest,
 * with the star dark, no row highlight, and the Clear button hidden. Four pins and four
 * unpins left 45 of 50 rows displaced, worst by 43 positions. Nothing looked wrong.
 *
 * WHAT KEEPS THIS FROM BEING A PLACEBO. A harness that fails to load the script, or whose
 * fake DOM does not actually move nodes, would see "order never changed" and report every
 * restoration assertion as a pass. So the suite asserts MOVEMENT first (a pin reaches row 1,
 * four pins arrive in pin order) and only then asserts RESTORATION. If the script never ran,
 * the movement assertions fail and the run is red.
 *
 * And it is checked against a known-bad version, not only a known-good one: `--blind` injects
 * the one line that reproduces the original semantics (re-reading row order from the DOM on
 * every paint) and requires the suite to FAIL. A check that cannot go red is worse than none.
 *
 *   node scripts/watchlist-order.mjs           run the suite against the shipped source
 *   node scripts/watchlist-order.mjs --blind    prove the suite detects the original defect
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "src/pages/watchlist.astro");

/** Pull the client island out of the .astro file, so the harness runs the SHIPPED code. */
export function extractIsland(src) {
  const m = src.match(/<script is:inline define:vars=\{\{[^}]*\}\}>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no inline island found in watchlist.astro");
  return m[1];
}

/**
 * THE KNOWN-BAD VERSIONS. Each mutation puts back exactly one shipped defect, and names the
 * assertions that MUST catch it. A mutation that produces a green run means the assertions
 * guarding that defect are decorative, and the run exits non-zero saying so.
 *
 * Anchors are asserted before use: a mutation that silently fails to apply would otherwise
 * test the fixed code against itself and report a false blind spot.
 */
export const MUTATIONS = [
  {
    name: "paint() re-reads row order from the DOM",
    anchor: "var pinned = read();",
    mutate: (b) => b.replace("var pinned = read();",
      "var pinned = read();\n        rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));"),
    mustCatch: /restores|returns only|drift/,
  },
  {
    name: "focus is not restored after the rows move",
    anchor: "if (back) back.focus();",
    mutate: (b) => b.replace("if (back) back.focus();", ""),
    mustCatch: /focus/,
  },
  {
    name: "the Clear button reads raw storage length again",
    anchor: "var present = pinned.filter",
    mutate: (b) => b
      .replace(/if \(clear\) clear\.hidden = present === 0 && offCoverage === 0;/, "if (clear) clear.hidden = pinned.length === 0;")
      .replace(/if \(note\) \{[\s\S]*?\n        \}/, ""),
    mustCatch: /off-coverage|note/,
  },
];

/** Kept for the original entry point. */
export function reintroduceDefect(body) {
  return applyMutation(body, MUTATIONS[0]);
}

export function applyMutation(body, m) {
  if (!body.includes(m.anchor)) throw new Error(`blind case "${m.name}" cannot find its anchor: ${m.anchor}`);
  const out = m.mutate(body);
  if (out === body) throw new Error(`blind case "${m.name}" changed nothing`);
  return out;
}

/** The smallest DOM that the island actually touches. appendChild really moves nodes. */
function makeDom(symbols) {
  const rows = symbols.map((sym) => {
    const button = {
      _attrs: { "data-sym": sym },
      classList: { contains: (c) => c === "pin" },
      getAttribute(k) { return this._attrs[k] ?? null; },
      setAttribute(k, v) { this._attrs[k] = v; },
      closest(sel) { return sel === ".pin" ? this : null; },
      focus() { focused = this; },
    };
    return {
      sym,
      button,
      classes: new Set(),
      getAttribute(k) { return k === "data-sym" ? this.sym : null; },
      classList: { toggle: (n, on) => (on ? rowOf(sym).classes.add(n) : rowOf(sym).classes.delete(n)) },
      querySelector(sel) { return sel === ".pin" ? this.button : null; },
    };
  });
  const rowOf = (s) => rows.find((r) => r.sym === s);

  let order = rows.slice();
  /* FOCUS IS MODELLED, because the defect is invisible without it: appendChild moves the node
     and a moved element loses focus, so activeElement silently becomes <body>. */
  const body = { tagName: "BODY" };
  let focused = body;
  const handlers = { tbody: [], clear: [] };
  const tbody = {
    querySelectorAll: () => order.slice(),
    querySelector(sel) {
      const m = /^\.pin\[data-sym="(.+)"\]$/.exec(sel);
      return m ? (rowOf(m[1])?.button ?? null) : null;
    },
    appendChild(tr) {
      order = order.filter((r) => r !== tr); order.push(tr);
      if (focused === tr.button) focused = body;   // the browser's behaviour, not a convenience
    },
    addEventListener: (_t, fn) => handlers.tbody.push(fn),
  };
  const clear = { hidden: false, addEventListener: (_t, fn) => handlers.clear.push(fn) };
  const note = { hidden: false, textContent: "" };
  const store = new Map();

  const dom = {
    document: {
      querySelector: (sel) => (sel === "#wl tbody" ? tbody : null),
      getElementById: (id) => (id === "wl-clear" ? clear : id === "wl-offcoverage" ? note : null),
      get activeElement() { return focused; },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    order: () => order.map((r) => r.sym),
    click: (sym) => handlers.tbody.forEach((fn) => fn({ target: rowOf(sym).button })),
    /* Keyboard activation is a click whose target is ALREADY focused — exactly what Enter or
       Space dispatches on a focused <button>, which is the path that lost focus. */
    keyClick: (sym) => { focused = rowOf(sym).button; dom.click(sym); },
    focusedSym: () => (focused && focused.getAttribute ? focused.getAttribute("data-sym") : "(body)"),
    noteHidden: () => note.hidden,
    noteText: () => note.textContent,
    seedStorage: (v) => store.set("k", JSON.stringify(v)),
    clickClear: () => handlers.clear.forEach((fn) => fn()),
    clearHidden: () => clear.hidden,
    pressed: (sym) => rowOf(sym).button.getAttribute("aria-pressed"),
    highlighted: (sym) => rowOf(sym).classes.has("is-pinned"),
  };
  return dom;
}

const SYMBOLS = ["BTC", "ETH", "HYPE", "SOL", "ZEC", "XRP", "PUMP", "LIT", "XMR", "AAVE",
  "DOGE", "ENA", "LINK", "AVAX", "TRX", "SUI", "WLD", "TAO", "TIA", "ARB",
  "MON", "OP", "APT", "INJ", "SEI", "PAXG", "PURR", "GRAM", "JUP", "PENDLE"];

export function runSuite(islandBody, symbols = SYMBOLS) {
  const dom = makeDom(symbols);
  new Function("document", "localStorage", "KEY", islandBody)(dom.document, dom.localStorage, "k");

  const server = dom.order();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = [];
  const t = (name, ok) => { if (!ok) fail.push(name); };

  // MOVEMENT — these are what stop a dead harness reporting green.
  dom.click(symbols[20]);
  t("a pin reaches row 1", dom.order()[0] === symbols[20]);
  t("the pinned row is marked", dom.pressed(symbols[20]) === "true" && dom.highlighted(symbols[20]));
  t("the Clear button appears", dom.clearHidden() === false);

  // RESTORATION — the defect.
  dom.click(symbols[20]);
  t("one pin then unpin restores server order", eq(dom.order(), server));
  t("the unpinned row is unmarked", dom.pressed(symbols[20]) === "false" && !dom.highlighted(symbols[20]));
  t("the Clear button hides again", dom.clearHidden() === true);

  const picks = [symbols[25], symbols[12], symbols[28], symbols[7]];
  picks.forEach(dom.click);
  t("four pins rise in the order pinned", eq(dom.order().slice(0, 4), picks));
  picks.forEach(dom.click);
  t("four pins then four unpins restores server order", eq(dom.order(), server));

  // PARTIAL — the unpinned one drops back to its own rank, the rest hold pin order.
  const p3 = [symbols[27], symbols[5], symbols[22]];
  p3.forEach(dom.click);
  dom.click(p3[1]);
  const keep = [p3[0], p3[2]];
  t("unpinning one of three returns only that row",
    eq(dom.order(), keep.concat(server.filter((s) => !keep.includes(s)))));

  // Clear-all is a second route to the same state and must land in the same place.
  dom.clickClear();
  t("Clear pinned coins restores server order", eq(dom.order(), server));

  // Idempotence: painting twice must not drift.
  dom.click(symbols[3]); dom.click(symbols[3]);
  dom.click(symbols[3]); dom.click(symbols[3]);
  t("repeated pin/unpin cycles do not drift", eq(dom.order(), server));

  /* KEYBOARD FOCUS. Enter or Space on a focused pin is a click whose target is already the
     active element; paint() then moves that node with appendChild, and a moved element loses
     focus. activeElement became <body> and the tab order restarted at the top of the document,
     so pinning four coins meant tabbing down the whole page four times. Invisible with a
     mouse, which is why it survived. */
  dom.clickClear();
  dom.keyClick(symbols[18]);
  t("keyboard pinning keeps focus on the pin", dom.focusedSym() === symbols[18]);
  dom.keyClick(symbols[18]);
  t("keyboard unpinning keeps focus on the pin", dom.focusedSym() === symbols[18]);
  dom.clickClear();

  /* PINS FOR COINS THAT HAVE LEFT COVERAGE. A pin is a ticker string in the reader's browser;
     the table is whatever clears the open-interest floor today. With only off-coverage pins the
     page rendered fifty rows, none highlighted, no star lit — and "Clear pinned coins" offering
     to clear nothing visible, because the button read raw storage length as a state of the
     table. The pins are kept on purpose: coverage moves both ways. */
  {
    const gone = makeDom(symbols);
    gone.seedStorage(["PENGU", "MOODENG"]);
    new Function("document", "localStorage", "KEY", islandBody)(gone.document, gone.localStorage, "k");
    t("off-coverage pins alone do not claim rows are pinned",
      symbols.every((sy) => !gone.highlighted(sy)));
    t("off-coverage pins are explained rather than hidden",
      gone.noteHidden() === false && /2 pinned coins/.test(gone.noteText()));
    t("off-coverage pins leave the order untouched", eq(gone.order(), symbols));
  }
  {
    const mixed = makeDom(symbols);
    mixed.seedStorage([symbols[9], "PENGU"]);
    new Function("document", "localStorage", "KEY", islandBody)(mixed.document, mixed.localStorage, "k");
    t("a present pin still rises when another has left coverage", mixed.order()[0] === symbols[9]);
    t("the note counts only the ones that left",
      mixed.noteHidden() === false && /1 pinned coin is/.test(mixed.noteText()));
  }
  {
    const clean = makeDom(symbols);
    new Function("document", "localStorage", "KEY", islandBody)(clean.document, clean.localStorage, "k");
    t("no note when nothing is pinned", clean.noteHidden() === true);
    clean.click(symbols[3]);
    t("no note when every pin is present", clean.noteHidden() === true);
  }

  return fail;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const blind = process.argv.includes("--blind");
  const body = extractIsland(readFileSync(PAGE, "utf8"));

  if (!blind) {
    const fail = runSuite(body);
    if (fail.length) {
      console.error("watchlist ordering FAILED:\n  " + fail.join("\n  "));
      process.exit(1);
    }
    console.log("watchlist ordering: 21 assertions passed (movement, restoration, partial, clear, idempotence, focus, off-coverage)");
    process.exit(0);
  }

  let blindSpots = 0;
  for (const m of MUTATIONS) {
    const fail = runSuite(applyMutation(body, m));
    const caught = fail.filter((f) => m.mustCatch.test(f));
    /* MOVEMENT must still pass. If a mutation breaks the harness itself, every assertion fails
       and "it went red" proves nothing about the assertions that matter. */
    const collateral = fail.filter((f) => /reaches row 1|rise in the order|is marked/.test(f));
    if (collateral.length) {
      console.log(`  BLIND  ${m.name}\n         broke the harness rather than the behaviour: ${collateral.join("; ")}`);
      blindSpots++;
    } else if (!caught.length) {
      console.log(`  BLIND  ${m.name}\n         the suite passed the known-bad island — nothing guards this`);
      blindSpots++;
    } else {
      console.log(`  ok     ${m.name}\n         caught by ${caught.length}: ${caught.join("; ")}`);
    }
  }
  console.log(blindSpots ? `\n  ${blindSpots} defect(s) nothing would catch\n` : `\n  every reintroduced defect is caught, and none by breaking the harness\n`);
  process.exit(blindSpots ? 1 : 0);
}
