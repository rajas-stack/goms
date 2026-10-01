-- Up Migration

-- Each custom column belongs to the Opportunity sheet it was added on (Bid Tracker,
-- Pipeline, Campaign or Master). The Master sheet shows the columns of all sheets
-- together; every other sheet shows only its own. Existing columns are Bid Tracker's.
ALTER TABLE bid_custom_fields ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker'
  CHECK (sheet IN ('bidTracker','pipeline','campaign','master'));

-- Down Migration

ALTER TABLE bid_custom_fields DROP COLUMN sheet;
