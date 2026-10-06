-- Up Migration

-- Per-person role overrides on top of the roles derived from org_people / sales_persons (RBAC spec §3.3).
-- 'grant' adds a role (e.g. CEO/CFO/CE&TO -> cxo; every Finance, IT and Delivery user); 'revoke' removes a derived one.
CREATE TABLE user_role_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  role       TEXT NOT NULL CHECK (role IN ('sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance')),
  effect     TEXT NOT NULL CHECK (effect IN ('grant', 'revoke')),
  reason     TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, role)
);

-- Down Migration

DROP TABLE IF EXISTS user_role_overrides;
