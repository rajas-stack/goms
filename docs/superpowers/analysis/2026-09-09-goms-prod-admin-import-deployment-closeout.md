# goms-prod Admin Import deployment closeout (2026-09-09)

## Confirmed Cloud Run deployment rule for goms-prod

`goms-api` (goms-prod) uses **explicit named-revision traffic pinning**, not
`latestRevision: true` auto-routing. Confirmed by reading the actual audit-log
request payload of a plain `gcloud run deploy --image=...` call: the request's
own `spec.traffic` field explicitly read
`[{percent: 100, revisionName: "<previous-revision>"}]` — gcloud preserved the
existing pinned name rather than pointing at the newly created revision. This
is not Terraform-managed (`infra/prod/cloudrun.tf`'s `google_cloud_run_v2_service.goms_api`
declares no `traffic {}` block) and not caused by `--no-traffic`, `--tag`, or
Firebase Hosting's rewrite (which simply forwards to whichever revision the
service's own traffic split already resolves to). It is this project's
established, historical pattern — every prior prod promotion required the
same explicit follow-up step (see this file's own prior comment referencing
`goms-api-00016-kkd`).

**Practical consequence:** a bare `gcloud run deploy` to goms-prod's `goms-api`
service creates a healthy new revision but does **not** go live on its own.

**Rule — every future goms-prod deployment must:**
1. Deploy the candidate revision (`gcloud run deploy ... --image=<image>`, optionally `--no-traffic --tag=candidate` to test before any cutover).
2. Verify `Ready=True` on the new revision (`gcloud run revisions describe <rev> --format="value(status.conditions)"`).
3. Explicitly run `gcloud run services update-traffic goms-api --to-revisions=<new>=100`.
4. Verify **both** `spec.traffic` and `status.traffic` show 100% on the new revision (`gcloud run services describe goms-api --format="yaml(spec.traffic,status.traffic)"`) — a bare summary line from the deploy command is not sufficient evidence of a live rollout.
5. Retain the previous revision (do not delete it) as the rollback target — rollback is exactly the same `update-traffic` command pointed at the old revision name.

## Final production state (Admin Data Import release)

| Item | Value |
|---|---|
| Live revision | `goms-api-00021-4gx` |
| Image digest | `sha256:2eeef901484e4935403fd4b483cbe7221c697797323292673bfe46b6ed90d0d2` |
| Traffic | 100% on `goms-api-00021-4gx` (spec and status both confirmed) |
| Admin Import | `ADMIN_IMPORT_ENABLED=true` |
| Allow-list | `rajas@amnex.com,rajassaji9@gmail.com,shubham16@amnex.com` |
| `AUTH_ENFORCEMENT_ENABLED` | `true` (unchanged from pre-release) |
| `EMERGENCY_READ_ONLY` | `false` (unchanged) |
| `FIREBASE_PROJECT_ID` | `goms-prod` (unchanged) |
| 15-item enhancement release | Live — `be946d6c`/`54cba4ca` confirmed as ancestors of the deployed commit |
| Item 1 migration | Applied — last `goms-migrate` execution completed successfully 2026-09-08T11:26:11Z; this release added no new migration |
| Firebase Hosting | Live at `https://goms-prod.web.app`, built with `VITE_ADMIN_IMPORT_ENABLED=true`, existing prod Firebase Auth/API config preserved exactly |

## Git state

- `origin/main`: `724dce2a589d015c6050e2dcef311f749991989e`
- Local-only, unpushed, on top of origin/main:
  - `e55d4b6a` — `fix(build): anchor the src ignore pattern in .gcloudignore/.dockerignore`
  - `e27132ca` — `fix(admin-import): case-insensitive enums, cascade-reject on failed references, header-row auto-detection` (deployed to goms-prod as-is, verified via `git archive`-based Cloud Build)
- Neither pushed. No GitLab CI triggered at any point in this release.

## Remaining risks

1. **Silent-non-rollout risk** — any future bare `gcloud run deploy` to this service will not go live without the explicit `update-traffic` step above; easy to mistake for a completed release without checking `status.traffic`.
2. **QA cleanup unverified independently** — production QAIMP-* test-data cleanup was confirmed by the operator via the app's own UI; not independently re-verified by direct DB read (secret access is blocked by this environment's safety controls).
3. **Pre-existing, unrelated drift** — `infra/prod/cloudrun.tf` documents DRIFT-001 (`allUsers` → `roles/run.invoker` granted out-of-band, not Terraform-managed). Untouched by this release, noted only because it's visible in the same file.
