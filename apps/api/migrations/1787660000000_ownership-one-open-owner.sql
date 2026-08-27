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

-- Down Migration

DROP INDEX ownership_assignments_one_open_owner_per_entity;
