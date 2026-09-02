-- Item 13: the timeline's Note field is too generic to capture what a
-- meeting was for, what came out of it, and what's next. Add three
-- optional, separately-displayed fields instead of overloading `note`.
-- Nullable, no default, no backfill: these are new optional fields for
-- meeting entries going forward; historical rows simply have none, which
-- is honest — there's no prior data to backfill from.
ALTER TABLE timeline_events
  ADD COLUMN agenda TEXT,
  ADD COLUMN outcome TEXT,
  ADD COLUMN next_steps TEXT;
