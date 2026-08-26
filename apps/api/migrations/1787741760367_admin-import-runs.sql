-- Up Migration

-- No FK/created_by yet — same unpopulated-seam convention as employees.created_by
-- elsewhere (auth doesn't exist yet, see Stage B §1). rejected_rows is capped to
-- what MAX_IMPORT_ROWS already bounds, so this can't grow unboundedly per row.
CREATE TABLE admin_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  summary JSONB NOT NULL,
  rejected_rows JSONB NOT NULL DEFAULT '[]',
  committed_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX admin_import_runs_domain_idx ON admin_import_runs (domain);

-- Down Migration

DROP TABLE admin_import_runs;