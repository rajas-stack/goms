-- Up Migration
-- Document maker: Office files edited in ONLYOFFICE Docs. The bytes are stored in Postgres (bytea) rather than the
-- GCS attachments bucket: the Document Server must fetch and save files through this API (JWT-checked routes), files
-- are capped at 50 MB, and keeping them in the database works the same locally and in Cloud Run with no bucket or
-- service-account setup. Only the current version is kept; every save is recorded in commercial_audit_logs.
CREATE TABLE maker_documents (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'spreadsheet', 'presentation')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  file_type TEXT NOT NULL CHECK (file_type IN ('docx', 'xlsx', 'pptx')),
  content BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  document_key TEXT NOT NULL UNIQUE CHECK (document_key ~ '^[0-9A-Za-z._=-]{1,128}$'),
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'document' AND file_type = 'docx') OR (kind = 'spreadsheet' AND file_type = 'xlsx') OR (kind = 'presentation' AND file_type = 'pptx'))
);
CREATE INDEX maker_documents_owner_updated_idx ON maker_documents (owner_email, updated_at DESC);
-- Down Migration
DROP TABLE maker_documents;
