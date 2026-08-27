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
const [, deployedRaw, expectedRaw] = m;
/* "THE WORKER NOW RUNNING IS X" WAS READ OFF A VALUE WRITTEN BEFORE THE DEPLOY.
   That figure is whatever the worker last put in KV on its tick, so immediately after
   `wrangler deploy` it still names the PREVIOUS build. Measured on 24 August: this printed
   "worker 9b850372c52c and the live site agree" seconds after deploying abd866373f8e, which
   was wrong about both halves. It runs at the end of deploy:worker, which is exactly when the
   value is stalest.

   AND THE CADENCE IN THIS COMMENT WAS WRONG, which is why the ceiling was wrong. It said "the
   tick runs once a minute" and 150 seconds was sized from that. The stamp is written inside
   the FIVE-MINUTE ingest tick — the minute tick returns before reaching that write — so 150
   seconds is half of one chance rather than two and a half, and the same false premise sits in
   verify-live, where it does fail the deploy. It did, twice on 27 August 2026.

   THE TICK IS OBSERVED RATHER THAN TIMED. The site publishes dateModified from the same
   `fetchedAt` the five-minute tick writes, so a change in it proves a cycle completed. That
   turns one indistinguishable outcome into two: the cron has not fired yet, or it fired and
   the stamp is genuinely stale. stampVerdict() in scripts/checks.mjs holds the rule for both
   this file and verify-live, so the two cannot drift on it. */
const stampOf = (b) => (/"dateModified":"([^"]+)"/.exec(b) || [])[1] ?? null;
const dataStamp = async () => stampOf(
  await fetch(`${ORIGIN}/?cb=${Math.random()}`, { headers: { "user-agent": UA } }).then((x) => x.text()).catch(() => ""),
);
const stampAtStart = await dataStamp();
let [deployed, expected] = [deployedRaw, expectedRaw];
let tickRan = false;
for (let waited = 0; deployed !== expected && waited < 360_000; waited += 20_000) {
  await new Promise((res) => setTimeout(res, 20_000));
  const again = /Deployed <code[^>]*>([^<]*)<\/code>, site expects <code[^>]*>([^<]*)</.exec(
    await fetch(`${ORIGIN}/status?cb=${Math.random()}`, { headers: { "user-agent": UA } }).then((x) => x.text()).catch(() => ""),
  );
  if (again) [, deployed, expected] = again;
  const now = await dataStamp();
  if (stampAtStart && now && now !== stampAtStart) tickRan = true;
}
const { stampVerdict } = await import("./checks.mjs");
const verdict = stampVerdict(deployed, expected, null, tickRan || !stampAtStart);
if (verdict.state === "current") {
  console.log(`\n  stamp: worker ${deployed} and the live site agree.`);
  process.exit(0);
}
if (verdict.state === "awaiting-tick") {
  console.log(`\n  stamp: the site expects ${expected} and KV still holds ${deployed}, but no five-minute ingest\n` +
              `  tick has completed since this started — the data stamp has not moved either. Nothing is\n` +
              `  stale; the next tick records it.`);
  process.exit(0);
}
console.log(
  `\n  ─────────────────────────────────────────────────────────────────────────────\n` +
  `  STAMP SKEW: the last stamp the worker wrote is ${deployed}, the LIVE site expects ${expected}.\n` +
  `  /status is correctly reporting a mismatch. It exists because a worker deploy re-stamps\n` +
  `  the site's source, and only the worker was deployed.\n\n` +
  `      npm run deploy:site\n\n` +
  `  ─────────────────────────────────────────────────────────────────────────────`,
);
