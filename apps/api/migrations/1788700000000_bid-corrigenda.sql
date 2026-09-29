-- Up Migration

-- Corrigenda: one row per detected amendment document/batch. `source_document_id`
-- requires `documents` to already exist — this migration MUST run after
-- 1788600000000_documents.sql (an ordering bug caught during the design
-- spec's self-review; do not reorder these two files).
CREATE TABLE bid_corrigenda (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id             UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  corrigendum_number INTEGER NOT NULL,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, corrigendum_number)
);
-- status ('pending_review' | 'reviewed') is DERIVED at read time (spec §12),
-- not a stored column.

CREATE TABLE bid_corrigendum_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrigendum_id UUID NOT NULL REFERENCES bid_corrigenda(id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,
  current_value  TEXT NOT NULL DEFAULT '',
  proposed_value TEXT NOT NULL DEFAULT '',
  decision       TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decided_at     TIMESTAMPTZ,
  decided_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bid_corrigendum_changes_corrigendum_id_idx ON bid_corrigendum_changes (corrigendum_id);

-- Down Migration

DROP TABLE bid_corrigendum_changes;
DROP TABLE bid_corrigenda;
