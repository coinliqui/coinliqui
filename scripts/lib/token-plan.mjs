/**
 * WHAT TO DO ABOUT THE WRANGLER TOKEN BEFORE A STEP THAT NEEDS IT — decided, not advised.
 *
 * The pre-flight used to diagnose and stop. On 17 September 2026 a deploy stopped at it with the
 * token "lapsed 15020s ago · refreshable yes" and the message "`npx wrangler whoami` will renew it
 * now" — a remedy the script knew, printed, and left for someone to remember. Run by hand it
 * renewed the token for an hour, and the deploy went through on the next try.
 *
 * Wrangler refreshes on LAPSE, not on proximity (measured 27 August 2026: whoami at 503s and 340s
 * left changed nothing; at 23s past expiry it renewed for 3581s). So there are exactly three moves:
 *
 *   ok     the token lives at least `need` more seconds
 *   renew  it has lapsed and holds a refresh grant: any wrangler call renews it now
 *   wait   it lives, but not long enough: wait `waitS` for it to lapse, then renew
 *   login  no expiry to read, or no refresh grant: only a browser login fixes it, which is the
 *          owner's to do
 */
export function tokenPlan({ left, refreshable, need }) {
  if (!Number.isFinite(left)) return { action: "login" };
  if (left >= need) return { action: "ok" };
  if (!refreshable) return { action: "login" };
  if (left <= 0) return { action: "renew" };
  return { action: "wait", waitS: left + 5 };
}
