-- 0011 — explicit outbox publisher ownership
-- Author: QalamHipHop
ALTER TABLE shared.outbox
  ADD COLUMN IF NOT EXISTS source_service TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS shared_outbox_backend_delivery_queue
  ON shared.outbox (source_service, next_attempt_at, created_at)
  WHERE published_at IS NULL;
