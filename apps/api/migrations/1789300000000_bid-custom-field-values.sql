-- Up Migration

-- One row per (bid, field); typed columns so sort/filter is type-correct.
-- A cleared value deletes the row (the audit log records the edit).
-- field_id is RESTRICT: a field that has ever held a value can only be
-- archived, never hard-deleted. Values cascade with their bid.
CREATE TABLE bid_custom_field_values (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  field_id     UUID NOT NULL REFERENCES bid_custom_fields(id) ON DELETE RESTRICT,
  value_text   TEXT,
  value_number NUMERIC,
  value_date   DATE,
  value_bool   BOOLEAN,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, field_id),
  CHECK (num_nonnulls(value_text, value_number, value_date, value_bool) = 1)
);
CREATE INDEX bid_cfv_field_text_idx   ON bid_custom_field_values (field_id, value_text)   WHERE value_text   IS NOT NULL;
CREATE INDEX bid_cfv_field_number_idx ON bid_custom_field_values (field_id, value_number) WHERE value_number IS NOT NULL;
CREATE INDEX bid_cfv_field_date_idx   ON bid_custom_field_values (field_id, value_date)   WHERE value_date   IS NOT NULL;

-- Down Migration

DROP TABLE bid_custom_field_values;
