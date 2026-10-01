-- Up Migration

-- More practical column types for the Bid Tracker grid: currency, url, email,
-- phone, multiselect (stored in the existing typed value columns) and the
-- entity-backed person / department / state (value = the entity's id / code,
-- never a copied name). multiselect, like select, carries an option list.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bid_custom_fields'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE bid_custom_fields DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_data_type_check CHECK (data_type IN (
  'text','number','date','select','boolean',
  'currency','url','email','phone','person','department','state','multiselect'
));
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_options_check CHECK (
  (data_type IN ('select','multiselect')) = (options IS NOT NULL)
);
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,47}$');
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80);
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_status_check CHECK (status IN ('active','archived'));

-- Down Migration

DELETE FROM bid_custom_fields WHERE data_type IN ('currency','url','email','phone','person','department','state','multiselect');
ALTER TABLE bid_custom_fields DROP CONSTRAINT bid_custom_fields_data_type_check;
ALTER TABLE bid_custom_fields DROP CONSTRAINT bid_custom_fields_options_check;
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_data_type_check CHECK (data_type IN ('text','number','date','select','boolean'));
ALTER TABLE bid_custom_fields ADD CONSTRAINT bid_custom_fields_options_check CHECK ((data_type = 'select') = (options IS NOT NULL));
