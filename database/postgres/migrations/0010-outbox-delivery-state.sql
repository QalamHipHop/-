-- 0010 — durable outbox delivery state
-- Author: QalamHipHop
ALTER TABLE shared.outbox
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS shared_outbox_delivery_queue
  ON shared.outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL;
