# Production Readiness — No-CI Work Complete

**Date:** 2026-08-26
**Scope:** Everything that could safely be implemented, tested, documented, or prepared locally/manually without GitLab CI runner capacity, the Amnex IT identity-provider answer, a real `goms-prod` project, or a production domain — per the working instruction to push Stage B forward on every unblocked front. Nothing in this pass touches `.gitlab-ci.yml`, provisions `goms-prod`, implements authentication, or deploys anything.

**Everything that can safely be made production-ready without CI capacity, production infrastructure, or the unresolved identity decision has been completed.**

---

## 1. What was implemented this pass

- **Error message sanitization (new fix, tested).** `apps/api/src/trpc.ts` now has an `errorFormatter` that replaces any `INTERNAL_SERVER_ERROR`'s client-visible message with a generic string — closing a real gap where raw `pg` driver error text (able to name internal hosts/constraints/columns) could reach the client. `apps/api/src/app.ts`'s `onError` hook logs the real error server-side first. 2 new regression tests confirm the sanitized case and confirm deliberate `BAD_REQUEST`/`NOT_FOUND`/`CONFLICT` messages stay untouched. Full writeup: `2026-08-26-goms-production-security-audit.md`.
- **`apps/api`'s own build, fixed.** `npm --workspace apps/api run build` (`tsc -p tsconfig.json`) was failing before this pass — two implicit-`any`/missing-DOM-type errors, one pre-existing (a test helper), one introduced by the errorFormatter fix itself. Both fixed with explicit types; no `"dom"` lib added to the Node-only backend tsconfig. This was never part of any prior gate (root `tsc -b` doesn't cover `apps/api` at all) — it is now verified clean directly.
- **Firebase Hosting config, prepared not deployed.** New `firebase.json` (SPA fallback via catch-all rewrite to `/index.html`, `/api/**` rewrite to `goms-api` Cloud Run in `asia-south1`, cache headers) and `.firebaserc.example` (real `.firebaserc` stays gitignored — it would name a real project ID that doesn't exist yet). This is the first real artifact for Stage B §6, previously plan-only.
- **Environment variable documentation.** New `.env.example` (root, `VITE_API_BASE_URL`) and `apps/api/.env.example` (`DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, `PORT`) — the audit found the `.gitignore` already carved out an exception for a committed `.env.example` but none existed. Both now document the exact variable, its default/fallback behavior, and example values per environment.
- **Backup/Restore remote-mode regression tests (new — none existed before).** 3 new component test files, 6 tests total: `src/features/settings/SettingsDialog.test.tsx` (Backup/Restore hidden with remote-mode explanation when `VITE_API_BASE_URL` is set, fully present when unset), `src/components/TopBar.test.tsx` ("Connected to goms-dev" badge shown/hidden correctly), `src/main.test.tsx` (local IndexedDB bootstrap skipped in remote mode, runs in local mode). Previously this behavior was verified only by a one-off manual Playwright session, not a committed automated test.
- **Rollback runbook polished.** `goms-prod-rollback-runbook.md` gained two new sections that were the only gaps against the requested checklist: **§0 Pre-cutover checks** (what to verify before a production deploy, and separately before the first-ever DNS cutover) and **§3 Post-rollback verification** (confirming a rollback actually worked — uptime check, traffic-split confirmation, a write-path smoke test, re-verification after any migration action, and recording what happened). Everything else requested (Cloud Run rollback, last-known-good identification, migration assessment, expand/contract rule, down-migration vs. PITR, IAM roles, exact commands) was already present from prior work.
- **Production data strategy decision document (new).** `2026-08-26-goms-production-data-strategy-decision.md` — Option A (fresh DB + approved reference data) vs. Option B (migrate real existing data), grounded in the concrete fact that **GOMS had no shared backend before Stage A** — any "real existing data" lives only in individual browsers' local IndexedDB, exportable today via the already-built Backup/Restore JSON format. No production data is invented or assumed; the document lays out mechanics for both options and the exact questions only the user can answer.
- **Production security readiness document (new).** `2026-08-26-goms-production-security-readiness.md` — the precise per-router, per-procedure map of what becomes `protectedProcedure` vs. `adminProcedure` (exactly 4 procedures, all under `commercial.masters`, are admin-only — everything else is "logged in" level), the migration order, where `createdBy`/`changedBy` will be populated from, exactly where the Cloud Run `allUsers` grant lives per environment (dev has it and must lose it once auth ships; prod never had it), and the 5 concrete frontend integration points for a future login screen.
- **Terraform formatting fixed.** `terraform fmt -check` found real (if cosmetic) misalignment in `infra/dev/database.tf`, `infra/dev/wif.tf`, `infra/prod/database.tf`, `infra/prod/wif.tf` — fixed via `terraform fmt`, no resource attributes changed, both directories now `fmt`-clean.
- **`infra/dev/README.md` and `infra/prod/README.md` (new).** Each consolidates its directory's scattered header-comment documentation into one place: exactly what's already applied vs. pending, the full ordered prerequisite list before `apply` can run, and the exact commands to run once prerequisites are met.
- **Full remote-mode regression re-run against live `goms-dev`.** All 9 requested screens (Home, StateWorkspace, Directory, Meetings, SalesWorkspace, Commercial Calculator, Relationship Analytics, Command Palette, Settings) verified via headless Playwright: zero console/page errors, zero failed requests, remote-mode badge correct on every screen, Settings' Backup/Restore correctly hidden. A real CRUD round-trip (create + delete a department) was verified against the live backend via independent `fetch` checks and left no residue. Local (default) mode re-verified separately in a fresh browser context: no remote badge, Backup/Restore fully functional, real local seed data. `.env.local` and the repo were confirmed restored to their pre-test state afterward.

## 2. What was already done before this pass (verified, not re-done)

- **Rate limiting** — `@fastify/rate-limit`, 300/5min global (no login-specific limit, correctly, since `auth.login` doesn't exist yet). 5 pre-existing tests plus the 2 new error-sanitization tests, all passing.
- **Monitoring Terraform** — `infra/dev/monitoring.tf` and `infra/prod/monitoring.tf`, uptime check + 4 alert policies each (API down, Cloud SQL CPU/storage/connections), both requiring `notification_channel_ids` with no default so `apply` fails explicitly rather than silently paging nobody.
- **`infra/prod/*.tf` skeleton** — all 7 files mirroring `infra/dev`'s shape, 2 deliberate deviations (no `goms-seed-import`, no `allUsers` grant) both explicitly flagged in-file for the user to confirm or override.
- **Rollback runbook's core content** (§1-§2, IAM section) — Cloud Run rollback commands, migration decision tree, expand/contract rule, IAM roles required.
- **Stage B production-readiness plan and identity-provider decision document** — the full auth/rate-limiting/monitoring/hosting/prod-environment plan, and the Option A/B identity comparison, both already written and unchanged by this pass.

## 3. Full testing gate — all green

| Gate | Result |
|---|---|
| `apps/api` tests (`npm --workspace apps/api run test`, temp Docker Postgres) | **149/149 passed** (147 pre-existing + 2 new) |
| Root unit tests (`npm test`) | **247/247 passed** |
| Component tests (`npm run test:component`) | **132/132 passed** (126 pre-existing + 6 new) |
| Integration tests (`vitest.integration.config.ts`) | **11/11 skipped**, correctly — `VITE_API_BASE_URL` is unset by default, confirming no production endpoint is baked into a default build |
| Root `tsc -b` | Clean |
| `apps/api`'s own `tsc -p tsconfig.json` | **Clean** (was failing before this pass — now fixed and verified) |
| Production build (`npm run build`) | **Success**, built in ~2 minutes |
| `terraform validate` — `infra/dev` | Success |
| `terraform validate` — `infra/prod` | Success |
| `terraform fmt -check` — both directories | **Clean** (fixed 4 files this pass) |
| Full remote-mode + local-mode Playwright regression against live `goms-dev` | **All checks passed** (one false-positive in the test script itself, documented and independently verified as not a real issue) |

## 4. Prepared but explicitly not applied/executed

- `infra/dev/monitoring.tf` and `infra/prod/monitoring.tf` — not applied (blocked on the notification-recipient decision, §5).
- `infra/prod/*.tf` in full — not applied (`goms-prod` doesn't exist).
- `firebase.json`/`.firebaserc.example` — no `firebase deploy` run, no Firebase project linked.
- The rollback runbook's commands — none executed against any real environment.
- `.gitlab-ci.yml` — untouched, per standing instruction (shared-runner minutes still exhausted).
- No authentication code — `protectedProcedure`/`adminProcedure`/`users` table/login screen all remain unbuilt, per the paused identity decision.
- `terraform fmt`'s fixes to already-*applied* dev resources (`database.tf`, `wif.tf`) were formatting-only (no attribute values changed) but have **not been `apply`'d** — Terraform will show a clean, no-op plan next time `terraform plan` runs against dev, since nothing about the actual resources changed, only the source formatting. Confirm this with `terraform plan` before assuming it's a pure no-op in a live environment.

## 5. Every decision still required from you

In the order each actually blocks the next (unchanged from the prior checkpoint's own framing, still accurate):

1. **Amnex IT identity-provider answer** — the 6 questions in `2026-08-26-goms-identity-provider-decision.md`. Blocks all of §1 (auth) in the Stage B plan, and transitively blocks removing `goms-dev`'s `allUsers` grant.
2. **Monitoring notification recipient** (email or Slack webhook) — blocks applying `monitoring.tf` in either `goms-dev` or `goms-prod`.
3. **GCP production project/billing** — blocks every `infra/prod` action. A user-owned action (billing, org policy).
4. **Production domain** — blocks Firebase Hosting's custom-domain step and the CORS allow-list's prod entry.
5. **Production data requirements** — which of Option A/B in `2026-08-26-goms-production-data-strategy-decision.md`, and (regardless of which) the approved reference-data list (verticals, currencies, tax classes, etc.).
6. **Production deployment trigger** — same `main` branch as dev with a `when: manual` gate, or a separate ref/tag? (`infra/prod/wif.tf`'s current stance: same branch, gated by a future CI stage — confirm or override.)
7. **Final security review** — once auth (§1) is actually implemented, not before.
8. **Explicit go/no-go for the actual DNS cutover moment** — the one step with no safe automatic default, by design.

## 6. Exact commands you'll eventually need to run manually

**Once the notification recipient is decided** (create the `google_monitoring_notification_channel` resource, fill its ID into `terraform.tfvars`, then):
```bash
cd infra/dev && terraform init && terraform plan -out=tfplan && terraform apply tfplan
```

**Once `goms-prod` exists, billing is linked, and `terraform.tfvars` is filled in** (see `infra/prod/README.md` for the full prerequisite order):
```bash
cd infra/prod && terraform init && terraform plan -out=tfplan && terraform apply tfplan
```

**Once a Firebase project is linked to `goms-prod`** (`firebase projects:addfirebase goms-prod`, then copy `.firebaserc.example` to `.firebaserc` with the real project id):
```bash
npm run build
npx firebase deploy --only hosting
```

**Rollback, once `goms-prod` is live** — see `goms-prod-rollback-runbook.md` in full; the two load-bearing commands:
```bash
gcloud run revisions list --service=goms-api --project=goms-prod --region=asia-south1
gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 --to-revisions=<last-good-revision>=100
```

**Removing `goms-dev`'s `allUsers` grant, once auth ships and is verified** (edit `infra/dev/cloudrun.tf` to remove the `google_cloud_run_v2_service_iam_member` resource near L69-74, then):
```bash
cd infra/dev && terraform plan -out=tfplan && terraform apply tfplan
```

## 7. What becomes immediately executable once each blocker lands

| Once this lands... | ...these become immediately executable |
|---|---|
| Amnex IT confirms the IdP | Start Stage B plan §1 implementation: `users` table migration, `auth` router, `protectedProcedure`/`adminProcedure` middleware, router-by-router migration per `2026-08-26-goms-production-security-readiness.md`'s exact order, frontend login screen at the 5 integration points already identified |
| Monitoring recipient is provided | `terraform apply` in `infra/dev` immediately (already-live environment, `monitoring.tf` is the only gap); same in `infra/prod` once it also exists |
| `goms-prod` exists (project + billing) | `terraform apply` the entire `infra/prod/*.tf` skeleton — already internally consistent and `validate`/`fmt`-clean, reviewed against `infra/dev` file-by-file with all deviations explicitly flagged |
| Production domain is available | Firebase Hosting custom-domain step, and filling the real domain into `CORS_ALLOWED_ORIGINS`/`apps/api/.env.example`'s prod line (currently `<GOMS_PROD_DOMAIN>` placeholder) |

---

**Stopping here for review, as instructed.** No `.gitlab-ci.yml` changes, no `goms-prod` provisioning, no authentication code, no self-managed runner, no production deploy — nothing beyond what's listed above was touched.
