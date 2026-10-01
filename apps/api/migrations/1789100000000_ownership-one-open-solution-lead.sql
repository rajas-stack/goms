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

-- Down Migration

DROP INDEX ownership_assignments_one_open_solution_lead;
