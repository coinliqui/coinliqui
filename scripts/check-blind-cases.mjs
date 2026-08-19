#!/usr/bin/env node
/**
 * A CHECK THAT HAS NEVER PRODUCED A FINDING IS INDISTINGUISHABLE FROM ONE THAT CANNOT.
 *
 * Measured, not assumed. checks.mjs was instrumented so every exported function recorded its
 * calls and whether it returned a non-empty finding list, and the full `npm run check` was run
 * against it. Of 27 exports — 25 finding-returning checks and 2 measurement functions —
 *
 *   0  were never called          (extractionRatio was the last one, fixed the cycle before)
 *   4  were observed to fire      flipTableColour, inlineScriptSyntax, sitemapLastmodHonesty,
 *                                 weightFaults
 *  21  ran and returned empty     every gate, every time
 *
 * Twenty-one of twenty-five is 84% of the suite reporting green that has never been falsified.
 * Several of those had a fault injected BY HAND at the time they were written — that proves the
 * check once and proves nothing after the next refactor. This file is the standing version: one
 * fixture per check, built to make it fire, run on every gate.
 *
 * The audit harness needed its own blind case too. Its first version counted any truthy return
 * as "fired", which scored pageWeight 33/33 — pageWeight returns a measurement object and is
 * truthy on every call. Return shape is now recorded, and the question is only asked of checks
 * that return a list.
 *
 * Fixtures are added a batch per cycle; the coverage line at the bottom is the number to watch.
 */
import {
  hiddenFromEveryone, dateModifiedAgreement, breadcrumbAgreement, publishesAPerson,
  contradictoryStates, rawEnums, founderAgreement, readmeCounts,
} from "./checks.mjs";

/* Enough page for a check to have something to read. Deliberately minimal: a fixture that is
   almost a real page hides which detail made the check fire. */
const doc = (body, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const cases = [
  {
    check: "hiddenFromEveryone",
    why: "text present in the DOM and hidden by CSS is redacted from a browser and from nothing else",
    fire: () => hiddenFromEveryone(doc(
      `<style>.gone{display:none}</style><div class="gone">Not updating</div>`)),
    quiet: () => hiddenFromEveryone(doc(`<div>Updated 2 min ago</div>`)),
  },
  {
    check: "contradictoryStates",
    why: "a page carrying both an age and a claim it is not updating tells two stories at once",
    fire: () => contradictoryStates(doc(`<p>Updated 3 min ago</p><p>Not updating</p>`)),
    quiet: () => contradictoryStates(doc(`<p>Updated 3 min ago</p>`)),
  },
  {
    check: "rawEnums",
    why: "an upstream's internal venue code reaching the reader is a leak of the data layer",
    fire: () => rawEnums(doc(`<p>Funding on HlPerp is 12%</p>`)),
    quiet: () => rawEnums(doc(`<p>Funding on Hyperliquid is 12%</p>`)),
  },
  {
    check: "dateModifiedAgreement",
    why: "the date the machine layer states must be the date the page states",
    fire: () => dateModifiedAgreement(doc(
      `<span data-fresh="1780000000000"></span>` +
      `<script type="application/ld+json">{"dateModified":"2020-01-01T00:00:00.000Z"}</script>`)),
    quiet: () => dateModifiedAgreement(doc(
      `<span data-fresh="1780000000000"></span>` +
      `<script type="application/ld+json">{"dateModified":"${new Date(1780000000000).toISOString()}"}</script>`)),
  },
  {
    check: "breadcrumbAgreement",
    why: "a BreadcrumbList that disagrees with the visible crumb shapes the search result wrongly",
    fire: () => breadcrumbAgreement(doc(
      `<p class="crumb"><a href="/funding">Funding</a> › BTC</p>`,
      `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[` +
      `{"@type":"ListItem","position":1,"name":"Coins"},{"@type":"ListItem","position":2,"name":"BTC"}]}</script>`)),
    quiet: () => breadcrumbAgreement(doc(
      `<p class="crumb"><a href="/funding">Funding</a> › BTC</p>`,
      `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[` +
      `{"@type":"ListItem","position":1,"name":"Funding"},{"@type":"ListItem","position":2,"name":"BTC"}]}</script>`)),
  },
  {
    check: "publishesAPerson",
    why: "a personal email in the markup is the exact leak that got an address harvested once",
    fire: () => publishesAPerson(doc(`<a href="mailto:someone@icloud.com">write to me</a>`)),
    quiet: () => publishesAPerson(doc(`<a href="mailto:hello@coinliqui.com">contact</a>`)),
  },
  {
    check: "founderAgreement",
    why: "the page and the structured data must not half-ship a name",
    fire: () => founderAgreement(doc(
      `<p>The project is independently run.</p>`,
      `<script type="application/ld+json">{"founder":{"@type":"Person","name":"A Name"}}</script>`)),
    quiet: () => founderAgreement(doc(`<p>The project is independently run.</p>`)),
  },
  {
    check: "readmeCounts",
    why: "a hardcoded count in the README goes stale the moment a contract crosses the floor",
    fire: () => readmeCounts("# x\n\nIt covers 50 contracts across 3 venues.\n"),
    quiet: () => readmeCounts("# x\n\nIt covers every contract above the open-interest floor.\n"),
  },
];

let bad = 0;
for (const c of cases) {
  const f = c.fire(), q = c.quiet();
  const fires = Array.isArray(f) ? f.length > 0 : Boolean(f);
  const quiet = Array.isArray(q) ? q.length === 0 : !q;
  if (!fires) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} did NOT fire on a fixture built to make it fire`); continue; }
  if (!quiet) { bad++; console.log(`  MISS  ${c.check.padEnd(24)} fired on the clean fixture too — it cannot tell them apart`); console.log(`          ${JSON.stringify(q).slice(0, 140)}`); continue; }
  console.log(`  ok    ${c.check.padEnd(24)} fires on the fault, silent on the clean page  — ${c.why}`);
}

/* THE COVERAGE LINE IS THE POINT. 25 finding-returning checks exist; this is how many have a
   standing fixture proving they can fire. Four more were already proven by cases living in
   blind-cases.mjs, sitemap-honesty.mjs and weight-cases.mjs. */
const PROVEN_ELSEWHERE = ["flipTableColour", "inlineScriptSyntax", "sitemapLastmodHonesty", "weightFaults"];
const TOTAL_CHECKS = 25;
const covered = new Set([...cases.map((c) => c.check), ...PROVEN_ELSEWHERE]).size;
if (bad) { console.error(`\n  ${bad} case(s) wrong`); process.exit(1); }
console.log(`\n  ${covered} of ${TOTAL_CHECKS} finding-returning checks now have a standing fixture that proves they fire`);
console.log(`  ${TOTAL_CHECKS - covered} still report green that has never been falsified — the number to drive down`);
