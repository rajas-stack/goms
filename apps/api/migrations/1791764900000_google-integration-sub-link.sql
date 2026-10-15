-- apps/api/migrations/1791764900000_google-integration-sub-link.sql
-- Up Migration

-- Link saved Google-integration settings to the person's Google subject id (`sub`), which Google never reassigns, instead of to a mutable email.
-- Purely additive and idempotent: one nullable column and one partial unique index. Existing rows keep their user_uid and are unchanged
-- (google_sub NULL until the API stamps it, from a VERIFIED token, the next time that person loads their settings). Code that predates this
-- migration ignores the column, so rolling the code back is harmless. Nothing here ever matches on email.
ALTER TABLE google_integration_settings ADD COLUMN IF NOT EXISTS google_sub TEXT;

-- At most one row per person; many NULLs (not yet stamped) are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS google_integration_settings_google_sub_key
  ON google_integration_settings (google_sub) WHERE google_sub IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS google_integration_settings_google_sub_key;
ALTER TABLE google_integration_settings DROP COLUMN IF EXISTS google_sub;
