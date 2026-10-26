-- Up Migration
ALTER TABLE bids ADD COLUMN lifecycle_reached_sheet TEXT;
ALTER TABLE bids ADD COLUMN lifecycle_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Preserve the furthest known stage, including historical moves back to an earlier sheet.
WITH stages(sheet, rank) AS (VALUES
  ('campaign', 0), ('pipeline-funnel', 1), ('pipeline-backup', 2), ('pipeline-commits', 3), ('bidTracker', 4)
), visits AS (
  SELECT b.id, s.rank FROM bids b JOIN stages s ON s.sheet = b.sheet
  UNION ALL
  SELECT b.id, s.rank FROM bids b
  JOIN commercial_audit_logs a ON a.entity_type = 'bid' AND a.entity_id = b.id::text AND a.field = 'sheet'
  JOIN stages s ON s.sheet = a.old_value OR s.sheet = a.new_value
), furthest AS (SELECT id, max(rank) AS rank FROM visits GROUP BY id)
UPDATE bids b SET lifecycle_reached_sheet = s.sheet FROM furthest f JOIN stages s ON s.rank = f.rank WHERE b.id = f.id;

ALTER TABLE bids ADD CONSTRAINT bids_lifecycle_reached_sheet_check CHECK (
  lifecycle_reached_sheet IS NULL OR lifecycle_reached_sheet IN ('campaign', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'bidTracker')
);

-- Down Migration
ALTER TABLE bids DROP COLUMN lifecycle_data;
ALTER TABLE bids DROP COLUMN lifecycle_reached_sheet;
