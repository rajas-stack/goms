-- apps/api/migrations/1791100000000_oauth-sessions.sql
-- Up Migration

-- Google OAuth login (spec 2026-10-06-google-oauth-login-design.md §4.4). Purely additive: no existing table changes.

-- One row per in-flight authorization request. Consumed atomically (DELETE ... RETURNING) by the callback.
CREATE TABLE auth_flows (
  state_hash    TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,           -- server-held PKCE verifier (API <-> Google hop only)
  nonce         TEXT NOT NULL,
  client        TEXT NOT NULL CHECK (client IN ('web', 'app')),
  return_to     TEXT NOT NULL DEFAULT '/',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_flows_expires_idx ON auth_flows (expires_at);

-- The GOMS one-time exchange code, hash only. NOT PKCE-bound: bound to the verified identity, family and client kind.
CREATE TABLE auth_exchange_codes (
  code_hash  TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  email      TEXT NOT NULL CHECK (email = lower(btrim(email))),
  family_id  UUID NOT NULL,
  client     TEXT NOT NULL CHECK (client IN ('web', 'app')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX auth_exchange_codes_expires_idx ON auth_exchange_codes (expires_at);

-- One row per refresh-token generation; family_id groups the generations of one sign-in.
CREATE TABLE auth_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid          TEXT NOT NULL,
  email        TEXT NOT NULL CHECK (email = lower(btrim(email))),
  refresh_hash TEXT NOT NULL UNIQUE,
  family_id    UUID NOT NULL,
  replaced_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT
);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);
CREATE INDEX auth_sessions_email_idx  ON auth_sessions (email);

-- Down Migration

DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_exchange_codes;
DROP TABLE IF EXISTS auth_flows;
