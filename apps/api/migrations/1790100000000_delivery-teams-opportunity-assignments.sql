-- Up Migration

CREATE TABLE delivery_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team TEXT NOT NULL CHECK (team IN ('preSales', 'legal', 'bid')),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team, name)
);

CREATE INDEX delivery_team_members_team_status_name_idx ON delivery_team_members (team, status, name);

ALTER TABLE opportunities
  ADD COLUMN geo_sales_person_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  ADD COLUMN bu_sales_person_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  ADD COLUMN pre_sales_person_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD COLUMN legal_person_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD COLUMN bid_team_member_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL;

CREATE INDEX opportunities_geo_sales_person_idx ON opportunities (geo_sales_person_id);
CREATE INDEX opportunities_bu_sales_person_idx ON opportunities (bu_sales_person_id);
CREATE INDEX opportunities_pre_sales_person_idx ON opportunities (pre_sales_person_id);
CREATE INDEX opportunities_legal_person_idx ON opportunities (legal_person_id);
CREATE INDEX opportunities_bid_team_member_idx ON opportunities (bid_team_member_id);

-- Down Migration

DROP INDEX IF EXISTS opportunities_bid_team_member_idx;
DROP INDEX IF EXISTS opportunities_legal_person_idx;
DROP INDEX IF EXISTS opportunities_pre_sales_person_idx;
DROP INDEX IF EXISTS opportunities_bu_sales_person_idx;
DROP INDEX IF EXISTS opportunities_geo_sales_person_idx;
ALTER TABLE opportunities
  DROP COLUMN IF EXISTS bid_team_member_id,
  DROP COLUMN IF EXISTS legal_person_id,
  DROP COLUMN IF EXISTS pre_sales_person_id,
  DROP COLUMN IF EXISTS bu_sales_person_id,
  DROP COLUMN IF EXISTS geo_sales_person_id;
DROP INDEX IF EXISTS delivery_team_members_team_status_name_idx;
DROP TABLE IF EXISTS delivery_team_members;