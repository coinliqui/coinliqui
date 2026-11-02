-- The arrival count gains the visitor's country, as Cloudflare reports it, and nothing finer.
--
-- WHY. The 28 October investigation had to drop Georgia by hand, because the operator reads the
-- site from Batumi and those visits sat among the readers' with nothing to tell them apart. A
-- two-letter country code is coarse enough that a row still cannot be tied to a person.
-- The table was hours old and held only the deploy's own checks and a handful of visits, so it is
-- rebuilt with the column in its key rather than migrated in place.
DROP TABLE IF EXISTS entry_day;
CREATE TABLE entry_day (
  day     TEXT NOT NULL,
  path    TEXT NOT NULL,
  src     TEXT NOT NULL,
  how     TEXT NOT NULL,
  device  TEXT NOT NULL,
  country TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, src, how, device, country)
);
