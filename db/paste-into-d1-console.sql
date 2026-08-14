-- Consecutive funding snapshots, one row per symbol per venue per cron tick.
-- The only retained history in phase 0, and the reason ingest runs from day one: it powers
-- the on-site flip feed, and it cannot be backfilled. There is no notification channel and
-- none is planned — see /privacy.
CREATE TABLE IF NOT EXISTS funding_snapshot (
  symbol TEXT NOT NULL,
  venue  TEXT NOT NULL,
  apr    REAL NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_at ON funding_snapshot (at);
CREATE INDEX IF NOT EXISTS idx_fs_sym ON funding_snapshot (symbol, venue, at);
-- Cron canary. One row per ingest attempt, successful or not.
-- Silent staleness is this architecture's failure mode: if the upstream starts refusing
-- requests or quietly drops a venue, pages keep serving the last good snapshot and only
-- the timestamp drifts. This table is what makes that visible.
--   status : HTTP status, or 0 when the request never completed
--   ms     : wall time of the whole ingest attempt
--   ok     : 1 only when usable rows were written
--   note   : JSON — per-venue row counts, symbol count, error string
CREATE TABLE IF NOT EXISTS upstream_check (
  at     INTEGER NOT NULL,
  source TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms     INTEGER NOT NULL,
  ok     INTEGER NOT NULL,
  note   TEXT
);
CREATE INDEX IF NOT EXISTS idx_uc_at ON upstream_check (at);
