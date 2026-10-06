-- Up Migration
CREATE TABLE bid_synopsis_sections (
  bid_id uuid NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('scope','pq','tq','manpower','milestone','payment','boq','queries')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (bid_id, section)
);

-- Down Migration
DROP TABLE bid_synopsis_sections;
