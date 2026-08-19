#!/usr/bin/env node
/**
 * THE CHECK THAT HAD NEVER RUN, AND WOULD HAVE BEEN BLIND IF IT HAD.
 *
 * scripts/checks.mjs exported `extractionRatio`, the comment above it named it the authority on
 * payload size, and a grep across the repository found the definition and that comment and
 * nothing else. It had never been invoked. It also counted <script> against prose on a site
 * whose weight is <svg>: /liquidations/survival is 524,790 bytes, of which 479,013 (91%) is
 * inline svg and 4,133 (0.8%) is script. The old ratio reports about 0.7 there and passes, with
 * nine tenths of the page outside its view.
 *
 * The first case below is that exact shape. An implementation that counts only scripts cannot
 * name svg as dominant, so it cannot pass this file — which is the property the old one lacked.
 */
import { pageWeight, weightFaults, WEIGHT_LIMITS } from "./checks.mjs";

const page = ({ svg = 0, script = 0, style = 0, template = 0, words = 0 }) =>
  `<html><body>` +
  (svg ? `<svg>${"M0 0L1 1".repeat(Math.max(1, Math.floor(svg / 8)))}</svg>` : "") +
  (script ? `<script>${"x".repeat(script)}</script>` : "") +
  (style ? `<style>${"y".repeat(style)}</style>` : "") +
  (template ? `<template>${"z".repeat(template)}</template>` : "") +
  `<p>${Array.from({ length: words }, (_, i) => `word${i}`).join(" ")}</p>` +
  `</body></html>`;

let bad = 0;
const check = (name, cond, detail = "") => {
  if (!cond) bad++;
  console.log(`  ${cond ? "ok  " : "MISS"}  ${name.padEnd(58)} ${detail}`);
};

/* 1. The live shape: overwhelmingly svg, scripts negligible, plenty of prose. */
{
  const w = pageWeight(page({ svg: 479_000, script: 4_100, words: 1060 }));
  check("a 91%-svg page names svg as dominant, not script",
    w.dominant.kind === "svg" && w.dominant.pct > 85, `dominant ${w.dominant.kind} ${w.dominant.pct}%`);
  check("  …and it is NOT a fault — a heatmap is what that page is for",
    weightFaults(w).length === 0, `${w.bytesPerWord} bytes/word, reported not gated`);
}

/* 2. The two gated conditions, each alone. */
{
  const over = pageWeight(page({ svg: 1_100_000, words: 800 }));
  const f = weightFaults(over);
  check("over a megabyte fails, and the message names the dominant kind",
    f.length === 1 && /exceeds/.test(f[0]) && /svg/.test(f[0]), f[0]?.slice(0, 62));
}
{
  const thin = pageWeight(page({ svg: 40_000, words: 100 }));
  const f = weightFaults(thin);
  check("under 150 words of prose fails",
    f.length === 1 && /under 150/.test(f[0]), f[0]?.slice(0, 62));
}
{
  const both = pageWeight(page({ svg: 1_200_000, words: 20 }));
  check("a page breaching both limits reports both", weightFaults(both).length === 2);
}

/* 3. The real extremes must stay clean, or the limits are gating taste rather than breakage. */
{
  const survival = pageWeight(page({ svg: 479_013, script: 4_133, words: 1060 }));
  const tools = pageWeight(page({ script: 3_000, style: 600, words: 224 }));
  check("today's heaviest real page passes", weightFaults(survival).length === 0, `${survival.total.toLocaleString()}B`);
  check("today's thinnest real page passes", weightFaults(tools).length === 0, `${tools.words} words`);
}

/* 4. Degenerate input must not throw or silently score well. */
{
  const empty = pageWeight("");
  check("an empty body is Infinity bytes/word, not 0", empty.bytesPerWord === Infinity, `words ${empty.words}`);
  check("  …and it fails the prose floor", weightFaults(empty).length >= 1);
  const noProse = pageWeight(page({ svg: 200_000, words: 0 }));
  check("all graphic and no prose fails the floor", weightFaults(noProse).some((f) => /under 150/.test(f)));
}

/* 5. The limits themselves must stay roughly 2x from the live extremes, or they have drifted
      into gating design. Stated as an assertion so a future edit has to justify itself. */
check("the byte ceiling is at least 1.5x the heaviest real page",
  WEIGHT_LIMITS.maxTotalBytes >= 525_000 * 1.5, `${WEIGHT_LIMITS.maxTotalBytes.toLocaleString()} vs 525,000`);
check("the prose floor is comfortably under the thinnest real page",
  WEIGHT_LIMITS.minWords <= 224 * 0.75, `${WEIGHT_LIMITS.minWords} vs 224`);

if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  page weight: every kind counted, the dominant one named, and only breakage gated");
