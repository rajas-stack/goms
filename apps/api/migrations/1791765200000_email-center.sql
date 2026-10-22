-- Up Migration
CREATE TABLE email_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_uid TEXT NOT NULL, owner_email TEXT NOT NULL,
  provider_email TEXT NOT NULL, provider_subject TEXT, credentials JSONB, scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'reconnect' CHECK (status IN ('connected','reconnect','disconnected')),
  credential_revision UUID NOT NULL DEFAULT gen_random_uuid(), last_sync_at TIMESTAMPTZ, last_error TEXT,
  next_sync_at TIMESTAMPTZ NOT NULL DEFAULT now(), sync_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_email,provider_email), CHECK (owner_email=lower(btrim(owner_email))), CHECK(provider_email=lower(btrim(provider_email)))
);
CREATE TABLE email_oauth_flows (
  state_hash TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL,
  user_uid TEXT NOT NULL, email TEXT NOT NULL, return_to TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE email_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mailbox_id UUID NOT NULL REFERENCES email_mailboxes(id) ON DELETE RESTRICT,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('message','thread')), item_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id UUID NOT NULL, participant_visible BOOLEAN NOT NULL DEFAULT true,
  category TEXT, availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','unavailable','deleted')),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), removed_at TIMESTAMPTZ,
  UNIQUE(mailbox_id,item_kind,item_id,entity_type,entity_id)
);
CREATE INDEX email_links_entity_idx ON email_links(entity_type,entity_id) WHERE removed_at IS NULL;
CREATE TABLE email_link_messages (
  link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE, provider_message_id TEXT NOT NULL,
  internet_id TEXT NOT NULL DEFAULT '', sent_at TIMESTAMPTZ, PRIMARY KEY(link_id,provider_message_id)
);
CREATE INDEX email_link_messages_internet_idx ON email_link_messages(internet_id) WHERE internet_id<>'';
CREATE TABLE email_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mailbox_id UUID NOT NULL REFERENCES email_mailboxes(id) ON DELETE RESTRICT,
  grantee TEXT NOT NULL CHECK(grantee=lower(btrim(grantee))), kind TEXT NOT NULL CHECK(kind IN ('hod','superadmin')),
  entity_type TEXT, entity_id UUID, include_unlinked BOOLEAN NOT NULL DEFAULT false, allow_download BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),
  requested_by TEXT NOT NULL, approved_by TEXT, approval_reference TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((entity_type IS NULL)=(entity_id IS NULL)), CHECK(status<>'approved' OR (approved_by IS NOT NULL AND length(btrim(approval_reference))>0))
);
CREATE INDEX email_grants_grantee_idx ON email_access_grants(grantee,mailbox_id);
CREATE TABLE email_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
  mailbox_id UUID REFERENCES email_mailboxes(id) ON DELETE RESTRICT, item_kind TEXT, item_id TEXT,
  entity_type TEXT, entity_id UUID, grant_id UUID REFERENCES email_access_grants(id) ON DELETE RESTRICT,
  details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_events_mailbox_idx ON email_events(mailbox_id,created_at DESC);
CREATE TABLE email_send_requests (
  mailbox_id UUID NOT NULL REFERENCES email_mailboxes(id), request_id UUID NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','unknown')), provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(mailbox_id,request_id)
);
CREATE TABLE email_stakeholder_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entity_type TEXT NOT NULL, entity_id UUID NOT NULL,
  email TEXT NOT NULL, suggested_by TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(entity_type,entity_id,email,suggested_by)
);
-- Preserve existing personal thread links as provider references; reconnect is required for server-side OAuth.
INSERT INTO email_mailboxes(owner_uid,owner_email,provider_email)
SELECT DISTINCT user_uid,lower(mailbox_email),lower(mailbox_email) FROM bid_communication_threads
ON CONFLICT(owner_email,provider_email) DO NOTHING;
INSERT INTO email_links(mailbox_id,item_kind,item_id,entity_type,entity_id,category,created_by,created_at)
SELECT m.id,'thread',t.thread_id,'opportunity',b.opportunity_id,t.category,m.owner_email,t.linked_at
FROM bid_communication_threads t JOIN bids b ON b.id=t.bid_id
JOIN email_mailboxes m ON m.owner_email=lower(t.mailbox_email) AND m.provider_email=lower(t.mailbox_email)
ON CONFLICT DO NOTHING;

CREATE FUNCTION email_record_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH changed AS (UPDATE email_links SET removed_at=now() WHERE entity_type=TG_ARGV[0] AND entity_id=OLD.id AND removed_at IS NULL RETURNING *)
  INSERT INTO email_events(actor,action,mailbox_id,item_kind,item_id,entity_type,entity_id)
  SELECT 'system','record_deleted',mailbox_id,item_kind,item_id,entity_type,entity_id FROM changed;
  RETURN OLD;
END $$;
CREATE TRIGGER email_opportunity_deleted AFTER DELETE ON opportunities FOR EACH ROW EXECUTE FUNCTION email_record_deleted('opportunity');
CREATE TRIGGER email_meeting_deleted AFTER DELETE ON timeline_events FOR EACH ROW EXECUTE FUNCTION email_record_deleted('meeting');
CREATE TRIGGER email_department_deleted AFTER DELETE ON hierarchy_nodes FOR EACH ROW EXECUTE FUNCTION email_record_deleted('department');
CREATE TRIGGER email_contact_deleted AFTER DELETE ON employees FOR EACH ROW EXECUTE FUNCTION email_record_deleted('contact');
-- Down Migration
DROP TRIGGER email_contact_deleted ON employees;
DROP TRIGGER email_department_deleted ON hierarchy_nodes;
DROP TRIGGER email_meeting_deleted ON timeline_events;
DROP TRIGGER email_opportunity_deleted ON opportunities;
DROP FUNCTION email_record_deleted();
DROP TABLE email_stakeholder_suggestions;
DROP TABLE email_send_requests;
DROP TABLE email_events;
DROP TABLE email_access_grants;
DROP TABLE email_link_messages;
DROP TABLE email_links;
DROP TABLE email_oauth_flows;
DROP TABLE email_mailboxes;
