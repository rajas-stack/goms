# goms-prod Bid Tracker release record (2026-09-30 → 2026-10-01)

Two production releases, both built from a clean `git archive`/worktree of the exact commit, deployed directly
(Cloud Build, `gcloud run`, Firebase Hosting) — no GitLab push, no CI.

## Release 2 (current): `8342c14a94a8df910fd310604e8369bdf6079098`
Create Bid resolves the opportunity's department (server-enforced), plus popover re-render fix.

| Item | Value |
|---|---|
| Migration | `1789600000000_opportunities-department-optional` (drops `NOT NULL` on `opportunities.department_id`). 27 → **28** applied. Verified: recorded, `department_id` nullable, opportunity/bid counts unchanged (1 / 1). |
| API image | `goms-api:8342c14a94a8df910fd310604e8369bdf6079098` (digest `sha256:33873df99677…b7b2`) |
| API revision | **`goms-api-00044-nuq`** — 100% in both `spec.traffic` and `status.traffic` |
| Frontend | Firebase Hosting release **`d5d0063103ea8839`** (2026-10-01T04:55:48Z), prod Firebase config, `VITE_BID_TRACKER_ENABLED=true`, zero goms-dev refs |
| Env/auth | identical to the previous revision (`AUTH_ENFORCEMENT_ENABLED`, `READ_AUTH_ENFORCEMENT_ENABLED`, `ATTACHMENTS_BUCKET`, SA, VPC) |

### Rollback targets (Release 2)
- API: `gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 --to-revisions=goms-api-00042-boz=100`
- Frontend: Hosting release **`a941bd32e8f7bbc9`** (re-release that version in the Firebase console, or `firebase hosting:clone`).
- Database: the migration is a constraint relaxation, so the previous API/frontend run unchanged on it — **no DB rollback is needed to roll the app back**. Reverting the column to `NOT NULL` (`node-pg-migrate down`, one step) only succeeds while no opportunity has a NULL department; do not run it casually.
- Backups: on-demand `1790772694358` (taken before Release 1's migrations); daily automated backups + 7-day PITR.

### Verification status
- **Verified against production:** migration state read-only before and after; existing opportunity/bid unchanged; candidate API health + DB connectivity + auth flags + procedures present (`bids.create` behind the auth gate); traffic spec/status; Bid Tracker loads real data with the existing bid intact; an opportunity with a department auto-shows Department / Major Department in Create Bid.
- **Covered by tests, NOT independently exercised against production** (deliberately — no temporary production data was created): clicking through Create Bid to the new bid and navigation; duplicate-bid rejection in the browser; the Opportunity-card Create Bid flow; the "select existing department" and "create department hierarchy" paths; atomic rollback on failure. Covered by 12 API integration tests (`bidCreateDepartment.test.ts`, real Postgres), the dialog component tests, and the earlier dev end-to-end run of the previous build (`970ba99c`). **The new department workflow itself was not run in a dev browser.**
- No department-less opportunity exists in production, so the new branch is dormant there until one does.

## Release 1: `33c315e31d9d5e05eacab23ccd73f1e6814f38d2`
Bid Tracker module, photo fix, posting dates, attachment infrastructure.

| Item | Value |
|---|---|
| Terraform (prod), applied scoped (`-target`) | `ATTACHMENTS_BUCKET` on goms-api; runtime SA `roles/iam.serviceAccountTokenCreator` on itself (signing); attachments bucket CORS (`goms-prod.web.app`, `goms-prod.firebaseapp.com`) + 1-day delete of `bid-tracker/_pending/`. 1 add / 2 change / 0 destroy. **Not applied:** 5 monitoring resources (placeholder hostname/channels). |
| Migrations | 12: `1788400000000` … `1789500000000` (15 → 27). Schema-only; all 22 pre-existing tables identical in row count and content hash before/after; added columns `opportunities.city`, `commercial_boqs.opportunity_id`. |
| API | `goms-api-00042-boz` (previous: `goms-api-00038-kig`) |
| Frontend | Hosting release `a941bd32e8f7bbc9` (previous: `57957fb03f99b8f3`) |

## Housekeeping
- `goms-migrate` job image now `goms-api:8342c14a…` (kept in lockstep with the service). `infra/prod/cloudrun.tf` still pins the older job/service image tags — reconcile before the next `terraform apply` there.
- Candidate tag `candidate` still points at the live revision; remove with `--remove-tags=candidate` when convenient.
- Local-only (not pushed): branch `feat/bid-tracker`. `scripts/dev/cleanup-zbt-smoke.js` is dev-only and was never run in production.
