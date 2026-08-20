-- 0007 — durable payment refunds
-- Author: QalamHipHop
-- Refunds are separate records so a provider retry cannot silently mutate an intent twice.

CREATE TABLE IF NOT EXISTS payments.refunds (
  id              TEXT PRIMARY KEY,
  intent_id       TEXT NOT NULL REFERENCES payments.payment_intents(id),
  user_id         UUID NOT NULL,
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','processing','succeeded','failed','cancelled')),
  external_id     TEXT,
  reason          TEXT NOT NULL,
  failure_reason  TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (intent_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_external_id_uq ON payments.refunds (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_intent_idx ON payments.refunds (intent_id, created_at DESC);
CREATE OR REPLACE FUNCTION payments.set_payment_refund_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_refunds_updated_at ON payments.refunds;
CREATE TRIGGER payment_refunds_updated_at BEFORE UPDATE ON payments.refunds
FOR EACH ROW EXECUTE FUNCTION payments.set_payment_refund_updated_at();
