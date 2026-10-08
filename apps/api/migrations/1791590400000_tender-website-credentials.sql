-- Up Migration

-- The client encrypts credentials before sending them. No plaintext secrets
-- or unlock passphrases are stored by the API, audit log, or backups.
ALTER TABLE tender_websites
  ADD COLUMN credentials JSONB,
  ADD COLUMN dsc_employee_id UUID REFERENCES org_people(id) ON DELETE SET NULL;

-- Down Migration

ALTER TABLE tender_websites
  DROP COLUMN dsc_employee_id,
  DROP COLUMN credentials;
