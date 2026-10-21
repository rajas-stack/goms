-- Up Migration
-- Settings > Masters > Directory Types: the Directory module's dropdown (formerly Teams).
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'internal', 'Amnex Employee', 'Amnex employees, org structure and internal teams', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'department', 'Departmental', 'Client and government department mailboxes', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('directoryTypes', 'oem', 'OEMs', 'OEM and partner contacts', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;

-- Down Migration
DELETE FROM commercial_masters WHERE master_key = 'directoryTypes';
