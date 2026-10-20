-- Up Migration
-- Mailbox references and headers only. No OAuth tokens, bodies or attachments are stored.
CREATE TABLE bid_communication_threads (
  bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL,
  mailbox_email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 1048576),
  category TEXT CHECK (category IN ('internal','delivery','oem','client','clientDepartment','external','unknown')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bid_id, user_uid, thread_id)
);
CREATE TABLE bid_communication_ignored (
  bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (bid_id, user_uid, email)
);
-- External email address book; internal staff and client people remain in their existing masters.
CREATE TABLE communication_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('delivery','oem','clientDepartment','external')),
  organization TEXT NOT NULL DEFAULT '',
  department_id UUID REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Down Migration
DROP TABLE communication_contacts;
DROP TABLE bid_communication_ignored;
DROP TABLE bid_communication_threads;
