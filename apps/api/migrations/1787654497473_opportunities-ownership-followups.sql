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
  note TEXT NOT NULL DEFAULT ''
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

-- Down Migration

DROP TABLE follow_ups;
DROP TABLE ownership_assignments;
DROP TABLE opportunity_stage_changes;
DROP TABLE opportunities;
