-- GOMS forward migration reference, generated from the current working source.
-- Use the project migration runner to apply migrations; this reference is not a live database dump.

-- Source: apps/api/migrations/1787561719008_customers.sql
-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  gst TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Source: apps/api/migrations/1787631449862_hierarchy-nodes.sql
-- Up Migration

CREATE TABLE hierarchy_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('geo','org','sales')),
  type_key TEXT NOT NULL,
  parent_id UUID REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  state_code INTEGER,
  name TEXT NOT NULL,
  code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX hierarchy_nodes_parent_id_idx ON hierarchy_nodes (parent_id);
CREATE INDEX hierarchy_nodes_domain_type_idx ON hierarchy_nodes (domain, type_key);
CREATE INDEX hierarchy_nodes_state_code_idx ON hierarchy_nodes (state_code);

-- Source: apps/api/migrations/1787635740835_employees.sql
-- Up Migration

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  org_node_id UUID NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  vacant BOOLEAN NOT NULL DEFAULT false,
  connected BOOLEAN NOT NULL DEFAULT true,
  relationship_status TEXT NOT NULL DEFAULT 'new',
  relationship_quality TEXT NOT NULL DEFAULT 'neutral',
  relationship_type TEXT NOT NULL DEFAULT '',
  introduced_by TEXT NOT NULL DEFAULT '',
  important_contact BOOLEAN NOT NULL DEFAULT false,
  preferred_comm JSONB NOT NULL DEFAULT '[]',
  last_interaction_at DATE,
  follow_up_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  visiting_cards JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX employees_org_node_id_idx ON employees (org_node_id);
CREATE INDEX employees_manager_id_idx ON employees (manager_id);
CREATE INDEX employees_status_idx ON employees (status);

CREATE TABLE employee_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('acting','additional')),
  title TEXT NOT NULL,
  org_node_id UUID REFERENCES hierarchy_nodes(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX employee_charges_employee_id_idx ON employee_charges (employee_id);

CREATE TABLE timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  custom_label TEXT,
  date DATE NOT NULL,
  time TEXT,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','system')),
  attendees JSONB,
  attended BOOLEAN,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX timeline_events_employee_id_idx ON timeline_events (employee_id);
CREATE INDEX timeline_events_type_idx ON timeline_events (type);

CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_designation TEXT NOT NULL,
  to_designation TEXT NOT NULL,
  from_department_name TEXT NOT NULL,
  to_department_name TEXT NOT NULL,
  from_office_name TEXT NOT NULL,
  to_office_name TEXT NOT NULL,
  to_org_node_id UUID NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  from_manager_name TEXT NOT NULL,
  to_manager_name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX transfers_employee_id_idx ON transfers (employee_id);

-- No FK on survivor_id/duplicate_id: duplicate_id no longer exists once the
-- merge completes, matching commercial_audit_logs' unenforced entity_id
-- convention for the same reason (this is a log of history, not a live join).
CREATE TABLE employee_merge_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id UUID NOT NULL,
  survivor_name TEXT NOT NULL,
  duplicate_id UUID NOT NULL,
  duplicate_name TEXT NOT NULL,
  merged_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  field_resolutions JSONB NOT NULL DEFAULT '[]',
  transferred JSONB NOT NULL
);
CREATE INDEX employee_merge_audit_survivor_id_idx ON employee_merge_audit (survivor_id);

-- Source: apps/api/migrations/1787639705341_sales.sql
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

-- Source: apps/api/migrations/1787645325426_commercial-masters.sql
-- Up Migration

-- One generic table for the 12 Commercial Calculator master kinds instead of
-- 12 separate tables — mirrors the frontend's generic MasterEntityKey design
-- (repository-logic.ts already treats all 12 identically). `parent_id` is
-- self-referencing and carries the Vertical -> Product -> Module -> Feature
-- chain; masters with no parent (verticals, skuCategories, etc.) leave it
-- NULL. Per-kind fields that don't warrant 12 separate tables (feature
-- status, tax rate, approval-band bounds, currency exchange rate, ...) live
-- in `extra`.
CREATE TABLE commercial_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_key TEXT NOT NULL,
  parent_id UUID REFERENCES commercial_masters(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_masters_key_code_idx ON commercial_masters (master_key, lower(trim(code)));
CREATE INDEX commercial_masters_parent_id_idx ON commercial_masters (parent_id);
CREATE INDEX commercial_masters_master_key_idx ON commercial_masters (master_key);

-- Product Edition <-> Feature junction (spec's ProductEditionFeature). Both
-- sides reference commercial_masters directly rather than adding a
-- master_key check, since editionId/featureId already imply which kind of
-- row is expected.
CREATE TABLE edition_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES commercial_masters(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES commercial_masters(id) ON DELETE CASCADE,
  mandatory BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX edition_features_edition_feature_idx ON edition_features (edition_id, feature_id);
CREATE INDEX edition_features_edition_id_idx ON edition_features (edition_id);

-- Source: apps/api/migrations/1787647096930_commercial-skus-bom.sql
-- Up Migration

-- Every FK to commercial_masters is intentionally untyped by master_key
-- (matching edition_features' existing precedent) — the column name already
-- implies which kind of master row is expected.
CREATE TABLE commercial_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES commercial_masters(id),
  feature_id UUID NOT NULL REFERENCES commercial_masters(id),
  edition_id UUID NOT NULL REFERENCES commercial_masters(id),
  uom_id UUID NOT NULL REFERENCES commercial_masters(id),
  currency_id UUID NOT NULL REFERENCES commercial_masters(id),
  tax_class_id UUID NOT NULL REFERENCES commercial_masters(id),
  billing_type_id UUID NOT NULL REFERENCES commercial_masters(id),
  active_from DATE NOT NULL,
  active_till DATE,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','active','inactive','retired')),
  is_sellable BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,

  -- Cost Management — PCS-020..025
  base_software_cost NUMERIC NOT NULL DEFAULT 0,
  implementation_cost_per_mm NUMERIC NOT NULL DEFAULT 0,
  integration_cost NUMERIC NOT NULL DEFAULT 0,
  third_party_cost NUMERIC NOT NULL DEFAULT 0,
  hardware_cost NUMERIC NOT NULL DEFAULT 0,
  cloud_cost NUMERIC NOT NULL DEFAULT 0,
  support_cost NUMERIC NOT NULL DEFAULT 0,
  training_cost NUMERIC NOT NULL DEFAULT 0,

  -- Pricing Levels — PCS-026/027, all in this SKU's currency
  internal_price NUMERIC NOT NULL DEFAULT 0,
  floor_price NUMERIC NOT NULL DEFAULT 0,
  partner_price NUMERIC NOT NULL DEFAULT 0,
  government_price NUMERIC NOT NULL DEFAULT 0,
  enterprise_price NUMERIC NOT NULL DEFAULT 0,
  corporate_price NUMERIC NOT NULL DEFAULT 0,
  list_price NUMERIC NOT NULL DEFAULT 0,

  minimum_allowed_price NUMERIC NOT NULL,
  -- Fallback ceiling used only when a line has no active pricing level (or a
  -- level with no per-level override) — see selected_pricing_levels below.
  maximum_discount_percent NUMERIC NOT NULL DEFAULT 90,

  -- Levels an admin has explicitly enabled for this SKU via "Set Pricing
  -- Levels" — [{ level, maximumDiscountPercent }, ...]. Each entry's
  -- maximumDiscountPercent is independent of every other entry's — never a
  -- field shared between two different levels (2026-08-20 UI correction).
  selected_pricing_levels JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_skus_sku_code_idx ON commercial_skus (sku_code);
CREATE INDEX commercial_skus_feature_id_idx ON commercial_skus (feature_id);

-- Component links are RESTRICT (the default), never CASCADE: PCS-038 requires
-- a clean, explicit "still referenced" error on delete, not a silent
-- cross-table cascade — the router checks and throws before ever issuing the
-- DELETE, matching commercial_masters' own delete-guard precedent.
CREATE TABLE commercial_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_sku_id UUID NOT NULL REFERENCES commercial_skus(id),
  component_sku_id UUID NOT NULL REFERENCES commercial_skus(id),
  mandatory BOOLEAN NOT NULL DEFAULT false,
  quantity NUMERIC NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX commercial_bom_items_parent_sku_id_idx ON commercial_bom_items (parent_sku_id);
CREATE INDEX commercial_bom_items_component_sku_id_idx ON commercial_bom_items (component_sku_id);

-- Source: apps/api/migrations/1787650774037_commercial-boq.sql
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

-- Source: apps/api/migrations/1787654497473_opportunities-ownership-followups.sql
-- Up Migration

CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Same convention as employees.org_node_id: RESTRICT, with hierarchy.ts's
  -- deleteNode explicitly deleting matching rows first.
  department_id UUID NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  -- Denormalized from the department for state-scoped queries and search;
  -- kept in sync on create only — a department never changes state.
  state_code INTEGER,
  -- Open string, PIPELINE_STAGE_MAP-driven — never a CHECK-constrained union.
  stage_key TEXT NOT NULL DEFAULT 'pipeline',
  closed_on DATE,
  opportunity_name TEXT NOT NULL DEFAULT '',
  gem_tender_id TEXT NOT NULL DEFAULT '',
  -- Plain string sentinels ('' = unset), not DATE/NUMERIC: the frontend type
  -- is `string`, not guaranteed well-formed, same as customers' free-text
  -- fields elsewhere in this schema.
  publish_date TEXT NOT NULL DEFAULT '',
  submission_date TEXT NOT NULL DEFAULT '',
  vertical TEXT NOT NULL DEFAULT '',
  component TEXT[] NOT NULL DEFAULT '{}',
  quantity TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  value_amount TEXT NOT NULL DEFAULT '',
  value_unit TEXT NOT NULL DEFAULT 'lakh',
  budget_known TEXT NOT NULL DEFAULT '',
  emd_amount TEXT NOT NULL DEFAULT '',
  emd_unit TEXT NOT NULL DEFAULT 'lakh',
  -- TRANSITIONAL in the frontend type (see src/lib/types.ts) — kept exactly
  -- as-is; this migration does not touch that field's lifecycle.
  sales_person_email TEXT NOT NULL DEFAULT '',
  -- isoToday() in-memory: a plain ISO date, not a timestamp.
  created_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX opportunities_department_id_idx ON opportunities (department_id);
CREATE INDEX opportunities_state_code_idx ON opportunities (state_code);

CREATE TABLE opportunity_stage_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- deleteOpportunity unconditionally cascades this in-memory.
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage_key TEXT,
  to_stage_key TEXT NOT NULL,
  changed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  changed_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  -- changed_at is a plain DATE (day granularity, matching the in-memory
  -- isoToday() field), so two changes on the same day tie on it. In-memory
  -- breaks that tie by `id`, which is safe there only because uid() mints
  -- monotonically increasing strings — a Postgres UUID has no such
  -- ordering, so a real insertion-order column is needed to reproduce the
  -- same "oldest first" guarantee.
  seq BIGSERIAL
);

CREATE INDEX opportunity_stage_changes_opportunity_id_idx ON opportunity_stage_changes (opportunity_id);

CREATE TABLE ownership_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic (orgNode/contact/opportunity) — no FK is possible across
  -- three different tables, same unenforced-reference precedent as
  -- employee_merge_audit.duplicate_id / commercial_audit_logs.entity_id.
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  -- Real, always-enforced FK: deleteSalesPerson unconditionally cascades
  -- this in-memory, same convention as sales_postings.sales_person_id.
  sales_person_id UUID NOT NULL REFERENCES sales_persons(id) ON DELETE CASCADE,
  -- Open string ("'owner' | 'delegate' today; 'collaborator' is a future
  -- addition" per the frontend type) — no CHECK.
  role TEXT NOT NULL DEFAULT 'owner',
  start_date DATE NOT NULL,
  -- Exclusive. NULL = still open. Mandatory when role = 'delegate'
  -- (enforced by the router, not a CHECK, since it depends on `role`).
  end_date DATE,
  reason TEXT NOT NULL DEFAULT 'initial'
    CHECK (reason IN ('initial', 'transfer', 'delegation', 'reassignment', 'correction')),
  batch_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX ownership_assignments_entity_idx ON ownership_assignments (entity_type, entity_id);
CREATE INDEX ownership_assignments_sales_person_id_idx ON ownership_assignments (sales_person_id);

CREATE TABLE follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic — no FK, same reasoning as ownership_assignments above.
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  -- -> sales_persons.id, but deliberately NO FK: deleteSalesPerson never
  -- touches follow_ups in-memory, leaving a dangling assigneeId — a real,
  -- existing gap this migration must not silently fix with SET NULL/RESTRICT.
  assignee_id UUID,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX follow_ups_entity_idx ON follow_ups (entity_type, entity_id);
CREATE INDEX follow_ups_status_idx ON follow_ups (status);

-- Source: apps/api/migrations/1787660000000_ownership-one-open-owner.sql
-- Up Migration

-- Enforces "at most one open (end_date IS NULL) owner-role assignment per
-- entity" at the DB level — today only enforced in JS (ownership.ts's
-- `assign` mutation), the exact same gap `sales_postings` already closed
-- for "at most one current posting per person" via
-- `one_current_sales_posting_per_person`. The app-level `SELECT ... FOR
-- UPDATE` in `assign` only locks rows that already exist and match; when
-- there is no existing open owner for an entity (e.g. two concurrent
-- first-ever assignments), FOR UPDATE locks nothing, and both requests can
-- pass the check and insert — leaving two simultaneously "open" owners for
-- the same entity. This index makes the second INSERT fail with a real
-- constraint violation instead of silently succeeding (see the 2026-08-26
-- backend hardening pass — `assign` now translates that violation into a
-- friendly CONFLICT).
CREATE UNIQUE INDEX ownership_assignments_one_open_owner_per_entity
  ON ownership_assignments (entity_type, entity_id)
  WHERE role = 'owner' AND end_date IS NULL;

-- Source: apps/api/migrations/1787741760367_admin-import-runs.sql
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

-- Source: apps/api/migrations/1787750000000_admin-import-hardening.sql
-- Up Migration

-- org's admin-assigned codes are unique across the whole 'org' domain
-- regardless of node type — matches organizationHierarchy.ts's own lookup/
-- update convention (`WHERE domain='org' AND lower(trim(code))=...`, no
-- type_key in that predicate). Case/whitespace-insensitive to match it.
CREATE UNIQUE INDEX hierarchy_nodes_org_code_ci_idx
  ON hierarchy_nodes (domain, lower(trim(code)))
  WHERE domain = 'org' AND code IS NOT NULL;

-- geo's raw LGD codes are NOT globally unique within the domain the way
-- org's are: they collide both across levels (a district and a taluka can
-- share the same numeric code) and across states (two different states can
-- have a district with the same code) -- geography.ts's own commit path
-- disambiguates by exactly this triple ("type_key+code" alone isn't enough,
-- see geography.ts's `updates` loop comment: "disambiguated by state_code
-- ... since raw LGD codes collide across states"). Scoping any tighter than
-- this (e.g. plain (domain, code) as originally drafted here) rejects real,
-- valid bundled LGD data -- caught by geography.test.ts's own fixture data
-- (Haryana district code '069'/69 colliding with Kalka taluka code 69)
-- before this migration shipped.
CREATE UNIQUE INDEX hierarchy_nodes_geo_type_code_state_ci_idx
  ON hierarchy_nodes (domain, type_key, lower(trim(code)), state_code)
  WHERE domain = 'geo' AND code IS NOT NULL;

-- Excludes ordinary-CRUD placeholder codes (employees.ts:291's
-- 'EMP-NEW-<4 digits>') — those are not a stable business key and can
-- legitimately collide; only an admin-supplied, imported code must be
-- unique. See design spec §6.3 and this migration's own header comment.
CREATE UNIQUE INDEX employees_code_ci_idx
  ON employees (lower(trim(code)))
  WHERE code NOT LIKE 'EMP-NEW-%';

CREATE UNIQUE INDEX commercial_bom_items_parent_component_idx
  ON commercial_bom_items (parent_sku_id, component_sku_id);

-- One admin_import_runs row per domain per session; session_id groups the
-- rows a single multi-domain commit produced (apps/api/src/import/auditLog.ts,
-- Task 9). Nullable so pre-existing rows from the old single-domain wizard
-- (if any survive in a dev DB) don't need a backfill.
ALTER TABLE admin_import_runs ADD COLUMN session_id UUID;
ALTER TABLE admin_import_runs ADD COLUMN excluded_rows JSONB NOT NULL DEFAULT '[]';
CREATE INDEX admin_import_runs_session_id_idx ON admin_import_runs (session_id);

-- Source: apps/api/migrations/1788000000000_admin-import-actor-email.sql
-- Closes Gate 5 of docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md
-- ("the audit/log record includes the authenticated caller's identity") now
-- that Task 2 gives every commit a verified Firebase-authenticated email.
-- Nullable + no backfill: every row committed before this migration was
-- written when no authentication existed at all, so there is no real actor
-- to backfill — NULL honestly represents "committed before auth shipped."
ALTER TABLE admin_import_runs ADD COLUMN actor_email text;

-- Source: apps/api/migrations/1788100000000_timeline-events-agenda-outcome-nextsteps.sql
-- Item 13: the timeline's Note field is too generic to capture what a
-- meeting was for, what came out of it, and what's next. Add three
-- optional, separately-displayed fields instead of overloading `note`.
-- Nullable, no default, no backfill: these are new optional fields for
-- meeting entries going forward; historical rows simply have none, which
-- is honest — there's no prior data to backfill from.
ALTER TABLE timeline_events
  ADD COLUMN agenda TEXT,
  ADD COLUMN outcome TEXT,
  ADD COLUMN next_steps TEXT;

-- Source: apps/api/migrations/1788200000000_sales-postings-gm-override.sql
-- Up Migration

-- Item 1: GM/Higher Reporting Manager becomes independently editable rather
-- than purely derived from walking the RM chain (reverses the original
-- 2026-09-01 plan's Decision #1, which deliberately kept GM derived-only to
-- avoid this column). Nullable: unset means "keep auto-deriving from RM",
-- matching how a fresh posting or one that's never been overridden behaves.
ALTER TABLE sales_postings ADD COLUMN gm_override_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL;

-- Source: apps/api/migrations/1788300000000_sales-persons-photo.sql
-- Up Migration

-- A profile picture for a SalesPerson, same "data URL, no separate asset
-- store" convention as employees.photo_url. Nullable: unset means no photo,
-- rendered as initials (Avatar already supports this — see
-- src/components/ui/Avatar.tsx).
ALTER TABLE sales_persons ADD COLUMN photo_url TEXT;

-- Source: apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql
-- Up Migration

-- One row per year, atomic sequence allocation (mirrors
-- commercial_boq_number_sequences).
CREATE TABLE bid_number_sequences (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

-- Bid Tracker's linked entity — 1:1 with opportunities (design spec §3).
-- ON DELETE RESTRICT with no exception for archived bids (spec §4.7).
CREATE TABLE bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  bid_code        TEXT NOT NULL UNIQUE,
  stage_key       TEXT NOT NULL DEFAULT 'solutioning',
  decision        TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','go','no_go')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  data_confidence TEXT NOT NULL DEFAULT 'verified' CHECK (data_confidence IN ('verified','needs_review')),
  tender_link     TEXT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bids_opportunity_id_idx ON bids (opportunity_id);
CREATE INDEX bids_stage_key_idx ON bids (stage_key);

-- Source: apps/api/migrations/1788500000000_bid-milestones.sql
-- Up Migration

-- Milestones: pre-bid conference, query deadlines, submission deadline,
-- corrigendum-linked date slots (spec §4.1, §11). `key` is PERMANENT and
-- non-colliding — stable across edits so a corrigendum can reference "this
-- exact date slot" across multiple amendments.
CREATE TABLE bid_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id         UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  due_at         TIMESTAMPTZ,
  venue          TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','superseded')),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','corrigendum')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, key)
);
CREATE INDEX bid_milestones_bid_id_idx ON bid_milestones (bid_id);

-- Source: apps/api/migrations/1788600000000_documents.sql
-- Up Migration

-- Documents + citations (spec §14) — genuinely new, no file/blob infra
-- exists anywhere in GOMS today. Polymorphic entity_type/entity_id,
-- deliberately unenforced (no FK), matching commercial_audit_logs'
-- convention — a document row can outlive whatever it was attached to.
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT 'v1.0',
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, filename, version)
);
CREATE INDEX documents_entity_idx ON documents (entity_type, entity_id);

CREATE TABLE document_citations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_label  TEXT NOT NULL,
  quote_text  TEXT NOT NULL DEFAULT '',
  field_ref   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_citations_document_id_idx ON document_citations (document_id);

-- Source: apps/api/migrations/1788700000000_bid-corrigenda.sql
-- Up Migration

-- Corrigenda: one row per detected amendment document/batch. `source_document_id`
-- requires `documents` to already exist — this migration MUST run after
-- 1788600000000_documents.sql (an ordering bug caught during the design
-- spec's self-review; do not reorder these two files).
CREATE TABLE bid_corrigenda (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id             UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  corrigendum_number INTEGER NOT NULL,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, corrigendum_number)
);
-- status ('pending_review' | 'reviewed') is DERIVED at read time (spec §12),
-- not a stored column.

CREATE TABLE bid_corrigendum_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrigendum_id UUID NOT NULL REFERENCES bid_corrigenda(id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,
  current_value  TEXT NOT NULL DEFAULT '',
  proposed_value TEXT NOT NULL DEFAULT '',
  decision       TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decided_at     TIMESTAMPTZ,
  decided_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bid_corrigendum_changes_corrigendum_id_idx ON bid_corrigendum_changes (corrigendum_id);

-- Source: apps/api/migrations/1788800000000_protected-values.sql
-- Up Migration

-- Generic, polymorphic freeze/unfreeze ledger (spec §13) — not bid-specific,
-- so any future entity type can adopt it without a new table.
CREATE TABLE protected_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  field_key   TEXT NOT NULL,
  frozen      BOOLEAN NOT NULL DEFAULT false,
  frozen_at   TIMESTAMPTZ,
  frozen_by   TEXT,
  UNIQUE (entity_type, entity_id, field_key)
);
CREATE INDEX protected_values_entity_idx ON protected_values (entity_type, entity_id);

-- Source: apps/api/migrations/1788900000000_bid-saved-views.sql
-- Up Migration

-- Saved views (spec §9). SYSTEM_BID_VIEWS (packages/domain/src/bids.ts) are
-- NEVER rows in this table — only personal/global user-created views live
-- here, by design (structural immutability for the system set).
CREATE TABLE bid_saved_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('personal','global')),
  owner_email      TEXT,
  filter_rules     JSONB NOT NULL DEFAULT '[]',
  sort             JSONB NOT NULL DEFAULT '[]',
  visible_columns  JSONB NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_view_has_owner CHECK (scope <> 'personal' OR owner_email IS NOT NULL)
);

-- Source: apps/api/migrations/1789000000000_commercial-boqs-opportunity-id.sql
-- Up Migration

-- The one missing FK the design audit found (spec §4.3) — nullable, NOT
-- unique: one opportunity can have more than one independent BOQ document
-- (boq_number lineage), verified by reading commercial.ts's revise/duplicate
-- code directly, not assumed.
ALTER TABLE commercial_boqs ADD COLUMN opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX commercial_boqs_opportunity_id_idx ON commercial_boqs (opportunity_id);

-- Source: apps/api/migrations/1789100000000_ownership-one-open-solution-lead.sql
-- Up Migration

-- "Solution Lead" is a second, concurrent role on the same entity, not a
-- sequential owner->delegate handoff (spec §4.6). Mirrors
-- ownership_assignments_one_open_owner_per_entity's shape exactly, scoped to
-- role='solutionLead' instead of 'owner' — applies across all entity types,
-- harmless for orgNode/contact/opportunity since nothing assigns that role
-- to them today.
CREATE UNIQUE INDEX ownership_assignments_one_open_solution_lead
  ON ownership_assignments (entity_type, entity_id)
  WHERE role = 'solutionLead' AND end_date IS NULL;

-- Source: apps/api/migrations/1789200000000_bid-custom-fields.sql
-- Up Migration

-- User-defined Master Grid columns (spec §8.1). `key` is the immutable slug
-- used as the grid column id (`custom:<key>`), filter field and import
-- heading; rename only ever changes `name`. `data_type` is immutable too
-- (enforced in the router — no patch shape includes it).
CREATE TABLE bid_custom_fields (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  data_type  TEXT NOT NULL CHECK (data_type IN ('text','number','date','select','boolean')),
  options    JSONB,
  position   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((data_type = 'select') = (options IS NOT NULL))
);
-- Names are unique among ACTIVE fields only (case-insensitive), so an
-- archived column's name can be reused.
CREATE UNIQUE INDEX bid_custom_fields_active_name_uq ON bid_custom_fields (lower(btrim(name))) WHERE status = 'active';
CREATE INDEX bid_custom_fields_position_idx ON bid_custom_fields (status, position);

-- Source: apps/api/migrations/1789300000000_bid-custom-field-values.sql
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

-- Source: apps/api/migrations/1789400000000_opportunities-city.sql
-- Up Migration

-- Master Grid's "Client City" column (spec §8) — no existing table tracks
-- city anywhere in GOMS (only state, via hierarchy_nodes' 'geo' domain).
-- Nullable, free-text, no new geo hierarchy level introduced.
ALTER TABLE opportunities ADD COLUMN city TEXT;

-- Source: apps/api/migrations/1789500000000_bid-custom-fields-has-held-value.sql
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

-- Source: apps/api/migrations/1789600000000_opportunities-department-optional.sql
-- Up Migration

-- An opportunity may now exist before its department hierarchy does. The Bid
-- Tracker's Create Bid flow resolves it (picks or creates the department)
-- before the bid is created, and bids.create refuses to create a bid for an
-- opportunity that still has none — so the rule is enforced where it matters
-- (the bid), not by forbidding the opportunity.
--
-- Purely a constraint relaxation: no existing row changes, the foreign key to
-- hierarchy_nodes (ON DELETE RESTRICT) stays, and every existing opportunity
-- keeps the department it has.
ALTER TABLE opportunities ALTER COLUMN department_id DROP NOT NULL;

-- Source: apps/api/migrations/1789700000000_bid-custom-field-types.sql
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

-- Source: apps/api/migrations/1789800000000_bid-saved-view-sheet.sql
-- Up Migration

-- Opportunity has several sheets (Bid Tracker, Pipeline > Funnel / Backup / Commits,
-- Campaign, Master), all the same Excel-style grid. A saved view belongs to one sheet.
-- Existing views are Bid Tracker views.
ALTER TABLE bid_saved_views ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker' CHECK (length(sheet) BETWEEN 1 AND 40);

-- Source: apps/api/migrations/1789900000000_bid-custom-field-sheet.sql
-- Up Migration

-- Each custom column belongs to the Opportunity sheet it was added on (Bid Tracker,
-- Pipeline, Campaign or Master). The Master sheet shows the columns of all sheets
-- together; every other sheet shows only its own. Existing columns are Bid Tracker's.
ALTER TABLE bid_custom_fields ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker'
  CHECK (sheet IN ('bidTracker','pipeline','campaign','master'));

-- Source: apps/api/migrations/1790000000000_opportunities-reference-assignment.sql
-- Up Migration

-- Create Bid's "Reference / Bid No" (a bid/reference number distinct from the
-- GeM/tender ID) and "Name of assignment" (the tender's own title for the
-- work, distinct from AMNEX's opportunity name). Nullable free text, like city.
ALTER TABLE opportunities ADD COLUMN reference_no TEXT;
ALTER TABLE opportunities ADD COLUMN assignment_name TEXT;

-- Source: apps/api/migrations/1790100000000_delivery-teams-opportunity-assignments.sql
-- Up Migration

CREATE TABLE delivery_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team TEXT NOT NULL CHECK (team IN ('preSales', 'legal', 'bid')),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team, name)
);

CREATE INDEX delivery_team_members_team_status_name_idx ON delivery_team_members (team, status, name);

ALTER TABLE opportunities
  ADD COLUMN geo_sales_person_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  ADD COLUMN bu_sales_person_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL,
  ADD COLUMN pre_sales_person_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD COLUMN legal_person_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD COLUMN bid_team_member_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL;

CREATE INDEX opportunities_geo_sales_person_idx ON opportunities (geo_sales_person_id);
CREATE INDEX opportunities_bu_sales_person_idx ON opportunities (bu_sales_person_id);
CREATE INDEX opportunities_pre_sales_person_idx ON opportunities (pre_sales_person_id);
CREATE INDEX opportunities_legal_person_idx ON opportunities (legal_person_id);
CREATE INDEX opportunities_bid_team_member_idx ON opportunities (bid_team_member_id);

-- Source: apps/api/migrations/1790200000000_delivery-team-members-manager.sql
-- Up Migration

ALTER TABLE delivery_team_members
  ADD COLUMN manager_id UUID REFERENCES delivery_team_members(id) ON DELETE SET NULL,
  ADD CONSTRAINT delivery_team_members_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id);

CREATE INDEX delivery_team_members_manager_idx ON delivery_team_members (manager_id);

-- Source: apps/api/migrations/1790300000000_pre-sales-roster.sql
-- Up Migration

ALTER TABLE delivery_team_members ADD COLUMN designation TEXT NOT NULL DEFAULT '';

-- The Pre-sales and Bid rosters as supplied by the business (2026-10-05); same
-- lists as src/data/pre-sales-team.ts. Shamik Joshi heads both orgs, so he is on
-- both teams. Existing people (same team + name) are left as-is.
CREATE TEMP TABLE roster_seed (team TEXT, name TEXT, designation TEXT, reports_to TEXT) ON COMMIT DROP;
INSERT INTO roster_seed (team, name, designation, reports_to) VALUES
  ('preSales', 'Shamik Joshi', 'Pre-Sales Head', NULL),
  ('preSales', 'Sagar Chudasama', 'Analyst', 'Shamik Joshi'),
  ('preSales', 'Manthan Soni', 'SVP', 'Shamik Joshi'),
  ('preSales', 'Harsh Pandit', 'Senior Manager', 'Shamik Joshi'),
  ('preSales', 'Gaurav Singal', 'AVP', 'Shamik Joshi'),
  ('preSales', 'Srinivas Rao', 'AVP', 'Manthan Soni'),
  ('preSales', 'Mohd Faiaz', 'Manager', 'Manthan Soni'),
  ('preSales', 'Dilip Panchal', 'VP', 'Manthan Soni'),
  ('preSales', 'Dev Patel', 'Lead Consultant', 'Manthan Soni'),
  ('preSales', 'Vidwams Madduri', 'Manager', 'Manthan Soni'),
  ('preSales', 'Rajesh Rathod', 'Manager', 'Harsh Pandit'),
  ('preSales', 'Nitish Thakkar', 'Manager', 'Harsh Pandit'),
  ('preSales', 'Mrinmoy Dhara', 'Senior Analyst', 'Harsh Pandit'),
  ('preSales', 'Rajas Saji', '', 'Harsh Pandit'),
  ('preSales', 'Maher Thakkar', 'Associate Developer', 'Harsh Pandit'),
  ('preSales', 'Utkarsh Raval', 'Associate Analyst', 'Harsh Pandit'),
  ('preSales', 'Baidyanath Hazra', 'Lead Analyst', 'Nitish Thakkar'),
  ('preSales', 'Sapna Singh', 'Analyst', 'Rajesh Rathod'),
  ('preSales', 'Kampan Vyas', 'Associate Analyst', 'Gaurav Singal'),
  ('preSales', 'Milap Shah', 'DM', 'Gaurav Singal'),
  ('preSales', 'Urvish Suthar', 'Senior Analyst', 'Gaurav Singal'),
  ('preSales', 'Shwetang Kotla', '', 'Kampan Vyas'),
  ('preSales', 'Mukesh Mehta', 'Senior Analyst', 'Kampan Vyas'),
  ('bid', 'Shamik Joshi', 'Pre-Sales Head', NULL),
  ('bid', 'Dharmesh Dhamecha', 'DGM', 'Shamik Joshi'),
  ('bid', 'Krutika Shah', 'Manager', 'Dharmesh Dhamecha'),
  ('bid', 'Hritika Nainwani', 'Senior Analyst', 'Dharmesh Dhamecha'),
  ('bid', 'Rajeev Maurya', 'Senior Analyst', 'Krutika Shah'),
  ('bid', 'Shivani Thakkar', 'Analyst', 'Krutika Shah');

INSERT INTO delivery_team_members (team, name, designation)
SELECT team, name, designation FROM roster_seed
ON CONFLICT (team, name) DO NOTHING;

-- Fill a missing reports-to from the roster (same team); never overwrite one already set.
UPDATE delivery_team_members m
SET manager_id = boss.id, updated_at = now()
FROM roster_seed r
JOIN delivery_team_members boss ON boss.team = r.team AND boss.name = r.reports_to
WHERE m.team = r.team AND m.name = r.name AND m.manager_id IS NULL;

-- Source: apps/api/migrations/1790400000000_opportunity-code.sql
-- Up Migration

-- Human-readable Opportunity ID, e.g. FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1
-- (packages/domain/src/opportunityCode.ts). Generated once, inside the insert
-- transaction (opportunities.insertOpportunity / bids.create), and never
-- changed afterwards. Nullable only for rows that predate it — fill those with
-- apps/api/scripts/backfill-opportunity-codes.ts. UNIQUE is the last-line
-- guard against a duplicate.
ALTER TABLE opportunities ADD COLUMN opportunity_code TEXT UNIQUE;
-- RFP / RFQ / EOI / RFI / GeM / Tender / Direct; '' = not set.
ALTER TABLE opportunities ADD COLUMN opportunity_type TEXT NOT NULL DEFAULT '';

-- One counter per fiscal year ('FY27'), allocated with the same atomic
-- INSERT … ON CONFLICT DO UPDATE … RETURNING upsert as bid_number_sequences.
CREATE TABLE opportunity_code_sequences (
  fiscal_year TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

-- Source: apps/api/migrations/1790500000000_bid-sheet.sql
-- Up Migration

-- Sheet ownership: which Opportunity sheet a bid lives in. Bid Tracker holds
-- live bids, Pipeline (Funnel / Backup / Commits) funnel opportunities and
-- Campaign campaign rows; Master is the collective view, never a home sheet.
-- Every existing bid was a Bid Tracker row, hence the default.
-- Keep the list in sync with OWNED_SHEETS (packages/domain/src/bids.ts).
ALTER TABLE bids ADD COLUMN sheet TEXT NOT NULL DEFAULT 'bidTracker'
  CHECK (sheet IN ('bidTracker', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'campaign'));
CREATE INDEX bids_sheet_idx ON bids (sheet);

-- Source: apps/api/migrations/1790600000000_legal-roster.sql
-- Up Migration

-- The Legal roster as supplied by the business (2026-10-05). Same shape and rules as
-- 1790300000000_pre-sales-roster.sql: a person already on the team (same team + name)
-- is left as-is, and a reports-to is only filled where none is set. Utpal Gandhi (MD)
-- reports to the chairman, who is not on this team, so he has no reports-to here.
-- Denish is "CFO – Finance & Legal"; Karan Shah's title is as supplied, spelling fixed.
CREATE TEMP TABLE legal_seed (name TEXT, designation TEXT, reports_to TEXT) ON COMMIT DROP;
INSERT INTO legal_seed (name, designation, reports_to) VALUES
  ('Utpal Gandhi', 'MD', NULL),
  ('Denish', 'CFO – Finance & Legal', 'Utpal Gandhi'),
  ('Karan Shah', 'Assistant Manager', 'Denish'),
  ('Chetana Vora', 'Deputy Manager', 'Denish'),
  ('Laveena Vangani', 'Manager', 'Denish'),
  ('Shijo Shaji', 'Manager', 'Denish'),
  ('Sharon Itagi', 'Executive', 'Karan Shah');

INSERT INTO delivery_team_members (team, name, designation)
SELECT 'legal', name, designation FROM legal_seed
ON CONFLICT (team, name) DO NOTHING;

UPDATE delivery_team_members m
SET manager_id = boss.id, updated_at = now()
FROM legal_seed r
JOIN delivery_team_members boss ON boss.team = 'legal' AND boss.name = r.reports_to
WHERE m.team = 'legal' AND m.name = r.name AND m.manager_id IS NULL;

-- Source: apps/api/migrations/1790700000000_org-people.sql
-- Up Migration

-- Org Structure: everyone in the company, their level (L0 = chairman, larger = more junior),
-- departments and reports-to. The Pre-Sales / Bid / Legal team rosters are mirrored from it
-- (sync_delivery_teams_from_org below), exactly as the local app does. The Sales team
-- (sales_persons and its postings) is a separate roster and is never read or written here.
CREATE TABLE org_people (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  designation TEXT NOT NULL DEFAULT '' CHECK (length(designation) <= 200),
  level       INTEGER NOT NULL CHECK (level BETWEEN 0 AND 7),
  departments TEXT[] NOT NULL DEFAULT '{}',
  manager_id  UUID REFERENCES org_people(id) ON DELETE SET NULL,
  email       TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE UNIQUE INDEX org_people_name_uq ON org_people (lower(btrim(name)));
CREATE INDEX org_people_manager_idx ON org_people (manager_id);

-- A team member that mirrors an org person points at them; hand-added members leave this NULL.
ALTER TABLE delivery_team_members ADD COLUMN org_person_id UUID REFERENCES org_people(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX delivery_team_members_org_person_uq ON delivery_team_members (team, org_person_id) WHERE org_person_id IS NOT NULL;

-- Mirrors the Pre-Sales / Bid / Legal rosters from org_people. Rules (same as src/data/org-structure.ts
-- syncTeamFromOrg): a team is everyone in its department; each member reports to their nearest org
-- ancestor who is also in that department; existing members are matched by org link, then by name, and
-- KEEP their ids (opportunity assignments point at them); members whose org person left the department
-- turn inactive instead of disappearing; hand-added members are left alone. Idempotent, and it only
-- writes rows that actually change.
CREATE OR REPLACE FUNCTION sync_delivery_teams_from_org() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  t RECORD;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _org_sync (person_id UUID, member_id UUID) ON COMMIT DELETE ROWS;
  FOR t IN SELECT * FROM (VALUES ('preSales', 'Pre-Sales'), ('bid', 'Bid Management'), ('legal', 'Legal')) AS v(team, dept) LOOP
    TRUNCATE _org_sync;

    INSERT INTO _org_sync (person_id, member_id)
    SELECT p.id, COALESCE(byorg.id, byname.id)
    FROM org_people p
    LEFT JOIN delivery_team_members byorg ON byorg.team = t.team AND byorg.org_person_id = p.id
    LEFT JOIN LATERAL (
      SELECT m.id FROM delivery_team_members m
      WHERE m.team = t.team AND m.org_person_id IS NULL AND lower(btrim(m.name)) = lower(btrim(p.name))
      ORDER BY m.created_at LIMIT 1
    ) byname ON true
    WHERE t.dept = ANY (p.departments);

    UPDATE delivery_team_members m
    SET name = p.name, designation = p.designation, status = p.status, org_person_id = p.id,
        email = CASE WHEN p.email <> '' THEN p.email ELSE m.email END, updated_at = now()
    FROM _org_sync s JOIN org_people p ON p.id = s.person_id
    WHERE m.id = s.member_id
      AND (m.name, m.designation, m.status, m.org_person_id, m.email)
          IS DISTINCT FROM (p.name, p.designation, p.status, p.id, CASE WHEN p.email <> '' THEN p.email ELSE m.email END);

    INSERT INTO delivery_team_members (team, name, email, designation, status, org_person_id)
    SELECT t.team, p.name, p.email, p.designation, p.status, p.id
    FROM _org_sync s JOIN org_people p ON p.id = s.person_id
    WHERE s.member_id IS NULL;

    UPDATE _org_sync s SET member_id = m.id
    FROM delivery_team_members m
    WHERE s.member_id IS NULL AND m.team = t.team AND m.org_person_id = s.person_id;

    -- reports-to: the nearest org ancestor who is also on this team
    WITH RECURSIVE anc(person_id, cur_id, depth) AS (
      SELECT s.person_id, p.manager_id, 1 FROM _org_sync s JOIN org_people p ON p.id = s.person_id
      UNION ALL
      SELECT a.person_id, o.manager_id, a.depth + 1 FROM anc a JOIN org_people o ON o.id = a.cur_id WHERE a.depth < 32
    ), nearest AS (
      SELECT DISTINCT ON (a.person_id) a.person_id, sm.member_id AS boss
      FROM anc a JOIN _org_sync sm ON sm.person_id = a.cur_id
      ORDER BY a.person_id, a.depth
    )
    UPDATE delivery_team_members m SET manager_id = n.boss, updated_at = now()
    FROM _org_sync s LEFT JOIN nearest n ON n.person_id = s.person_id
    WHERE m.id = s.member_id AND m.manager_id IS DISTINCT FROM n.boss;

    UPDATE delivery_team_members m SET status = 'inactive', manager_id = NULL, updated_at = now()
    WHERE m.team = t.team AND m.org_person_id IS NOT NULL
      AND m.id NOT IN (SELECT member_id FROM _org_sync WHERE member_id IS NOT NULL)
      AND (m.status <> 'inactive' OR m.manager_id IS NOT NULL);
  END LOOP;
END
$fn$;

-- The company org chart as supplied by the business (2026-10-05).
CREATE TEMP TABLE org_seed (name TEXT, designation TEXT, level INTEGER, departments TEXT[], reports_to TEXT) ON COMMIT DROP;
INSERT INTO org_seed (name, designation, level, departments, reports_to) VALUES
  ('Aditya Shah', 'Chairman', 0, ARRAY['Leadership']::text[], NULL),
  ('Utpal Gandhi', 'MD', 1, ARRAY['Leadership', 'Legal']::text[], 'Aditya Shah'),
  ('Tapan Gosalia', 'Director', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('Poussin Punnose', 'ED & COO', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('Harbinder Khalsa', 'Chairman''s Office', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('JP', 'Sales', 2, ARRAY['Sales']::text[], 'Utpal Gandhi'),
  ('Shamik Joshi', 'Head – Bid & Pre-Sales; Chief of Strategy', 2, ARRAY['Pre-Sales', 'Bid Management']::text[], 'Utpal Gandhi'),
  ('Denish', 'CFO – Finance & Legal', 2, ARRAY['Finance', 'Legal']::text[], 'Utpal Gandhi'),
  ('Anish', 'CE&TO', 2, ARRAY['Technology']::text[], 'Utpal Gandhi'),
  ('Nirav Shah', 'CEO', 2, ARRAY['Business Units']::text[], 'Utpal Gandhi'),
  ('Vimal Shah', 'Resources & Utility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Ashish Desai', 'Integrated', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Mihir Dakwala', 'CPTO', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Ankur Singhania', 'Mobility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Nilesh Gauda', 'Data Fabrics', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Hardik Mirani', 'Mobility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Gurpreet Basra', 'Traffic', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Damodaran C', 'Pre-Sales', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Sagar Chudasama', 'Analyst', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Manthan Soni', 'SVP', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Harsh Pandit', 'Senior Manager', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Gaurav Singal', 'AVP', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Srinivas Rao', 'AVP', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Mohd Faiaz', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Dilip Panchal', 'VP', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Dev Patel', 'Lead Consultant', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Vidwams Madduri', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Rajesh Rathod', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Nitish Thakkar', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Mrinmoy Dhara', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Rajas Saji', 'Associate Developer', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Maher Thakkar', 'Associate Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Utkarsh Raval', 'Lead Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Baidyanath Hazra', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'Nitish Thakkar'),
  ('Sapna Singh', 'Associate Analyst', 5, ARRAY['Pre-Sales']::text[], 'Rajesh Rathod'),
  ('Kampan Vyas', 'Deputy Manager', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Milap Shah', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Urvish Suthar', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Shwetang Kotla', 'Senior Analyst', 5, ARRAY['Pre-Sales']::text[], 'Kampan Vyas'),
  ('Mukesh Mehta', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'Kampan Vyas'),
  ('Dharmesh Dhamecha', 'DGM', 3, ARRAY['Bid Management']::text[], 'Shamik Joshi'),
  ('Krutika Shah', 'Manager', 4, ARRAY['Bid Management']::text[], 'Dharmesh Dhamecha'),
  ('Hritika Nainwani', 'Senior Analyst', 4, ARRAY['Bid Management']::text[], 'Dharmesh Dhamecha'),
  ('Rajeev Maurya', 'Senior Analyst', 5, ARRAY['Bid Management']::text[], 'Krutika Shah'),
  ('Shivani Thakkar', 'Analyst', 5, ARRAY['Bid Management']::text[], 'Krutika Shah'),
  ('Karan Shah', 'Assistant Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Chetana Vora', 'Deputy Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Laveena Vangani', 'Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Shijo Shaji', 'Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Sharon Itagi', 'Executive', 4, ARRAY['Legal']::text[], 'Karan Shah');

INSERT INTO org_people (name, designation, level, departments)
SELECT name, designation, level, departments FROM org_seed
ON CONFLICT DO NOTHING;

UPDATE org_people p SET manager_id = boss.id
FROM org_seed s JOIN org_people boss ON lower(btrim(boss.name)) = lower(btrim(s.reports_to))
WHERE lower(btrim(p.name)) = lower(btrim(s.name)) AND p.manager_id IS NULL;

SELECT sync_delivery_teams_from_org();

-- Source: apps/api/migrations/1790800000000_rbac-role-overrides.sql
-- Up Migration

-- Per-person role overrides on top of the roles derived from org_people / sales_persons (RBAC spec §3.3).
-- 'grant' adds a role (e.g. CEO/CFO/CE&TO -> cxo; every Finance, IT and Delivery user); 'revoke' removes a derived one.
-- The eight functional roles only: system_admin is deliberately absent (spec §3.4) — System Admin comes only from
-- ADMIN_ALLOWED_EMAILS, so it can be neither granted nor revoked through this table.
CREATE TABLE user_role_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  role       TEXT NOT NULL CHECK (role IN ('sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance')),
  effect     TEXT NOT NULL CHECK (effect IN ('grant', 'revoke')),
  reason     TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, role)
);

-- Source: apps/api/migrations/1790900000000_rbac-created-by-and-email-indexes.sql
-- Up Migration

-- Who created the row (lower-cased email). Nullable: rows that predate RBAC have none.
-- It makes a creator "own" what they just created (RBAC spec §9.1; plan gap A1).
ALTER TABLE opportunities    ADD COLUMN created_by TEXT;
ALTER TABLE timeline_events  ADD COLUMN created_by TEXT;
ALTER TABLE follow_ups       ADD COLUMN created_by TEXT;

-- Role resolution matches a login against these emails on every (cached) request.
CREATE INDEX org_people_email_lower_idx ON org_people (lower(btrim(email))) WHERE email <> '';
CREATE INDEX delivery_team_members_email_lower_idx ON delivery_team_members (lower(btrim(email))) WHERE email <> '';
CREATE INDEX sales_persons_official_email_lower_idx ON sales_persons (lower(btrim(official_email)));

-- Source: apps/api/migrations/1791000000000_rbac-seen-users.sql
-- Up Migration

-- Who has signed in while RBAC was on (shadow / enforce), and with how many roles — feeds the access-readiness view
-- ("users who authenticated but resolved to zero roles", RBAC spec §3.3). Written by auth.me.
CREATE TABLE rbac_seen_users (
  email        TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  role_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: apps/api/migrations/1791100000000_oauth-sessions.sql
-- apps/api/migrations/1791100000000_oauth-sessions.sql
-- Up Migration

-- Google OAuth login (spec 2026-10-06-google-oauth-login-design.md §4.4). Purely additive: no existing table changes.

-- One row per in-flight authorization request. Consumed atomically (DELETE ... RETURNING) by the callback.
CREATE TABLE auth_flows (
  state_hash    TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,           -- server-held PKCE verifier (API <-> Google hop only)
  nonce         TEXT NOT NULL,
  client        TEXT NOT NULL CHECK (client IN ('web', 'app')),
  return_to     TEXT NOT NULL DEFAULT '/',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_flows_expires_idx ON auth_flows (expires_at);

-- The GOMS one-time exchange code, hash only. NOT PKCE-bound: bound to the verified identity, family and client kind.
CREATE TABLE auth_exchange_codes (
  code_hash  TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  email      TEXT NOT NULL CHECK (email = lower(btrim(email))),
  family_id  UUID NOT NULL,
  client     TEXT NOT NULL CHECK (client IN ('web', 'app')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX auth_exchange_codes_expires_idx ON auth_exchange_codes (expires_at);

-- One row per refresh-token generation; family_id groups the generations of one sign-in.
CREATE TABLE auth_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid          TEXT NOT NULL,
  email        TEXT NOT NULL CHECK (email = lower(btrim(email))),
  refresh_hash TEXT NOT NULL UNIQUE,
  family_id    UUID NOT NULL,
  replaced_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT
);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);
CREATE INDEX auth_sessions_email_idx  ON auth_sessions (email);

-- Source: apps/api/migrations/1791244800000_bid-synopsis.sql
-- Up Migration
CREATE TABLE bid_synopsis_sections (
  bid_id uuid NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('scope','pq','tq','manpower','milestone','payment','boq','queries')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (bid_id, section)
);

-- Source: apps/api/migrations/1791331200000_bid-synopsis-general.sql
-- Up Migration

-- "General" tender information (bid no., dates, EMD, PBG, compliance...) is a
-- structured synopsis section. Keep the list in sync with BID_SYNOPSIS_SECTIONS
-- (packages/domain/src/bidSynopsis.ts).
ALTER TABLE bid_synopsis_sections DROP CONSTRAINT bid_synopsis_sections_section_check;
ALTER TABLE bid_synopsis_sections ADD CONSTRAINT bid_synopsis_sections_section_check
  CHECK (section IN ('general','scope','pq','tq','manpower','milestone','payment','boq','queries'));

-- Source: apps/api/migrations/1791417600000_tender-websites.sql
-- Up Migration

-- Tender portals (e.g. "E-Proc") managed from Settings. A bid's General tab
-- offers them as a dropdown and shows each one as a named hyperlink. Only
-- absolute http(s) links are accepted (also validated by the router).
CREATE TABLE tender_websites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  url         TEXT NOT NULL CHECK (char_length(url) <= 2000 AND url ~* '^https?://'),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tender_websites_name_key ON tender_websites (lower(btrim(name)));

-- Source: apps/api/migrations/1791504000000_bid-corrigendum-register.sql
-- Up Migration

-- Corrigendum Part 1: the corrigendum register and clause-level change detail.
-- Keep every CHECK list in sync with packages/domain/src/corrigenda.ts.
-- Number of Changes / Open Actions stay DERIVED at read time (never stored).

ALTER TABLE bid_corrigenda
  ADD COLUMN published_date         DATE,
  ADD COLUMN received_date          DATE,
  ADD COLUMN effective_date         DATE,
  ADD COLUMN affected_sections      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN impact_level           TEXT    NOT NULL DEFAULT 'medium'
    CHECK (impact_level IN ('low','medium','high','critical')),
  ADD COLUMN technical_impact       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN commercial_impact      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN bid_date_impact        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN submission_date_impact BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN review_owner_id        TEXT,
  ADD COLUMN review_status          TEXT    NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','reviewed','action_required','closed')),
  ADD COLUMN remarks                TEXT    NOT NULL DEFAULT '';

ALTER TABLE bid_corrigenda ADD CONSTRAINT bid_corrigenda_affected_sections_check
  CHECK (affected_sections <@ ARRAY['sow','pq','tq','manpower','milestones','payment_terms','boq','dates','sla','commercial','other']::TEXT[]);

-- Change rows are append-only: current_value is the text BEFORE this
-- corrigendum, proposed_value the text after, so the original tender is the
-- current_value of a clause's earliest change and is never overwritten.
ALTER TABLE bid_corrigendum_changes
  ADD COLUMN kind            TEXT NOT NULL DEFAULT 'field' CHECK (kind IN ('field','clause')),
  ADD COLUMN clause_title    TEXT NOT NULL DEFAULT '',
  ADD COLUMN affected_module TEXT NOT NULL DEFAULT 'other'
    CHECK (affected_module IN ('sow','pq','tq','manpower','milestones','payment_terms','boq','dates','sla','commercial','other')),
  ADD COLUMN classification  TEXT NOT NULL DEFAULT 'modified'
    CHECK (classification IN ('added','modified','deleted','clarified','date_changed','quantity_changed',
                              'commercial_changed','qualification_relaxed','qualification_tightened','no_material_change')),
  ADD COLUMN impact_level    TEXT NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('low','medium','high','critical')),
  ADD COLUMN source_ref      TEXT NOT NULL DEFAULT '';

-- Existing rows are milestone-date changes (plus the odd tender link).
UPDATE bid_corrigendum_changes SET affected_module = 'dates', classification = 'date_changed' WHERE field_key <> 'tenderLink';

-- One change per clause per corrigendum is enforced in the router, not with a
-- unique index: rows recorded before this migration were never checked.

-- Source: apps/api/migrations/1791590400000_tender-website-credentials.sql
-- Up Migration

-- The client encrypts credentials before sending them. No plaintext secrets
-- or unlock passphrases are stored by the API, audit log, or backups.
ALTER TABLE tender_websites
  ADD COLUMN credentials JSONB,
  ADD COLUMN dsc_employee_id UUID REFERENCES org_people(id) ON DELETE SET NULL;

-- Source: apps/api/migrations/1791676800000_tender-website-edit-lock.sql
-- Up Migration
ALTER TABLE tender_websites ADD COLUMN editing_locked BOOLEAN NOT NULL DEFAULT false;

-- Source: apps/api/migrations/1791763200000_website-kind.sql
-- Up Migration

-- Settings now has two website pages sharing this table: tender portals
-- (offered in a bid's General tab) and document verification portals (GST,
-- MCA, Udyam, ISO certificate checks). Existing rows are tender portals.
-- Names stay unique ignoring case, but only within the same page.
ALTER TABLE tender_websites
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'tender'
  CONSTRAINT tender_websites_kind_check CHECK (kind IN ('tender', 'verification'));
DROP INDEX tender_websites_name_key;
CREATE UNIQUE INDEX tender_websites_kind_name_key ON tender_websites (kind, lower(btrim(name)));

-- Source: apps/api/migrations/1791763500000_credential-passphrases.sql
-- Up Migration
CREATE TABLE credential_passphrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot SMALLINT NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 5),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  proof JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credential_passphrases_name ON credential_passphrases (lower(name));

-- Source: apps/api/migrations/1791763800000_google-integrations.sql
-- Up Migration
CREATE TABLE google_integration_settings (
  user_uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: apps/api/migrations/1791763900000_bid-document-batches.sql
-- Up Migration

-- Bid attachments are filed into two batches: Batch 1 'tender' (the tender as
-- published) and Batch 2 'post_publication' (pre-bid responses, corrigenda,
-- addenda...). Keep both CHECK lists in sync with packages/domain/src/bidAttachments.ts.
-- Existing documents default to Batch 1 / Other tender documents.

ALTER TABLE documents
  ADD COLUMN batch    TEXT NOT NULL DEFAULT 'tender'
    CHECK (batch IN ('tender','post_publication')),
  ADD COLUMN category TEXT NOT NULL DEFAULT 'other_tender'
    CHECK (category IN ('rfp','synopsis','boq','other_tender','prebid_response','corrigendum','addendum','other_post'));

ALTER TABLE documents ADD CONSTRAINT documents_batch_category_check CHECK (
  (batch = 'tender' AND category IN ('rfp','synopsis','boq','other_tender'))
  OR (batch = 'post_publication' AND category IN ('prebid_response','corrigendum','addendum','other_post'))
);

-- Source: apps/api/migrations/1791764000000_security-events.sql
-- Up Migration
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  procedure TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'started' CHECK (outcome IN ('started','succeeded','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX security_events_started_at_idx ON security_events (started_at);

-- Source: apps/api/migrations/1791764300000_maker-documents.sql
-- Up Migration
-- Document maker: Office files edited in ONLYOFFICE Docs. The bytes are stored in Postgres (bytea) rather than the
-- GCS attachments bucket: the Document Server must fetch and save files through this API (JWT-checked routes), files
-- are capped at 50 MB, and keeping them in the database works the same locally and in Cloud Run with no bucket or
-- service-account setup. Only the current version is kept; every save is recorded in commercial_audit_logs.
CREATE TABLE maker_documents (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'spreadsheet', 'presentation')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  file_type TEXT NOT NULL CHECK (file_type IN ('docx', 'xlsx', 'pptx')),
  content BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  document_key TEXT NOT NULL UNIQUE CHECK (document_key ~ '^[0-9A-Za-z._=-]{1,128}$'),
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'document' AND file_type = 'docx') OR (kind = 'spreadsheet' AND file_type = 'xlsx') OR (kind = 'presentation' AND file_type = 'pptx'))
);
CREATE INDEX maker_documents_owner_updated_idx ON maker_documents (owner_email, updated_at DESC);

