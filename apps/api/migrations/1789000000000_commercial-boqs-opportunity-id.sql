-- Up Migration

-- The one missing FK the design audit found (spec §4.3) — nullable, NOT
-- unique: one opportunity can have more than one independent BOQ document
-- (boq_number lineage), verified by reading commercial.ts's revise/duplicate
-- code directly, not assumed.
ALTER TABLE commercial_boqs ADD COLUMN opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX commercial_boqs_opportunity_id_idx ON commercial_boqs (opportunity_id);

-- Down Migration

DROP INDEX commercial_boqs_opportunity_id_idx;
ALTER TABLE commercial_boqs DROP COLUMN opportunity_id;
