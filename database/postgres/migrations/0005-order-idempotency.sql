-- 0005 — order submission idempotency
-- Author: QalamHipHop
-- A client id is scoped to a user and market. Re-submitting the same
-- request returns the original order instead of locking funds again.
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_market_client_unique
  ON trading.orders (user_id, market_id, client_id)
  WHERE client_id IS NOT NULL;
