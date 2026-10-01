# GOMS Production — Terraform Reconciliation + admin_import_runs Investigation

**Date:** 2026-09-04
**Status:** Investigation and Terraform-file correction only. Nothing applied to `goms-prod`
infrastructure, nothing modified in `goms-prod`'s database. `terraform plan` was run read-only
(twice); neither plan was applied.

---

## 1. `infra/prod` Terraform reconciliation

**Problem:** the committed `infra/prod/cloudrun.tf` still described a `:bootstrap` placeholder
image and never declared the live scaling config, so a fresh `terraform plan` proposed rolling
both `goms-api` and `goms-migrate` back to `:bootstrap` and dropping the live
`max_instance_count=10` ceiling — unsafe if ever applied.

**Fix (commit `72e3a1c6`):** pinned both resources' `image` to the commit-SHA tag confirmed
actually running live (`54a7d6ab3af64b7ee186db77f1f86cf827b5c20e`, verified via
`gcloud run services describe`/`gcloud run jobs describe`), and added the `scaling` blocks matching
live reality exactly (service-level `scaling_mode = "AUTOMATIC"`, `manual_instance_count = 0`;
template-level `min_instance_count = 0`, `max_instance_count = 10`, confirmed via the
`run.googleapis.com/scalingMode`/`autoscaling.knative.dev/maxScale` annotations on the live
resource). Did **not** touch `ADMIN_IMPORT_ENABLED` (confirmed absent both before and after), did
**not** add any monitoring resource or IAM binding.

**Fresh `terraform plan` after the fix** (full, unscoped):
```
Plan: 5 to add, 1 to change, 0 to destroy.
```
- The 1 change to `google_cloud_run_v2_service.goms_api` is **only** the `client`/`client_version`
  provenance metadata (`"gcloud" -> null`) — a cosmetic annotation Terraform tracks about which
  tool last touched the resource, not a functional config value. Confirmed via `terraform show`
  that every other attribute and all 3 blocks (containers, both `scaling` blocks, `vpc_access`) are
  listed as **unchanged**.
- `google_cloud_run_v2_job.goms_migrate` no longer appears in the plan at all — it now matches live
  exactly.
- The 5 "to add" are the long-committed, never-applied Stage B monitoring resources
  (`google_monitoring_uptime_check_config.goms_api_health` + 4 `google_monitoring_alert_policy`
  resources), which still depend on `var.api_hostname`/`var.notification_channel_ids` —
  `terraform.tfvars` still holds placeholder values for both (`api_hostname` literally
  `"PLACEHOLDER-not-yet-created.run.app"`), and no business decision has been made on
  `notification_channel_ids` (who/what gets paged). This Terraform version (1.9.8) does not support
  `-exclude` (only added in later Terraform releases), so a full `plan` cannot omit them by flag —
  they are correctly reported here, not applied, and not part of the release-readiness scope.

**Scoped plan, real resources only** (`-target=google_cloud_run_v2_service.goms_api
-target=google_cloud_run_v2_job.goms_migrate`):
```
Plan: 0 to add, 1 to change, 0 to destroy.
```
This is the plan that reflects **0 unsafe rollbacks and 0 placeholder values** — the single change
is the same harmless metadata field. **Not applied** (nothing should be deployed to `goms-prod`
without explicit approval, and this plan still isn't the release-candidate promotion itself — that
requires bumping the image tag to the approved SHA, a separate, explicitly-approved step).

**The 5 monitoring resources remain deliberately out of scope** — applying them requires the user
to first supply a real `api_hostname` (the live Cloud Run/Firebase Hosting hostname now exists and
could be filled in) and decide `notification_channel_ids` (email vs. Slack, who gets paged). Until
then, any `terraform apply` in `infra/prod` should explicitly target only the two real resources
above, not the full plan.

---

## 2. `admin_import_runs` investigation — the two 2026-09-01 sessions (read-only)

**Method:** read-only Postgres queries via a one-off `goms-migrate` Cloud Run Job execution
override (same established, user-approved technique as every other prod DB check this project has
used) — zero writes. Cross-referenced against Cloud Run's own HTTP request logs (Cloud Logging) for
the same time window. **No record was deleted, edited, or rolled back as part of this
investigation.**

### Exact timestamps and domains

There are actually **4 `admin_import_runs` rows across 2 sessions**, both dated 2026-09-01 (UTC):

| Session ID | Committed at | Domain | Summary |
|---|---|---|---|
| `d4e576ad-9576-41bc-981f-c4fe9c50b884` | 2026-09-01T05:50:52.512Z | `taxClasses` | 1 row, created |
| `d4e576ad-9576-41bc-981f-c4fe9c50b884` | 2026-09-01T05:50:52.512Z | `currencies` | 1 row, created |
| `054644e5-a57d-4fe3-9e67-cad32fa2cd44` | 2026-09-01T05:52:48.510Z | `organizationHierarchy` | 1 row, created |
| `054644e5-a57d-4fe3-9e67-cad32fa2cd44` | 2026-09-01T05:52:48.510Z | `employees` | 1 row, created |

### Actor / identity information

**None recorded in the database.** The `actor_email` column did not exist on `admin_import_runs`
until the migration applied earlier in this session (2026-09-04) — these rows predate it entirely,
and `goms-prod` has never had any authentication in front of `adminImport.*` (the Firebase
Google Sign-In work was explicitly scoped to `goms-dev` only). No application-level identity exists
for these commits.

**Infrastructure-level trace (Cloud Run request logs):** every request in both sessions' windows
originated from Google-owned IP ranges — `66.249.82.0/24` and `192.178.14.0/24` — using the user
agent `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
HeadlessChrome/148.0.7778.96 Safari/537.36`. This is a plain headless-Chrome signature with **no**
`Googlebot` identifier (real Googlebot self-identifies in its UA string), so this is not Google's
web crawler — it is far more consistent with an automated browser-driven tool (e.g. Playwright,
which this project already uses extensively for its own E2E verification) run from a Google
Cloud–hosted environment (Cloud Shell, Cloud Workstations, or similar egress a Google-owned range).
**This could not be conclusively attributed to a specific person** — only its infrastructure
fingerprint could be recovered.

### Affected records and identifiers

| Table | Business key | Name | Created | Still present? |
|---|---|---|---|---|
| `hierarchy_nodes` | `ZVERIFY-UNIT` | "Import Verification Unit" (type: unit) | 2026-09-01T05:52:48.510Z | **Yes** |
| `commercial_masters` (taxClasses) | `ZVERIFY-TAX` | "Import Verification Tax Class" | 2026-09-01T05:50:52.512Z | **Yes** |
| `commercial_masters` (currencies) | `ZVT` | "Import Verification Currency" | 2026-09-01T05:50:52.512Z | **Yes** |
| `employees` | (id `5ee58904-217a-4025-b38d-a7f1adeb6900`) | — | 2026-09-01T05:52:48.510Z | **No — deleted** |

The created employee record does not exist in the `employees` table today. Cloud Run request logs
show it was viewed/navigated repeatedly for the following ~17 minutes (hierarchy, reporting chain,
timeline, transfers, follow-ups — a full detail-view walkthrough), then explicitly removed via
`POST /api/trpc/employees.delete` at **2026-09-01T06:09:35.768Z** (HTTP 200), from the same
Google-owned IP range.

### Assessment: legitimate testing vs. unauthorized activity

**Strong circumstantial evidence points to deliberate, self-conducted verification testing, not
unauthorized exploitation** — but it cannot be proven with certainty, since no identity was ever
captured:

- Every surviving record is explicitly self-labeled `"Import Verification..."` / `ZVERIFY-*` / `ZVT`
  — naming chosen to make it obviously a test artifact, not something an attacker planting real
  fraudulent data would do.
- The one record type not left behind (the employee) was created, thoroughly inspected through the
  app's normal detail views, and then explicitly deleted — a clean create-verify-cleanup cycle,
  matching this project's own well-established testing discipline (e.g. the equivalent `AUTHVERIFY`
  tax-class row created and deleted during `goms-dev`'s auth verification, per prior session notes).
- Scale is minimal and non-destructive: exactly 1 row per domain, all `toCreate`, zero `toUpdate`/
  `rejected` — nothing resembling a bulk or destructive write.
- The surrounding ~17 minutes of traffic reads as an organic, broad walkthrough of the whole live
  app (hierarchy, employees, sales roster, opportunities, follow-ups) rather than a narrow,
  targeted attack against just the import endpoints.
- The source IPs being Google-owned ranges (not a residential/hosting-provider range typical of
  opportunistic scanning) combined with a bare headless-Chrome UA is consistent with an automated
  test tool run from Google Cloud infrastructure, which fits this project's own tooling pattern.

**What remains genuinely unconfirmed:** exactly who ran this, and from precisely what environment —
this session cannot prove authorization, only that the pattern strongly resembles it. Recommend
confirming directly with whoever had prod access on 2026-09-01 whether they ran a Playwright/manual
verification pass against `goms-prod`'s live API that morning.

**Cleanup recommendation (not performed — read-only investigation only):** the 3 surviving
`ZVERIFY-UNIT`/`ZVERIFY-TAX`/`ZVT` records are harmless but are test data sitting in production
reference tables. Removing them is a straightforward follow-up once explicitly approved — not done
here per the investigation's read-only constraint.
