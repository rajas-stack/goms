-- Up Migration

-- Settings now has two website pages sharing this table: tender portals
-- (offered in a bid's General tab) and document verification portals (GST,
-- MCA, Udyam, ISO certificate checks). Existing rows are tender portals.
-- Names stay unique ignoring case, but only within the same page.
ALTER TABLE tender_websites
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'tender'
  CONSTRAINT tender_websites_kind_check CHECK (kind IN ('tender', 'verification'));
DROP INDEX tender_websites_name_key;
CREATE UNIQUE INDEX tender_websites_kind_name_key ON tender_websites (kind, lower(btrim(name)));

-- Down Migration

-- Verification portals have no meaning without the column (they would leak
-- into the tender dropdown), and may share a name with a tender portal.
DELETE FROM tender_websites WHERE kind <> 'tender';
DROP INDEX tender_websites_kind_name_key;
CREATE UNIQUE INDEX tender_websites_name_key ON tender_websites (lower(btrim(name)));
ALTER TABLE tender_websites DROP COLUMN kind;
