-- Up Migration
-- Preserve optional local clocks on user-entered calendar fields throughout the app.
-- Machine audit timestamps remain timestamp/date columns and are never edited by these controls.
ALTER TABLE employees
  ALTER COLUMN last_interaction_at TYPE text USING to_char(last_interaction_at, 'YYYY-MM-DD'),
  ALTER COLUMN follow_up_date TYPE text USING to_char(follow_up_date, 'YYYY-MM-DD');
ALTER TABLE employee_charges
  ALTER COLUMN start_date TYPE text USING to_char(start_date, 'YYYY-MM-DD'),
  ALTER COLUMN end_date TYPE text USING to_char(end_date, 'YYYY-MM-DD');
ALTER TABLE transfers ALTER COLUMN effective_date TYPE text USING to_char(effective_date, 'YYYY-MM-DD');
ALTER TABLE sales_persons
  ALTER COLUMN joined_on TYPE text USING to_char(joined_on, 'YYYY-MM-DD'),
  ALTER COLUMN left_on TYPE text USING to_char(left_on, 'YYYY-MM-DD');
ALTER TABLE sales_postings
  ALTER COLUMN start_date TYPE text USING to_char(start_date, 'YYYY-MM-DD'),
  ALTER COLUMN end_date TYPE text USING to_char(end_date, 'YYYY-MM-DD');
ALTER TABLE ownership_assignments
  ALTER COLUMN start_date TYPE text USING to_char(start_date, 'YYYY-MM-DD'),
  ALTER COLUMN end_date TYPE text USING to_char(end_date, 'YYYY-MM-DD');
ALTER TABLE commercial_skus
  ALTER COLUMN active_from TYPE text USING to_char(active_from, 'YYYY-MM-DD'),
  ALTER COLUMN active_till TYPE text USING to_char(active_till, 'YYYY-MM-DD');
ALTER TABLE commercial_boq_line_items ALTER COLUMN approval_date TYPE text USING to_char(approval_date, 'YYYY-MM-DD');

-- Down Migration
-- A rollback discards optional clocks. Back up the calendar values before reverting.
ALTER TABLE employees
  ALTER COLUMN last_interaction_at TYPE date USING left(last_interaction_at, 10)::date,
  ALTER COLUMN follow_up_date TYPE date USING left(follow_up_date, 10)::date;
ALTER TABLE employee_charges
  ALTER COLUMN start_date TYPE date USING left(start_date, 10)::date,
  ALTER COLUMN end_date TYPE date USING left(end_date, 10)::date;
ALTER TABLE transfers ALTER COLUMN effective_date TYPE date USING left(effective_date, 10)::date;
ALTER TABLE sales_persons
  ALTER COLUMN joined_on TYPE date USING left(joined_on, 10)::date,
  ALTER COLUMN left_on TYPE date USING left(left_on, 10)::date;
ALTER TABLE sales_postings
  ALTER COLUMN start_date TYPE date USING left(start_date, 10)::date,
  ALTER COLUMN end_date TYPE date USING left(end_date, 10)::date;
ALTER TABLE ownership_assignments
  ALTER COLUMN start_date TYPE date USING left(start_date, 10)::date,
  ALTER COLUMN end_date TYPE date USING left(end_date, 10)::date;
ALTER TABLE commercial_skus
  ALTER COLUMN active_from TYPE date USING left(active_from, 10)::date,
  ALTER COLUMN active_till TYPE date USING left(active_till, 10)::date;
ALTER TABLE commercial_boq_line_items ALTER COLUMN approval_date TYPE date USING left(approval_date, 10)::date;
