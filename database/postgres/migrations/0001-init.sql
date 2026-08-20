-- =========================================================================
--  0001 — initial schema (idempotent, safe to re-run)
--  Every service owns its own schema; cross-schema writes go through APIs.
-- =========================================================================

-- ---------- required PostgreSQL extensions ----------------------------
-- These extensions are prerequisites for CITEXT identity fields and UUID
-- generation used throughout the authoritative schema.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- shared types ----------------------------------------------
CREATE SCHEMA IF NOT EXISTS shared;

CREATE OR REPLACE FUNCTION shared.tg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION shared.tg_set_id() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS NULL THEN NEW.id = gen_random_uuid(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- outbox (every service writes its own) --------------------
CREATE TABLE IF NOT EXISTS shared.outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate       TEXT        NOT NULL,
  aggregate_id    TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  payload_hash    BYTEA       NOT NULL,
  prev_hash       BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS outbox_unpublished ON shared.outbox (created_at) WHERE published_at IS NULL;

-- ---------- audit (mirror) -------------------------------------------
CREATE TABLE IF NOT EXISTS shared.audit (
  id              BIGSERIAL   PRIMARY KEY,
  aggregate       TEXT        NOT NULL,
  aggregate_id    TEXT        NOT NULL,
  actor           TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  payload_hash    BYTEA       NOT NULL,
  prev_hash       BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_agg ON shared.audit (aggregate, aggregate_id, created_at DESC);

-- =========================================================================
--  AUTH schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT      UNIQUE,
  phone           TEXT        UNIQUE,
  username        TEXT        UNIQUE,
  password_hash   TEXT,
  status          TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','banned','pending')),
  kyc_level       INT         NOT NULL DEFAULT 0,
  country_code    CHAR(2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION shared.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS auth.identities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        TEXT        NOT NULL,            -- local|google|github|telegram|discord|wallet|passkey
  provider_uid    TEXT        NOT NULL,
  meta            JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS auth.passkeys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id   BYTEA       NOT NULL UNIQUE,
  public_key      BYTEA       NOT NULL,
  sign_count      BIGINT      NOT NULL DEFAULT 0,
  transports      TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth.totp_secrets (
  user_id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  secret          TEXT        NOT NULL,
  confirmed       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token   TEXT        NOT NULL UNIQUE,
  user_agent      TEXT,
  ip              INET,
  device_id       TEXT,
  trusted         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user ON auth.sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS auth.trusted_devices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id       TEXT        NOT NULL,
  name            TEXT,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS auth.roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL UNIQUE,
  permissions     TEXT[]      NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.user_roles (
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id         UUID        NOT NULL REFERENCES auth.roles(id)  ON DELETE CASCADE,
  scope           TEXT        NOT NULL DEFAULT 'global', -- global|tenant
  scope_id        TEXT,
  PRIMARY KEY (user_id, role_id, scope, scope_id)
);

-- =========================================================================
--  WALLETS schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS wallets;

-- account_type:  user | hot | cold | treasury | fee | reward
-- currency:      'RIAL' (internal) or chain symbol (e.g. 'ETH','SOL')
CREATE TABLE IF NOT EXISTS wallets.accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      TEXT        NOT NULL,                -- user|service
  owner_id        TEXT        NOT NULL,
  account_type    TEXT        NOT NULL,
  currency        TEXT        NOT NULL,
  address         TEXT,                                -- external chain address (null for internal)
  label           TEXT,
  meta            JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_currency
  ON wallets.accounts (owner_type, owner_id, account_type, currency);
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON wallets.accounts
  FOR EACH ROW EXECUTE FUNCTION shared.tg_set_updated_at();

-- balance snapshot (fast read); authoritative is the ledger.
CREATE TABLE IF NOT EXISTS wallets.balances (
  account_id      UUID        PRIMARY KEY REFERENCES wallets.accounts(id) ON DELETE CASCADE,
  available_minor BIGINT      NOT NULL DEFAULT 0,    -- 8 decimal places
  pending_minor   BIGINT      NOT NULL DEFAULT 0,
  reserved_minor  BIGINT      NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- double-entry ledger
CREATE TABLE IF NOT EXISTS wallets.ledger_entries (
  id              BIGSERIAL   PRIMARY KEY,
  tx_id           UUID        NOT NULL,
  account_id      UUID        NOT NULL REFERENCES wallets.accounts(id),
  amount_minor    BIGINT      NOT NULL,               -- signed
  currency        TEXT        NOT NULL,
  kind            TEXT        NOT NULL,                -- debit|credit
  reason          TEXT        NOT NULL,
  meta            JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_account ON wallets.ledger_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_tx      ON wallets.ledger_entries (tx_id);

-- multi-sig proposals
CREATE TABLE IF NOT EXISTS wallets.multisig_proposals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chain           TEXT        NOT NULL,
  to_address      TEXT        NOT NULL,
  amount_minor    BIGINT      NOT NULL,
  currency        TEXT        NOT NULL,
  data            BYTEA,
  threshold       INT         NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','signed','broadcast','confirmed','failed','cancelled')),
  created_by      UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wallets.multisig_signatures (
  proposal_id     UUID        NOT NULL REFERENCES wallets.multisig_proposals(id) ON DELETE CASCADE,
  signer          TEXT        NOT NULL,
  signature       BYTEA       NOT NULL,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, signer)
);

-- transaction history (denormalized for fast UI)
CREATE TABLE IF NOT EXISTS wallets.transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  type            TEXT        NOT NULL,                -- deposit|withdraw|trade|launch|fee|reward|transfer
  currency        TEXT        NOT NULL,
  amount_minor    BIGINT      NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  meta            JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tx_user ON wallets.transactions (user_id, created_at DESC);

-- =========================================================================
--  LAUNCHPAD schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS launchpad;

CREATE TABLE IF NOT EXISTS launchpad.tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID        NOT NULL,
  chain           TEXT        NOT NULL,
  contract_addr   TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  symbol          TEXT        NOT NULL,
  decimals        INT         NOT NULL,
  total_supply    NUMERIC(38,0) NOT NULL,
  logo_url        TEXT,
  banner_url      TEXT,
  description     TEXT,
  website         TEXT,
  telegram        TEXT,
  twitter         TEXT,
  discord         TEXT,
  github          TEXT,
  mint_authority  TEXT,
  freeze_authority TEXT,
  curve_model     TEXT        NOT NULL,
  curve_params    JSONB       NOT NULL DEFAULT '{}',
  graduation_rial_minor BIGINT NOT NULL,
  graduated       BOOLEAN     NOT NULL DEFAULT FALSE,
  graduated_at    TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','pending','live','graduated','rejected','paused')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, contract_addr)
);
CREATE INDEX IF NOT EXISTS tokens_creator ON launchpad.tokens (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tokens_status  ON launchpad.tokens (status, created_at DESC);

CREATE TABLE IF NOT EXISTS launchpad.bonding_state (
  token_id        UUID        PRIMARY KEY REFERENCES launchpad.tokens(id) ON DELETE CASCADE,
  supply_circulating_minor BIGINT NOT NULL DEFAULT 0,
  reserve_rial_minor        BIGINT NOT NULL DEFAULT 0,
  virtual_rial_minor        BIGINT NOT NULL DEFAULT 0,
  price_rial_per_token_minor_8dp NUMERIC(38,8) NOT NULL DEFAULT 0,
  holders_count   INT         NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS launchpad.holders (
  token_id        UUID        NOT NULL REFERENCES launchpad.tokens(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  balance_minor   BIGINT      NOT NULL DEFAULT 0,
  first_bought_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, user_id)
);

CREATE TABLE IF NOT EXISTS launchpad.vesting_schedules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id        UUID        NOT NULL REFERENCES launchpad.tokens(id) ON DELETE CASCADE,
  beneficiary     UUID        NOT NULL,
  total_minor     BIGINT      NOT NULL,
  released_minor  BIGINT      NOT NULL DEFAULT 0,
  cliff_seconds   INT         NOT NULL DEFAULT 0,
  duration_seconds INT        NOT NULL,
  start_at        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
--  TRADING schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS trading;

CREATE TABLE IF NOT EXISTS trading.markets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chain           TEXT        NOT NULL,
  base_symbol     TEXT        NOT NULL,
  quote_symbol    TEXT        NOT NULL DEFAULT 'RIAL',
  kind            TEXT        NOT NULL DEFAULT 'spot'
                  CHECK (kind IN ('spot','perp','launch')),
  token_id        UUID,                                -- link to launchpad.tokens.id if launch market
  tick_minor      BIGINT      NOT NULL,
  lot_minor       BIGINT      NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, base_symbol, quote_symbol)
);

CREATE TABLE IF NOT EXISTS trading.orders (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL,
  market_id       UUID        NOT NULL REFERENCES trading.markets(id),
  side            TEXT        NOT NULL CHECK (side IN ('buy','sell')),
  type            TEXT        NOT NULL CHECK (type IN ('market','limit','stop','stop_limit','iceberg','trailing','oco')),
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','partial','filled','cancelled','rejected','expired')),
  time_in_force   TEXT        NOT NULL DEFAULT 'GTC'
                  CHECK (time_in_force IN ('GTC','IOC','FOK','GTD')),
  price_minor     BIGINT,                              -- per 1 base, in quote minor
  stop_price_minor BIGINT,
  amount_minor    BIGINT      NOT NULL,
  filled_minor    BIGINT      NOT NULL DEFAULT 0,
  avg_price_minor BIGINT,
  fee_minor       BIGINT      NOT NULL DEFAULT 0,
  client_id       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user   ON trading.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_market ON trading.orders (market_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_client ON trading.orders (user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trading.trades (
  id              UUID        PRIMARY KEY,
  market_id       UUID        NOT NULL REFERENCES trading.markets(id),
  buy_order_id    UUID        NOT NULL,
  sell_order_id   UUID        NOT NULL,
  buyer_id        UUID        NOT NULL,
  seller_id       UUID        NOT NULL,
  price_minor     BIGINT      NOT NULL,
  amount_minor    BIGINT      NOT NULL,
  fee_buyer_minor  BIGINT     NOT NULL DEFAULT 0,
  fee_seller_minor BIGINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trades_market ON trading.trades (market_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trading.candles (
  market_id       UUID        NOT NULL REFERENCES trading.markets(id),
  bucket          TIMESTAMPTZ NOT NULL,
  interval        TEXT        NOT NULL,                -- 1m|5m|15m|1h|4h|1d
  open_minor      BIGINT      NOT NULL,
  high_minor      BIGINT      NOT NULL,
  low_minor       BIGINT      NOT NULL,
  close_minor     BIGINT      NOT NULL,
  volume_minor    BIGINT      NOT NULL,
  PRIMARY KEY (market_id, interval, bucket)
);

-- =========================================================================
--  PAYMENTS schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.deposits (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL,
  adapter         TEXT        NOT NULL,
  external_id     TEXT        NOT NULL,                -- PSP-side id
  amount_minor    BIGINT      NOT NULL,                -- in fiat minor
  fiat_currency   TEXT        NOT NULL,
  amount_rial_minor BIGINT,                            -- credited
  fx_rate_minor_8dp NUMERIC(38,8),                     -- fiat per 1 ﷼
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','completed','failed','refunded','cancelled')),
  raw             JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (adapter, external_id)
);

CREATE TABLE IF NOT EXISTS payments.withdrawals (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL,
  adapter         TEXT        NOT NULL,
  destination     JSONB       NOT NULL,
  amount_rial_minor BIGINT    NOT NULL,
  fiat_amount_minor BIGINT,
  fiat_currency   TEXT,
  fx_rate_minor_8dp NUMERIC(38,8),
  status          TEXT        NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments.webhook_events (
  id              UUID        PRIMARY KEY,
  adapter         TEXT        NOT NULL,
  external_id     TEXT        NOT NULL,
  type            TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  UNIQUE (adapter, external_id, type)
);

-- =========================================================================
--  FEES schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS fees;

CREATE TABLE IF NOT EXISTS fees.schedules (
  id              UUID        PRIMARY KEY,
  scope           TEXT        NOT NULL,                -- global|market|user
  scope_id        TEXT,
  kind            TEXT        NOT NULL,                -- platform|creator|referral|affiliate|burn|treasury
  rate_bps        INT         NOT NULL,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fees.accruals (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         UUID        NOT NULL,
  market_id       UUID,
  trade_id        UUID,
  kind            TEXT        NOT NULL,
  amount_minor    BIGINT      NOT NULL,
  currency        TEXT        NOT NULL DEFAULT 'RIAL',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fees_accruals_user ON fees.accruals (user_id, created_at DESC);

-- =========================================================================
--  REFERRALS schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS referrals;

CREATE TABLE IF NOT EXISTS referrals.codes (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL,
  code            TEXT        NOT NULL UNIQUE,
  level           INT         NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referrals.edges (
  user_id         UUID        PRIMARY KEY,
  referrer_id     UUID        NOT NULL,
  level           INT         NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edges_referrer ON referrals.edges (referrer_id, level);

CREATE TABLE IF NOT EXISTS referrals.campaigns (
  id              UUID        PRIMARY KEY,
  name            TEXT        NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  reward_minor    BIGINT      NOT NULL,
  currency        TEXT        NOT NULL DEFAULT 'RIAL',
  rules           JSONB       NOT NULL DEFAULT '{}',
  active          BOOLEAN     NOT NULL DEFAULT TRUE
);

-- =========================================================================
--  NOTIFICATIONS schema
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS notify;

CREATE TABLE IF NOT EXISTS notify.outbox (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL,
  channel         TEXT        NOT NULL,                -- push|sms|email|telegram|discord|ws
  template        TEXT        NOT NULL,
  data            JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','failed','read')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notify_user ON notify.outbox (user_id, created_at DESC);

-- =========================================================================
--  ADMIN / CONFIG
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE IF NOT EXISTS admin.feature_flags (
  name            TEXT        PRIMARY KEY,
  enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
  description     TEXT,
  updated_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.audit_log (
  id              BIGSERIAL   PRIMARY KEY,
  actor           TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  target          TEXT,
  meta            JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.emergency_pauses (
  scope           TEXT        PRIMARY KEY,             -- global|market|user
  scope_id        TEXT,
  reason          TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  enabled_by      UUID        NOT NULL,
  enabled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
--  AI / MODERATION
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS moderation;

CREATE TABLE IF NOT EXISTS moderation.reports (
  id              UUID        PRIMARY KEY,
  reporter_id     UUID        NOT NULL,
  target_type     TEXT        NOT NULL,                -- user|token|order|message
  target_id       TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  evidence        JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','triaged','actioned','rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_target ON moderation.reports (target_type, target_id);

CREATE TABLE IF NOT EXISTS moderation.blacklist (
  kind            TEXT        NOT NULL,                -- user|ip|country|token|address|email_domain
  value           TEXT        NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS moderation.whitelist (
  kind            TEXT        NOT NULL,
  value           TEXT        NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS moderation.risk_scores (
  user_id         UUID        PRIMARY KEY,
  score           NUMERIC(5,4) NOT NULL,
  components      JSONB       NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
