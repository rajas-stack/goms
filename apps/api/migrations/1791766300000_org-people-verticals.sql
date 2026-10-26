-- Up Migration

-- The business verticals (Verticals master names, e.g. 'Traffic') an Org Structure person works in. Names, not ids,
-- like org_people.departments. Empty array = none chosen.
ALTER TABLE org_people ADD COLUMN verticals TEXT[] NOT NULL DEFAULT '{}';

-- Down Migration

ALTER TABLE org_people DROP COLUMN verticals;
