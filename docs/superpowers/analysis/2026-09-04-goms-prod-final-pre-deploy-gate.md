# GOMS Production — Final Pre-Deploy Gate

**Date:** 2026-09-04
**Status:** Cleanup, migrations, and Terraform plan complete. **Nothing deployed to the live
`goms-api` Cloud Run service.** Awaiting explicit approval before the application deployment step.

---

## 1. Test-data cleanup — done and verified

Read-only query confirmed the exact 3 records (IDs below), zero dependents anywhere (no hierarchy
children, no employees/transfers/opportunities/BOQs/SKUs referencing them). Deleted via a single
guarded transaction (`DELETE ... WHERE id=$1 AND code=$2`, rolled back if any statement didn't
affect exactly 1 row):

| Table | ID | Code | Name |
|---|---|---|---|
| `hierarchy_nodes` | `7686a695-17bc-4311-8699-5d649466e21e` | `ZVERIFY-UNIT` | Import Verification Unit |
| `commercial_masters` | `ff304d34-de6d-4f84-b754-63fd3ae3dd8b` | `ZVERIFY-TAX` | Import Verification Tax Class |
| `commercial_masters` | `36a512a2-db86-47f3-b051-a3c0d612a789` | `ZVT` | Import Verification Currency |

**Verified after deletion:** both codes return 0 rows; `hierarchy_nodes` count dropped by exactly 1
(7253 → 7252); all 16 `admin_import_runs` audit rows — including the two 2026-09-01 sessions that
created these records — are unchanged, untouched, not deleted or edited.

---

## 2. Application release SHA

**`b8b187059dbe828895971e0214a2fb4a1842f514`**

- Built and pushed to `asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:b8b187059dbe828895971e0214a2fb4a1842f514`
  (local Docker build from a clean worktree at this exact commit — no uncommitted WIP included).
- **Not yet deployed** to the live `goms-api` Cloud Run service, which still runs
  `54a7d6ab3af64b7ee186db77f1f86cf827b5c20e` at 100% traffic (revision `goms-api-00014-shs`).
- This commit is local `main`, **not yet pushed to `origin/main`** (3 commits ahead:
  `9c41dc4f`, `b8b18705`, `72e3a1c6`) — worth pushing for source-of-truth hygiene, independent of
  the deployment decision.

## 3. Infrastructure commit

**`72e3a1c666a6166be552fc51f4efb14bf147461f`** — reconciles `infra/prod/cloudrun.tf` with the real
live config (image tag, scaling blocks). Also local-only, not pushed to `origin/main` (see above).

---

## 4. Migrations — applied and verified

Exactly 2 were pending (confirmed against `pgmigrations` before touching anything); both are purely
additive nullable `ALTER TABLE ADD COLUMN`, zero duplicate-key/data risk:

- `1788000000000_admin-import-actor-email` — `admin_import_runs.actor_email text`
- `1788100000000_timeline-events-agenda-outcome-nextsteps` — `timeline_events.agenda/outcome/next_steps text`

**Wrinkle found and resolved:** `goms-migrate`'s image (`54a7d6ab`) predates both migration files, so
the job's default `up` reported "No migrations to run!" — not because they were already applied, but
because it couldn't see them. Fixed by temporarily pointing `goms-migrate` (only the job, never the
`goms-api` service) at the new `b8b18705` image, running `up` (both migrations applied, logged SQL
confirms it), then reverting the job's image back to `54a7d6ab` to match today's committed Terraform
exactly. Confirmed post-revert: job image is `54a7d6ab` again; live `goms-api` service was never
touched (still `goms-api-00014-shs`, 100% traffic, `54a7d6ab`, throughout).

**Verified:** `pgmigrations` now lists all 13 migration files with none missing; `actor_email` and
`agenda`/`outcome`/`next_steps` columns exist in `information_schema.columns`.

---

## 5. Final Terraform plan — not applied

Fresh `terraform plan` (full, unscoped): **5 to add, 2 to change, 0 to destroy.**

- The 2 changes (`google_cloud_run_v2_service.goms_api`, `google_cloud_run_v2_job.goms_migrate`) are
  **only** the `client`/`client_version` provenance metadata (`"gcloud" -> null`) — cosmetic,
  confirmed via the plan JSON that every functional attribute (image, env, scaling, vpc_access) is
  unchanged. (This job now shows 2 changes instead of the 2026-09-04 investigation's 1, because
  today's temporary image swap+revert on `goms-migrate` touched its own provenance metadata the same
  way — the underlying image is still exactly `54a7d6ab`, matching committed state.)
- The 5 "to add" are the long-committed Stage B monitoring resources, still blocked on real
  `api_hostname`/`notification_channel_ids` values — **out of scope for this release, not applied.**

**Scoped plan** (`-target` on just the 2 real resources): **0 to add, 2 to change, 0 to destroy.**

**Checklist confirmed directly from the plan JSON:**
- ✅ No image rollback — both `goms_api` and `goms_migrate` show `image =
  "...goms-api:54a7d6ab3af64b7ee186db77f1f86cf827b5c20e"` in the planned "after" state.
- ✅ No `:bootstrap` placeholder anywhere.
- ✅ Scaling: service-level `scaling_mode="AUTOMATIC"`, `min_instance_count=0`; template-level
  `min_instance_count=0`, `max_instance_count=10`.
- ✅ `ADMIN_IMPORT_ENABLED` absent from the planned env list (only `DATABASE_URL`, `TRUST_PROXY`).
- ✅ No monitoring placeholders being applied — the 5 monitoring resources appear only in the
  unscoped plan's "to add" list, not in the scoped real-resource plan.

No stray diff or `tfplan` file left in `infra/prod` — confirmed clean via `git status`.

---

## 6. Admin Import — confirmed disabled

- `ADMIN_IMPORT_ENABLED` unset on the live `goms-api` service today, and absent from both the
  committed Terraform config and this plan's output — will **stay** unset through this release.
- No production Firebase Authentication for Admin Import was configured or enabled in this session.
- The code being promoted (`b8b18705`) fails closed (`UNAUTHORIZED`) with no `FIREBASE_PROJECT_ID`
  configured, and the flag gates everything upstream anyway — safe to ship dark.

---

## 7. Monitoring — confirmed out of scope

The 5 Stage B monitoring resources are not part of this release's plan and were not applied. They
remain committed-but-unapplied pending real `notification_channel_ids` and `api_hostname` values —
a separate, future infrastructure change, per your instruction.

---

## 8. What's left to actually deploy (nothing has happened here yet)

Per the established sequence (Aug 31 safety report §5, unchanged in shape):

1. Update the live `goms-api` Cloud Run service to the `b8b18705` image (already built and pushed —
   this step is `gcloud run services update`/`deploy` or a Terraform apply of just that resource,
   **not yet run**).
2. Deploy the matching frontend build to `goms-prod` Firebase Hosting (not yet built or deployed).
3. Smoke-test (see §9).
4. `terraform apply -target=...` on just the 2 real resources afterward, to reconcile state (image
   tag is already correct in the committed file per `72e3a1c6`; this apply would just clear the
   cosmetic provenance-metadata diff).

## 9. Production smoke-test plan (to run immediately after the service/frontend deploy, before
   declaring the release done)

1. `curl https://goms-api-2vhbzi24iq-el.a.run.app/api/trpc/adminImport.listDomains` → expect `404
   {"code":"NOT_FOUND"}` (flag still off — confirms nothing about Admin Import went live).
2. Ordinary CRUD smoke pass against the real frontend (`https://goms-prod.web.app`):
   - Hierarchy: load org tree, open a department, confirm no `ZVERIFY-UNIT`/`ZVERIFY-TAX`/`ZVT`
     remnants anywhere in pickers/dropdowns.
   - Employees: list loads, open one employee's detail/timeline view (exercises the new
     `agenda`/`outcome`/`next_steps` columns without erroring).
   - Sales roster / opportunities: list loads, open one record.
   - Commercial Calculator: open Tax Classes and Currencies masters, confirm the deleted test rows
     are gone and no real currency/tax class is missing.
3. Confirm `/admin/data-import` route is absent/inert in the deployed frontend (no
   `VITE_ADMIN_IMPORT_ENABLED` baked in).
4. Tail Cloud Run request logs for ~5 minutes post-deploy watching for a spike in 5xx responses.

## 10. Rollback plan

- **Application:** Cloud Run traffic-shift back to `goms-api-00014-shs` (current live revision,
  image `54a7d6ab`) — instant, no migration rollback needed, per the existing rollback runbook
  (`docs/superpowers/analysis/goms-prod-rollback-runbook.md`).
- **Frontend:** Firebase Hosting rollback to the previous release via `firebase hosting:rollback` or
  the console's release history.
- **Database:** both migrations applied today are purely additive nullable columns — no down-
  migration is needed even if the release is rolled back; they can stay applied safely regardless of
  which `goms-api` revision is serving traffic.
- **Test-data cleanup (§1):** not reversible via rollback (real `DELETE`s), but the rows were inert
  test artifacts with zero dependents — no functional impact either direction.

---

## Awaiting your explicit approval before step 8 (the actual `goms-api`/frontend deployment) runs.
