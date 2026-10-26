-- Up Migration

-- Settings > Masters > Live Bids > Requirements / Products (packages/domain/src/bidTrackerFields.ts).
-- The General "Scope of Work" field is now "Requirement", picked from the Requirements master; its
-- saved text stays where it is (one requirement per line). Every distinct existing line is added to
-- the master so it shows up as an option. Re-runnable: existing rows are left untouched.
WITH scope_cells AS (
  SELECT r->'content'->1 AS cell
  FROM bid_synopsis_sections s
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.document->'content') = 'array' THEN s.document->'content' ELSE '[]' END) tbl
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tbl->'content') = 'array' THEN tbl->'content' ELSE '[]' END) r
  WHERE s.section = 'general' AND tbl->>'type' = 'table'
    AND (r->'attrs'->>'fieldKey' = 'scopeOfWork'
      OR lower(btrim((SELECT string_agg(t #>> '{}', '') FROM jsonb_path_query(r->'content'->0, 'strict $.** ? (@.type == "text").text') t))) = 'scope of work')
), paragraphs AS (
  SELECT (SELECT string_agg(CASE WHEN n->>'type' = 'hardBreak' THEN E'\n' ELSE coalesce(n->>'text', '') END, '' ORDER BY i)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'content') = 'array' THEN p->'content' ELSE '[]' END) WITH ORDINALITY x(n, i)) AS text
  FROM scope_cells
  CROSS JOIN LATERAL jsonb_path_query(scope_cells.cell, 'strict $.** ? (@.type == "paragraph" || @.type == "heading")') p
), lines AS (
  SELECT DISTINCT ON (lower(btrim(line))) btrim(line) AS line
  FROM paragraphs CROSS JOIN LATERAL regexp_split_to_table(coalesce(text, ''), E'\n') line
  WHERE btrim(line) <> ''
  ORDER BY lower(btrim(line)), btrim(line)
)
INSERT INTO commercial_masters (master_key, code, name, description, display_order)
SELECT 'requirements', line, line, '', (row_number() OVER (ORDER BY lower(line)) - 1)::int FROM lines
ON CONFLICT (master_key, lower(trim(code))) DO NOTHING;

-- Down Migration
DELETE FROM commercial_masters WHERE master_key IN ('requirements', 'bidProducts');
