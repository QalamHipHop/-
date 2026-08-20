-- 0006 — platform operations and recovery primitives
-- Author: QalamHipHop
-- Safe to re-run. This migration adds durable state; it does not delete existing work.

CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS compliance;

-- One durable key for every cross-service command/event. The payload hash prevents
-- accidental reuse of a key for a different financial operation.
CREATE TABLE IF NOT EXISTS operations.idempotency_keys (
  namespace       TEXT NOT NULL,
  key             TEXT NOT NULL,
  payload_hash    BYTEA NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  response        JSONB,
  error_code      TEXT,
  owner_service   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry ON operations.idempotency_keys (expires_at) WHERE expires_at IS NOT NULL;

-- Outbox delivery attempts and dead-letter state. The original shared.outbox remains
-- the source event record; this table records delivery, retry and operator actions.
CREATE TABLE IF NOT EXISTS operations.outbox_attempts (
  id              BIGSERIAL PRIMARY KEY,
  outbox_id       UUID NOT NULL REFERENCES shared.outbox(id) ON DELETE CASCADE,
  attempt_no      INT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','sent','retry','dead')),
  error_code      TEXT,
  error_message   TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ,
  UNIQUE (outbox_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS outbox_attempts_retry ON operations.outbox_attempts (next_attempt_at) WHERE status = 'retry';

CREATE TABLE IF NOT EXISTS operations.dead_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  failure_code    TEXT NOT NULL,
  failure_message TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','replayed','ignored')),
  attempts        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
CREATE INDEX IF NOT EXISTS dead_letters_open ON operations.dead_letters (created_at) WHERE status = 'open';

-- Reconciliation runs and differences are append-only evidence, not mutable balances.
CREATE TABLE IF NOT EXISTS operations.reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL CHECK (scope IN ('wallet','payment','trading','chain','full')),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','passed','failed','partial')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  initiated_by    TEXT NOT NULL,
  summary         JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS operations.reconciliation_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES operations.reconciliation_runs(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  expected_value  JSONB,
  actual_value    JSONB,
  difference      JSONB,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','resolved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
CREATE INDEX IF NOT EXISTS reconciliation_findings_open ON operations.reconciliation_findings (severity, created_at) WHERE status = 'open';

-- Admin actions are separated from domain audit so operator actions remain visible
-- even when a business transaction is rolled back.
CREATE TABLE IF NOT EXISTS operations.admin_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  reason          TEXT NOT NULL,
  request_id      TEXT,
  before_state    JSONB,
  after_state     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_target ON operations.admin_actions (target_type, target_id, created_at DESC);

-- Compliance state is explicit. It does not claim KYC approval merely because a user exists.
CREATE TABLE IF NOT EXISTS compliance.kyc_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  level           INT NOT NULL DEFAULT 0 CHECK (level >= 0),
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','pending','approved','rejected','expired','manual_review')),
  provider        TEXT,
  provider_case_id TEXT,
  risk_score      NUMERIC(8,4),
  country_code    CHAR(2),
  sanctions_state TEXT NOT NULL DEFAULT 'unknown' CHECK (sanctions_state IN ('unknown','clear','match','manual_review')),
  submitted_at    TIMESTAMPTZ,
  reviewed_at     TIMESTAMPTZ,
  reviewer_id     TEXT,
  expires_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_active_user ON compliance.kyc_cases (user_id) WHERE status IN ('pending','approved','manual_review');
CREATE INDEX IF NOT EXISTS kyc_review_queue ON compliance.kyc_cases (status, created_at) WHERE status IN ('pending','manual_review');

CREATE OR REPLACE FUNCTION operations.tg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_idempotency_updated ON operations.idempotency_keys;
CREATE TRIGGER trg_idempotency_updated BEFORE UPDATE ON operations.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION operations.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_kyc_updated ON compliance.kyc_cases;
CREATE TRIGGER trg_kyc_updated BEFORE UPDATE ON compliance.kyc_cases
  FOR EACH ROW EXECUTE FUNCTION operations.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS operations.platform_settings (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  description     TEXT,
  updated_by      TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_platform_settings_updated ON operations.platform_settings;
CREATE TRIGGER trg_platform_settings_updated BEFORE UPDATE ON operations.platform_settings
  FOR EACH ROW EXECUTE FUNCTION operations.tg_set_updated_at();
INSERT INTO operations.platform_settings (key, value, description, updated_by)
VALUES
  ('trading_paused', 'false', 'Global trading pause switch', 'migration'),
  ('launchpad_paused', 'false', 'Global launchpad pause switch', 'migration'),
  ('withdrawals_paused', 'false', 'Global withdrawal pause switch', 'migration')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE operations.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_no_public_write ON operations.platform_settings;
CREATE POLICY platform_settings_no_public_write ON operations.platform_settings FOR SELECT USING (true);
