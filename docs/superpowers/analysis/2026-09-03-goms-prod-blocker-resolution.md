# GOMS Production Readiness — Blocker Resolution Report

> **2026-09-04 addendum:** two further release-readiness items were closed after this report:
> `infra/prod/cloudrun.tf` was corrected to match the actual live config (commit `72e3a1c6`) so a
> fresh `terraform plan` now shows 0 unsafe changes and 0 placeholder values in its real-resource
> scope, and the two `admin_import_runs` sessions dated 2026-09-01 were investigated read-only. See
> the final revised GO/NO-GO report for full detail on both — this file's original content below is
> left as written at the time.

**Date:** 2026-09-03 (same day as, later than, the final readiness audit)
**Status:** All 5 numbered blockers from the audit resolved. Still **NO-GO** pending explicit user
approval — nothing deployed to `goms-prod`.

---

## Blocker 1 — stray `infra/prod/cloudrun.tf` diff

**Resolution:** `git restore -- infra/prod/cloudrun.tf`. Confirmed empty diff afterward and that
every other unrelated uncommitted file was untouched (`git status` before/after matched except for
this one file).

## Blocker 2 — `apps/api` DB-backed suite unverified

**Resolution:** Docker Desktop started, a disposable `postgres:16` container run on a free port
(`goms-api-test-pg`, port 55490 — 55432/5433 were already in use by unrelated local containers),
all migrations applied via `npm run migrate up` (clean, no errors), then `npx vitest run` in
`apps/api`.

**Result: 393/393 tests pass, 32/32 files**, against a clean, real Postgres, on the exact release
candidate. Container torn down afterward (`docker rm -f`).

## Blocker 3 — 6 (actually 8) E2E failures needing root-cause

The Sept 2 doc's failure list was stale. A fresh run against real `goms-dev` today showed **8**
still failing (3 of the original 11 had already been fixed by an earlier commit today,
`cefe0e17`). Root-caused all 8, not just the 6 originally flagged:

**Root cause A (6 of 8): `data-testid` attributes referenced by the already-committed E2E spec
were never shipped.** Confirmed directly, not inferred: the live deployed JS bundle
(`goms-dev.firebaseapp.com`) was fetched and grepped — zero occurrences of `person-row-`,
`opportunity-row-`, `profile-photo-dropzone`, `org-chart-node-` anywhere in it. The attributes
existed only in uncommitted local changes to 4 component files. Affected: Phase 2.2 (People
directory search), Phase 2.1 (clipboard paste target), Phase 4.1 (Create opportunity), Phase
6.1–6.3 (GM auto-derive → org chart), Phase 9.1–9.2 (avatars in directory), and Ownership-after-
reload.

- **Fix:** committed exactly those 4 files (`fix(e2e): add data-testid hooks required by
  26-task-enhancements.spec.ts`, commit `9c41dc4f`) — no behavior change, pure test hooks — then
  rebuilt the frontend with `goms-dev`'s standard build env and redeployed to Firebase Hosting.
  Verified post-deploy: the testid strings are present in the live route chunks
  (`StateWorkspace-*.js`, `SalesWorkspace-*.js` — they're split across lazy-loaded route chunks,
  not the main bundle, which is why an initial single-bundle grep looked like the fix hadn't
  landed; checking all `dist/assets/*.js` confirmed it had).

**Root cause B (2 of 8): known, already-diagnosed `timeline_events` seed gap** (Phase 8.4 Edit
Meeting, Phase 9.2–9.4 attendee avatar). `scripts/seed-import.ts` already had a 2026-09-03 comment
root-causing this exactly (`seed.timeline` was never inserted into Postgres, despite being
destructured and truncated-for as if it were) — the fix existed in code but had never been *run*
against `goms-dev`. A full `seed-import.ts --reset` would wipe all real accumulated data, which the
user explicitly forbade. Instead:
1. **Discovered mid-check (read-only recon script, user-approved):** `goms-dev`'s `timeline_events`
   table was also missing the `agenda`/`outcome`/`next_steps` columns — that migration had never
   been applied there either, despite the deployed app code depending on it. Applied it via
   `goms-migrate`'s normal default `up` args (purely additive, no override, no risk).
2. Wrote a **narrow, idempotent backfill script** (not committed to the repo — ad hoc, run once)
   that resolves Priya Nair's and Vikram Rao's *real* `goms-dev` employee ids (by email/name, not
   fixture ids) and inserts exactly the 3 QA-fixture rows `seed.ts` defines for them (2 "Contact
   created" system events + the "QA Kickoff Meeting" with attendee "Mr. Rohit Tiku"), guarded by a
   check that skips entirely if that meeting already exists. Ran it once via the same one-off
   `goms-migrate` job-execution-override technique already established in this project (Aug 31
   report, memory update 15) — **user-approved before running**, since it's a live-database write.
   Verified: `INSERTED 3 QA timeline_events rows`, and the job's persisted definition confirmed
   unchanged afterward (`args` still the default `node-pg-migrate up`).

**Then found and fixed one more, genuine test-only bug** while re-running the suite: Phase 8.4
still failed once root causes A/B were fixed — `entriesBefore` (a bare `.count()` right after
selecting Priya Nair) raced her async timeline fetch and snapshotted 0 before the entry rendered,
the same race class the file's own comments already document being fixed for the District-select
test earlier today. **Fix:** wait for the "Edit QA Kickoff Meeting" button to be visible before
taking the count (commit `b8b18705`). Verified with 3 repeated runs (`--repeat-each=3`), all green.

**Final E2E result: 23/23 pass.**

## Blocker 4 — timeline_events backfill

Done as part of Blocker 3's Root Cause B above — narrow (3 rows), idempotent (guarded skip),
QA-fixture-only, no `--reset`, no other table touched. Rerunning Edit Meeting + attendee-avatar
tests (and the full suite) confirmed the fix.

## Blocker 5 — fresh `infra/prod` terraform plan

Ran `terraform init` (already-initialized backend, `goms-prod-tfstate` GCS bucket) then
`terraform plan` — **read-only, not applied.**

**Plan: 5 to add, 2 to change, 0 to destroy.**

- **`google_cloud_run_v2_service.goms_api` and `google_cloud_run_v2_job.goms_migrate` would both
  roll the live image back** from `goms-api:54a7d6ab...` to the old `:bootstrap` placeholder tag —
  because the committed file (after correctly discarding Blocker 1's stray diff) was never updated
  to reflect the real image that's actually live. **Do not apply this plan as generated.**
- The service's top-level `scaling` block and `template.scaling.max_instance_count = 10` would be
  dropped (reverted to Terraform-unmanaged/default) — the exact class of drift the discarded stray
  diff was (badly) trying to fix, this time for real.
- **5 new resources** (`google_monitoring_alert_policy` ×4, `google_monitoring_uptime_check_config`
  ×1) would be created — these are the Stage B monitoring resources, committed but never applied.
  The uptime check's `monitored_resource.labels.host` would be set to the **literal placeholder
  string** `"PLACEHOLDER-not-yet-created.run.app"` — `terraform.tfvars`'s own comment says these 5
  resources are "deliberately excluded from the first terraform plan/apply (via `-exclude` flags)
  until [`notification_channel_ids`/`api_hostname`] are real." This plan run did not use those
  `-exclude` flags, so it surfaced them — a real `apply` should not include them until those two
  values are filled in for real.

**Conclusion: this plan must not be applied as-is.** A correct plan needs (a) the committed image
tag corrected to the real live tag before generating it, and (b) the 5 monitoring resources
excluded (or `api_hostname`/`notification_channel_ids` given real values) — otherwise applying it
would actively regress production (image rollback, scaling ceiling removed) while also creating a
broken uptime check.

## Extra finding surfaced during the migration pre-check (not one of the 5 numbered blockers)

Running the pre-check revealed the situation is better than the original audit assumed: **only 2 of
the 4 migrations are actually still pending on `goms-prod`** (`admin-import-runs` and
`admin-import-hardening` — the two with real duplicate-key risk — are already applied). The 2
still pending (`admin-import-actor-email`, `timeline-events-agenda-outcome-nextsteps`) are both
purely additive nullable `ALTER TABLE ADD COLUMN`, zero duplicate-key risk. See the migration
pre-check section of the final summary for full detail, including a fresh duplicate-key check
result (all zero) and an admin_import_runs history review surfaced while investigating the earlier
live-exposure incident.
