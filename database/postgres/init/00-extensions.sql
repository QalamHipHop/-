-- =========================================================================
--  ﷼ Platform — Postgres init (extensions)
--  Runs once on first cluster boot.
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Logical replication slot used by the audit-relay to stream outbox events.
-- The audit-relay creates this slot on first run; do not create here.
