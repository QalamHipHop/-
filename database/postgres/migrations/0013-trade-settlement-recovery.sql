-- 0013 — durable trade settlement recovery
-- A trade is execution-final once recorded, but wallet settlement may need retry.
ALTER TABLE trading.trades
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS settlement_processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_last_error TEXT,
  ADD COLUMN IF NOT EXISTS settlement_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE trading.trades DROP CONSTRAINT IF EXISTS trades_settlement_status_check;
  ALTER TABLE trading.trades
    ADD CONSTRAINT trades_settlement_status_check
    CHECK (settlement_status IN ('pending','processing','succeeded','failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS trades_settlement_recovery_idx
  ON trading.trades (settlement_status, settlement_next_attempt_at)
  WHERE settlement_status IN ('pending','failed');

CREATE UNIQUE INDEX IF NOT EXISTS trades_settlement_tx_unique
  ON trading.trades (settlement_tx_id)
  WHERE settlement_tx_id IS NOT NULL;
