-- Up Migration
-- Opportunity › Live Bids › Manage columns › People columns: who each person column's dropdown offers.
-- One row per column id (standard id or custom:<key>); `settings` = { departments: string[], people: string[], multiple: boolean }.
-- No row = the column's default list.
CREATE TABLE bid_people_column_settings (
  column_id TEXT PRIMARY KEY,
  settings JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE bid_people_column_settings;
