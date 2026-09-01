-- Closes Gate 5 of docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md
-- ("the audit/log record includes the authenticated caller's identity") now
-- that Task 2 gives every commit a verified Firebase-authenticated email.
-- Nullable + no backfill: every row committed before this migration was
-- written when no authentication existed at all, so there is no real actor
-- to backfill — NULL honestly represents "committed before auth shipped."
ALTER TABLE admin_import_runs ADD COLUMN actor_email text;
