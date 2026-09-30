-- Up Migration

-- Master Grid's "Client City" column (spec §8) — no existing table tracks
-- city anywhere in GOMS (only state, via hierarchy_nodes' 'geo' domain).
-- Nullable, free-text, no new geo hierarchy level introduced.
ALTER TABLE opportunities ADD COLUMN city TEXT;

-- Down Migration

ALTER TABLE opportunities DROP COLUMN city;
