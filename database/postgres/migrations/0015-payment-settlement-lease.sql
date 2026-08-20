-- Durable lease for payment -> wallet settlement recovery.
-- A stable wallet idempotency key remains the final duplicate barrier; this lease
-- prevents unnecessary concurrent calls across payment-service replicas.
ALTER TABLE payments.payment_intents
  ADD COLUMN IF NOT EXISTS settlement_claim_token TEXT,
  ADD COLUMN IF NOT EXISTS settlement_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payment_intents_settlement_claim_idx
  ON payments.payment_intents (settlement_claimed_at)
  WHERE kind = 'deposit' AND status = 'succeeded' AND settlement_status IN ('pending','failed');
