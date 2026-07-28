CREATE SCHEMA IF NOT EXISTS wallet;

CREATE TABLE IF NOT EXISTS wallet.accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID,
  kind        TEXT NOT NULL CHECK (kind IN ('user','hot','cold','reserve','treasury','escrow')),
  symbol      TEXT NOT NULL,
  balance     BIGINT NOT NULL DEFAULT 0,
  available   BIGINT NOT NULL DEFAULT 0,
  pending     BIGINT NOT NULL DEFAULT 0,
  version     BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_kind ON wallet.accounts (owner_id, kind) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_internal_kind ON wallet.accounts (kind) WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS accounts_owner ON wallet.accounts (owner_id);

CREATE TABLE IF NOT EXISTS wallet.transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES wallet.accounts(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  balance_after   BIGINT NOT NULL,
  reference       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  actor           TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tx_idem ON wallet.transactions (account_id, idempotency_key);
CREATE INDEX IF NOT EXISTS tx_account_created ON wallet.transactions (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet.withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES wallet.accounts(id) ON DELETE RESTRICT,
  amount        BIGINT NOT NULL,
  destination   TEXT NOT NULL,
  chain         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','signing','broadcast','confirmed','failed','canceled')),
  tx_hash       TEXT,
  signers       TEXT[] NOT NULL DEFAULT '{}',
  required_sigs INT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wd_status ON wallet.withdrawals (status, created_at DESC);
