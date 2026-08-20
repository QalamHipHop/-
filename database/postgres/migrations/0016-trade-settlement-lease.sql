-- Durable fencing token for trade -> wallet settlement recovery.
-- processing_started_at remains the lease timeout; claim_token fences stale workers.
ALTER TABLE trading.trades
  ADD COLUMN IF NOT EXISTS settlement_claim_token TEXT;

CREATE INDEX IF NOT EXISTS trades_settlement_claim_idx
  ON trading.trades (settlement_claim_token)
  WHERE settlement_status = 'processing';
