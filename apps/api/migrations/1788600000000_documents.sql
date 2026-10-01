-- Up Migration

-- Documents + citations (spec §14) — genuinely new, no file/blob infra
-- exists anywhere in GOMS today. Polymorphic entity_type/entity_id,
-- deliberately unenforced (no FK), matching commercial_audit_logs'
-- convention — a document row can outlive whatever it was attached to.
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT 'v1.0',
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, filename, version)
);
CREATE INDEX documents_entity_idx ON documents (entity_type, entity_id);

CREATE TABLE document_citations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_label  TEXT NOT NULL,
  quote_text  TEXT NOT NULL DEFAULT '',
  field_ref   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_citations_document_id_idx ON document_citations (document_id);

-- Down Migration

DROP TABLE document_citations;
DROP TABLE documents;
