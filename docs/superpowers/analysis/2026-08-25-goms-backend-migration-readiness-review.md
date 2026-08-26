# GOMS Backend Migration Readiness Review (Phases 0–7)

**Purpose:** Independent ground-truth audit of the GCP backend migration before Phase 8 starts. Verified directly against source code, migrations, Terraform, CI config, and git history — plan-doc checkboxes were treated as claims to verify, not facts. No files were changed; no deploys, migrations, or cloud actions were performed as part of this review.

**Scope:** `docs/superpowers/plans/2026-08-24-goms-gcp-foundation-implementation-plan.md` (foundation + `customers`) and `docs/superpowers/plans/2026-08-25-goms-repository-domains-migration-plan.md` (Phases 1–7).

---

## Headline findings

1. **`RemoteRepository` already has 100% method-level parity with `Repository` — 114/114 methods, zero gaps.** The `implements Partial<Repository>` annotation and several code comments (`src/data/repository.ts`, `src/data/remote/repository.ts`) are stale; every domain, including ones no plan phase explicitly called "done" the same way, is fully wired. This is good news for *code* coverage — see finding 3 for why it doesn't mean cutover-ready.
2. **Phase 4 (`commercial masters`) is the one domain with no recorded live-GCP verification.** Phases 1, 2, 3, 5, 6, 7 each have an explicit "Deploy to `goms-dev` and smoke test" task with `curl` evidence against the live Cloud Run URL. Phase 4 has no `## Phase 4` section in the plan doc at all — it shipped as a single commit (`1d64492f`) and was marked "accepted" in a docs-only commit (`1e80d851`) with no equivalent smoke-test record. Locally tested (13 tests, green) but not confirmed against `goms-dev`.
3. **No seed/reference data exists in Postgres — every table is empty.** Zero `INSERT` statements across all 8 migrations, and no seed-import script exists anywhere in `apps/api` or `scripts/`. Enabling the remote backend today would show an empty geo tree, empty org chart, empty sales roster, and empty commercial catalog — not a crash, an empty app. This is the largest concrete cutover blocker, independent of code completeness.
4. **No authentication anywhere**, by deliberate design (spec §2/§15) — Cloud Run's `goms-api` grants `roles/run.invoker` to `allUsers`. Fine for a no-login dev sandbox; a real production gap once real data is involved. No rate limiting, and no infra-level monitoring/alerting/logging beyond the app's own business audit-log tables.
5. **Two non-`Repository` local-data surfaces would silently stay local even after a cutover**: Settings backup/restore (`getFullSnapshot`/`restoreFromBackup`) and app bootstrap (`bootstrapRepository`) are re-exported straight from the in-memory module regardless of `VITE_API_BASE_URL`, because they were never part of the `Repository` interface. Flipping the flag would not touch these — a real split-brain risk (export/import reflecting local IndexedDB, not the server).
6. **CI/CD deploys automatically on every push to `main`** (`test → build → deploy-dev`, no manual approval gate), using GitLab **shared** runners (no `tags:` anywhere in `.gitlab-ci.yml`) — ~100/400 monthly minutes remained as of the Phase 7 checkpoint (2026-08-25). Frontend tests never run in CI, only `apps/api`'s.
7. `VITE_API_BASE_URL` is unset everywhere today, confirmed — nothing has been cut over, matching the plan's own constraint.

---

## 1. Full migration matrix (Repository domain → methods → DB tables → router → RemoteRepository → tests → live GCP verification)

| # | Domain | Methods | DB tables | Router (procedures) | RemoteRepository | apps/api tests | Live GCP verification |
|---|---|---|---|---|---|---|---|
| 0 | Customers | 5 | `customers` | `customers` (5) | 5/5 | 6 | ✅ Foundation phase (2026-08-24) — proven pattern, deployed to `goms-dev`; hit and fixed a real deploy/migrate-ordering bug (`relation "customers" does not exist` until `goms-migrate` ran) |
| 1 | Hierarchy (geo/org) | 20 | `hierarchy_nodes` | `hierarchy` (20) | 20/20 | 19 | ✅ Task 1.6 — `curl` round-trip (`listStates`, `createNode`+`getNode`) against deployed Cloud Run URL |
| 2 | Employees + timeline + transfers | 17+5+2=24 | `employees`, `employee_charges`, `employee_merge_audit`, `timeline_events`, `transfers` | `employees` (+`.timeline`, `.transfers`) (24) | 24/24 | 11 | ✅ Task 2.8 — deploy + smoke test |
| 3 | Sales / postings | 9 | `sales_persons`, `sales_postings` | `sales` (9) | 9/9 | 12 | ✅ Task 3.6 — `curl` smoke test incl. verifying the `officialEmail` uniqueness `CONFLICT` fires for real against the deployed DB |
| 4 | Commercial masters | 8 | `commercial_masters`, `edition_features` | `commercial.masters` (8) | 8/8 | 13 | ⚠️ **No recorded live verification.** Single-commit implementation (`1d64492f`), docs-only "accepted" commit (`1e80d851`) — no `## Phase 4` plan section, no Task-4.6-equivalent, no `curl` evidence against `goms-dev` |
| 5 | Commercial SKUs + BOM | 5+5=10 | `commercial_skus`, `commercial_bom_items` | `commercial.skus`, `commercial.bom` (10) | 10/10 | 19 | ✅ Task 5.6 — deploy + smoke test, cleanup verified back to empty state |
| 6 | Commercial BOQs + line items + audit logs | 14+1=15 | `commercial_boqs`, `commercial_boq_line_items`, `commercial_boq_number_sequences`, `commercial_audit_logs` | `commercial.boq`, `commercial.auditLogs` (15) | 15/15 | 20 | ✅ Task 6.6 — deploy + smoke test |
| 7 | Ownership + opportunities + followUps + search | 8+7+5+3=23 | `ownership_assignments`, `opportunities`, `opportunity_stage_changes`, `follow_ups` | `ownership`, `opportunities`, `followUps`, `search` (23) | 23/23 | 15+7+5+14=41 | ✅ Task 7.6 — 62-assertion live smoke test + cleanup; **only phase with agent-confirmed CI green via direct GitLab API poll** (`#2788768178`) rather than a human-operator handoff |
| — | Health | — | — | `health` (1) | n/a | 1 | Implicit (every smoke test depends on it responding) |

**Totals:** 114 `Repository` methods · 114/114 implemented in `RemoteRepository` (0 gaps) · 10 domain routers + health, all registered on `appRouter` · 142 `apps/api` tests across 12 test files, all green locally (not re-run in this session — see §6) · 8 schema migrations, 0 seed rows.

---

## 2. Remaining methods/domains/data paths that exist only in-memory / IndexedDB

**At the `Repository`-interface method level: none.** Every method in every domain has a real `RemoteRepository` implementation wired to a tRPC procedure.

**Outside the `Repository` interface, entirely local and untouched by the migration:**

| Module | What it is | Cutover implication |
|---|---|---|
| `src/data/persist.ts` | IndexedDB snapshot layer backing the in-memory repo (debounced save, retry, migration-on-load) | Bypassed entirely once `RemoteRepository` is active — becomes dead weight for that mode, but currently always active since `VITE_API_BASE_URL` is unset |
| `src/data/backup.ts`, `src/data/migrations.ts` | Whole-app JSON export/import (Settings dialog) | **Not part of `Repository`** — always reads/writes local IndexedDB even if the app is otherwise pointed at the remote backend. Users would export/restore *local* data, not server data — a real user-facing inconsistency post-cutover |
| `src/data/seed.ts`, `gov-hierarchy.ts`, `sales-roster-seed.ts`, `sales-team.ts`, `ownership-fixture.ts`, `src/modules/commercial-calculator/seed-defaults.ts` | Fresh-install data generators | Only ever populate the in-memory store; Postgres has no equivalent (see §4) |
| `src/data/india-admin.json`, `subdistricts.json` | Static India geo reference data (36 states, 736 districts, 6,405 talukas, ~642k villages counted-not-materialized) | Bundled frontend assets, never imported server-side |

No page/component was found calling a method missing from `RemoteRepository` (there are none missing). Separately noted: **no UI exists for the `customers` domain at all** — it's fully migrated backend-side but has zero frontend callers. Not a gap, just worth knowing.

---

## 3. Frontend cutover readiness

**Page/feature → domains used** (full detail gathered; condensed here):

| Page | Domains |
|---|---|
| Home, Landing/map | hierarchy, employees |
| StateWorkspace | hierarchy (full CRUD), employees (+timeline/transfers/charges/merge), sales, ownership, opportunities, followUps |
| Directory | employees, then everything `DetailsPanel` pulls in |
| RelationshipAnalytics | search (`relationshipAnalytics`) |
| Meetings | employees, timeline |
| SalesWorkspace | sales, ownership |
| CommercialCalculatorWorkspace | commercial masters/SKUs/BOM/BOQ/auditLogs, employees, sales |
| CommandPalette (global) | search |
| Settings dialog (global) | **not** `Repository` — local-only backup/restore (see §2) |

- **Which pages can safely use `RemoteRepository` today?** All of them, method-availability-wise — there is no missing-method risk anywhere in the current codebase.
- **Which still depend on unmigrated methods?** None — 114/114 parity.
- **Can `VITE_API_BASE_URL` be enabled without breaking any current workflow?** **No — not recommended yet**, but not because of missing methods. Reasons:
  1. Every domain's Postgres tables are empty (§4) — the app would render essentially blank on first load instead of the pre-populated dataset users expect today.
  2. Settings backup/restore and app bootstrap would keep operating on local IndexedDB regardless (§2) — a confusing split.
  3. Commercial masters (Phase 4) has no live-verification evidence — unknown risk on the domain most other commercial routers depend on via FK.
  4. No auth/rate-limiting — flipping this on for anyone besides a controlled local/dev test would expose an open read/write API.
  5. The 142 `apps/api` tests were not re-run in this review (no local Postgres/`DATABASE_URL` available in this environment) — they should be run for real, not just trusted from prior checkpoints, before any go-ahead.

---

## 4. Seed / reference data still needed before cutover

No migration contains an `INSERT`, and no script anywhere imports the frontend's seed data into Postgres. On a fresh `goms-dev` database, every one of these is missing:

- **Geo hierarchy** (`hierarchy_nodes`): 1 country + 36 states + 736 districts + 6,405 talukas (~7,178 nodes), sourced from `india-admin.json`/`subdistricts.json`.
- **Government org chart** (`hierarchy_nodes` + `employees`): 73 org nodes + 11 vacant position seats, hand-built in `gov-hierarchy.ts`.
- **Sales roster** (`sales_persons`/`sales_postings`): 31 AMNEX sales people with initial postings, from `sales-team.ts`/`sales-roster-seed.ts`.
- **Commercial catalog** (`commercial_masters`, `commercial_skus`, `commercial_bom_items`): 8 verticals, 22 real AMNEX products, sample modules/features/pre-sales, 12 SKU categories, 6 UoMs, 6 product editions, 5 billing types, 5 tax classes, an approval matrix, 4 currencies, and 6 sample SKUs. This also confirms a gap already flagged mid-migration: the in-memory `STANDARD_EDITION_ID` has no Postgres equivalent — the backend resolves "standard edition" by code lookup instead, which only works if that row exists.
- **Ownership demo fixture** (`ownership_assignments`): a small illustrative set.

**Action needed before any real cutover:** build a one-time seed-import script (or a seed migration) that reads the same source data the frontend seed builder uses and inserts it into the corresponding Postgres tables. This does not exist today in any form.

---

## 5. Behavioral differences discovered between in-memory and Postgres (Phases 0–7)

Selected, most cutover-relevant items (full list of ~20 traced with file:line citations available on request):

- **Type coercion fixes required:** `pg` returns `NUMERIC` as strings and can shift `DATE` by a day across timezones — both fixed via `types.setTypeParser` overrides in `apps/api/src/db.ts`. Silent-wrong-value risk if ever reverted.
- **New, real constraint enforcement:** `sales_persons.official_email` uniqueness was documented but *never enforced* in-memory; Postgres adds a real `UNIQUE` constraint — a genuine behavior change (previously-silent duplicates now `CONFLICT`).
- **Optimistic concurrency exists only for `customers`.** SKUs, masters, and BOQs have no `expectedUpdatedAt` — a known, carried-forward gap, not silently patched.
- **`commercial_boqs.parent_boq_id` has no FK** (dropped after a real regression: `ON DELETE RESTRICT` blocked deleting any BOQ that had ever been revised, stricter than the in-memory original).
- **`boq_number` is deliberately non-unique** (revisions keep the same number; only `duplicate` mints a new one) — the spec's illustrative `UNIQUE` constraint would have broken revisions.
- **Two asymmetric FK/cascade behaviors reproduced exactly from the in-memory original, not "fixed":** `follow_ups.assignee_id` has no FK (dangling on delete, by design-inherited-gap); `ownership_assignments.sales_person_id` does cascade on delete.
- **Test-infra note:** `apps/api` vitest runs with `fileParallelism: false` — required once employee tests began resetting shared tables in `beforeEach`, or parallel test files raced each other's `DELETE`s.

---

## 6. Production-readiness gap review

| Area | Status | Detail |
|---|---|---|
| Authentication/authorization | ❌ None, by design | Cloud Run `goms-api`: `roles/run.invoker` → `allUsers` (`infra/dev/cloudrun.tf`). Deliberate per spec §2/§15 for the dev sandbox; **not yet addressed even in planning for a prod pass** beyond a one-line "follow-up plans" note |
| Backend API exposure | ⚠️ Fully public | No auth + unrestricted ingress means any mutation (create/delete employees, BOQs, etc.) is callable by anyone who finds the URL. Acceptable for a no-real-data dev sandbox only |
| Rate limiting | ❌ None found | No config anywhere in Terraform or CI; only referenced as a future spec intent |
| Logging/monitoring | ❌ None found | No Cloud Monitoring dashboards, uptime checks, or alerting policies. `commercial_audit_logs` is a *business* audit trail, not infra observability |
| Backups | ✅ Partial | Cloud SQL daily backups + PITR enabled, `deletion_protection = true`. No restore drill or documented restore procedure |
| Migration process | ⚠️ Manual | `node-pg-migrate` via the `goms-migrate` Cloud Run Job — not automatic on deploy (spec §14.1 defers this); already caused one real ordering bug (customers phase). CI now updates the job's image alongside the service deploy |
| CI/CD | ⚠️ Partial | Solid WIF/keyless auth + kaniko build; but auto-deploys on every `main` push with **no manual approval gate**, frontend tests never run in CI, and it runs on **shared** GitLab runners with limited minutes (~100/400 remaining as of the last checkpoint) |
| Secrets | ✅ Good | Secret Manager for DB password/URL, scoped `secretAccessor` IAM, injected via `secret_key_ref`, no keys or secrets hardcoded |
| Data seeding/import | ❌ None | See §4 — no path exists at all |
| Frontend hosting | ❌ Not started | Noted as a follow-up in prior planning (Firebase Hosting or pure-GCP alternative); no work done yet |
| Domain/HTTPS | ⚠️ Partial | Cloud Run's default `*.run.app` URL is HTTPS by default; no custom domain/DNS configured |
| Rollback/cutover | ⚠️ Partial | Infra-provisioning rollback exists (`terraform destroy -target=...` per resource); **no application-deploy rollback** (no revision-traffic-shift step in CI) and **no documented cutover runbook** for actually flipping `VITE_API_BASE_URL` |

---

## 7. Recommendation

**Do not enable `VITE_API_BASE_URL` and do not start Phase 8 yet.** Code-level domain coverage is done (114/114), which is real progress worth crediting — but three concrete, closeable gaps stand between here and a safe cutover:

1. Close the Phase 4 verification gap — run the same kind of live `curl`/smoke sweep against `commercial.masters` on `goms-dev` that every other phase has.
2. Build the seed-import path (§4) — without it, cutover means an empty app, not a working one.
3. Decide and document, even briefly, the prod-readiness posture for auth, rate limiting, and a deploy/cutover rollback runbook — these don't block *dev* work but should not be silently deferred indefinitely once real data is in scope.

Everything else (the 142-test suite, the router implementations, the `RemoteRepository` wiring) is in genuinely good shape and doesn't need rework — this is a "close the last-mile gaps" situation, not a "go back and redo phases" one.

---

## 8. Self-managed GitLab Runner on GCP — architecture & recommendation

**Context:** CI currently runs entirely on GitLab.com's shared runners (no `tags:` in `.gitlab-ci.yml`), using kaniko for builds since shared runners have no Docker daemon, and WIF for keyless GCP auth. ~100 of 400 monthly minutes remained as of the Phase 7 checkpoint (2026-08-25).

**If/when it becomes worth building**, the right shape is:

- A single small Compute Engine VM (e.g. `e2-small`, no public IP) in `asia-south1`, running `gitlab-runner` with the **Docker executor** (real dind, replacing the kaniko workaround entirely — a self-managed runner *can* run privileged Docker, so builds get simpler, not just cheaper).
- The runner authenticates to GCP via its **own attached service account** (native GCE metadata-server credentials) scoped identically to the current WIF deploy SA — `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser` on the runtime SA only. This actually *removes* the need for WIF's OIDC dance and kaniko's hand-written `external_account` JSON — a net simplification, not just a minutes fix.
- Register it as a project-level runner with a distinguishing tag (e.g. `gcp-self-hosted`); add that tag to the `build-api`/`deploy-dev` jobs only (leave `test-api` on shared runners, or move it too if minutes are the binding constraint).
- For cost control: either a single always-on VM (~$12–25/month) for a project with infrequent pushes, or the GitLab Runner Autoscaler/fleeting plugin against a GCE instance template for scale-to-zero (adds real operational complexity: instance-template management, autoscaler config, cold-start latency).
- Model it as its own small Terraform module (`infra/dev/runner.tf`), mirroring the existing pattern (private-only, scoped SA, no keys).

**Is it worth implementing now? No.** Reasoning:

- The added surface (a VM to patch and monitor, a new Terraform module, ongoing always-on cost) is disproportionate to the actual problem — this is a single-developer-cadence project mid-migration, not a high-frequency CI shop.
- The cheaper, faster fix for the immediate constraint is topping up GitLab.com CI minutes (a small paid add-on) or simply batching pushes the way Phase 7's checkpoint already did deliberately ("one push for all of Phase 7's local work, per the minutes constraint") — that pattern already works and costs nothing to keep doing.
- There's no security/compliance driver either — no secrets currently pass through the shared runner itself (WIF/Secret Manager already keep credentials off the runner), so "get builds off shared infrastructure" isn't buying anything here.
- **Revisit this** only if minute consumption becomes a recurring, real monthly blocker after cutover (sustained higher push frequency, more contributors), or if kaniko's workaround becomes a maintenance burden worth removing on its own merits.
