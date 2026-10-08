-- Up Migration

-- "General" tender information (bid no., dates, EMD, PBG, compliance...) is a
-- structured synopsis section. Keep the list in sync with BID_SYNOPSIS_SECTIONS
-- (packages/domain/src/bidSynopsis.ts).
ALTER TABLE bid_synopsis_sections DROP CONSTRAINT bid_synopsis_sections_section_check;
ALTER TABLE bid_synopsis_sections ADD CONSTRAINT bid_synopsis_sections_section_check
  CHECK (section IN ('general','scope','pq','tq','manpower','milestone','payment','boq','queries'));

-- Down Migration

DELETE FROM bid_synopsis_sections WHERE section = 'general';
ALTER TABLE bid_synopsis_sections DROP CONSTRAINT bid_synopsis_sections_section_check;
ALTER TABLE bid_synopsis_sections ADD CONSTRAINT bid_synopsis_sections_section_check
  CHECK (section IN ('scope','pq','tq','manpower','milestone','payment','boq','queries'));
