-- Up Migration

-- A profile picture for an Org Structure person, same "data URL, no separate asset store" convention as
-- sales_persons.photo_url / employees.photo_url. Nullable: unset means no photo, rendered as initials.
ALTER TABLE org_people ADD COLUMN photo_url TEXT;

-- Down Migration

ALTER TABLE org_people DROP COLUMN photo_url;
