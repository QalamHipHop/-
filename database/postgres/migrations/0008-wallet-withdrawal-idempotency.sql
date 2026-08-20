-- 0008 — durable wallet withdrawal idempotency
-- Author: QalamHipHop
-- The application stores the request key in transactions.meta.clientId.
-- A partial unique index makes concurrent retries deterministic without
-- changing the existing transaction schema or deleting historical data.

CREATE UNIQUE INDEX IF NOT EXISTS tx_user_client_id_unique
  ON wallets.transactions (user_id, ((meta->>'clientId')))
  WHERE meta ? 'clientId' AND (meta->>'clientId') IS NOT NULL;

CREATE INDEX IF NOT EXISTS tx_pending_withdrawals
  ON wallets.transactions (created_at ASC)
  WHERE type = 'withdraw' AND status = 'pending';
