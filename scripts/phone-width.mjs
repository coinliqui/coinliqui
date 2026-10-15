#!/usr/bin/env node
/**
 * NO PAGE SCROLLS SIDEWAYS ON A PHONE.
 *
 * Every other check here reads HTML, and HTML cannot say how wide a page lays out. On 15 October
 * 2026 the day-earlier column of the liquidation table put /liquidations and every
 * /liquidations/{coin} at 445px inside a 375px phone — a sideways page scroll on the site's most
 * clicked family — and the gate, the smoke run and the live checks were all green, because none
 * of them lays a page out. This one does: a real browser at 375×812, every URL in the sitemap plus
 * the reader-set states, and the page's scroll width against its viewport.
 *
 * 320px BY DEFAULT, the narrowest phone still in use: the first run at 375 was clean after the fix,
 * and the same pages at 320 found /tools's 300px cards and a long name in /data-sources's code
 * wider than the screen. 768 and 1024 were clean. `--width=N` measures another width.
 *
 * THE BROWSER IS THE ONE ON THIS MACHINE, driven over the DevTools protocol with Node's own
 * WebSocket: no dependency is added. Analytics hosts are blocked for the run, so a self-check
 * never becomes a pageview — the 22 October measurement of /liquidations* reads those counts.
 *
 *   node scripts/phone-width.mjs [origin]
 *   node scripts/phone-width.mjs --blind    # offline: a page with a 600px element must fail
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BLIND = process.argv.includes("--blind");
const ORIGIN = (process.argv.find((a) => a.startsWith("http")) ?? "https://coinliqui.com").replace(/\/$/, "");
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
const W = Number(process.argv.find((a) => a.startsWith("--width="))?.slice(8) ?? 320), H = 812;
const BLOCK = ["*googletagmanager.com*", "*google-analytics.com*", "*cloudflareinsights.com*", "*analytics.google.com*"];
/* States a reader sets, which render different markup from the bare URL. */
const STATES = ["/liquidations?at=70000", "/open-interest?w=7d", "/open-interest?w=14d", "/funding/btc?tf=15m", "/coins/bitcoin?view=line"];

if (!CHROME) { console.error("no Chrome or Chromium found — this check cannot lay a page out"); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), "coinliqui-phone-"));
const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const done = (code) => { try { proc.kill(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); };

const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  const t = setTimeout(() => rej(new Error("Chrome did not open a DevTools port in 15s")), 15_000);
  proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
}).catch((e) => { console.error(e.message); done(1); });
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map(), waiters = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) for (const w of [...waiters]) if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); }
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const next = (method, ms) => new Promise((res) => { const w = { method, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms); });

await send("Page.enable");
await send("Network.enable");
await send("Network.setBlockedURLs", { urls: BLOCK });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (+https://coinliqui.com/about; coinliqui-selfcheck)" });

/* THE PHONE'S WIDTH IS THE CONSTANT, NOT clientWidth. With mobile emulation Chrome does what a phone
   does with an overflowing page and widens the layout viewport to fit it, so clientWidth grew with
   the overflow and the blind 600px cell measured 375 of 375 until the comparison was made against
   the 375 the phone actually has. */
/* What is wider than the viewport, named, so a failure says where to look. */
const MEASURE = `(() => {
  const vw = ${W}, sw = document.documentElement.scrollWidth;
  const wide = sw > vw ? [...document.querySelectorAll("body *")].filter((e) => {
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.right <= vw + 1) return false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return false;
      if (getComputedStyle(p).position === "fixed") return false;
    }
    return getComputedStyle(e).position !== "fixed";
  }) : [];
  const leaves = wide.filter((e) => !wide.some((c) => c !== e && e.contains(c))).slice(0, 4)
    .map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") + " →" + Math.round(e.getBoundingClientRect().right) + "px");
  return JSON.stringify({ vw, sw, leaves });
})()`;

const measure = async (url) => {
  const loaded = next("Page.loadEventFired", 30_000);
  await send("Page.navigate", { url });
  if (!(await loaded)) return { err: "did not load in 30s" };
  await new Promise((r) => setTimeout(r, 300));
  const r = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
  try { return JSON.parse(r.result.result.value); } catch { return { err: "could not measure" }; }
};

if (BLIND) {
  const doc = (body) => "data:text/html," + encodeURIComponent(`<meta name="viewport" content="width=device-width, initial-scale=1"><body>${body}</body>`);
  const narrow = await measure(doc("<p>fits</p>"));
  const wide = await measure(doc('<table><tr><td style="white-space:nowrap">a row of figures too long for a phone: $82,474.00 $79,732.00 $4.15B 10.95% shorts</td></tr></table>'));
  const scrolled = await measure(doc('<div style="overflow-x:auto"><div style="width:600px">in a scroller</div></div>'));
  const ok = narrow.sw <= narrow.vw && wide.sw > wide.vw && wide.leaves.length > 0 && scrolled.sw <= scrolled.vw;
  console.log(`  narrow ${narrow.sw}/${narrow.vw}  wide ${wide.sw}/${wide.vw} (${wide.leaves?.join(", ")})  scroller ${scrolled.sw}/${scrolled.vw}`);
  if (!ok) { console.error("BLIND: the measure did not tell a page that fits from one that scrolls sideways"); done(1); }
  console.log("blind case red as required — a row too long for a phone is caught, a page that fits and an inner scroller are not");
  done(0);
}

/* The sitemap is an index of sitemaps; each child is read in turn, one request at a time. */
const locs = async (path) => [...(await (await fetch(ORIGIN + path, { headers: { "user-agent": "Mozilla/5.0 (+https://coinliqui.com/about; coinliqui-selfcheck)" } })).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const pages = [];
for (const p of await locs("/sitemap.xml")) pages.push(...(p.endsWith(".xml") ? await locs(p) : [p]));
const paths = [...new Set(pages.concat(STATES))];
console.log(`\nphone width: ${paths.length} pages at ${W}px against ${ORIGIN}`);
let bad = 0;
for (const p of paths) {
  const r = await measure(ORIGIN + p);
  if (r.err) { bad++; console.log(`  FAIL  ${p.padEnd(40)} ${r.err}`); continue; }
  if (r.sw > r.vw) { bad++; console.log(`  FAIL  ${p.padEnd(40)} ${r.sw}px wide in a ${r.vw}px phone — ${r.leaves.join(", ") || "no single element named"}`); }
}
if (bad) { console.error(`\n  ${bad} of ${paths.length} page(s) scroll sideways or did not load on a phone`); done(1); }
console.log(`  all ${paths.length} pages fit a ${W}px phone without a sideways scroll`);
done(0);
