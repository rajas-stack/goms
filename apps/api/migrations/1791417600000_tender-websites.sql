-- Up Migration

-- Tender portals (e.g. "E-Proc") managed from Settings. A bid's General tab
-- offers them as a dropdown and shows each one as a named hyperlink. Only
-- absolute http(s) links are accepted (also validated by the router).
CREATE TABLE tender_websites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  url         TEXT NOT NULL CHECK (char_length(url) <= 2000 AND url ~* '^https?://'),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tender_websites_name_key ON tender_websites (lower(btrim(name)));

-- Down Migration

DROP TABLE tender_websites;
