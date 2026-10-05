-- Up Migration

-- Sheet ownership: which Opportunity sheet a bid lives in. Bid Tracker holds
-- live bids, Pipeline (Funnel / Backup / Commits) funnel opportunities and
-- Campaign campaign rows; Master is the collective view, never a home sheet.
-- Every existing bid was a Bid Tracker row, hence the default.
-- Keep the list in sync with OWNED_SHEETS (packages/domain/src/bids.ts).
ALTER TABLE bids ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker'
  CHECK (sheet IN ('bidTracker', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'campaign'));
CREATE INDEX bids_sheet_idx ON bids (sheet);

-- Down Migration

DROP INDEX IF EXISTS bids_sheet_idx;
ALTER TABLE bids DROP COLUMN sheet;
