-- Up Migration

-- Milestones: pre-bid conference, query deadlines, submission deadline,
-- corrigendum-linked date slots (spec §4.1, §11). `key` is PERMANENT and
-- non-colliding — stable across edits so a corrigendum can reference "this
-- exact date slot" across multiple amendments.
CREATE TABLE bid_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id         UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  due_at         TIMESTAMPTZ,
  venue          TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','superseded')),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','corrigendum')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, key)
);
CREATE INDEX bid_milestones_bid_id_idx ON bid_milestones (bid_id);

-- Down Migration

DROP TABLE bid_milestones;
