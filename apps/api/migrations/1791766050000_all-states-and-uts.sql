-- Up Migration
-- Every Indian State / UT (plus the virtual Central Ministries state, code 0) as a geo 'state' node.
-- The Live Bids State picker and every state-name lookup read these rows; a database where the
-- Admin Import > Geography load never ran had only a few states (e.g. no Delhi). Same rows, names and
-- LGD codes the geography load creates (src/data/india-admin.json), so that load later matches them
-- instead of duplicating them. A state already present (by state_code) is left as it is.
INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code)
SELECT 'geo', 'country', NULL, NULL, 'India', 'IN'
WHERE NOT EXISTS (SELECT 1 FROM hierarchy_nodes WHERE domain = 'geo' AND type_key = 'country');

INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code)
SELECT 'geo', 'state',
  (SELECT id FROM hierarchy_nodes WHERE domain = 'geo' AND type_key = 'country' ORDER BY created_at LIMIT 1),
  s.state_code, s.name, s.state_code::text
FROM (VALUES
  (0, 'Central Ministries (Govt. of India)'),
  (35, 'Andaman and Nicobar Islands'),
  (37, 'Andhra Pradesh'),
  (12, 'Arunachal Pradesh'),
  (18, 'Assam'),
  (10, 'Bihar'),
  (4, 'Chandigarh'),
  (22, 'Chhattisgarh'),
  (26, 'Dadra and Nagar Haveli and Daman and Diu'),
  (7, 'Delhi'),
  (30, 'Goa'),
  (24, 'Gujarat'),
  (6, 'Haryana'),
  (2, 'Himachal Pradesh'),
  (1, 'Jammu and Kashmir'),
  (20, 'Jharkhand'),
  (29, 'Karnataka'),
  (32, 'Kerala'),
  (38, 'Ladakh'),
  (31, 'Lakshadweep'),
  (23, 'Madhya Pradesh'),
  (27, 'Maharashtra'),
  (14, 'Manipur'),
  (17, 'Meghalaya'),
  (15, 'Mizoram'),
  (13, 'Nagaland'),
  (21, 'Odisha'),
  (34, 'Puducherry'),
  (3, 'Punjab'),
  (8, 'Rajasthan'),
  (11, 'Sikkim'),
  (33, 'Tamil Nadu'),
  (36, 'Telangana'),
  (16, 'Tripura'),
  (9, 'Uttar Pradesh'),
  (5, 'Uttarakhand'),
  (19, 'West Bengal')
) AS s(state_code, name)
WHERE NOT EXISTS (SELECT 1 FROM hierarchy_nodes h WHERE h.type_key = 'state' AND h.state_code = s.state_code);

-- Down Migration
-- Reference rows that opportunities and departments point at by state code: nothing is removed.
