-- Up Migration

-- Generic, polymorphic freeze/unfreeze ledger (spec §13) — not bid-specific,
-- so any future entity type can adopt it without a new table.
CREATE TABLE protected_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  field_key   TEXT NOT NULL,
  frozen      BOOLEAN NOT NULL DEFAULT false,
  frozen_at   TIMESTAMPTZ,
  frozen_by   TEXT,
  UNIQUE (entity_type, entity_id, field_key)
);
CREATE INDEX protected_values_entity_idx ON protected_values (entity_type, entity_id);

-- Down Migration

DROP TABLE protected_values;
