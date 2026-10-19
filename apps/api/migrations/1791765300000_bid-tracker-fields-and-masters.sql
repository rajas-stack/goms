-- Up Migration

-- Bid Tracker built-in fields and their dropdown masters (packages/domain/src/bidTrackerFields.ts).
-- Generated from that file. Masters live in commercial_masters (Settings > Masters > Bid Tracker);
-- the fields are custom fields with fixed keys whose options are resolved live from their source.
-- Re-runnable: existing rows (or a user column with the same name) are left untouched.

INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidPriorities', 'Hot', 'Hot', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidPriorities', 'Cold', 'Cold', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'NA', 'NA', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'Online', 'Online', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'DD', 'DD', '', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'NEFT', 'NEFT', '', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'RTGS', 'RTGS', '', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'IMPS', 'IMPS', '', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'Internet Banking', 'Internet Banking', '', 6) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'BG', 'BG', '', 7) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'Cheque', 'Cheque', '', 8) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'Cash', 'Cash', '', 9) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderFeeModes', 'Exempted', 'Exempted', '', 10) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'NA', 'NA', 'Not Applicable', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'TBD', 'TBD', 'To Be Decided', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'Not Specified', 'Not Specified', 'Not Specified', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'BG', 'BG', 'Bank Guarantee', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'Online', 'Online', 'Online Payment', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'DD', 'DD', 'Demand Draft', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'PO', 'PO', 'Pay Order', 6) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'BD', 'BD', 'Banker''s Draft', 7) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'BC', 'BC', 'Banker''s Cheque', 8) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'TC', 'TC', 'Treasury Challan', 9) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'FDR', 'FDR', 'Fixed Deposit Receipt', 10) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'FD', 'FD', 'Fixed Deposit', 11) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'ISB', 'ISB', 'Insurance Surety Bond', 12) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'Surety Bond', 'Surety Bond', 'Surety Bond', 13) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'NEFT', 'NEFT', 'National Electronic Funds Transfer', 14) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'RTGS', 'RTGS', 'Real Time Gross Settlement', 15) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'eBG', 'eBG', 'Electronic Bank Guarantee', 16) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'IMPS', 'IMPS', 'Immediate Payment Service', 17) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'Internet Banking', 'Internet Banking', 'Internet Banking', 18) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'ECS', 'ECS', 'Electronic Clearing Service', 19) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'Insurance Bond', 'Insurance Bond', 'Insurance Bond', 20) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('emdInstruments', 'CDR', 'CDR', 'Call Deposit Receipt', 21) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'Sole', 'Sole', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'OEM', 'OEM', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'TBD', 'TBD', '', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'Consortium', 'Consortium', '', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'Sub Contractor', 'Sub Contractor', '', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('rtmTypes', 'Lead', 'Lead', '', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'East', 'East', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'West', 'West', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'North', 'North', '', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'South', 'South', '', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'North-Central', 'North-Central', '', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('zones', 'North-East', 'North-East', '', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Under Preparation', 'Under Preparation', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Under Qualification', 'Under Qualification', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Under Review', 'Under Review', '', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Pre-Bid Stage', 'Pre-Bid Stage', '', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Pre-Bid Queries', 'Pre-Bid Queries', '', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Under Approval', 'Under Approval', '', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Go Approved', 'Go Approved', '', 6) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'No-Go', 'No-Go', '', 7) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Technical Proposal Preparation', 'Technical Proposal Preparation', '', 8) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Commercial Proposal Preparation', 'Commercial Proposal Preparation', '', 9) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Ready for Submission', 'Ready for Submission', '', 10) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Submitted', 'Submitted', '', 11) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Under Evaluation', 'Under Evaluation', '', 12) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Technical Evaluation', 'Technical Evaluation', '', 13) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Technically Qualified', 'Technically Qualified', '', 14) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Technically Disqualified', 'Technically Disqualified', '', 15) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Financial Evaluation', 'Financial Evaluation', '', 16) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Financial Bid Opened', 'Financial Bid Opened', '', 17) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Financially Qualified', 'Financially Qualified', '', 18) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'L1 Declared', 'L1 Declared', '', 19) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Selected', 'Selected', '', 20) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Won', 'Won', '', 21) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Lost', 'Lost', '', 22) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'LOI Received', 'LOI Received', '', 23) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'LOA Issued', 'LOA Issued', '', 24) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Work Order Received', 'Work Order Received', '', 25) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Agreement Signed', 'Agreement Signed', '', 26) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Cancelled', 'Cancelled', '', 27) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Withdrawn', 'Withdrawn', '', 28) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Not Participated', 'Not Participated', '', 29) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'On Hold', 'On Hold', '', 30) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Tender Extended', 'Tender Extended', '', 31) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Retendering', 'Retendering', '', 32) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('tenderStatuses', 'Disqualified', 'Disqualified', '', 33) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;

INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'bid_priority', 'Bid Priority', 'select', '["Hot","Cold"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'bid_priority' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Bid Priority'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'pb_response_date', 'PB Response Published Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'pb_response_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('PB Response Published Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'pre_cxo', 'Pre-CXO', 'select', '["Yes","No"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'pre_cxo' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Pre-CXO'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'final_cxo', 'Final CXO', 'select', '["Yes","No"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'final_cxo' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Final CXO'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'bid_approval', 'Bid Approval Received', 'select', '["Yes","No-Go","Under Approval"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'bid_approval' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Bid Approval Received'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'tender_fee_mode', 'Tender Fee in the Form Of', 'select', '["NA","Online","DD","NEFT","RTGS","IMPS","Internet Banking","BG","Cheque","Cash","Exempted"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'tender_fee_mode' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Tender Fee in the Form Of'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'tender_fee_paid', 'Tender Fee Paid', 'select', '["Yes","No","NA"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'tender_fee_paid' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Tender Fee Paid'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'emd_mode', 'Tender EMD in the Form Of', 'multiselect', '["NA","TBD","Not Specified","BG","Online","DD","PO","BD","BC","TC","FDR","FD","ISB","Surety Bond","NEFT","RTGS","eBG","IMPS","Internet Banking","ECS","Insurance Bond","CDR"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'emd_mode' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Tender EMD in the Form Of'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'rtm', 'RTM', 'select', '["Sole","OEM","TBD","Consortium","Sub Contractor","Lead"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'rtm' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('RTM'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'presales_lead', 'Presales Lead', 'select', '[]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'presales_lead' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Presales Lead'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'zone', 'Zone', 'select', '["East","West","North","South","North-Central","North-East"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'zone' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Zone'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'bu_owner', 'BU Owner', 'select', '[]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'bu_owner' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('BU Owner'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'tender_status', 'Tender Status', 'select', '["Under Preparation","Under Qualification","Under Review","Pre-Bid Stage","Pre-Bid Queries","Under Approval","Go Approved","No-Go","Technical Proposal Preparation","Commercial Proposal Preparation","Ready for Submission","Submitted","Under Evaluation","Technical Evaluation","Technically Qualified","Technically Disqualified","Financial Evaluation","Financial Bid Opened","Financially Qualified","L1 Declared","Selected","Won","Lost","LOI Received","LOA Issued","Work Order Received","Agreement Signed","Cancelled","Withdrawn","Not Participated","On Hold","Tender Extended","Retendering","Disqualified"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'tender_status' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Tender Status'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'emd_refund', 'EMD Refund Received', 'select', '["Yes","No"]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'emd_refund' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('EMD Refund Received'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'participants', 'Participant List', 'multiselect', '[]'::jsonb, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'participants' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Participant List'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'loss_reason', 'Lost / Non-participation Reason', 'text', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'loss_reason' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Lost / Non-participation Reason'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'financial_opening_date', 'Financial Bid Opening Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'financial_opening_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Financial Bid Opening Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'loi_date', 'LOI Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'loi_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('LOI Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'loa_date', 'LOA / WO Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'loa_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('LOA / WO Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'agreement_date', 'Agreement Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'agreement_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Agreement Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'actual_submission_date', 'Actual Bid Submission Date', 'date', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'actual_submission_date' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('Actual Bid Submission Date'))));
INSERT INTO bid_custom_fields (key, name, data_type, options, position, sheet, created_by)
  SELECT 'crm_link', 'CRM Link', 'url', NULL, COALESCE((SELECT MAX(position) + 1 FROM bid_custom_fields), 0), 'bidTracker', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM bid_custom_fields WHERE key = 'crm_link' OR (status = 'active' AND lower(btrim(name)) = lower(btrim('CRM Link'))));

-- Down Migration

DELETE FROM bid_custom_fields WHERE created_by = 'system' AND key IN ('bid_priority', 'pb_response_date', 'pre_cxo', 'final_cxo', 'bid_approval', 'tender_fee_mode', 'tender_fee_paid', 'emd_mode', 'rtm', 'presales_lead', 'zone', 'bu_owner', 'tender_status', 'emd_refund', 'participants', 'loss_reason', 'financial_opening_date', 'loi_date', 'loa_date', 'agreement_date', 'actual_submission_date', 'crm_link') AND NOT has_held_value;
DELETE FROM commercial_masters WHERE master_key IN ('bidPriorities', 'tenderFeeModes', 'emdInstruments', 'rtmTypes', 'zones', 'tenderStatuses', 'buOwners');
