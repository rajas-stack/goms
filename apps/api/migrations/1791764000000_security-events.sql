-- Up Migration
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  procedure TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'started' CHECK (outcome IN ('started','succeeded','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX security_events_started_at_idx ON security_events (started_at);
-- Down Migration
DROP TABLE security_events;
