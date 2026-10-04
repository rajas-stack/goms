-- Up Migration

-- Create Bid's "Reference / Bid No" (a bid/reference number distinct from the
-- GeM/tender ID) and "Name of assignment" (the tender's own title for the
-- work, distinct from AMNEX's opportunity name). Nullable free text, like city.
ALTER TABLE opportunities ADD COLUMN reference_no TEXT;
ALTER TABLE opportunities ADD COLUMN assignment_name TEXT;

-- Down Migration

ALTER TABLE opportunities DROP COLUMN assignment_name;
ALTER TABLE opportunities DROP COLUMN reference_no;
