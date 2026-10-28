-- Arrivals from outside the site, counted on the server, one row per (day, page, source, kind, device).
--
-- WHY. Measured 28 October 2026: human entries fell by about half from mid-October and the only
-- instruments that could say from where were Cloudflare Web Analytics, which samples 1 in 10 and
-- strips the referrer, and GA4, which needs a Google login this machine does not have. On 49 and
-- 17 sampled events the day of the fall could not be seen. This counts every navigation a browser
-- makes to a page, without JavaScript and without sampling. The rules are in src/lib/entries.ts.
--
-- WHAT IT HOLDS, AND WHAT IT DOES NOT. A date, a path, a source host (the utm_source a link
-- carried, or the referring host), how the browser said it arrived (typed or bookmarked, from
-- another site, or from a page of this one), and phone or desktop. No IP address, no user-agent
-- string, no cookie, no identifier: a row is a count, and nothing in it can be joined to a person.
CREATE TABLE IF NOT EXISTS entry_day (
  day    TEXT NOT NULL,
  path   TEXT NOT NULL,
  src    TEXT NOT NULL,
  how    TEXT NOT NULL,
  device TEXT NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, src, how, device)
);
