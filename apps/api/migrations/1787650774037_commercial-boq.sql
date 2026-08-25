-- Up Migration

CREATE TABLE commercial_boq_number_sequences (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE commercial_boqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately NOT unique: reviseBoqLogic keeps the same boq_number as the
  -- BOQ it revises (only duplicateBoq mints a fresh one), so more than one
  -- row can legitimately share a number.
  boq_number TEXT NOT NULL,
  opportunity_name TEXT NOT NULL,
  department_id UUID NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_organization TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  customer_contact TEXT NOT NULL DEFAULT '',
  vertical_id UUID NOT NULL REFERENCES commercial_masters(id) ON DELETE RESTRICT,
  budget_amount TEXT NOT NULL DEFAULT '',
  budget_unit TEXT NOT NULL DEFAULT '',
  budget_known TEXT NOT NULL DEFAULT '',
  emd_amount TEXT NOT NULL DEFAULT '',
  emd_unit TEXT NOT NULL DEFAULT '',
  sales_person_id UUID NOT NULL REFERENCES sales_persons(id) ON DELETE RESTRICT,
  bu_sales_person_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  pre_sales_id UUID REFERENCES commercial_masters(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','approved','rejected','cancelled','archived')),
  boq_version INTEGER NOT NULL DEFAULT 1,
  revision_number INTEGER NOT NULL DEFAULT 0,
  -- No FK: deleteBoqLogic never checks for revisions pointing back at a BOQ
  -- before deleting it — a revision's parent_boq_id is allowed to dangle
  -- after its source is deleted, same as employee_merge_audit.duplicate_id's
  -- unenforced reference to a row that's since been merged away. A `RESTRICT`
  -- FK here would block deleting any BOQ that has ever been revised, which
  -- the real in-memory behavior never blocks.
  parent_boq_id UUID,
  -- A currency CODE (e.g. "INR"), not an FK — matches the real frontend
  -- CommercialBoq.currency: string field, resolved against
  -- commercial_masters (master_key='currencies').code at the application layer.
  currency TEXT NOT NULL,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  last_modified_by TEXT
);
CREATE INDEX commercial_boqs_number_idx ON commercial_boqs (boq_number);
-- NOT a unique index: findBoqByOpportunityName's uniqueness check runs only
-- at the two "new value" entry points (createBoqLogic/updateBoqLogic) — the
-- copy paths (reviseBoqLogic/duplicateBoqLogic) never re-check it and
-- deliberately carry the original's opportunity_name forward unchanged, so
-- a revision/duplicate legitimately shares its name with its source. A DB
-- UNIQUE constraint here would block every revise/duplicate of a named BOQ;
-- uniqueness is enforced at the application layer (assertOpportunityNameAvailable
-- in the router) only for create/update, matching the real in-memory behavior.
CREATE INDEX commercial_boqs_opportunity_name_idx ON commercial_boqs (lower(trim(opportunity_name)));
CREATE INDEX commercial_boqs_department_id_idx ON commercial_boqs (department_id);
CREATE INDEX commercial_boqs_sales_person_id_idx ON commercial_boqs (sales_person_id);
CREATE INDEX commercial_boqs_parent_boq_id_idx ON commercial_boqs (parent_boq_id);

CREATE TABLE commercial_boq_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id UUID NOT NULL REFERENCES commercial_boqs(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES commercial_skus(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  discount_pct NUMERIC NOT NULL DEFAULT 0,
  tax_pct NUMERIC NOT NULL DEFAULT 0,
  approver_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  approval_date DATE,
  approval_remarks TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('auto_approved','pending','approved','rejected')),
  line_total NUMERIC NOT NULL DEFAULT 0,
  pricing_levels JSONB NOT NULL DEFAULT '[]',
  active_pricing_level TEXT,
  -- No dedicated field in the in-memory model (line order is the flat
  -- array's own relative order) — Postgres needs an explicit column to
  -- preserve the same "reorder within this BOQ only" behavior deterministically.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX commercial_boq_line_items_boq_id_idx ON commercial_boq_line_items (boq_id);
CREATE INDEX commercial_boq_line_items_sku_id_idx ON commercial_boq_line_items (sku_id);

-- Generic across every domain (masters/SKU/BOQ/line-item today; any future
-- domain tomorrow) — entity_type/entity_id are deliberately unenforced TEXT,
-- not a typed FK, matching employee_merge_audit's precedent: a log of
-- history must survive the entity it describes being long gone.
CREATE TABLE commercial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  changed_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  changed_by TEXT
);
CREATE INDEX commercial_audit_logs_entity_idx ON commercial_audit_logs (entity_type, entity_id);

-- Down Migration

DROP TABLE commercial_audit_logs;
DROP TABLE commercial_boq_line_items;
DROP TABLE commercial_boqs;
DROP TABLE commercial_boq_number_sequences;
