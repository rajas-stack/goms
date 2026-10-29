-- Up Migration

-- The GOMS site that started a Google sign-in or Gmail grant (e.g. the :5173 preview or the :8088 stack, which share one
-- API). The callback sends the browser back there; NULL keeps the configured OAUTH_WEB_ORIGIN. Checked against the
-- allowed web origins when the flow starts.
ALTER TABLE auth_flows ADD COLUMN web_origin TEXT;
ALTER TABLE email_oauth_flows ADD COLUMN web_origin TEXT;

-- Down Migration

ALTER TABLE email_oauth_flows DROP COLUMN IF EXISTS web_origin;
ALTER TABLE auth_flows DROP COLUMN IF EXISTS web_origin;
