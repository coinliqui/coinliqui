-- Open interest over time, one row per symbol per HOUR.
--
-- WHY IT DID NOT EXIST UNTIL NOW. funding_snapshot keeps (symbol, venue, apr, at) and nothing
-- else, so this site could state what open interest IS and never what it had done. Every
-- aggregator in this space leads with "OI Change 1h / 4h / 24h" and it is the most visible thing
-- coinliqui could not show — not because the figure is hard, but because the reading was never
-- kept. A delta cannot be backfilled: it exists only if somebody stored yesterday.
--
-- WHY A SEPARATE TABLE. Open interest is a property of a SYMBOL on one venue's book, not of a
-- (symbol, venue) pair — Binance and Bybit numbers here are funding rates that Hyperliquid
-- redistributes, and this site says so on /open-interest. Adding a column to funding_snapshot
-- would have written the same value onto three rows per symbol and invited a future reader to
-- average them.
--
-- WHY HOURLY AND NOT EVERY TICK. The ingest runs every five minutes; open interest does not move
-- on that timescale in any way a reader needs. Hourly gives 1h, 4h and 24h deltas exactly, at 50
-- rows an hour — 1,200 a day against the 14,400 a five-minute cadence would have cost, on a
-- worker whose whole D1 budget is 100,000 rows written a day and which already spends ~43,000 on
-- funding. Precision nobody reads is the most expensive kind.
CREATE TABLE IF NOT EXISTS oi_snapshot (
  symbol TEXT NOT NULL,
  oi     REAL NOT NULL,
  at     INTEGER NOT NULL
);
-- The prune scans by time; the reader scans one symbol back through time.
CREATE INDEX IF NOT EXISTS idx_oi_at ON oi_snapshot (at);
CREATE INDEX IF NOT EXISTS idx_oi_sym ON oi_snapshot (symbol, at);
