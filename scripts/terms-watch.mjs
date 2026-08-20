#!/usr/bin/env node
/**
 * A CLOCK ON OUR OWN LEGAL DILIGENCE. IT MAKES NO NETWORK REQUEST, AND THAT IS THE DESIGN.
 *
 * THE RISK IT ADDRESSES. Since 19 August 2026 this site has one upstream. Of the ways Hyperliquid
 * can fail, three — an outage, a rate limit, a response shape that will not parse — arrive as
 * stale data and are now described honestly by src/lib/freshness.ts. The fourth has no technical
 * symptom at all: Hyperliquid publishes an API-scoped or data-scoped instrument and the site's
 * entire legal position evaporates while every page keeps rendering perfectly. Nothing would
 * detect it. The first signal would be a letter.
 *
 * WHY THIS DOES NOT FETCH ANYTHING, WHICH IS THE WHOLE POINT.
 *
 * The obvious build is a weekly worker job that GETs app.hyperliquid.xyz/terms and diffs its
 * "Last updated" line. That job would have this production service making an automated, recurring
 * request to the Interface — and the site's position, the one everything rests on, is that we
 * never load the Interface and are therefore not bound by a document scoped to it. Monitoring the
 * contract by doing the one thing the contract binds on is a bad trade: it risks the argument in
 * order to watch the argument.
 *
 * A person opening the terms page to understand their own obligations is a different act from a
 * service consuming an interface to obtain data, and that distinction is defensible. But it is a
 * distinction that survives a human with a browser and would not survive a cron job in the
 * evidence. So the human keeps doing it, and this counts the days since they last did.
 *
 * WHAT IT ACTUALLY ASSERTS: every document the site depends on has been read by a person within
 * reviewEveryDays, and the reading is written down — the date on the document, the date we read
 * it, how we read it, what it said, and what would change the answer. An entry with no finding is
 * treated as unread, because a baseline that records only a date proves nothing was understood.
 *
 * UNREADABLE IS NOT UNCHANGED. Both of the documents that matter needed a browser: Hyperliquid's
 * is a JS application that serves a shell to curl, and Coinbase's returned 403 to three plain
 * fetches and was recorded as "unreadable" for two audits before a browser loaded it first try.
 * A fetcher would have reported "no change detected" on both. That is the failure this shape
 * avoids.
 *
 *   node scripts/terms-watch.mjs [--asOf YYYY-MM-DD]
 *   node scripts/terms-watch.mjs --blind
 */
import { readFileSync } from "node:fs";

const DAY = 86_400_000;

export function overdue(docs, defaultDays, asOf) {
  const out = [];
  for (const d of docs) {
    const missing = ["id", "url", "readAt", "finding", "watchFor"].filter((k) => !d[k] || String(d[k]).trim() === "");
    if (missing.length) { out.push({ id: d.id ?? "(unnamed)", days: null, why: `baseline entry is incomplete: ${missing.join(", ")} — an entry without a finding records a date, not a reading` }); continue; }
    const read = Date.parse(`${d.readAt}T00:00:00Z`);
    if (!Number.isFinite(read)) { out.push({ id: d.id, days: null, why: `readAt "${d.readAt}" is not a date` }); continue; }
    const days = Math.floor((asOf - read) / DAY);
    /* PER DOCUMENT, BECAUSE THE INTERVAL IS AN EXPOSURE WINDOW RATHER THAN A GUESS AT CHURN.
       Hyperliquid's terms are the whole legal basis for the site and get 30 days; the other two
       are documents we do not currently depend on and get 90. See intervalReason on each. */
    const every = Number.isInteger(d.reviewEveryDays) ? d.reviewEveryDays : defaultDays;
    if (days < 0) out.push({ id: d.id, days, why: `readAt is in the future — a clock is wrong` });
    else if (days > every) out.push({ id: d.id, days, why: `last read ${days} days ago, review is due every ${every}` });
  }
  return out;
}

if (process.argv.includes("--blind")) {
  const base = { id: "x", url: "u", readAt: "2026-08-19", finding: "f", watchFor: "w" };
  const NOW = Date.parse("2026-08-19T00:00:00Z");
  const cases = [
    ["a document read today", [base], 90, NOW, null],
    ["a document read exactly at the limit", [{ ...base, readAt: "2026-05-21" }], 90, NOW, null],
    ["a document one day past the limit", [{ ...base, readAt: "2026-05-20" }], 90, NOW, /review is due every 90/],
    ["a document read years ago", [{ ...base, readAt: "2023-01-01" }], 90, NOW, /last read \d+ days ago/],
    ["an entry with no finding recorded", [{ ...base, finding: "" }], 90, NOW, /records a date, not a reading/],
    ["an entry with no watchFor", [{ ...base, watchFor: "" }], 90, NOW, /incomplete/],
    ["an unparseable readAt", [{ ...base, readAt: "soon" }], 90, NOW, /is not a date/],
    ["a readAt in the future", [{ ...base, readAt: "2027-01-01" }], 90, NOW, /clock is wrong/],
    ["one stale among three fresh", [base, base, { ...base, readAt: "2020-01-01" }], 90, NOW, /last read/],
    /* THE PER-DOCUMENT OVERRIDE, both directions. A document with a shorter window must go
       overdue while the default would still clear it, and one with a longer window must clear
       while the default would flag it — otherwise the field is decoration. */
    ["a 30-day document at 45 days, default 90", [{ ...base, readAt: "2026-07-05", reviewEveryDays: 30 }], 90, NOW, /due every 30/],
    ["a 180-day document at 100 days, default 90", [{ ...base, readAt: "2026-05-11", reviewEveryDays: 180 }], 90, NOW, null],
  ];
  let bad = 0;
  for (const [name, docs, every, now, want] of cases) {
    const r = overdue(docs, every, now);
    const hit = want ? r.some((x) => want.test(x.why)) : r.length === 0;
    if (!hit) { bad++; console.log(`  BLIND  ${name}`); console.log(`         got: ${r.map((x) => x.why).join(" | ") || "(clean)"}`); }
    else console.log(`  ok     ${want ? "FLAGS " : "CLEARS"} ${name}`);
  }
  console.log(bad ? `\n  ${bad} BLIND SPOT(S)\n` : `\n  ${cases.length} cases: the clock flags every way a reading can be missing or stale\n`);
  process.exit(bad ? 1 : 0);
}

const argAsOf = process.argv.indexOf("--asOf");
const asOf = argAsOf > -1 ? Date.parse(`${process.argv[argAsOf + 1]}T00:00:00Z`) : Date.now();
const base = JSON.parse(readFileSync(new URL("../src/data/terms-baseline.json", import.meta.url), "utf8"));
const late = overdue(base.documents, base.reviewEveryDaysDefault, asOf);

console.log(`\n  ${base.documents.length} document(s) this site depends on\n`);
for (const d of base.documents) {
  const days = Math.floor((asOf - Date.parse(`${d.readAt}T00:00:00Z`)) / DAY);
  const flag = late.find((l) => l.id === d.id);
  console.log(`  ${flag ? "DUE " : "ok  "}  ${d.id.padEnd(22)} read ${Number.isFinite(days) ? `${days}d ago` : d.readAt} of ${d.reviewEveryDays ?? base.reviewEveryDaysDefault}d · document dated ${d.lastUpdatedOnDocument}`);
  console.log(`         ${d.url}`);
}
if (late.length) {
  console.log(`\n  ${late.length} DOCUMENT(S) DUE FOR A HUMAN RE-READ:\n`);
  for (const l of late) console.log(`    - ${l.id}: ${l.why}`);
  console.log(`\n  Open each in a browser — a plain fetch is not a reading, and both of the documents`);
  console.log(`  that matter here served a shell or a 403 to one. Update readAt, lastUpdatedOnDocument`);
  console.log(`  and finding in src/data/terms-baseline.json when you have actually read it.\n`);
  process.exit(1);
}
console.log(`\n  every document has been read by a person inside its own review window\n`);
