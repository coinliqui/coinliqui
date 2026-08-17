#!/usr/bin/env node
/**
 * EVERY contract page, EVERY timeframe panel. Not a sample.
 *
 * Spot checks had covered a handful of symbols; this walks all 50 from the sitemap and all 200
 * panels, because the defects this site produces hide in the ones nobody opens — a thin symbol,
 * a k-prefixed one, the timeframe that is not the default.
 *
 * Structural: a panel exists, exactly one is active, no NaN/Infinity/undefined reaches the SVG,
 * no path point escapes the viewBox, and no SVG node is styled by CLASS — Astro's scoped styles
 * never reach markup injected with set:html, so a class-styled chart renders black on black.
 *
 * Run periodically, not on every push: 50 live fetches is too slow for a gate. The cheap half —
 * the chart agreeing with the figures printed beside it — runs in the gate on the contract pages
 * it already renders (scripts/checks.mjs, chartAgreement).
 *
 *   node scripts/sweep-charts.mjs
 */
import { chartAgreement } from "./checks.mjs";
const O = process.argv[2] || "https://coinliqui.com";
const syms = [...(await (await fetch(`${O}/sitemaps/funding-symbols.xml`)).text())
  .matchAll(/<loc>[^<]*\/funding\/([a-z0-9]+)<\/loc>/g)].map(m => m[1]);
console.log(`symbols in sitemap: ${syms.length}\n`);

const problems = [];
let panels = 0, empties = 0;
for (const s of syms) {
  const r = await fetch(`${O}/funding/${s}`);
  const h = await r.text();
  if (r.status !== 200) { problems.push([s, "-", `status ${r.status}`]); continue; }
  if (/Candles not collected yet/.test(h)) { empties++; continue; }

  const tf = [...h.matchAll(/data-tfpanel="([^"]+)"([^>]*)>/g)];
  if (!tf.length) { problems.push([s, "-", "no timeframe panels at all"]); continue; }
  const on = tf.filter(m => /data-on/.test(m[2]));
  if (on.length !== 1) problems.push([s, "-", `${on.length} panels marked active, expected 1`]);

  for (const [, name] of tf) {
    panels++;
    // the panel's own points array and its svg
    const seg = h.split(`data-tfpanel="${name}"`)[1]?.slice(0, 400000) ?? "";
    const svg = (seg.match(/<svg[\s\S]*?<\/svg>/) ?? [""])[0];
    if (!svg) { problems.push([s, name, "panel has no <svg>"]); continue; }

    if (/NaN|Infinity|undefined|null/.test(svg)) problems.push([s, name, "NaN/Infinity/undefined in the SVG"]);

    // every path must stay inside the declared viewBox
    const vb = (svg.match(/viewBox="([^"]+)"/) ?? [, ""])[1].split(/\s+/).map(Number);
    if (vb.length === 4) {
      const [, , vw, vh] = vb;
      for (const p of svg.matchAll(/ d="([^"]+)"/g)) {
        const nums = [...p[1].matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
        for (let i = 0; i + 1 < nums.length; i += 2) {
          if (nums[i] < -2 || nums[i] > vw + 2 || nums[i + 1] < -2 || nums[i + 1] > vh + 2) {
            problems.push([s, name, `path point (${nums[i]},${nums[i+1]}) outside viewBox ${vw}x${vh}`]);
            i = nums.length;
          }
        }
      }
    }
    // A class-styled SVG renders black-on-black: Astro scoping never reaches set:html markup.
    const classed = [...svg.matchAll(/<(path|rect|circle|line|text)[^>]*class="/g)];
    if (classed.length) problems.push([s, name, `${classed.length} SVG nodes use class= instead of presentation attributes`]);
  }
}
/* SEMANTIC HALF: the chart against the figures printed beside it, using the SAME function the
   pre-push gate runs, so the sweep and the gate cannot drift into disagreeing about what
   "agrees" means. */
const dis = [];
for (const s of syms) {
  const h = await (await fetch(`${O}/funding/${s}`)).text();
  for (const d of chartAgreement(h)) dis.push([s, d]);
}
console.log(`panels checked: ${panels}   pages awaiting candles: ${empties}`);
console.log(dis.length ? `\nCHART/PROSE DISAGREEMENTS (${dis.length}):` : `chart agrees with its printed figures on all ${syms.length} symbols`);
for (const [s, d] of dis.slice(0, 10)) console.log(`  ${s.padEnd(10)} ${d}`);
console.log(problems.length ? `\nPROBLEMS (${problems.length}):` : "\nno structural problems across every symbol and timeframe");
const seen = new Set();
for (const [s, tf, msg] of problems) {
  const k = tf + msg.replace(/[\d.,()-]/g, "");
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  ${s.padEnd(10)} ${tf.padEnd(6)} ${msg}`);
}
if (problems.length > seen.size) console.log(`  … ${problems.length - seen.size} more of the same shapes`);
