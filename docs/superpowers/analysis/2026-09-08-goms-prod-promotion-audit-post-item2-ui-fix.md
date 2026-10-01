# GOMS Prod Promotion Audit — Post Item 2 UI Fix

**Date:** 2026-09-08 (follow-up to the same-day final-promotion audit, after `5a5dc0c9` landed)
**Not pushed. Not deployed. No code modified during this audit.**

## 0. Correction to the requested premise — please read first

The request assumed all seven commits (`c65192e9` … `5a5dc0c9`) are still local/unpushed. **That's no longer true.** Earlier in this session, after the first promotion audit, you approved "STEP 1 only" and I ran `git push origin main`, which pushed `c65192e9` through `54095b7d` — confirmed at the time (`6f376438..54095b7d main -> main`) and re-verified just now:

```
git log -1 --format="%H %s" origin/main
54095b7d8cd342b56fccd78d3880635adee849a1 feat(goms): expand verified STD code dataset

git merge-base --is-ancestor <sha> origin/main, for each of the 7:
c65192e9: ALREADY on origin/main
54655970: ALREADY on origin/main
54cba4ca: ALREADY on origin/main
83025c8a: ALREADY on origin/main
be946d6c: ALREADY on origin/main
54095b7d: ALREADY on origin/main
5a5dc0c9: NOT on origin/main
```

So **only `5a5dc0c9` (the Item 2 UI fix) is actually unpushed.** The rest of this audit covers all seven for completeness against your checklist, but the "push" step at the end is a single-commit push, not a 7-commit one.

## 1. Current live production revision/config (re-verified fresh this session)

- `gcloud run services describe goms-api --project=goms-prod --region=asia-south1`: revision **`goms-api-00018-qrk`**, 100% traffic, image `asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:6f376438f4ae0ef084fccab447afc8f93ac50c09`, `AUTH_ENFORCEMENT_ENABLED=true`. **Unchanged** from the last audit — no drift.
- `gcloud run jobs executions list --job=goms-migrate --project=goms-prod`: last successful execution still **`goms-migrate-jzhlj`** (2026-09-07). Unchanged.
- `firebase hosting:channel:list --project=goms-prod`: live channel still last released **2026-09-07 12:37:20**. Unchanged.

Nothing has been built, migrated, or deployed to `goms-prod` since the last audit — confirmed, not assumed.

## 2. Which of the 7 commits are reflected in prod, and which are not

| Commit | On `origin/main`? | Live in `goms-prod`? |
|---|---|---|
| `c65192e9` | Yes | Yes — describes already-live IaC state, no functional change |
| `54655970` | Yes | Yes — same, describes already-live IaC state |
| `54cba4ca` | Yes | **No** — frontend items 2/4/7/15, not built/deployed |
| `83025c8a` | Yes | **No** — frontend items 4/11, not built/deployed |
| `be946d6c` | Yes | **No** — backend Item 1 + migration, not built/deployed/migrated |
| `54095b7d` | Yes | **No** — STD dataset, not built/deployed |
| `5a5dc0c9` | **No** (still local) | **No** |

"On origin/main" answers whether the code is pushed to the git remote; "live in goms-prod" answers whether it's actually running — these are different questions, and for every commit except the two infra-reconciliation ones, the answer to the second is no. The live Cloud Run image (`6f376438...`) predates all seven commits.

## 3. Item 1 migration still the only new DB migration

Confirmed. `apps/api/migrations/` at `HEAD` has 14 files; the only one not already reflected in the live image is `1788200000000_sales-postings-gm-override.sql` (from `be946d6c`). `5a5dc0c9` touches zero files under `apps/api/migrations/` — verified via `git diff 5a5dc0c9~1 5a5dc0c9 --name-only`.

## 4. Item 2 now includes both required pieces

Confirmed, both present at `HEAD`:
- **202-entry STD dataset** (`54095b7d`): `src/data/std-codes.ts` at `HEAD` has exactly 202 entries — `verified=15`, `secondary=15`, `cross-walked=173` (recounted fresh this session, unchanged since the last audit).
- **Corrected workflow** (`5a5dc0c9`, not yet pushed): State→District→City is now a searchable dropdown sourced from that dataset (no free-typed city), STD auto-populates on a match and stays editable, and Landline/EPBX vs. Mobile are separated so a domestic STD-code number and a +91 mobile number are never shown concatenated.

`5a5dc0c9` does not touch `src/data/std-codes.ts` at all — it's a pure UI/logic fix layered on top of the dataset commit, not a dataset change.

## 5. `5a5dc0c9` requires no additional DB migration

Confirmed. All nine files it touches are frontend TS/TSX (`PhoneInput`, `NodeDetails`, `ExportDialog`, `DepartmentFields`, `contact-numbers`, plus their tests) — the department contact-number data continues to live in the existing `metadata.contactNumbers` JSONB blob (unchanged column, unchanged shape at the DB level: still a JSON-encoded array on the same text metadata field). No `apps/api/migrations/` file is added or touched.

## 6. Items 1–15 still covered by the final promotion set

Unchanged from the prior audit's item-by-item cross-reference against the enhancement plan's DB/API summary table — `5a5dc0c9` doesn't add or remove scope, it corrects Item 2's implementation quality (the City field was free-text despite the whole point being to drive the STD lookup). Items 1–15 remain fully covered across the seven commits, with Item 13 already live from before this batch (`de9dafa8`, unrelated to these seven).

## 7. No unrelated WIP in any of the 7 commits

Confirmed for all seven, including the new one:
- The prior audit already confirmed `c65192e9` … `54095b7d` touch only `infra/prod/cloudrun.tf`, `src/data/std-codes.ts(.test.ts)`, `src/features/**`, `apps/api/src/routers/sales.ts(.test.ts)`, `apps/api/migrations/1788200000000_...sql`, and `e2e/26-task-enhancements.spec.ts` — nothing under `apps/api/src/import/**`, `src/modules/admin-data-import/**`, or `docs/superpowers/**`.
- `5a5dc0c9` touches exactly the 9 files listed in §4/§5 above, all directly implementing the Item 2 UI fix. `git status` right now shows the identical set of pre-existing modified/untracked files (Admin Data Import/import-engine WIP, docs analysis/plan files, scratch assets, `std_codes.md`, the STD CSV) as before this commit — none were staged or touched by it.

## 8. Shared-file dependency/ordering issues between the commits

None that block a single push of the full range — every file touched by more than one of the seven commits is touched **sequentially within this same linear history**, not divergently:

| File | Touched by (in order) |
|---|---|
| `infra/prod/cloudrun.tf` | `c65192e9` → `54655970` |
| `src/data/std-codes.ts`(`.test.ts`) | `54cba4ca` → `54095b7d` |
| `e2e/26-task-enhancements.spec.ts` | `54cba4ca` → `be946d6c` |
| `src/features/details/DepartmentSection.tsx`(`.test.tsx`) | `54cba4ca` → `83025c8a` |
| `src/features/details/NodeDetails.tsx`(`.test.tsx`) | `54cba4ca` → `5a5dc0c9` |
| `src/features/import/ExportDialog.tsx` | `83025c8a` → `5a5dc0c9` |

Because these are all commits on one straight line (`git log --oneline` shows no branching), pushing the whole range applies them in exactly this order automatically — there's no rebase, merge, or cherry-pick risk. The one practical implication: **these commits are not independently deployable in isolation** — e.g. `5a5dc0c9` alone, without `54cba4ca` underneath it, wouldn't apply/build, since it edits code `54cba4ca` introduced. This is only a concern if someone tries to cherry-pick a subset; pushing the full range (which is what's recommended below) sidesteps it entirely.

## 9. Recommended production promotion sequence

1. **Git push (the real remaining step):** `git push origin main` — this pushes only `5a5dc0c9`, since the other six are already on `origin/main`. Range: `54095b7d..5a5dc0c9`.
2. **CI gate:** wait for `test-api` (runs automatically on push, no manual gate on the test stage). Given `5a5dc0c9` touches no backend files, this is low-risk, but still confirm green before proceeding — the same rule applied last time, when an unrelated flaky `ownership.test.ts` race test needed a retry.
3. **Production API image build:** `gcloud builds submit --project=goms-prod --config=cloudbuild.yaml --substitutions=_IMAGE_URI=asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:5a5dc0c9ee9a65adb71e2194f3bccaaf3371e3f6 .` — builds the tip of the full seven-commit range in one image (since `5a5dc0c9` sits on top of all of it).
4. **Migration execution:** `gcloud run jobs update goms-migrate --project=goms-prod --region=asia-south1 --image=...:5a5dc0c9...` then `gcloud run jobs execute goms-migrate --project=goms-prod --region=asia-south1 --wait` — applies `1788200000000_sales-postings-gm-override.sql` (still the only pending migration; confirm the job completes before the next step).
5. **Backend deployment:** `gcloud run deploy goms-api --project=goms-prod --region=asia-south1 --image=...:5a5dc0c9...`. Confirm the new revision is `Ready` at 100% traffic.
6. **Frontend deployment:** `npm run build` with the same prod `VITE_API_BASE_URL=https://goms-prod.web.app` / `VITE_FIREBASE_*` values used for the 2026-09-07 12:37 live release, then `npx firebase-tools deploy --only hosting --project goms-prod`.
7. **Pre-deploy smoke tests:** already run this session and in the Item 2 UI-fix work — `npx tsc -b` clean; root unit suite 392/392; component suite 363/366 (only the pre-existing, unrelated `TimelineEventDialog` flake); live-verified in the running app (State→District→City→STD auto-fill, Landline vs. Mobile rows, save + reload persistence, read-only display). Recommend one more `npm run build` immediately before step 3 as a final sanity check, since it hasn't been run in this exact session.
8. **Post-deploy 15-item verification:** click through all 15 items against `https://goms-prod.web.app`, per the enhancement plan's per-phase acceptance criteria — this repo's own convention keeps full click-through E2E post-deploy since local DB has no seed data. Specifically re-verify Item 2 end-to-end against prod data: pick a real department, confirm State→District→City is select-only, STD auto-fills and stays editable, and a Mobile row shows only `+91` + 10 digits with no STD field.
9. **Rollback procedure:**
   - Frontend: restore the 2026-09-07 12:37 Hosting release (`firebase hosting:clone` to the prior release id, or re-deploy from the prior commit).
   - Backend: `gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 --to-revisions=goms-api-00018-qrk=100` — instant traffic rollback, no need to delete the new revision.
   - Migration: `1788200000000`'s down-migration (`DROP COLUMN gm_override_id`) is safe to run only if no `gm_override_id` values have been written yet; since it's nullable and additive, leaving it in place while rolling back service traffic is the lower-risk default (the old code never references the new column).

## GO / NO-GO

**GO** — for pushing and promoting the full seven-commit line (only `5a5dc0c9` actually needs pushing; the other six are already on `origin/main` and CI-verified from earlier in this session). The Item 2 dataset (202/15/15/173) and the Item 2 UI fix are both confirmed present and correctly layered, Item 1's migration remains the only new one, no unrelated WIP is present in any of the seven commits, and the only cross-commit file overlaps are strictly sequential with no ordering risk.

**Exact commit/range to push:** `git push origin main`, which will push `5a5dc0c9` (range `54095b7d..5a5dc0c9`). Nothing else needs pushing — it's already there.

Awaiting your explicit approval before running step 1.
