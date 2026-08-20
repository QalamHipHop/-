-- Author: QalamHipHop
-- Guardrails for backend wallet snapshots. The authoritative ledger remains the
-- source of truth; these checks prevent corrupted snapshots from being persisted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_balances_nonnegative'
      AND conrelid = 'wallets.balances'::regclass
  ) THEN
    ALTER TABLE wallets.balances
      ADD CONSTRAINT wallet_balances_nonnegative
      CHECK (available_minor >= 0 AND pending_minor >= 0 AND reserved_minor >= 0);
  END IF;
END $$;
