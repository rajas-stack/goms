-- Up Migration

-- Built-in Bid Tracker field "Tender Folder Link" (packages/domain/src/bidTrackerFields.ts, key tender_folder).
-- A Google Drive folder link; the grid lists that folder's files using the viewer's own Drive access.
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'tender_folder', 'Tender Folder Link', 'url', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'tender_folder' OR (status = 'active' AND lower(btrim(name)) = 'tender folder link'));

-- Down Migration

DELETE FROM bid_custom_fields WHERE key = 'tender_folder' AND created_by = 'system' AND NOT has_held_value;
