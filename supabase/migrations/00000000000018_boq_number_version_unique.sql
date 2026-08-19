-- supabase/migrations/00000000000018_boq_number_version_unique.sql
--
-- Phase 1's `commercial_boqs.boq_number` was declared `unique` on its own,
-- but the source-of-truth business logic (repository-logic.ts's
-- reviseBoqLogic, ported unchanged since before this migration existed)
-- deliberately inserts a NEW row that carries the SAME boq_number forward
-- when a BOQ is revised — only boq_version increments, parent_boq_id links
-- back to the original. A bare per-column unique constraint makes every
-- revision after the first impossible: discovered when Phase 4's real
-- Supabase-backed reviseBoq hit "duplicate key value violates unique
-- constraint commercial_boqs_boq_number_key" against real Postgres (the
-- in-memory fallback has no such constraint, so this was invisible until
-- BOQs were migrated). The real invariant is that a (boq_number, boq_version)
-- pair is unique, not boq_number alone — allocate_boq_number() only ever
-- returns a freshly-generated number for a brand-new version-1 BOQ
-- (createBoq/duplicateBoq), so two version-1 rows can never collide either.

alter table public.commercial_boqs drop constraint commercial_boqs_boq_number_key;
alter table public.commercial_boqs add constraint commercial_boqs_boq_number_version_key unique (boq_number, boq_version);
