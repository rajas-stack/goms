# GOMS Production Checkpoint — What Remains

**Date:** 2026-08-26
**Status:** No new implementation this pass. Auth stays fully paused pending Amnex IT. This is a status checkpoint, not a plan revision — see `2026-08-26-goms-stage-b-production-readiness-plan.md` for the full detail behind each line, and `2026-08-26-goms-identity-provider-decision.md` for the auth comparison.

## Accepted and holding, unchanged

- Rate limiting (`@fastify/rate-limit`, 300/5min global + 5/min on `auth.login`) — implemented, tested, **not deployed**.
- Monitoring Terraform (`infra/dev/monitoring.tf`, `infra/prod/monitoring.tf`) — written, `validate` passes, **not applied**.
- Rollback runbook (`docs/superpowers/analysis/goms-prod-rollback-runbook.md`) — written.
- `infra/prod/*.tf` — unprovisioned skeleton, `validate` passes, **nothing applied**, `goms-prod` project doesn't exist.
- No self-managed GitLab runner created. `VITE_API_BASE_URL` unset by default. `goms-prod` not provisioned.

## What remains before production, in the order each actually blocks the next

1. **Amnex IT identity-provider decision** — blocks everything auth-related (§1 of the readiness plan): the `users` table, login screen, `protectedProcedure`/`adminProcedure`, and removing Cloud Run's `allUsers` grant. Waiting on the 6 questions in the identity decision doc.
2. **Monitoring notification recipient** (email or Slack webhook) — blocks applying `monitoring.tf` in either `goms-dev` or `goms-prod`. Terraform already refuses to `plan`/`apply` without this (`var.notification_channel_ids` has no default), so there's no risk of it silently paging nobody in the meantime.
3. **GCP production project/billing** — blocks every other prod action: `infra/prod` can't be applied, no service accounts/secrets/Cloud SQL instance can exist, without a real `goms-prod` project and linked billing account. A user-owned action (billing, org policy), not something this repo can do on its own.
4. **Production domain** — blocks Firebase Hosting's custom-domain step (§6) and the CORS allow-list's prod entry. Needs the user to own or acquire a domain; none assumed.
5. **Production data requirements** — **decided 2026-08-26: Option A's scope** (fresh production database + admin-approved reference data), per `2026-08-26-goms-production-data-strategy-decision.md`. `goms-prod` starts empty except for approved baseline/reference data (geographic/organizational hierarchy, employees/sales roster, commercial masters, SKUs/BOM/reference configuration, currencies/tax classes/approval matrix, other explicitly approved reference data) — the full `goms-dev` database is not copied over, and browser/IndexedDB data is not migrated automatically. Transactional data starts clean unless the user explicitly identifies real records that need migrating. `goms-seed-import` (dev's demo-data importer) is confirmed **not** the answer for prod. **Revised same day: the loading mechanism is a self-service Admin Data Import feature (website upload, no developer/CLI/script/SQL involvement), not a developer-run seed script.** Design: `docs/superpowers/specs/2026-08-26-goms-admin-data-import-design.md` — architecture, 11 templates, dependency order, validation pipeline, and UI flow are designed but **not implemented**. Still blocking: the feature itself needs to be built, and separately, Amnex still needs to author the actual reference data to upload through it once it exists. Nothing provisioned or seeded.
6. **Production deployment trigger** — blocks `infra/prod/wif.tf`'s `attribute_condition` and the `.gitlab-ci.yml` `deploy-prod` stage: same `main` branch as dev with a `when: manual` gate, or a separate ref/tag? Also blocked in practice by exhausted shared-runner minutes (`.gitlab-ci.yml` isn't being touched until that's resolved, per standing instruction).
7. **Final security review** — a dedicated pass once auth (§1) is actually implemented, not before — auth code is exactly the kind of change that needs its own review, not a rubber stamp on the rest of Stage B.
8. **Final browser/E2E production rehearsal** — validate `goms-prod` end-to-end (including a rollback-command rehearsal) under a temporary hostname, before any DNS cutover. Depends on 1, 3, 4, and 6 all landing first — this is the last gate, not an independent one.

## Rule for this checkpoint

Nothing above gets started until its own blocking decision lands — in particular, no auth code, no `terraform apply` against `goms-prod` or the monitoring resources, no `.gitlab-ci.yml` changes, no domain/DNS action. **Stopping here. Waiting on the Amnex IT response (item 1) before any further action.**
