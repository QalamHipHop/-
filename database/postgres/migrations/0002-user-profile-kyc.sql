-- =========================================================================
--  0002 — user profile expansion, preferences, KYC applications
--  Idempotent: every ALTER is guarded with IF NOT EXISTS / IF EXISTS.
-- =========================================================================

-- ---------- extend auth.users --------------------------------------------
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS bio          TEXT;

-- ---------- user preferences --------------------------------------------
CREATE TABLE IF NOT EXISTS auth.user_preferences (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_prefs_updated BEFORE UPDATE ON auth.user_preferences
  FOR EACH ROW EXECUTE FUNCTION shared.tg_set_updated_at();

-- ---------- KYC applications --------------------------------------------
CREATE TABLE IF NOT EXISTS auth.kyc_applications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  full_name        TEXT        NOT NULL,
  dob              DATE        NOT NULL,
  country_code     CHAR(2)     NOT NULL,
  document_type    TEXT        NOT NULL
                   CHECK (document_type IN ('passport','national_id','driver_license')),
  document_number  TEXT        NOT NULL,
  selfie_ref       TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ,
  reviewer_id      UUID        REFERENCES auth.users(id),
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS kyc_user_status ON auth.kyc_applications (user_id, status);
CREATE INDEX IF NOT EXISTS kyc_pending     ON auth.kyc_applications (submitted_at) WHERE status = 'pending';

-- ---------- one-pending-per-user partial unique -------------------------
-- Enforce: at most one PENDING KYC per user.
CREATE UNIQUE INDEX IF NOT EXISTS kyc_one_pending_per_user
  ON auth.kyc_applications (user_id)
  WHERE status = 'pending';
