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
/* THE BREACH FIXTURES HAD TO BE REBUILT WHEN THE CEILING MOVED TO THE WIRE FIGURE, and the
   reason is the point of the change. `page({ svg: 1_100_000 })` repeats one path command
   137,500 times: over a megabyte uncompressed and about three hundred bytes transferred. Under
   the old limit that "breached"; under the new one it does not, because it costs a reader
   nothing. To breach a transfer ceiling a page has to carry bytes that do not compress, so
   these build high-entropy content instead of repetition. Deterministic, because a fixture
   that varies between runs is one nobody can debug. */
const noise = (n) => { let s = "", x = 7; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += String.fromCharCode(48 + (x % 74)); } return s; };
/* THE BREACH IS TESTED AGAINST A SCALED CEILING, not by fabricating a page big enough to beat
   the real one. Getting 300 KB PAST brotli takes roughly a megabyte of genuinely incompressible
   bytes, and a fixture that spends its effort defeating a compressor is testing the compressor.
   weightFaults already takes its limits as an argument; the rule is what these cases are for,
   and the real ceiling is asserted separately in section 5 against the real heaviest page. */
const SMALL = { maxWireBytes: 5_000, minWords: 150 };
{
  const over = pageWeight(page({ script: 420_000, words: 800 }).replace(/x{100,}/, noise(420_000)));
  const f = weightFaults(over, SMALL);
  check("a page too heavy OVER THE WIRE fails, and the message names the dominant kind",
    f.length === 1 && /over the wire/.test(f[0]) && /script/.test(f[0]), f[0]?.slice(0, 70));
}
{
  const thin = pageWeight(page({ svg: 40_000, words: 100 }));
  const f = weightFaults(thin);
  check("under 150 words of prose fails",
    f.length === 1 && /under 150/.test(f[0]), f[0]?.slice(0, 62));
}
{
  const both = pageWeight(page({ script: 420_000, words: 20 }).replace(/x{100,}/, noise(420_000)));
  check("a page breaching both limits reports both", weightFaults(both, SMALL).length === 2);
}
/* AND THE CASE THE CHANGE EXISTS FOR: a megabyte of repetition is no longer a fault, because
   it is not a megabyte to anybody downloading it. Without this, moving the ceiling back to the
   uncompressed size would pass every other case in this file. */
{
  const repetitive = pageWeight(page({ svg: 1_100_000, words: 800 }));
  check("a megabyte of repeated markup is NOT a fault — it is a few hundred bytes on the wire",
    weightFaults(repetitive).length === 0,
    `${repetitive.total.toLocaleString()}B raw -> ${repetitive.wireBytes?.toLocaleString()}B wire`);
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
      into gating design. Stated as an assertion so a future edit has to justify itself.

      THE CEILING MOVED TO THE WIRE FIGURE ON 27 AUGUST 2026, and the old one was measuring
      something no reader pays. Production, same day: /liquidations/survival is 527,309 bytes
      uncompressed and 24,417 over the wire — 21.6x, because a heatmap grid is enormously
      repetitive and brotli crushes it. The heaviest page on this site costs 45 KB. A ceiling
      of 1,000,000 uncompressed was therefore a real-transfer ceiling of roughly 48 KB on the
      pages that matter: a limit nobody chose and nobody could see. */
check("the wire ceiling is at least 1.5x the heaviest real page's transfer",
  WEIGHT_LIMITS.maxWireBytes >= 45_000 * 1.5, `${WEIGHT_LIMITS.maxWireBytes.toLocaleString()} vs 45,000 over the wire`);
/* The instrument must actually compress. A null wireBytes falls back to the uncompressed size,
   which silently restores the old behaviour — that is exactly what the first version of this
   did, because `require` inside an ES module throws and the throw was caught. */
{
  const w = pageWeight(page({ svg: 200_000, words: 400 }));
  check("wireBytes is a real compressed size, not a swallowed error",
    Number.isFinite(w.wireBytes) && w.wireBytes > 0 && w.wireBytes < w.total,
    `${w.total.toLocaleString()} -> ${w.wireBytes === null ? "null" : w.wireBytes.toLocaleString()}`);
  check("the fault names the transferred figure, not the uncompressed one",
    weightFaults({ ...w, wireBytes: WEIGHT_LIMITS.maxWireBytes + 1 }).some((f) => /over the wire/.test(f)));
}
check("the prose floor is comfortably under the thinnest real page",
  WEIGHT_LIMITS.minWords <= 224 * 0.75, `${WEIGHT_LIMITS.minWords} vs 224`);

if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log("\n  page weight: every kind counted, the dominant one named, and only breakage gated");
