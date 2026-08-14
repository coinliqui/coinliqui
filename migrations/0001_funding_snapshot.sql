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
