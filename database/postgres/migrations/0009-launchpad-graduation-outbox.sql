-- 0009 — durable launchpad graduation event idempotency
-- Author: QalamHipHop
-- A token may produce exactly one launchpad.graduated command/event.
CREATE UNIQUE INDEX IF NOT EXISTS shared_outbox_launchpad_graduation_key
  ON shared.outbox (aggregate, aggregate_id, event_type)
  WHERE aggregate = 'launchpad' AND event_type = 'launchpad.graduated';
