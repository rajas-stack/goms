-- Up Migration

-- Item 1: GM/Higher Reporting Manager becomes independently editable rather
-- than purely derived from walking the RM chain (reverses the original
-- 2026-09-01 plan's Decision #1, which deliberately kept GM derived-only to
-- avoid this column). Nullable: unset means "keep auto-deriving from RM",
-- matching how a fresh posting or one that's never been overridden behaves.
ALTER TABLE sales_postings ADD COLUMN gm_override_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL;

-- Down Migration

ALTER TABLE sales_postings DROP COLUMN gm_override_id;
