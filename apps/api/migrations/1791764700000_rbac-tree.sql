-- Up Migration

-- The UI permission tree (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md). It narrows, in the browser, what the
-- server policy (packages/domain/src/rbac/policy.ts) already allows; it never widens it.

-- Nodes synced from packages/domain/src/rbac/tree/manifest.generated.ts at API boot (and "Sync now"). A node that is no
-- longer declared is RETIRED (retired_at set), never deleted, so its grants survive.
CREATE TABLE rbac_nodes (
  id          TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 300 AND id ~ '^[A-Za-z0-9_:-]+(\.[A-Za-z0-9_:-]+)*$'),
  parent_id   TEXT,
  label       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  kind        TEXT NOT NULL CHECK (kind IN ('module','page','tab','subtab','section','view','action-area')),
  actions     TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  dynamic     JSONB,
  retired_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-created roles, assigned to people by email. Their grant subject id is 'custom:<id>'.
CREATE TABLE rbac_custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rbac_custom_roles_label_key ON rbac_custom_roles (lower(btrim(label)));

CREATE TABLE rbac_custom_role_members (
  role_id UUID NOT NULL REFERENCES rbac_custom_roles (id) ON DELETE CASCADE,
  email   TEXT NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  PRIMARY KEY (role_id, email)
);
CREATE INDEX rbac_custom_role_members_email_idx ON rbac_custom_role_members (email);

CREATE TABLE rbac_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rbac_templates_name_key ON rbac_templates (lower(btrim(name)));

-- Linked mode: a role or user follows (at most) one template; editing the template updates everyone linked to it.
CREATE TABLE rbac_template_links (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('role','user')),
  subject_id   TEXT NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 254),
  template_id  UUID NOT NULL REFERENCES rbac_templates (id) ON DELETE CASCADE,
  linked_by    TEXT,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);
CREATE INDEX rbac_template_links_template_idx ON rbac_template_links (template_id);

-- One explicit cell. "inherit" is the absence of a row. node_id deliberately has no foreign key: grants on retired or
-- data-driven (saved view) nodes are kept.
CREATE TABLE rbac_grants (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('role','user','template')),
  subject_id   TEXT NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 254),
  node_id      TEXT NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 300),
  action       TEXT NOT NULL CHECK (action IN ('view','create','edit','delete','download','manage')),
  effect       TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, node_id, action)
);

-- Down Migration

DROP TABLE rbac_grants;
DROP TABLE rbac_template_links;
DROP TABLE rbac_templates;
DROP TABLE rbac_custom_role_members;
DROP TABLE rbac_custom_roles;
DROP TABLE rbac_nodes;
