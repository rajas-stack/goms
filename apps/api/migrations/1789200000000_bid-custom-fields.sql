-- Up Migration

-- User-defined Master Grid columns (spec §8.1). `key` is the immutable slug
-- used as the grid column id (`custom:<key>`), filter field and import
-- heading; rename only ever changes `name`. `data_type` is immutable too
-- (enforced in the router — no patch shape includes it).
CREATE TABLE bid_custom_fields (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  data_type  TEXT NOT NULL CHECK (data_type IN ('text','number','date','select','boolean')),
  options    JSONB,
  position   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((data_type = 'select') = (options IS NOT NULL))
);
-- Names are unique among ACTIVE fields only (case-insensitive), so an
-- archived column's name can be reused.
CREATE UNIQUE INDEX bid_custom_fields_active_name_uq ON bid_custom_fields (lower(btrim(name))) WHERE status = 'active';
CREATE INDEX bid_custom_fields_position_idx ON bid_custom_fields (status, position);

-- Down Migration

DROP TABLE bid_custom_fields;
