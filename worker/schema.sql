-- Consecutive funding snapshots, one row per symbol per venue per cron tick.
-- This is the only retained history in phase 0. It powers the flip feed today and
-- Telegram alerts later, which is why it starts accruing from day one.
CREATE TABLE IF NOT EXISTS funding_snapshot (
  symbol TEXT NOT NULL,
  venue  TEXT NOT NULL,
  apr    REAL NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_at ON funding_snapshot (at);
CREATE INDEX IF NOT EXISTS idx_fs_sym ON funding_snapshot (symbol, venue, at);
