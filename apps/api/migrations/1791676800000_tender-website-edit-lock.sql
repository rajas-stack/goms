-- Up Migration
ALTER TABLE tender_websites ADD COLUMN editing_locked BOOLEAN NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE tender_websites DROP COLUMN editing_locked;
