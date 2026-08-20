-- 0002 — per-account withdrawal destination allowlist
CREATE TABLE IF NOT EXISTS wallet.withdrawal_destinations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES wallet.accounts(id) ON DELETE CASCADE,
  chain          TEXT NOT NULL,
  destination    TEXT NOT NULL,
  label          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  cooldown_until TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  confirmation_token_hash BYTEA,
  confirmation_expires_at TIMESTAMPTZ,
  UNIQUE (account_id, chain, destination)
);

CREATE INDEX IF NOT EXISTS wd_dest_active_idx
  ON wallet.withdrawal_destinations (account_id, chain, status)
  WHERE status = 'active';
