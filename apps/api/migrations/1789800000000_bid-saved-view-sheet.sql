-- Up Migration

-- Opportunity has several sheets (Bid Tracker, Pipeline > Funnel / Backup / Commits,
-- Campaign, Master), all the same Excel-style grid. A saved view belongs to one sheet.
-- Existing views are Bid Tracker views.
ALTER TABLE bid_saved_views ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker' CHECK (length(sheet) BETWEEN 1 AND 40);

-- Down Migration

ALTER TABLE bid_saved_views DROP COLUMN sheet;
