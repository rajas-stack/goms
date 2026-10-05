-- Up Migration

-- Human-readable Opportunity ID, e.g. FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1
-- (packages/domain/src/opportunityCode.ts). Generated once, inside the insert
-- transaction (opportunities.insertOpportunity / bids.create), and never
-- changed afterwards. Nullable only for rows that predate it — fill those with
-- apps/api/scripts/backfill-opportunity-codes.ts. UNIQUE is the last-line
-- guard against a duplicate.
ALTER TABLE opportunities ADD COLUMN opportunity_code TEXT UNIQUE;
-- RFP / RFQ / EOI / RFI / GeM / Tender / Direct; '' = not set.
ALTER TABLE opportunities ADD COLUMN opportunity_type TEXT NOT NULL DEFAULT '';

-- One counter per fiscal year ('FY27'), allocated with the same atomic
-- INSERT … ON CONFLICT DO UPDATE … RETURNING upsert as bid_number_sequences.
CREATE TABLE opportunity_code_sequences (
  fiscal_year TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

-- Down Migration

DROP TABLE opportunity_code_sequences;
ALTER TABLE opportunities DROP COLUMN opportunity_type;
ALTER TABLE opportunities DROP COLUMN opportunity_code;
