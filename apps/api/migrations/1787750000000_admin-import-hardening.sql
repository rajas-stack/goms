-- Up Migration

-- Scoped by domain: geo's LGD codes and org's admin-assigned codes are
-- independent namespaces and must not collide with each other, only within
-- themselves. Case/whitespace-insensitive to match every domain adapter's
-- own lower(trim(code)) lookup/update convention (organizationHierarchy.ts,
-- employees.ts, geography.ts).
CREATE UNIQUE INDEX hierarchy_nodes_domain_code_ci_idx
  ON hierarchy_nodes (domain, lower(trim(code)))
  WHERE code IS NOT NULL;

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
DROP INDEX hierarchy_nodes_domain_code_ci_idx;
