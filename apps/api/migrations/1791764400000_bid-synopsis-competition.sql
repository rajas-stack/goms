-- Up Migration

-- "Competition" (rival bidders, scores, prices, ranks) is a grid synopsis
-- section. Keep the list in sync with BID_SYNOPSIS_SECTIONS
-- (packages/domain/src/bidSynopsis.ts).
ALTER TABLE bid_synopsis_sections DROP CONSTRAINT bid_synopsis_sections_section_check;
ALTER TABLE bid_synopsis_sections ADD CONSTRAINT bid_synopsis_sections_section_check
  CHECK (section IN ('general','scope','pq','tq','manpower','milestone','payment','boq','queries','competition'));

-- Down Migration

DELETE FROM bid_synopsis_sections WHERE section = 'competition';
ALTER TABLE bid_synopsis_sections DROP CONSTRAINT bid_synopsis_sections_section_check;
ALTER TABLE bid_synopsis_sections ADD CONSTRAINT bid_synopsis_sections_section_check
  CHECK (section IN ('general','scope','pq','tq','manpower','milestone','payment','boq','queries'));
