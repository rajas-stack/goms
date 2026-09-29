-- Up Migration

-- Saved views (spec §9). SYSTEM_BID_VIEWS (packages/domain/src/bids.ts) are
-- NEVER rows in this table — only personal/global user-created views live
-- here, by design (structural immutability for the system set).
CREATE TABLE bid_saved_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('personal','global')),
  owner_email      TEXT,
  filter_rules     JSONB NOT NULL DEFAULT '[]',
  sort             JSONB NOT NULL DEFAULT '[]',
  visible_columns  JSONB NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_view_has_owner CHECK (scope <> 'personal' OR owner_email IS NOT NULL)
);

-- Down Migration

DROP TABLE bid_saved_views;
