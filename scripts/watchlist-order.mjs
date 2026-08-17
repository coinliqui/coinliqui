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

/** Re-reading DOM order inside paint() is exactly what the original did. */
export function reintroduceDefect(body) {
  const anchor = "var pinned = read();";
  if (!body.includes(anchor)) throw new Error("blind case cannot find its anchor in paint()");
  return body.replace(anchor, anchor + "\n        rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));");
}

/** The smallest DOM that the island actually touches. appendChild really moves nodes. */
function makeDom(symbols) {
  const rows = symbols.map((sym) => {
    const button = {
      _attrs: { "data-sym": sym },
      getAttribute(k) { return this._attrs[k] ?? null; },
      setAttribute(k, v) { this._attrs[k] = v; },
      closest(sel) { return sel === ".pin" ? this : null; },
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
  const handlers = { tbody: [], clear: [] };
  const tbody = {
    querySelectorAll: () => order.slice(),
    appendChild(tr) { order = order.filter((r) => r !== tr); order.push(tr); },
    addEventListener: (_t, fn) => handlers.tbody.push(fn),
  };
  const clear = { hidden: false, addEventListener: (_t, fn) => handlers.clear.push(fn) };
  const store = new Map();

  return {
    document: {
      querySelector: (sel) => (sel === "#wl tbody" ? tbody : null),
      getElementById: (id) => (id === "wl-clear" ? clear : null),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    order: () => order.map((r) => r.sym),
    click: (sym) => handlers.tbody.forEach((fn) => fn({ target: rowOf(sym).button })),
    clickClear: () => handlers.clear.forEach((fn) => fn()),
    clearHidden: () => clear.hidden,
    pressed: (sym) => rowOf(sym).button.getAttribute("aria-pressed"),
    highlighted: (sym) => rowOf(sym).classes.has("is-pinned"),
  };
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

  return fail;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const blind = process.argv.includes("--blind");
  const body = extractIsland(readFileSync(PAGE, "utf8"));
  const fail = runSuite(blind ? reintroduceDefect(body) : body);

  if (blind) {
    const restoration = fail.filter((f) => f.includes("restores") || f.includes("returns only") || f.includes("drift"));
    const movement = fail.filter((f) => !restoration.includes(f));
    if (movement.length) {
      console.error("blind case is not a clean red — movement assertions failed too:\n  " + movement.join("\n  "));
      process.exit(1);
    }
    if (!restoration.length) {
      console.error("BLIND: the suite passed the known-bad island. It cannot detect the defect it exists for.");
      process.exit(1);
    }
    console.log(`blind case red as required — ${restoration.length} restoration assertions caught it:`);
    restoration.forEach((f) => console.log("  x " + f));
  } else {
    if (fail.length) {
      console.error("watchlist ordering FAILED:\n  " + fail.join("\n  "));
      process.exit(1);
    }
    console.log("watchlist ordering: 12 assertions passed (movement, restoration, partial, clear, idempotence)");
  }
}
