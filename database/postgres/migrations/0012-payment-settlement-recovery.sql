-- 0012 — durable payment-to-wallet settlement recovery
-- Author: QalamHipHop
ALTER TABLE payments.payment_intents
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS settlement_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_last_error TEXT,
  ADD COLUMN IF NOT EXISTS settlement_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

ALTER TABLE payments.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_settlement_status_check;
ALTER TABLE payments.payment_intents
  ADD CONSTRAINT payment_intents_settlement_status_check
  CHECK (settlement_status IN ('not_required','pending','succeeded','failed'));

CREATE INDEX IF NOT EXISTS payment_intents_settlement_recovery_idx
  ON payments.payment_intents (settlement_status, settlement_next_attempt_at)
  WHERE kind = 'deposit' AND status = 'succeeded' AND settlement_status IN ('pending','failed');
