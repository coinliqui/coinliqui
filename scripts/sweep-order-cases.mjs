/* Which bulk sweep gets the tick — src/lib/sweep-order.ts, which had no cases at all until a
   6-hour funding cycle held the slot long enough for the 2-hour m15 sweep to go stale
   (15 October 2026). `--blind` turns rule 4 off and must fail. */
import { orderSweeps } from "../src/lib/sweep-order.ts";

const blind = process.argv.includes("--blind");
const H = 3_600_000, NOW = 100 * H;
const S = (name, hours, agoH, cursor = 0, stalledSince = 0) => ({ name, hours, lastCycle: NOW - agoH * H, cursor, stalledSince });
const first = (states) => orderSweeps(states, NOW, 30 * 60_000, blind)[0]?.name;
let bad = 0;
const t = (why, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${String(got).padEnd(10)} want ${String(want).padEnd(10)} ${why}`); };

console.log("\n  sweep order");
t("a cycle in progress finishes first when nothing is badly late", first([S("funding", 6, 6.5, 20), S("m15", 2, 2.2)]), "funding");
t("a 2-hour sweep 169 minutes late goes ahead of a 6-hour cycle in progress", first([S("funding", 6, 6.8, 20), S("m15", 2, 169 / 60)]), "m15");
t("a slower sweep never preempts a faster cycle in progress", first([S("hourly", 2, 2.5, 10), S("candles", 12, 20)]), "hourly");
t("two fast sweeps: the one in progress keeps going", first([S("hourly", 2, 2.6, 10), S("m15", 2, 3)]), "hourly");
t("without a cycle in progress the most overdue by its own gate goes", first([S("funding", 6, 9), S("m15", 2, 2.4)]), "funding");
t("a sweep in backoff is skipped even when urgent", first([S("funding", 6, 6.8, 20), S("m15", 2, 3, 0, NOW - 60_000)]), "funding");

if (blind) {
  if (!bad) { console.error("\nBLIND: the order without rule 4 satisfied every case. This suite cannot see a starved fast sweep."); process.exit(1); }
  console.log(`\nblind case red as required — ${bad} case(s) failed without rule 4`);
  process.exit(0);
}
if (bad) { console.error(`\n  ${bad} case(s) failed`); process.exit(1); }
console.log("\n  the tick goes where the charts need it, and a slow cycle is delayed rather than dropped");
