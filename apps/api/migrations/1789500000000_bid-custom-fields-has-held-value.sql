-- Up Migration

-- "A column that has ever held a value can only be archived, never deleted"
-- (spec §8.1). Clearing a value deletes its row, so row existence alone cannot
-- say whether a column EVER held one; this flag records it durably. Set to true
-- the first time any non-null value is written and never reset.
ALTER TABLE bid_custom_fields ADD COLUMN has_held_value BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any column that currently has value rows has held a value. (A
-- column whose values were all cleared before this migration cannot be
-- recovered from the tables — its audit-log history is the only record.)
UPDATE bid_custom_fields f SET has_held_value = true
WHERE EXISTS (SELECT 1 FROM bid_custom_field_values v WHERE v.field_id = f.id)
   OR EXISTS (SELECT 1 FROM commercial_audit_logs a
              WHERE a.entity_type = 'bidCustomFieldValue' AND a.field = f.key AND a.action = 'custom_value_set');

-- Down Migration

ALTER TABLE bid_custom_fields DROP COLUMN has_held_value;
