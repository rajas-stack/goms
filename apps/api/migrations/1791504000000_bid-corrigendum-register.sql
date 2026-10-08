-- Up Migration

-- Corrigendum Part 1: the corrigendum register and clause-level change detail.
-- Keep every CHECK list in sync with packages/domain/src/corrigenda.ts.
-- Number of Changes / Open Actions stay DERIVED at read time (never stored).

ALTER TABLE bid_corrigenda
  ADD COLUMN published_date         DATE,
  ADD COLUMN received_date          DATE,
  ADD COLUMN effective_date         DATE,
  ADD COLUMN affected_sections      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN impact_level           TEXT    NOT NULL DEFAULT 'medium'
    CHECK (impact_level IN ('low','medium','high','critical')),
  ADD COLUMN technical_impact       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN commercial_impact      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN bid_date_impact        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN submission_date_impact BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN review_owner_id        TEXT,
  ADD COLUMN review_status          TEXT    NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','reviewed','action_required','closed')),
  ADD COLUMN remarks                TEXT    NOT NULL DEFAULT '';

ALTER TABLE bid_corrigenda ADD CONSTRAINT bid_corrigenda_affected_sections_check
  CHECK (affected_sections <@ ARRAY['sow','pq','tq','manpower','milestones','payment_terms','boq','dates','sla','commercial','other']::TEXT[]);

-- Change rows are append-only: current_value is the text BEFORE this
-- corrigendum, proposed_value the text after, so the original tender is the
-- current_value of a clause's earliest change and is never overwritten.
ALTER TABLE bid_corrigendum_changes
  ADD COLUMN kind            TEXT NOT NULL DEFAULT 'field' CHECK (kind IN ('field','clause')),
  ADD COLUMN clause_title    TEXT NOT NULL DEFAULT '',
  ADD COLUMN affected_module TEXT NOT NULL DEFAULT 'other'
    CHECK (affected_module IN ('sow','pq','tq','manpower','milestones','payment_terms','boq','dates','sla','commercial','other')),
  ADD COLUMN classification  TEXT NOT NULL DEFAULT 'modified'
    CHECK (classification IN ('added','modified','deleted','clarified','date_changed','quantity_changed',
                              'commercial_changed','qualification_relaxed','qualification_tightened','no_material_change')),
  ADD COLUMN impact_level    TEXT NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('low','medium','high','critical')),
  ADD COLUMN source_ref      TEXT NOT NULL DEFAULT '';

-- Existing rows are milestone-date changes (plus the odd tender link).
UPDATE bid_corrigendum_changes SET affected_module = 'dates', classification = 'date_changed' WHERE field_key <> 'tenderLink';

-- One change per clause per corrigendum is enforced in the router, not with a
-- unique index: rows recorded before this migration were never checked.

-- Down Migration

ALTER TABLE bid_corrigendum_changes
  DROP COLUMN source_ref, DROP COLUMN impact_level, DROP COLUMN classification,
  DROP COLUMN affected_module, DROP COLUMN clause_title, DROP COLUMN kind;
ALTER TABLE bid_corrigenda DROP CONSTRAINT IF EXISTS bid_corrigenda_affected_sections_check;
ALTER TABLE bid_corrigenda
  DROP COLUMN remarks, DROP COLUMN review_status, DROP COLUMN review_owner_id, DROP COLUMN submission_date_impact,
  DROP COLUMN bid_date_impact, DROP COLUMN commercial_impact, DROP COLUMN technical_impact, DROP COLUMN impact_level,
  DROP COLUMN affected_sections, DROP COLUMN effective_date, DROP COLUMN received_date, DROP COLUMN published_date;
