-- Up Migration
-- DATE columns used to validate calendar input implicitly. Keep that guarantee
-- after permitting optional local clocks without silently normalizing bad dates.
CREATE FUNCTION goms_valid_calendar_value(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN value ~ '^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$'
    THEN to_char(to_date(left(value, 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = left(value, 10)
    ELSE false END
$$;
DO $$
DECLARE field record;
BEGIN
  FOR field IN SELECT * FROM (VALUES
    ('employees','last_interaction_at'), ('employees','follow_up_date'),
    ('employee_charges','start_date'), ('employee_charges','end_date'), ('transfers','effective_date'),
    ('sales_persons','joined_on'), ('sales_persons','left_on'), ('sales_postings','start_date'), ('sales_postings','end_date'),
    ('ownership_assignments','start_date'), ('ownership_assignments','end_date'),
    ('commercial_skus','active_from'), ('commercial_skus','active_till'), ('commercial_boq_line_items','approval_date'),
    ('bid_custom_field_values','value_date'), ('follow_ups','due_date'),
    ('bid_corrigenda','published_date'), ('bid_corrigenda','received_date'), ('bid_corrigenda','effective_date')
  ) AS fields(table_name, column_name) LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (goms_valid_calendar_value(%I))', field.table_name, 'goms_' || field.column_name || '_calendar', field.column_name);
  END LOOP;
END $$;

-- Down Migration
DO $$
DECLARE field record;
BEGIN
  FOR field IN SELECT conrelid::regclass AS table_name, conname FROM pg_constraint WHERE conname LIKE 'goms_%_calendar' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', field.table_name, field.conname);
  END LOOP;
END $$;
DROP FUNCTION goms_valid_calendar_value(text);
