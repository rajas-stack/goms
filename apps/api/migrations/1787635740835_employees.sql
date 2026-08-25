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

-- Down Migration

DROP TABLE employee_merge_audit;
DROP TABLE transfers;
DROP TABLE timeline_events;
DROP TABLE employee_charges;
DROP TABLE employees;
