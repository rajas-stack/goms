-- Up Migration

-- Amnex Departments master (Settings > Masters > Employee Master). org_people.departments keeps storing department NAMES
-- (no CHECK / enum restricts them, so custom departments already save); this table is the list the UI offers.
-- system_key marks the departments whose exact names derive RBAC roles (packages/domain DERIVED_ROLE_DEPARTMENTS) and feed
-- sync_delivery_teams_from_org(): the router refuses to rename or delete those, so role derivation never breaks.
-- Renaming / deleting a custom department rewrites org_people.departments in the same transaction.
CREATE TABLE amnex_departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  system_key  TEXT UNIQUE CHECK (system_key IS NULL OR system_key IN ('presales', 'bid', 'legal', 'cxo')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX amnex_departments_name_key ON amnex_departments (lower(btrim(name)));

INSERT INTO amnex_departments (name, system_key, sort_order)
SELECT v.name, v.system_key, v.ord
FROM (VALUES
  ('Leadership', 'cxo', 0), ('Sales', NULL, 1), ('Pre-Sales', 'presales', 2), ('Bid Management', 'bid', 3),
  ('Legal', 'legal', 4), ('Finance', NULL, 5), ('Technology', NULL, 6), ('Business Units', NULL, 7)
) AS v(name, system_key, ord)
ON CONFLICT DO NOTHING;

-- Any other department already in use by an employee joins the master too (after the defaults, alphabetically).
INSERT INTO amnex_departments (name, sort_order)
SELECT d.name, 100 + row_number() OVER (ORDER BY lower(d.name))
FROM (
  SELECT DISTINCT ON (lower(btrim(dep))) btrim(dep) AS name
  FROM org_people, unnest(departments) AS dep
  WHERE char_length(btrim(dep)) BETWEEN 1 AND 80
  ORDER BY lower(btrim(dep)), btrim(dep)
) d
ON CONFLICT DO NOTHING;

-- Down Migration

DROP TABLE IF EXISTS amnex_departments;
