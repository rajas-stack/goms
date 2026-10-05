-- Up Migration

ALTER TABLE delivery_team_members ADD COLUMN designation TEXT NOT NULL DEFAULT '';

-- The Pre-sales and Bid rosters as supplied by the business (2026-10-05); same
-- lists as src/data/pre-sales-team.ts. Shamik Joshi heads both orgs, so he is on
-- both teams. Existing people (same team + name) are left as-is.
CREATE TEMP TABLE roster_seed (team TEXT, name TEXT, designation TEXT, reports_to TEXT) ON COMMIT DROP;
INSERT INTO roster_seed (team, name, designation, reports_to) VALUES
  ('preSales', 'Shamik Joshi', 'Pre-Sales Head', NULL),
  ('preSales', 'Sagar Chudasama', 'Analyst', 'Shamik Joshi'),
  ('preSales', 'Manthan Soni', 'SVP', 'Shamik Joshi'),
  ('preSales', 'Harsh Pandit', 'Senior Manager', 'Shamik Joshi'),
  ('preSales', 'Gaurav Singal', 'AVP', 'Shamik Joshi'),
  ('preSales', 'Srinivas Rao', 'AVP', 'Manthan Soni'),
  ('preSales', 'Mohd Faiaz', 'Manager', 'Manthan Soni'),
  ('preSales', 'Dilip Panchal', 'VP', 'Manthan Soni'),
  ('preSales', 'Dev Patel', 'Lead Consultant', 'Manthan Soni'),
  ('preSales', 'Vidwams Madduri', 'Manager', 'Manthan Soni'),
  ('preSales', 'Rajesh Rathod', 'Manager', 'Harsh Pandit'),
  ('preSales', 'Nitish Thakkar', 'Manager', 'Harsh Pandit'),
  ('preSales', 'Mrinmoy Dhara', 'Senior Analyst', 'Harsh Pandit'),
  ('preSales', 'Rajas Saji', '', 'Harsh Pandit'),
  ('preSales', 'Maher Thakkar', 'Associate Developer', 'Harsh Pandit'),
  ('preSales', 'Utkarsh Raval', 'Associate Analyst', 'Harsh Pandit'),
  ('preSales', 'Baidyanath Hazra', 'Lead Analyst', 'Nitish Thakkar'),
  ('preSales', 'Sapna Singh', 'Analyst', 'Rajesh Rathod'),
  ('preSales', 'Kampan Vyas', 'Associate Analyst', 'Gaurav Singal'),
  ('preSales', 'Milap Shah', 'DM', 'Gaurav Singal'),
  ('preSales', 'Urvish Suthar', 'Senior Analyst', 'Gaurav Singal'),
  ('preSales', 'Shwetang Kotla', '', 'Kampan Vyas'),
  ('preSales', 'Mukesh Mehta', 'Senior Analyst', 'Kampan Vyas'),
  ('bid', 'Shamik Joshi', 'Pre-Sales Head', NULL),
  ('bid', 'Dharmesh Dhamecha', 'DGM', 'Shamik Joshi'),
  ('bid', 'Krutika Shah', 'Manager', 'Dharmesh Dhamecha'),
  ('bid', 'Hritika Nainwani', 'Senior Analyst', 'Dharmesh Dhamecha'),
  ('bid', 'Rajeev Maurya', 'Senior Analyst', 'Krutika Shah'),
  ('bid', 'Shivani Thakkar', 'Analyst', 'Krutika Shah');

INSERT INTO delivery_team_members (team, name, designation)
SELECT team, name, designation FROM roster_seed
ON CONFLICT (team, name) DO NOTHING;

-- Fill a missing reports-to from the roster (same team); never overwrite one already set.
UPDATE delivery_team_members m
SET manager_id = boss.id, updated_at = now()
FROM roster_seed r
JOIN delivery_team_members boss ON boss.team = r.team AND boss.name = r.reports_to
WHERE m.team = r.team AND m.name = r.name AND m.manager_id IS NULL;

-- Down Migration

ALTER TABLE delivery_team_members DROP COLUMN IF EXISTS designation;
