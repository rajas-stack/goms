-- Up Migration

-- One generic table for the 12 Commercial Calculator master kinds instead of
-- 12 separate tables — mirrors the frontend's generic MasterEntityKey design
-- (repository-logic.ts already treats all 12 identically). `parent_id` is
-- self-referencing and carries the Vertical -> Product -> Module -> Feature
-- chain; masters with no parent (verticals, skuCategories, etc.) leave it
-- NULL. Per-kind fields that don't warrant 12 separate tables (feature
-- status, tax rate, approval-band bounds, currency exchange rate, ...) live
-- in `extra`.
CREATE TABLE commercial_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_key TEXT NOT NULL,
  parent_id UUID REFERENCES commercial_masters(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_masters_key_code_idx ON commercial_masters (master_key, lower(trim(code)));
CREATE INDEX commercial_masters_parent_id_idx ON commercial_masters (parent_id);
CREATE INDEX commercial_masters_master_key_idx ON commercial_masters (master_key);

-- Product Edition <-> Feature junction (spec's ProductEditionFeature). Both
-- sides reference commercial_masters directly rather than adding a
-- master_key check, since editionId/featureId already imply which kind of
-- row is expected.
CREATE TABLE edition_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES commercial_masters(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES commercial_masters(id) ON DELETE CASCADE,
  mandatory BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX edition_features_edition_feature_idx ON edition_features (edition_id, feature_id);
CREATE INDEX edition_features_edition_id_idx ON edition_features (edition_id);

-- Down Migration

DROP TABLE edition_features;
DROP TABLE commercial_masters;
