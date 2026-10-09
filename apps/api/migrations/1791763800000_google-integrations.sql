-- Up Migration
CREATE TABLE google_integration_settings (
  user_uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Down Migration
DROP TABLE google_integration_settings;
