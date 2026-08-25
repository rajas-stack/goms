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

-- Down Migration

DROP TABLE hierarchy_nodes;
