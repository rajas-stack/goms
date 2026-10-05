-- Up Migration

ALTER TABLE delivery_team_members
  ADD COLUMN manager_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD CONSTRAINT delivery_team_members_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id);

CREATE INDEX delivery_team_members_manager_idx ON delivery_team_members (manager_id);

-- Down Migration

DROP INDEX IF EXISTS delivery_team_members_manager_idx;
ALTER TABLE delivery_team_members
  DROP CONSTRAINT IF EXISTS delivery_team_members_not_own_manager,
  DROP COLUMN IF EXISTS manager_id;
