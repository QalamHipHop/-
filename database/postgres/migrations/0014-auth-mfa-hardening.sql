-- 0014 — MFA enrollment lifecycle and recovery metadata
-- The legacy auth.totp_secrets table remains intact for backward compatibility.
-- New workflows must use this table and store only an encrypted secret envelope.
CREATE TABLE IF NOT EXISTS auth.mfa_enrollments (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  secret_envelope         TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','revoked')),
  recovery_code_hashes    TEXT[] NOT NULL DEFAULT '{}',
  confirmation_attempts   INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_attempts >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at            TIMESTAMPTZ,
  revoked_at              TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_enrollments_status_idx
  ON auth.mfa_enrollments (status, updated_at DESC);

CREATE OR REPLACE FUNCTION auth.set_mfa_enrollment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mfa_enrollments_updated_at ON auth.mfa_enrollments;
CREATE TRIGGER mfa_enrollments_updated_at
BEFORE UPDATE ON auth.mfa_enrollments
FOR EACH ROW EXECUTE FUNCTION auth.set_mfa_enrollment_updated_at();
