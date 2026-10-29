-- Up Migration
-- Document maker sharing and version history.
-- Shares: the owner grants any combination of read / comment / write to an Amnex employee; every share may open
-- the file. Versions: before a save overwrites maker_documents.content, the previous bytes are kept here so the
-- file page can list and download earlier versions.
CREATE TABLE maker_document_shares (
  document_id UUID NOT NULL REFERENCES maker_documents(id) ON DELETE CASCADE,
  grantee_email TEXT NOT NULL CHECK (grantee_email ~ '^[^@[:space:]]+@amnex\.com$'),
  grantee_name TEXT NOT NULL DEFAULT '',
  can_read BOOLEAN NOT NULL DEFAULT false,
  can_comment BOOLEAN NOT NULL DEFAULT false,
  can_write BOOLEAN NOT NULL DEFAULT false,
  shared_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, grantee_email),
  CHECK (can_read OR can_comment OR can_write)
);
CREATE INDEX maker_document_shares_grantee_idx ON maker_document_shares (grantee_email);

CREATE TABLE maker_document_versions (
  document_id UUID NOT NULL REFERENCES maker_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  content BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  saved_by TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version)
);

-- Desktop-app sessions (Word / Excel / PowerPoint over WebDAV). Office truncates long URLs, so the link carries a
-- short random id; only its SHA-256 is stored. Access is re-checked against owner/shares on every request.
CREATE TABLE maker_dav_sessions (
  token_hash TEXT PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES maker_documents(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX maker_dav_sessions_expires_idx ON maker_dav_sessions (expires_at);
-- Down Migration
DROP TABLE maker_dav_sessions;
DROP TABLE maker_document_versions;
DROP TABLE maker_document_shares;
