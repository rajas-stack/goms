-- Up Migration

-- One row per year, atomic sequence allocation (mirrors
-- commercial_boq_number_sequences).
CREATE TABLE bid_number_sequences (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

-- Bid Tracker's linked entity — 1:1 with opportunities (design spec §3).
-- ON DELETE RESTRICT with no exception for archived bids (spec §4.7).
CREATE TABLE bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  bid_code        TEXT NOT NULL UNIQUE,
  stage_key       TEXT NOT NULL DEFAULT 'solutioning',
  decision        TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','go','no_go')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  data_confidence TEXT NOT NULL DEFAULT 'verified' CHECK (data_confidence IN ('verified','needs_review')),
  tender_link     TEXT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bids_opportunity_id_idx ON bids (opportunity_id);
CREATE INDEX bids_stage_key_idx ON bids (stage_key);

-- Down Migration

DROP TABLE bids;
DROP TABLE bid_number_sequences;
