-- Durable intent state for payment-service. This table is the source of truth
-- across process restarts and enforces the API idempotency contract.
CREATE TABLE IF NOT EXISTS payments.payment_intents (
  id                    TEXT        PRIMARY KEY,
  kind                  TEXT        NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  user_id               UUID        NOT NULL REFERENCES auth.users(id),
  adapter               TEXT        NOT NULL,
  status                TEXT        NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'expired')),
  amount_minor          BIGINT      NOT NULL CHECK (amount_minor > 0),
  currency              TEXT        NOT NULL,
  settled_amount_minor  BIGINT,
  settled_currency      TEXT,
  reference             TEXT        NOT NULL,
  external_id           TEXT,
  redirect_url          TEXT,
  qr_code               TEXT,
  failure_reason        TEXT,
  idempotency_key       TEXT        NOT NULL,
  metadata              JSONB       NOT NULL DEFAULT '{}',
  destination           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_adapter_external_id_uq
  ON payments.payment_intents (adapter, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_intents_user_created_idx
  ON payments.payment_intents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_intents_status_created_idx
  ON payments.payment_intents (status, created_at DESC);

CREATE OR REPLACE FUNCTION payments.set_payment_intent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_intents_updated_at ON payments.payment_intents;
CREATE TRIGGER payment_intents_updated_at
BEFORE UPDATE ON payments.payment_intents
FOR EACH ROW EXECUTE FUNCTION payments.set_payment_intent_updated_at();
