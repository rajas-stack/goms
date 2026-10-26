-- Up Migration
-- Directory › External categories: Competitors and Consortium Partners join Departmental and OEM as e-mail contact
-- categories (communication_contacts.party). Additive only: no existing row changes.
ALTER TABLE communication_contacts DROP CONSTRAINT IF EXISTS communication_contacts_party_check;
ALTER TABLE communication_contacts ADD CONSTRAINT communication_contacts_party_check
  CHECK (party IN ('delivery','oem','clientDepartment','external','competitor','consortium'));
ALTER TABLE bid_communication_threads DROP CONSTRAINT IF EXISTS bid_communication_threads_category_check;
ALTER TABLE bid_communication_threads ADD CONSTRAINT bid_communication_threads_category_check
  CHECK (category IN ('internal','delivery','oem','client','clientDepartment','external','unknown','competitor','consortium'));

INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'competitor', 'Competitors', 'Competitor company contacts', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'consortium', 'Consortium Partners', 'Consortium and JV partner contacts', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'external', 'Others', 'Any other external contact', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
-- OEM Companies / Consortium Partners masters (master_key oemCompanies / consortiumPartners) start empty.

-- Directory › Internal lists HR and Delivery beside the existing departments (custom, renameable departments).
INSERT INTO amnex_departments (name, sort_order) VALUES ('HR', 8), ('Delivery', 9) ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM commercial_masters WHERE master_key = 'directoryTypes' AND code IN ('competitor', 'consortium', 'external');
ALTER TABLE communication_contacts DROP CONSTRAINT IF EXISTS communication_contacts_party_check;
ALTER TABLE communication_contacts ADD CONSTRAINT communication_contacts_party_check
  CHECK (party IN ('delivery','oem','clientDepartment','external'));
ALTER TABLE bid_communication_threads DROP CONSTRAINT IF EXISTS bid_communication_threads_category_check;
ALTER TABLE bid_communication_threads ADD CONSTRAINT bid_communication_threads_category_check
  CHECK (category IN ('internal','delivery','oem','client','clientDepartment','external','unknown'));
