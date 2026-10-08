-- Up Migration

-- The Legal roster as supplied by the business (2026-10-05). Same shape and rules as
-- 1790300000000_pre-sales-roster.sql: a person already on the team (same team + name)
-- is left as-is, and a reports-to is only filled where none is set. Utpal Gandhi (MD)
-- reports to the chairman, who is not on this team, so he has no reports-to here.
-- Denish is "CFO – Finance & Legal"; Karan Shah's title is as supplied, spelling fixed.
CREATE TEMP TABLE legal_seed (name TEXT, designation TEXT, reports_to TEXT) ON COMMIT DROP;
INSERT INTO legal_seed (name, designation, reports_to) VALUES
  ('Utpal Gandhi', 'MD', NULL),
  ('Denish', 'CFO – Finance & Legal', 'Utpal Gandhi'),
  ('Karan Shah', 'Assistant Manager', 'Denish'),
  ('Chetana Vora', 'Deputy Manager', 'Denish'),
  ('Laveena Vangani', 'Manager', 'Denish'),
  ('Shijo Shaji', 'Manager', 'Denish'),
  ('Sharon Itagi', 'Executive', 'Karan Shah');

INSERT INTO delivery_team_members (team, name, designation)
SELECT 'legal', name, designation FROM legal_seed
ON CONFLICT (team, name) DO NOTHING;

UPDATE delivery_team_members m
SET manager_id = boss.id, updated_at = now()
FROM legal_seed r
JOIN delivery_team_members boss ON boss.team = 'legal' AND boss.name = r.reports_to
WHERE m.team = 'legal' AND m.name = r.name AND m.manager_id IS NULL;

-- Down Migration

DELETE FROM delivery_team_members
WHERE team = 'legal'
  AND name IN ('Utpal Gandhi', 'Denish', 'Karan Shah', 'Chetana Vora', 'Laveena Vangani', 'Shijo Shaji', 'Sharon Itagi');
