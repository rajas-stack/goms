-- Up Migration

-- Who has signed in while RBAC was on (shadow / enforce), and with how many roles — feeds the access-readiness view
-- ("users who authenticated but resolved to zero roles", RBAC spec §3.3). Written by auth.me.
CREATE TABLE rbac_seen_users (
  email        TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  role_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS rbac_seen_users;
