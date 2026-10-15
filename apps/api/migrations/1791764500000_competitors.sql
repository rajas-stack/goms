-- Up Migration

-- Rival (or partner) companies, e.g. "SAS", managed from Settings > Competitors
-- with their positioning and capabilities. Validated by the router too
-- (packages/domain/src/competitors.ts): logo is an image data: URL of at most
-- 256 KB or an https link; website is an https link. Keep the relationship
-- list and the tag-list limits in sync with COMPETITOR_RELATIONSHIPS and
-- COMPETITOR_LIST_LIMITS.
CREATE TABLE competitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  logo            TEXT CHECK (logo IS NULL OR logo ~* '^(data:image/|https://)'),
  website         TEXT CHECK (website IS NULL OR (char_length(website) <= 2000 AND website ~* '^https://')),
  relationship    TEXT NOT NULL DEFAULT 'competitor'
                  CHECK (relationship IN ('competitor','partner','neutral','strategicThreat')),
  category        TEXT NOT NULL DEFAULT '' CHECK (char_length(category) <= 80),
  sub_categories  TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(sub_categories) <= 10),
  verticals       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(verticals) <= 15),
  certifications  TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(certifications) <= 20),
  offerings       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(offerings) <= 30),
  strengths       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(strengths) <= 10),
  description     TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX competitors_name_key ON competitors (lower(btrim(name)));

-- Down Migration

DROP TABLE competitors;
