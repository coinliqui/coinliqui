#!/usr/bin/env node
/**
 * THE PRE-FLIGHT RENEWS WHAT IT CAN RENEW, AND STOPS ONLY FOR WHAT IT CANNOT.
 *
 * Two stops on 17 September 2026 had one cause: scripts/credentials.mjs --strict read a lapsed
 * but refreshable wrangler token, printed that `npx wrangler whoami` would renew it, and exited 1.
 * The deploy waited for someone to run the command it had just named. Before that, a token inside
 * the last ten minutes of its life was refused with "wait Ns", and the wait was left to a person too.
 *
 * These cases hold tokenPlan() to the three measured facts: a lapsed token with a refresh grant
 * renews on any wrangler call; one that has not lapsed will not renew until it does; one with no
 * grant, or no readable expiry, needs a login.
 *
 *   node scripts/credential-cases.mjs
 *   node scripts/credential-cases.mjs --blind   the old stop-and-print rule, which must fail
 */
import { tokenPlan } from "./lib/token-plan.mjs";

const blind = process.argv.includes("--blind");
/** THE OLD RULE, reproduced: lapsed or absent-expiry stops; under the margin stops under --strict. */
const oldPlan = ({ left, need }) => (!Number.isFinite(left) || left <= 0 || left < need ? { action: "stop" } : { action: "ok" });
const plan = blind ? oldPlan : tokenPlan;

let bad = 0;
const ok = (cond, what, detail = "") => {
  if (cond) console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
  else { bad++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ""}`); }
};
const NEED = 600;
const said = (p) => `${p.action}${p.waitS ? ` ${p.waitS}s` : ""}`;

console.log(`\nthe wrangler token before a step that needs ${NEED}s of it${blind ? "  [BLIND: stop and print]" : ""}\n`);
{
  /* THE STOP THAT HAPPENED: 12:41 local, 17 September 2026. */
  const p = plan({ left: -15020, refreshable: true, need: NEED });
  ok(p.action === "renew", "lapsed 15020s ago with a refresh grant: renew now, do not stop", said(p));
  const q = plan({ left: -1, refreshable: true, need: NEED });
  ok(q.action === "renew", "lapsed a second ago: renew", said(q));

  /* Inside the margin nothing renews it early, so the only move that works is to wait out its life. */
  const w = plan({ left: 340, refreshable: true, need: NEED });
  ok(w.action === "wait" && w.waitS > 340 && w.waitS <= 350, "340s left: wait until it lapses, then renew", said(w));

  const fine = plan({ left: 1569, refreshable: true, need: NEED });
  ok(fine.action === "ok", "1569s left: go", said(fine));
  ok(plan({ left: NEED, refreshable: true, need: NEED }).action === "ok", "exactly the need: go");

  /* What no script can fix. */
  ok(plan({ left: -30, refreshable: false, need: NEED }).action === "login", "lapsed with no refresh grant: a login, not a renewal", said(plan({ left: -30, refreshable: false, need: NEED })));
  ok(plan({ left: 200, refreshable: false, need: NEED }).action === "login", "short with no refresh grant: waiting would only reach a dead token");
  ok(plan({ left: NaN, refreshable: true, need: NEED }).action === "login", "no readable expiry: nothing to plan from");
  ok(plan({ left: 5000, refreshable: false, need: NEED }).action === "ok", "a long-lived token needs no grant today");
}

if (blind) {
  if (!bad) { console.error("\nBLIND: stop-and-print satisfied every assertion. This suite cannot see the stops it exists for."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} assertion(s) failed against stop-and-print`);
  process.exit(0);
}
if (bad) { console.error(`\ncredential cases FAILED: ${bad}`); process.exit(1); }
console.log("\ncredential cases: a renewable token is renewed, a short one is waited out, only a dead grant stops a deploy");
