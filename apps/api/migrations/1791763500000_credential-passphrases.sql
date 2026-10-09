-- Up Migration
CREATE TABLE credential_passphrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot SMALLINT NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 5),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  proof JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credential_passphrases_name ON credential_passphrases (lower(name));
-- Down Migration
DROP TABLE credential_passphrases;
