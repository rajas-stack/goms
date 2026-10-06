-- Up Migration

-- Who created the row (lower-cased email). Nullable: rows that predate RBAC have none.
-- It makes a creator "own" what they just created (RBAC spec §9.1; plan gap A1).
ALTER TABLE opportunities    ADD COLUMN created_by TEXT;
ALTER TABLE timeline_events  ADD COLUMN created_by TEXT;
ALTER TABLE follow_ups       ADD COLUMN created_by TEXT;

-- Role resolution matches a login against these emails on every (cached) request.
CREATE INDEX org_people_email_lower_idx ON org_people (lower(btrim(email))) WHERE email <> '';
CREATE INDEX delivery_team_members_email_lower_idx ON delivery_team_members (lower(btrim(email))) WHERE email <> '';
CREATE INDEX sales_persons_official_email_lower_idx ON sales_persons (lower(btrim(official_email)));

-- Down Migration

DROP INDEX IF EXISTS sales_persons_official_email_lower_idx;
DROP INDEX IF EXISTS delivery_team_members_email_lower_idx;
DROP INDEX IF EXISTS org_people_email_lower_idx;
ALTER TABLE follow_ups      DROP COLUMN IF EXISTS created_by;
ALTER TABLE timeline_events DROP COLUMN IF EXISTS created_by;
ALTER TABLE opportunities   DROP COLUMN IF EXISTS created_by;
