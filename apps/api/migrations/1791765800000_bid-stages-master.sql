-- Up Migration
-- Settings > Masters > Live Bids > Bid Stages: the Bid Stage dropdown (packages/domain/src/bids.ts BID_STAGES).
-- code = the stage key stored on bids.stage_key (unchanged), name = its label. Users add their own stages here.
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'solutioning', 'Solutioning', '', 0) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'qualification', 'Qualification', '', 1) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'preBidQueries', 'Pre-bid Queries', '', 2) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'commercialProposal', 'Commercial Proposal', '', 3) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'submitted', 'Submitted', '', 4) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'goApproved', 'Go Approved', '', 5) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;
INSERT INTO commercial_masters (master_key, code, name, description, display_order) VALUES ('bidStages', 'dropped', 'Dropped', '', 6) ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;

-- Down Migration
DELETE FROM commercial_masters WHERE master_key = 'bidStages';
