#!/usr/bin/env node
/**
 * THE DECISION THAT PUTS A LINK ON SEVENTY-NINE PAGES, AND EVERY WAY IT COULD GO WRONG.
 *
 * The site's only external claim about itself used to be a compile-time constant, and it spent
 * days asserting a URL that returned 404 to every signed-out reader. It is now a runtime
 * decision taken from what a daily worker probe measured — which fixes that failure and creates
 * four new ones, because a value that used to be typed by hand now arrives from KV:
 *
 *   - a record for a URL nobody put in the allow-list could inject markup into every page;
 *   - a stale `ok` could keep the claim standing long after the probe stopped running;
 *   - a malformed or missing record could throw during render, or worse, be read as consent;
 *   - a clock skew could make a record from the future look infinitely fresh.
 *
 * Each is a case below, and each has its counterpart — the input that MUST publish — because a
 * gate that only proves "publishes nothing" is satisfied by a function that always returns [].
 */
import { publishable, reachRows, CANDIDATES, MAX_AGE_MS } from "../src/lib/corroboration.ts";

const NOW = 1_787_000_000_000;
const URL0 = CANDIDATES[0];
const rec = (o) => ({ url: URL0, ok: true, status: 200, at: NOW - 3_600_000, ...o });

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? console.log(`  ok    ${name}`) : (bad++, console.log(`  FAIL  ${name}\n          got ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`));
};

console.log("\n  what may be published\n");
eq("a fresh 200 is published — the case that proves the rest are not vacuous", publishable([rec()], NOW), [URL0]);
eq("a 404 is not", publishable([rec({ ok: false, status: 404 })], NOW), []);
eq("a 403 is not — a reader who cannot read it cannot verify us", publishable([rec({ ok: false, status: 403 })], NOW), []);
eq("no answer at all is not", publishable([rec({ ok: false, status: null })], NOW), []);
eq("ok:'true' as a string is not — only the boolean counts", publishable([rec({ ok: "true" })], NOW), []);

console.log("\n  freshness: a stored yes is not evidence for ever\n");
eq("one hour old publishes", publishable([rec({ at: NOW - 3_600_000 })], NOW), [URL0]);
eq("one hour inside the limit publishes", publishable([rec({ at: NOW - MAX_AGE_MS + 3_600_000 })], NOW), [URL0]);
eq("one hour past the limit does not — a probe that stopped must not leave the claim standing", publishable([rec({ at: NOW - MAX_AGE_MS - 3_600_000 })], NOW), []);
eq("dated in the future does not — that is a broken clock, not fresh evidence", publishable([rec({ at: NOW + 86_400_000 })], NOW), []);

console.log("\n  the allow-list: KV now decides markup on every page, so it may not decide the URL\n");
eq("a reachable URL nobody declared is ignored", publishable([{ url: "https://evil.example/coinliqui", ok: true, status: 200, at: NOW }], NOW), []);
eq("...even alongside a real one, and the real one still publishes",
  publishable([{ url: "https://evil.example/x", ok: true, status: 200, at: NOW }, rec()], NOW), [URL0]);
eq("a personal-namespace URL is ignored like any other undeclared one",
  publishable([{ url: "https://github.com/some-person/coinliqui", ok: true, status: 200, at: NOW }], NOW), []);

console.log("\n  absence is silence, and never a throw\n");
for (const [name, input] of [["null", null], ["undefined", undefined], ["an empty array", []], ["a string", "yes"],
  ["an object", { ok: true }], ["an array of nulls", [null, undefined]], ["an array of strings", ["x"]],
  ["a record with no url", [{ ok: true, at: NOW }]], ["a record with no at", [{ url: URL0, ok: true }]]]) {
  let got;
  try { got = publishable(input, NOW); } catch (e) { got = `THREW ${e.message}`; }
  eq(`${name} publishes nothing`, got, []);
}

console.log("\n  /status must be able to tell the three silences apart\n");
const state = (r) => reachRows(r, NOW)[0].state;
eq("never checked", state(null), "never checked");
eq("unreachable", state([rec({ ok: false, status: 404 })]), "unreachable");
eq("stale", state([rec({ at: NOW - MAX_AGE_MS - 1 })]), "stale");
eq("published", state([rec()]), "published");
eq("a candidate with no record of its own still gets a row", reachRows([{ url: "https://other.example", ok: true, status: 200, at: NOW }], NOW).map((r) => r.state), ["never checked"]);
eq("no answer reads as no answer, not as a status code", reachRows([rec({ ok: false, status: null })], NOW)[0].detail.startsWith("no answer"), true);

/* THE BLIND CASE FOR THE WHOLE FILE. Every assertion above is about a function returning [].
   A function that returns [] unconditionally passes all but one of them, so the suite must
   fail if the publishing path ever stops working — and must say so in those words. */
if (!publishable([rec()], NOW).length) {
  bad++;
  console.log("\n  FAIL  publishable() never publishes anything — every case above is vacuously satisfied");
}

console.log(bad ? `\n  ${bad} case(s) wrong\n` : "\n  the link publishes when it resolves, and in no other circumstance\n");
process.exit(bad ? 1 : 0);
