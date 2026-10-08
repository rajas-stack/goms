-- Up Migration

-- Org Structure: everyone in the company, their level (L0 = chairman, larger = more junior),
-- departments and reports-to. The Pre-Sales / Bid / Legal team rosters are mirrored from it
-- (sync_delivery_teams_from_org below), exactly as the local app does. The Sales team
-- (sales_persons and its postings) is a separate roster and is never read or written here.
CREATE TABLE org_people (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  designation TEXT NOT NULL DEFAULT '' CHECK (length(designation) <= 200),
  level       INTEGER NOT NULL CHECK (level BETWEEN 0 AND 7),
  departments TEXT[] NOT NULL DEFAULT '{}',
  manager_id  UUID REFERENCES org_people(id) ON DELETE SET NULL,
  email       TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE UNIQUE INDEX org_people_name_uq ON org_people (lower(btrim(name)));
CREATE INDEX org_people_manager_idx ON org_people (manager_id);

-- A team member that mirrors an org person points at them; hand-added members leave this NULL.
ALTER TABLE delivery_team_members ADD COLUMN org_person_id UUID REFERENCES org_people(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX delivery_team_members_org_person_uq ON delivery_team_members (team, org_person_id) WHERE org_person_id IS NOT NULL;

-- Mirrors the Pre-Sales / Bid / Legal rosters from org_people. Rules (same as src/data/org-structure.ts
-- syncTeamFromOrg): a team is everyone in its department; each member reports to their nearest org
-- ancestor who is also in that department; existing members are matched by org link, then by name, and
-- KEEP their ids (opportunity assignments point at them); members whose org person left the department
-- turn inactive instead of disappearing; hand-added members are left alone. Idempotent, and it only
-- writes rows that actually change.
CREATE OR REPLACE FUNCTION sync_delivery_teams_from_org() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  t RECORD;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _org_sync (person_id UUID, member_id UUID) ON COMMIT DELETE ROWS;
  FOR t IN SELECT * FROM (VALUES ('preSales', 'Pre-Sales'), ('bid', 'Bid Management'), ('legal', 'Legal')) AS v(team, dept) LOOP
    TRUNCATE _org_sync;

    INSERT INTO _org_sync (person_id, member_id)
    SELECT p.id, COALESCE(byorg.id, byname.id)
    FROM org_people p
    LEFT JOIN delivery_team_members byorg ON byorg.team = t.team AND byorg.org_person_id = p.id
    LEFT JOIN LATERAL (
      SELECT m.id FROM delivery_team_members m
      WHERE m.team = t.team AND m.org_person_id IS NULL AND lower(btrim(m.name)) = lower(btrim(p.name))
      ORDER BY m.created_at LIMIT 1
    ) byname ON true
    WHERE t.dept = ANY (p.departments);

    UPDATE delivery_team_members m
    SET name = p.name, designation = p.designation, status = p.status, org_person_id = p.id,
        email = CASE WHEN p.email <> '' THEN p.email ELSE m.email END, updated_at = now()
    FROM _org_sync s JOIN org_people p ON p.id = s.person_id
    WHERE m.id = s.member_id
      AND (m.name, m.designation, m.status, m.org_person_id, m.email)
          IS DISTINCT FROM (p.name, p.designation, p.status, p.id, CASE WHEN p.email <> '' THEN p.email ELSE m.email END);

    INSERT INTO delivery_team_members (team, name, email, designation, status, org_person_id)
    SELECT t.team, p.name, p.email, p.designation, p.status, p.id
    FROM _org_sync s JOIN org_people p ON p.id = s.person_id
    WHERE s.member_id IS NULL;

    UPDATE _org_sync s SET member_id = m.id
    FROM delivery_team_members m
    WHERE s.member_id IS NULL AND m.team = t.team AND m.org_person_id = s.person_id;

    -- reports-to: the nearest org ancestor who is also on this team
    WITH RECURSIVE anc(person_id, cur_id, depth) AS (
      SELECT s.person_id, p.manager_id, 1 FROM _org_sync s JOIN org_people p ON p.id = s.person_id
      UNION ALL
      SELECT a.person_id, o.manager_id, a.depth + 1 FROM anc a JOIN org_people o ON o.id = a.cur_id WHERE a.depth < 32
    ), nearest AS (
      SELECT DISTINCT ON (a.person_id) a.person_id, sm.member_id AS boss
      FROM anc a JOIN _org_sync sm ON sm.person_id = a.cur_id
      ORDER BY a.person_id, a.depth
    )
    UPDATE delivery_team_members m SET manager_id = n.boss, updated_at = now()
    FROM _org_sync s LEFT JOIN nearest n ON n.person_id = s.person_id
    WHERE m.id = s.member_id AND m.manager_id IS DISTINCT FROM n.boss;

    UPDATE delivery_team_members m SET status = 'inactive', manager_id = NULL, updated_at = now()
    WHERE m.team = t.team AND m.org_person_id IS NOT NULL
      AND m.id NOT IN (SELECT member_id FROM _org_sync WHERE member_id IS NOT NULL)
      AND (m.status <> 'inactive' OR m.manager_id IS NOT NULL);
  END LOOP;
END
$fn$;

-- The company org chart as supplied by the business (2026-10-05).
CREATE TEMP TABLE org_seed (name TEXT, designation TEXT, level INTEGER, departments TEXT[], reports_to TEXT) ON COMMIT DROP;
INSERT INTO org_seed (name, designation, level, departments, reports_to) VALUES
  ('Aditya Shah', 'Chairman', 0, ARRAY['Leadership']::text[], NULL),
  ('Utpal Gandhi', 'MD', 1, ARRAY['Leadership', 'Legal']::text[], 'Aditya Shah'),
  ('Tapan Gosalia', 'Director', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('Poussin Punnose', 'ED & COO', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('Harbinder Khalsa', 'Chairman''s Office', 1, ARRAY['Leadership']::text[], 'Aditya Shah'),
  ('JP', 'Sales', 2, ARRAY['Sales']::text[], 'Utpal Gandhi'),
  ('Shamik Joshi', 'Head – Bid & Pre-Sales; Chief of Strategy', 2, ARRAY['Pre-Sales', 'Bid Management']::text[], 'Utpal Gandhi'),
  ('Denish', 'CFO – Finance & Legal', 2, ARRAY['Finance', 'Legal']::text[], 'Utpal Gandhi'),
  ('Anish', 'CE&TO', 2, ARRAY['Technology']::text[], 'Utpal Gandhi'),
  ('Nirav Shah', 'CEO', 2, ARRAY['Business Units']::text[], 'Utpal Gandhi'),
  ('Vimal Shah', 'Resources & Utility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Ashish Desai', 'Integrated', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Mihir Dakwala', 'CPTO', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Ankur Singhania', 'Mobility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Nilesh Gauda', 'Data Fabrics', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Hardik Mirani', 'Mobility', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Gurpreet Basra', 'Traffic', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Damodaran C', 'Pre-Sales', 3, ARRAY['Business Units']::text[], 'Nirav Shah'),
  ('Sagar Chudasama', 'Analyst', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Manthan Soni', 'SVP', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Harsh Pandit', 'Senior Manager', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Gaurav Singal', 'AVP', 3, ARRAY['Pre-Sales']::text[], 'Shamik Joshi'),
  ('Srinivas Rao', 'AVP', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Mohd Faiaz', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Dilip Panchal', 'VP', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Dev Patel', 'Lead Consultant', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Vidwams Madduri', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Manthan Soni'),
  ('Rajesh Rathod', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Nitish Thakkar', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Mrinmoy Dhara', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Rajas Saji', 'Associate Developer', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Maher Thakkar', 'Associate Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Utkarsh Raval', 'Lead Analyst', 4, ARRAY['Pre-Sales']::text[], 'Harsh Pandit'),
  ('Baidyanath Hazra', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'Nitish Thakkar'),
  ('Sapna Singh', 'Associate Analyst', 5, ARRAY['Pre-Sales']::text[], 'Rajesh Rathod'),
  ('Kampan Vyas', 'Deputy Manager', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Milap Shah', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Urvish Suthar', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'Gaurav Singal'),
  ('Shwetang Kotla', 'Senior Analyst', 5, ARRAY['Pre-Sales']::text[], 'Kampan Vyas'),
  ('Mukesh Mehta', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'Kampan Vyas'),
  ('Dharmesh Dhamecha', 'DGM', 3, ARRAY['Bid Management']::text[], 'Shamik Joshi'),
  ('Krutika Shah', 'Manager', 4, ARRAY['Bid Management']::text[], 'Dharmesh Dhamecha'),
  ('Hritika Nainwani', 'Senior Analyst', 4, ARRAY['Bid Management']::text[], 'Dharmesh Dhamecha'),
  ('Rajeev Maurya', 'Senior Analyst', 5, ARRAY['Bid Management']::text[], 'Krutika Shah'),
  ('Shivani Thakkar', 'Analyst', 5, ARRAY['Bid Management']::text[], 'Krutika Shah'),
  ('Karan Shah', 'Assistant Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Chetana Vora', 'Deputy Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Laveena Vangani', 'Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Shijo Shaji', 'Manager', 3, ARRAY['Legal']::text[], 'Denish'),
  ('Sharon Itagi', 'Executive', 4, ARRAY['Legal']::text[], 'Karan Shah');

INSERT INTO org_people (name, designation, level, departments)
SELECT name, designation, level, departments FROM org_seed
ON CONFLICT DO NOTHING;

UPDATE org_people p SET manager_id = boss.id
FROM org_seed s JOIN org_people boss ON lower(btrim(boss.name)) = lower(btrim(s.reports_to))
WHERE lower(btrim(p.name)) = lower(btrim(s.name)) AND p.manager_id IS NULL;

SELECT sync_delivery_teams_from_org();

-- Down Migration

DROP FUNCTION IF EXISTS sync_delivery_teams_from_org();
DROP INDEX IF EXISTS delivery_team_members_org_person_uq;
ALTER TABLE delivery_team_members DROP COLUMN IF EXISTS org_person_id;
DROP TABLE IF EXISTS org_people;
