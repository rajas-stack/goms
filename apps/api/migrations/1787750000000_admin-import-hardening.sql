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

-- Down Migration

DROP INDEX admin_import_runs_session_id_idx;
ALTER TABLE admin_import_runs DROP COLUMN excluded_rows;
ALTER TABLE admin_import_runs DROP COLUMN session_id;
DROP INDEX commercial_bom_items_parent_component_idx;
DROP INDEX employees_code_ci_idx;
DROP INDEX hierarchy_nodes_geo_type_code_state_ci_idx;
DROP INDEX hierarchy_nodes_org_code_ci_idx;
