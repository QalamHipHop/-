-- Author: QalamHipHop
-- Balance invariants for the authoritative Go wallet schema.
-- Existing deployments must reconcile any violating rows before applying this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_accounts_nonnegative_balances'
      AND conrelid = 'wallet.accounts'::regclass
  ) THEN
    ALTER TABLE wallet.accounts
      ADD CONSTRAINT wallet_accounts_nonnegative_balances
      CHECK (balance >= 0 AND available >= 0 AND pending >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_accounts_balance_decomposition'
      AND conrelid = 'wallet.accounts'::regclass
  ) THEN
    ALTER TABLE wallet.accounts
      ADD CONSTRAINT wallet_accounts_balance_decomposition
      CHECK (balance = available + pending);
  END IF;
END $$;
