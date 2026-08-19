#!/usr/bin/env node
/**
 * DID DEPLOYING THE WORKER LEAVE THE LIVE SITE ADVERTISING A STALE STAMP?
 *
 * scripts/stamp-worker.mjs writes one hash into TWO files: WORKER_BUILD in worker/build-stamp.ts
 * and EXPECTED_WORKER_BUILD in src/lib/version.ts. /status renders both and says whether they
 * agree, which is how a worker running code the site was not built alongside becomes visible.
 *
 * The consequence nobody had noticed: a worker deploy re-stamps the SITE's source too, so
 * deploying the worker alone leaves the deployed site advertising the previous hash. Found by
 * running verify-live for the first time after wiring it into deploy:site — "worker bundle stale:
 * deployed 8a4aebe588b1, expected 48ca5a783ca6" — after two worker deploys with no site deploy
 * between them. Nothing was broken; /status was simply telling readers a true thing about a
 * mismatch that only existed because of the deploy order.
 *
 * THIS DOES NOT FAIL. The worker deploy already succeeded by the time it runs, and a non-zero
 * exit after a successful deploy is the shape people learn to ignore — the same argument that
 * keeps flips-parity out of the deploy path. It prints, loudly, what to run. The safety net is
 * that verify-live fails on the skew at the next site deploy, and verify-live now always runs.
 */
const ORIGIN = process.argv[2] || "https://coinliqui.com";
const UA = "coinliqui-selfcheck (+https://coinliqui.com/about)";

const r = await fetch(`${ORIGIN}/status?cb=${Math.random().toString(36).slice(2)}`, { headers: { "user-agent": UA } })
  .catch((e) => ({ ok: false, err: e }));
if (!r || !r.ok) {
  console.log(`\n  stamp skew: could not read ${ORIGIN}/status (${r?.status ?? r?.err?.message ?? "no response"}) — not asserting anything.`);
  process.exit(0);
}
const body = await r.text();
const m = /Deployed <code[^>]*>([^<]*)<\/code>, site expects <code[^>]*>([^<]*)</.exec(body);
if (!m) {
  console.log("\n  stamp skew: /status no longer prints the deployed/expected pair — this notice is blind, fix the selector.");
  process.exit(0);
}
const [, deployed, expected] = m;
if (deployed === expected) {
  console.log(`\n  stamp: worker ${deployed} and the live site agree.`);
  process.exit(0);
}
console.log(
  `\n  ─────────────────────────────────────────────────────────────────────────────\n` +
  `  STAMP SKEW: the worker now running is ${deployed}, the LIVE site still expects ${expected}.\n` +
  `  /status is correctly reporting a mismatch. It exists because a worker deploy re-stamps\n` +
  `  the site's source, and only the worker was deployed.\n\n` +
  `      npm run deploy:site\n\n` +
  `  ─────────────────────────────────────────────────────────────────────────────`,
);
