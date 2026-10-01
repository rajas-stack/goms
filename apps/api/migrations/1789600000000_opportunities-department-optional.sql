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

-- Down Migration

-- Fails (by design) if any opportunity has been left without a department; give
-- those a department first rather than letting a rollback invent one.
ALTER TABLE opportunities ALTER COLUMN department_id SET NOT NULL;
