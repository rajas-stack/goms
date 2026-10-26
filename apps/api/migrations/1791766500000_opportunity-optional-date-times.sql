-- Up Migration
-- ISO calendar values keep their optional local clock. Existing dates remain date-only.
-- These values are entered by people; audit timestamps and milestone instants remain typed timestamps.
ALTER TABLE bid_custom_field_values ALTER COLUMN value_date TYPE text USING to_char(value_date, 'YYYY-MM-DD');
ALTER TABLE follow_ups ALTER COLUMN due_date TYPE text USING to_char(due_date, 'YYYY-MM-DD');
ALTER TABLE bid_corrigenda
  ALTER COLUMN published_date TYPE text USING to_char(published_date, 'YYYY-MM-DD'),
  ALTER COLUMN received_date TYPE text USING to_char(received_date, 'YYYY-MM-DD'),
  ALTER COLUMN effective_date TYPE text USING to_char(effective_date, 'YYYY-MM-DD');

-- Down Migration
-- Reverting to date-only storage discards optional times; take a backup before a rollback.
ALTER TABLE bid_custom_field_values ALTER COLUMN value_date TYPE date USING left(value_date, 10)::date;
ALTER TABLE follow_ups ALTER COLUMN due_date TYPE date USING left(due_date, 10)::date;
ALTER TABLE bid_corrigenda
  ALTER COLUMN published_date TYPE date USING left(published_date, 10)::date,
  ALTER COLUMN received_date TYPE date USING left(received_date, 10)::date,
  ALTER COLUMN effective_date TYPE date USING left(effective_date, 10)::date;
