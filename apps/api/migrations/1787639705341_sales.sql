-- Up Migration

CREATE TABLE sales_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  official_email TEXT NOT NULL,
  personal_email TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  alt_mobile TEXT NOT NULL DEFAULT '',
  joined_on DATE,
  left_on DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','onLeave','resigned','inactive')),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sales_persons_official_email_idx ON sales_persons (official_email);

CREATE TABLE sales_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id UUID NOT NULL REFERENCES sales_persons(id) ON DELETE CASCADE,
  designation TEXT NOT NULL,
  tier_key TEXT NOT NULL,
  manager_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  office TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE,
  change_type TEXT NOT NULL CHECK (change_type IN ('initial','promotion','demotion','lateralMove','reorg','correction')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT sales_posting_end_after_start CHECK (end_date IS NULL OR end_date > start_date)
);
CREATE INDEX sales_postings_sales_person_id_idx ON sales_postings (sales_person_id);
-- Enforces "at most one current posting per person" at the DB level (today only enforced in JS, spec §7.3):
CREATE UNIQUE INDEX one_current_sales_posting_per_person ON sales_postings (sales_person_id) WHERE end_date IS NULL;

-- Down Migration

DROP TABLE sales_postings;
DROP TABLE sales_persons;
