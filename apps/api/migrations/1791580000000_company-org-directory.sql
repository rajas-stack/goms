-- Up Migration
-- Company employee levels used by the DSC selector, matching the existing org directory.
CREATE TABLE org_people (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  designation TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 7),
  departments TEXT[] NOT NULL DEFAULT '{}',
  manager_id TEXT REFERENCES org_people(id) DEFERRABLE INITIALLY DEFERRED,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_people_name_key ON org_people(lower(btrim(name)));
INSERT INTO org_people (id, name, designation, level, departments, manager_id, email, status, created_at) VALUES
('org-aditya-shah', 'Aditya Shah', 'Chairman', 0, ARRAY['Leadership']::text[], NULL, '', 'active', '2026-10-05'),
('org-utpal-gandhi', 'Utpal Gandhi', 'MD', 1, ARRAY['Leadership','Legal']::text[], 'org-aditya-shah', '', 'active', '2026-10-05'),
('org-tapan-gosalia', 'Tapan Gosalia', 'Director', 1, ARRAY['Leadership']::text[], 'org-aditya-shah', '', 'active', '2026-10-05'),
('org-poussin-punnose', 'Poussin Punnose', 'ED & COO', 1, ARRAY['Leadership']::text[], 'org-aditya-shah', '', 'active', '2026-10-05'),
('org-harbinder-khalsa', 'Harbinder Khalsa', 'Chairman''s Office', 1, ARRAY['Leadership']::text[], 'org-aditya-shah', '', 'active', '2026-10-05'),
('org-jp', 'JP', 'Sales', 2, ARRAY['Sales']::text[], 'org-utpal-gandhi', '', 'active', '2026-10-05'),
('org-shamik-joshi', 'Shamik Joshi', 'Head – Bid & Pre-Sales; Chief of Strategy', 2, ARRAY['Pre-Sales','Bid Management']::text[], 'org-utpal-gandhi', '', 'active', '2026-10-05'),
('org-denish', 'Denish', 'CFO – Finance & Legal', 2, ARRAY['Finance','Legal']::text[], 'org-utpal-gandhi', '', 'active', '2026-10-05'),
('org-anish', 'Anish', 'CE&TO', 2, ARRAY['Technology']::text[], 'org-utpal-gandhi', '', 'active', '2026-10-05'),
('org-nirav-shah', 'Nirav Shah', 'CEO', 2, ARRAY['Business Units']::text[], 'org-utpal-gandhi', '', 'active', '2026-10-05'),
('org-vimal-shah', 'Vimal Shah', 'Resources & Utility', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-ashish-desai', 'Ashish Desai', 'Integrated', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-mihir-dakwala', 'Mihir Dakwala', 'CPTO', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-ankur-singhania', 'Ankur Singhania', 'Mobility', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-nilesh-gauda', 'Nilesh Gauda', 'Data Fabrics', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-hardik-mirani', 'Hardik Mirani', 'Mobility', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-gurpreet-basra', 'Gurpreet Basra', 'Traffic', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-damodaran-c', 'Damodaran C', 'Pre-Sales', 3, ARRAY['Business Units']::text[], 'org-nirav-shah', '', 'active', '2026-10-05'),
('org-sagar-chudasama', 'Sagar Chudasama', 'Analyst', 3, ARRAY['Pre-Sales']::text[], 'org-shamik-joshi', '', 'active', '2026-10-05'),
('org-manthan-soni', 'Manthan Soni', 'SVP', 3, ARRAY['Pre-Sales']::text[], 'org-shamik-joshi', '', 'active', '2026-10-05'),
('org-harsh-pandit', 'Harsh Pandit', 'Senior Manager', 3, ARRAY['Pre-Sales']::text[], 'org-shamik-joshi', '', 'active', '2026-10-05'),
('org-gaurav-singal', 'Gaurav Singal', 'AVP', 3, ARRAY['Pre-Sales']::text[], 'org-shamik-joshi', '', 'active', '2026-10-05'),
('org-srinivas-rao', 'Srinivas Rao', 'AVP', 4, ARRAY['Pre-Sales']::text[], 'org-manthan-soni', '', 'active', '2026-10-05'),
('org-mohd-faiaz', 'Mohd Faiaz', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'org-manthan-soni', '', 'active', '2026-10-05'),
('org-dilip-panchal', 'Dilip Panchal', 'VP', 4, ARRAY['Pre-Sales']::text[], 'org-manthan-soni', '', 'active', '2026-10-05'),
('org-dev-patel', 'Dev Patel', 'Lead Consultant', 4, ARRAY['Pre-Sales']::text[], 'org-manthan-soni', '', 'active', '2026-10-05'),
('org-vidwams-madduri', 'Vidwams Madduri', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'org-manthan-soni', '', 'active', '2026-10-05'),
('org-rajesh-rathod', 'Rajesh Rathod', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-nitish-thakkar', 'Nitish Thakkar', 'Manager', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-mrinmoy-dhara', 'Mrinmoy Dhara', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-rajas-saji', 'Rajas Saji', 'Associate Developer', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-maher-thakkar', 'Maher Thakkar', 'Associate Analyst', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-utkarsh-raval', 'Utkarsh Raval', 'Lead Analyst', 4, ARRAY['Pre-Sales']::text[], 'org-harsh-pandit', '', 'active', '2026-10-05'),
('org-baidyanath-hazra', 'Baidyanath Hazra', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'org-nitish-thakkar', '', 'active', '2026-10-05'),
('org-sapna-singh', 'Sapna Singh', 'Associate Analyst', 5, ARRAY['Pre-Sales']::text[], 'org-rajesh-rathod', '', 'active', '2026-10-05'),
('org-kampan-vyas', 'Kampan Vyas', 'Deputy Manager', 4, ARRAY['Pre-Sales']::text[], 'org-gaurav-singal', '', 'active', '2026-10-05'),
('org-milap-shah', 'Milap Shah', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'org-gaurav-singal', '', 'active', '2026-10-05'),
('org-urvish-suthar', 'Urvish Suthar', 'Senior Analyst', 4, ARRAY['Pre-Sales']::text[], 'org-gaurav-singal', '', 'active', '2026-10-05'),
('org-shwetang-kotla', 'Shwetang Kotla', 'Senior Analyst', 5, ARRAY['Pre-Sales']::text[], 'org-kampan-vyas', '', 'active', '2026-10-05'),
('org-mukesh-mehta', 'Mukesh Mehta', 'Analyst', 5, ARRAY['Pre-Sales']::text[], 'org-kampan-vyas', '', 'active', '2026-10-05'),
('org-dharmesh-dhamecha', 'Dharmesh Dhamecha', 'DGM', 3, ARRAY['Bid Management']::text[], 'org-shamik-joshi', '', 'active', '2026-10-05'),
('org-krutika-shah', 'Krutika Shah', 'Manager', 4, ARRAY['Bid Management']::text[], 'org-dharmesh-dhamecha', '', 'active', '2026-10-05'),
('org-hritika-nainwani', 'Hritika Nainwani', 'Senior Analyst', 4, ARRAY['Bid Management']::text[], 'org-dharmesh-dhamecha', '', 'active', '2026-10-05'),
('org-rajeev-maurya', 'Rajeev Maurya', 'Senior Analyst', 5, ARRAY['Bid Management']::text[], 'org-krutika-shah', '', 'active', '2026-10-05'),
('org-shivani-thakkar', 'Shivani Thakkar', 'Analyst', 5, ARRAY['Bid Management']::text[], 'org-krutika-shah', '', 'active', '2026-10-05'),
('org-karan-shah', 'Karan Shah', 'Assistant Manager', 3, ARRAY['Legal']::text[], 'org-denish', '', 'active', '2026-10-05'),
('org-chetana-vora', 'Chetana Vora', 'Deputy Manager', 3, ARRAY['Legal']::text[], 'org-denish', '', 'active', '2026-10-05'),
('org-laveena-vangani', 'Laveena Vangani', 'Manager', 3, ARRAY['Legal']::text[], 'org-denish', '', 'active', '2026-10-05'),
('org-shijo-shaji', 'Shijo Shaji', 'Manager', 3, ARRAY['Legal']::text[], 'org-denish', '', 'active', '2026-10-05'),
('org-sharon-itagi', 'Sharon Itagi', 'Executive', 4, ARRAY['Legal']::text[], 'org-karan-shah', '', 'active', '2026-10-05');

ALTER TABLE delivery_team_members ADD COLUMN org_person_id TEXT REFERENCES org_people(id) ON DELETE SET NULL;
UPDATE delivery_team_members m SET org_person_id=p.id FROM org_people p WHERE lower(btrim(m.name))=lower(p.name);

-- Down Migration
ALTER TABLE delivery_team_members DROP COLUMN org_person_id;
DROP TABLE org_people;
