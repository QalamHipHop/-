-- 0014 — durable webhook processing lease
ALTER TABLE payments.webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS webhook_events_processing_idx
  ON payments.webhook_events (processed_at, processing_started_at)
  WHERE processed_at IS NULL;
