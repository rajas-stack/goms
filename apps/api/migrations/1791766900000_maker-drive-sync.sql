-- Up Migration
-- Document maker → the owner's own Google Drive. Each employee connects once (scope drive.file: GOMS sees only the
-- files it created). credentials is sealed with EMAIL_TOKEN_ENCRYPTION_KEY and bound to the employee's email.
-- Every saved version is uploaded over the same Drive file, so Drive keeps its own revisions too.
CREATE TABLE maker_drive_connections (
  email TEXT PRIMARY KEY,
  credentials JSONB NOT NULL,
  folder_id TEXT,
  last_error TEXT,
  last_sync_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE maker_drive_files (
  document_id UUID PRIMARY KEY REFERENCES maker_documents(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Down Migration
DROP TABLE maker_drive_files;
DROP TABLE maker_drive_connections;
