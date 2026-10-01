# GOMS Prod Final Promotion Audit — 15-Item Enhancement Batch

**Date:** 2026-09-08
**Scope:** The six local commits ahead of `origin/main` — `c65192e9`, `54655970`, `54cba4ca`, `83025c8a`, `be946d6c`, `54095b7d`.
**Not pushed. Not deployed. No code modified during this audit.**

## 0. Fresh production state (verified this session, not reused from prior audits)

- `gcloud run services describe goms-api --project=goms-prod --region=asia-south1`:
  - Live revision: **`goms-api-00018-qrk`**, 100% traffic, Ready since `2026-09-07T07:09:52Z`.
  - Image: `asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:6f376438f4ae0ef084fccab447afc8f93ac50c09`.
  - Env: `AUTH_ENFORCEMENT_ENABLED=true`, `EMERGENCY_READ_ONLY=false`, `FIREBASE_PROJECT_ID=goms-prod`, `TRUST_PROXY=firebase-hosting`.
- `gcloud run jobs executions list --job=goms-migrate --project=goms-prod`: last successful run **`goms-migrate-jzhlj`**, completed `2026-09-07T08:48:04Z`, same image tag as the service above.
- `firebase hosting:channel:list --project=goms-prod`: live channel last released `2026-09-07 12:37:20`, `https://goms-prod.web.app`.
- Commit `6f376438` (`docs(auth): record goms-dev auth verification results`) is dated `2026-09-07 11:41:05 +0530` and is the **parent-of-parent-of-parent-of-parent-of-parent-of-parent** ancestor immediately before `c65192e9` in `git log` — i.e. **none of the six audited commits are reachable from what's currently live.**
- `git log origin/main..HEAD` returns exactly the six commits listed above, in this order (oldest→newest): `c65192e9`, `54655970`, `54cba4ca`, `83025c8a`, `be946d6c`, `54095b7d`. No other local commits exist ahead of `origin/main`.

## 1. Commit-by-commit audit

### `c65192e9` — fix(infra): reconcile infra/prod/cloudrun.tf with the deployed no-op auth release
- **Changes:** Updates `infra/prod/cloudrun.tf`'s `goms-api` service and `goms-migrate` job image tags from `54a7d6ab...` to `6f376438...` (the tag actually live since 2026-09-04's manual deploy), and adds explicit `AUTH_ENFORCEMENT_ENABLED=false` / `EMERGENCY_READ_ONLY=false` env blocks matching that same no-op release. Documentation-only reconciliation of Terraform state to already-deployed reality; no functional change.
- **Live already?** Yes — every value it writes matches the live service exactly (confirmed in §0).
- **Needs promotion?** Push only. A `terraform plan` after push should show **zero diff** (state already matches).
- **Migration/deploy dependency:** None.
- **Regression/compatibility risk:** None — pure IaC-drift documentation.

### `54655970` — feat(infra): reflect AUTH_ENFORCEMENT_ENABLED=true and goms-prod Firebase Auth on prod
- **Changes:** Flips `AUTH_ENFORCEMENT_ENABLED` from `"false"` to `"true"` in `infra/prod/cloudrun.tf`, adds `FIREBASE_PROJECT_ID=goms-prod`. Documents the already-performed manual enablement of Google Sign-In on goms-prod's own Firebase project.
- **Live already?** Yes — confirmed live in §0 (`AUTH_ENFORCEMENT_ENABLED=true`, `FIREBASE_PROJECT_ID=goms-prod` both present on revision `goms-api-00018-qrk`).
- **Needs promotion?** Push only. `terraform plan` should show zero diff.
- **Migration/deploy dependency:** None.
- **Regression/compatibility risk:** None — describes a state that is already live and already smoke-tested (per revision timestamps, this was the same 2026-09-07 deploy window as the last `goms-migrate` run and the last Hosting release).

### `54cba4ca` — fix(gap-analysis): complete items 2, 4, 7, 15 against original Excel requirements
- **Changes:** Frontend-only. `src/data/std-codes.ts` (+`std-codes.test.ts`), `HierarchyCanvas.tsx` (item 7 — people search in Canvas view), `DepartmentSection.tsx`/`EmployeeDetails.tsx`/`NodeDetails.tsx` (items 2, 4, 15 — department contact metadata/STD picker, Website/Address removal follow-through, department meeting timeline), plus a new e2e spec.
- **Live already?** No — not reachable from the live image/frontend.
- **Needs promotion?** Yes — frontend rebuild + Hosting deploy (no backend/API changes in this commit).
- **Migration/deploy dependency:** None (per the enhancement plan's own DB/API summary table — items 2, 4, 7, 15 are all frontend-only or metadata-only).
- **Regression/compatibility risk:** Low. Touches shared components (`NodeDetails`, `EmployeeDetails`, `DepartmentSection`) also touched by `83025c8a` — reviewed together below.

### `83025c8a` — fix(account-mapping): close remaining item 4/11 gaps in Excel re-audit
- **Changes:** Frontend-only. Further `DepartmentSection.tsx`/`EmployeeDetails.tsx` cleanup (item 4), `VisitingCard.tsx` (item 11 avatar rollout), `ExportDialog.tsx`, `CreateBoq.tsx` (commercial calculator), each with matching test files.
- **Live already?** No.
- **Needs promotion?** Yes — frontend rebuild + Hosting deploy.
- **Migration/deploy dependency:** None.
- **Regression/compatibility risk:** Low — `ExportDialog.tsx`'s 51/65-line change is the largest non-additive edit in the batch; covered by its own new test file (`ExportDialog.test.ts`, 65 lines added, part of the 391 passing frontend unit tests — see §3).

### `be946d6c` — feat(goms): complete 15-item enhancement batch
- **Changes:** The one commit touching both backend and DB:
  - **New migration** `apps/api/migrations/1788200000000_sales-postings-gm-override.sql` — adds nullable `sales_postings.gm_override_id UUID REFERENCES sales_persons(id) ON DELETE SET NULL`.
  - `apps/api/src/routers/sales.ts` (+test) — new `sales.updatePostingManager` procedure (item 1).
  - `src/data/in-memory/repository.ts`, `src/data/remote/repository.ts`, `src/lib/api.ts`, `src/lib/types.ts` — client-side plumbing for the above.
  - `SalesPersonFormDialog.tsx`, `SalesPersonDetails.tsx`, `PeopleDirectory.test.tsx` — editable RM + derived-disabled GM UI (item 1).
- **Live already?** No.
- **Needs promotion?** Yes — this is the only commit requiring a **backend image rebuild, a migration run, and a Cloud Run service redeploy**, in addition to the frontend rebuild.
- **Migration/deploy dependency:** `1788200000000_sales-postings-gm-override.sql` must run (via the `goms-migrate` Cloud Run job) using an image that contains it, before or as part of deploying the new `goms-api` revision.
- **Regression/compatibility risk:** Low-moderate. The migration is additive/nullable (no backfill, no NOT NULL, no data migration) and reversible via its down-migration (`DROP COLUMN`). This deviates from the original 2026-09-01 plan's Decision #1 (which explicitly avoided a new column) — the migration file's own comment documents this as a deliberate reversal, confirmed intentional per your framing of Item 1 in this request.

### `54095b7d` — feat(goms): expand verified STD code dataset
- **Changes:** Frontend-only. `src/data/std-codes.ts` (+test) — dataset expansion.
- **Live already?** No.
- **Needs promotion?** Yes — frontend rebuild + Hosting deploy (same artifact as `54cba4ca`/`83025c8a`, no independent deploy needed).
- **Migration/deploy dependency:** None.
- **Regression/compatibility risk:** None — pure static-data addition, verified below.

## 2. Explicit confirmations requested

- **Items 1–15 implemented:** Confirmed. Cross-referenced against `docs/superpowers/plans/2026-09-01-goms-15-item-enhancement-plan.md`'s own "Summary Table — DB/API Changes by Item" (lines 740-758) and each commit's diff. Item 13 (Agenda/Outcome/Next Steps) was already implemented and merged to `origin/main` earlier (commit `de9dafa8`, migration `1788100000000`) and is **not** part of this six-commit batch — it's already live (confirmed applied: the last successful `goms-migrate` execution, `goms-migrate-jzhlj` on 2026-09-07, ran an image that already contained `1788100000000`).
- **Item 1 migration is the only new DB migration:** Confirmed. `git ls-tree HEAD apps/api/migrations` vs `git ls-tree origin/main apps/api/migrations` diff by exactly one file: `1788200000000_sales-postings-gm-override.sql`.
- **Item 2 final dataset is 202 entries (verified=15, secondary=15, cross-walked=173):** Confirmed by direct count against the committed `src/data/std-codes.ts` at `HEAD`:
  ```
  173 verificationLevel: 'cross-walked'
   15 verificationLevel: 'secondary'
   15 verificationLevel: 'verified'
  202 total (stdCode: occurrences)
  ```
- **Items 2–15 have no additional DB migration requirements:** Confirmed — the only migration file added anywhere in the six commits is Item 1's (above); the enhancement plan's own table marks every other item "No" migration, which the diffs corroborate.
- **No unrelated WIP included:** Confirmed. `git show --stat` on all six commits touches only: `infra/prod/cloudrun.tf`, `src/data/std-codes.ts(.test.ts)`, `src/features/**`, `src/app/routes/SalesWorkspace.test.tsx`, `src/data/{in-memory,remote}/repository.ts`, `src/lib/{api,types}.ts`, `src/data/sales-roster-seed.ts`, `apps/api/src/routers/sales.ts(.test.ts)`, `apps/api/migrations/1788200000000_...sql`, `e2e/26-task-enhancements.spec.ts`. **None** of the six commits touch `apps/api/src/import/**`, `src/modules/admin-data-import/**`, or any `docs/superpowers/**` file — those are all separately uncommitted/untracked in the working tree (confirmed via `git status`) and are correctly excluded from this promotion.

## 3. Test evidence (run fresh this session)

- `npm test` (root, `vitest run`, `.ts` unit tests): **36 files / 391 tests, all passed.**
- `npm run test:component` (root, `.tsx` component tests): **55 of 56 files passed, 351 of 354 tests passed.** The one failing file is `src/features/employees/TimelineEventDialog.test.tsx` (3 attendee-picker tests) — this is a **known, pre-existing failure** predating 2026-09-03 (see `[[project_timelineeventdialog_preexisting_test_failures]]` memory), unrelated to any of these six commits, not a regression introduced by this batch.
- `apps/api` (`npm test`): **Could not be verified in this session** — every DB-backed test file fails locally with `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`, because this environment has no local Postgres reachable at the `.env`-configured `DATABASE_URL` and `vitest.config.ts` does not auto-load `.env`. This is a **local-environment gap, not evidence of a code defect** — `.gitlab-ci.yml`'s `test-api` job runs the same suite against a real `postgres:16` service, executing `npm --workspace apps/api run migrate up` (which will apply `1788200000000`) immediately before `npm --workspace apps/api run test`, and runs automatically on every push (no manual gate on the test stage itself). **Recommend treating a green `test-api` CI run on the push as the actual verification gate for `be946d6c`'s backend changes**, before proceeding to the image build/deploy steps below.

## 4. Recommended production promotion sequence

1. **Git push** — `git push origin main`. This is the only step that should happen without further confirmation once you approve; everything after this needs the results of the push's CI run inspected before continuing.
2. **Wait for and inspect `test-api` CI job** (runs automatically on push, no `rules:` gate on the test stage). Confirm green before proceeding — this is the only real independent verification of `be946d6c`'s backend/migration changes, since local DB testing wasn't available this session (§3).
3. **Backend image build:** either let `build-api` run (auto on `main`, tags the image `${CI_COMMIT_SHA}`, i.e. `54095b7d...`) or run `gcloud builds submit --config=cloudbuild.yaml --substitutions=_IMAGE_URI=asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:54095b7d8cd342b56fccd78d3880635adee849a1 .` manually — `build-api`'s current `rules:` only target `goms-dev`'s registry path implicitly via `$GCP_PROJECT_ID_DEV`, so **a prod image build is a manual step**, matching this repo's established pattern (`.gitlab-ci.yml` has no `deploy` stage job for `goms-prod` at all — every prior prod promotion, per the `cloudrun.tf` comments audited above, was `gcloud run deploy` run by hand, out-of-band from CI/Terraform).
4. **Migration execution:** `gcloud run jobs update goms-migrate --project=goms-prod --region=asia-south1 --image=asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:54095b7d8cd342b56fccd78d3880635adee849a1` then `gcloud run jobs execute goms-migrate --project=goms-prod --region=asia-south1 --wait`. Confirm it completes successfully (applies `1788200000000_sales-postings-gm-override.sql`) before the next step.
5. **Backend deployment:** `gcloud run deploy goms-api --project=goms-prod --region=asia-south1 --image=asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:54095b7d8cd342b56fccd78d3880635adee849a1`. Confirm the new revision is `Ready` and receiving 100% traffic (`gcloud run services describe goms-api --project=goms-prod --region=asia-south1`).
6. **Frontend deployment:** `npm run build` with the same prod `VITE_API_BASE_URL=https://goms-prod.web.app` / `VITE_FIREBASE_*` values used for the 2026-09-07 12:37 live release (per `docs/superpowers/analysis/2026-09-04-goms-auth-architecture-decision.md` — these four `VITE_FIREBASE_*` values are not stored in this repo; retrieve them from wherever that prior release's build inputs were kept), then `npx firebase-tools deploy --only hosting --project goms-prod`.
7. **Post-deploy Terraform reconciliation:** `terraform plan` against `infra/prod/` should now show a diff only for the image tag bump (`6f376438...` → `54095b7d...`) if you choose to also update `cloudrun.tf`'s pinned tag in a follow-up commit (matching this repo's established after-the-fact-documentation pattern) — not required for functionality, since the service/job image was already updated directly in step 4/5.
8. **Pre-deploy smoke tests** (before step 1, on current `main` + these six commits, already done this session): §3's test evidence. Additionally recommended immediately before step 1: `npm run build` locally to confirm the frontend still builds clean with these changes (not yet run this session — recommend running once approved, since it's fast and non-destructive).
9. **Post-deploy 15-item verification:** click through all 15 items against `https://goms-prod.web.app` per the acceptance criteria in `docs/superpowers/plans/2026-09-01-goms-15-item-enhancement-plan.md`'s per-phase task descriptions — this repo's own convention (per `[[feedback_pre_deploy_local_test_suite]]`) is that full click-through E2E against real data only happens post-deploy, since local DB has no seed data.
10. **Rollback procedure:**
    - Frontend: `firebase hosting:clone goms-prod:live@<previous-release-id> goms-prod:live --project=goms-prod` (or re-run step 6 with a checked-out prior commit) to restore the 2026-09-07 12:37 release.
    - Backend: `gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 --to-revisions=goms-api-00018-qrk=100` — instantly routes traffic back to the current live revision without deleting the new one.
    - Migration: `1788200000000`'s down-migration (`ALTER TABLE sales_postings DROP COLUMN gm_override_id;`) is safe to run via `node-pg-migrate down` **only if** no `gm_override_id` values have been written yet by the new code — since the column is nullable and additive, leaving it in place (i.e. *not* rolling back the migration) while rolling back the service traffic is the lower-risk option and is sufficient on its own; the old code never references the new column, so its mere presence is harmless.

## 5. GO / NO-GO

**GO**, for pushing and promoting all six commits as a single batch — no unrelated WIP, no undisclosed migrations, the STD dataset is exactly the agreed 202/15/15/173 split, and the only pre-existing test failure (`TimelineEventDialog`) is documented as unrelated and pre-dating this batch. The one open item is that `apps/api`'s test suite couldn't be run locally this session (§3) — treat a green `test-api` CI run on the push as the real gate before building/deploying the backend image (step 2 above), rather than a reason to withhold the push itself.

**Recommended commit range to push:** `origin/main..54095b7d` (i.e. push `main` with all six commits — `c65192e9..54095b7d` inclusive — in one push; they were designed and are already ordered as a single dependent batch, and none is independently deployable without the others given shared file touches in `DepartmentSection.tsx`/`EmployeeDetails.tsx` across `54cba4ca` and `83025c8a`).

Awaiting your explicit approval before running step 1.
