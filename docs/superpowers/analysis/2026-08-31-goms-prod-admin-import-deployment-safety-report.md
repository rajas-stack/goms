# GOMS Production Admin Data Import — Deployment Safety Report

**Date:** 2026-08-31
**Status:** Investigation only. Nothing deployed, migrated, or changed on `goms-prod` as part of
this report except one read-only Cloud Run Job execution (see §1) — confirmed to have left the
job's own definition unchanged afterward.
**Trigger:** user requirement for a production URL where an authorized person can upload Excel
files and have the result land in `goms-prod`'s Cloud SQL and be reflected live in Account Mapping
and Commercial Calculator — with an explicit instruction not to apply the pending DB migration or
deploy anything until safety and scope are established.

---

## Headline finding

**The DB migration is safe to apply — zero duplicate business keys exist in `goms-prod` today.**
That was the narrowest question asked, and it has a clean answer. But it is the *smallest* blocker
in the path to the user's actual acceptance criterion. Two much bigger facts changed the shape of
this task:

1. **The backend currently running on `goms-prod` predates the entire Admin Data Import redesign.**
   Flipping `ADMIN_IMPORT_ENABLED=true` today would not turn on the new multi-file session wizard —
   it would 404, because the deployed image doesn't contain the `adminImport.session.*` procedures
   at all. A real image rebuild + redeploy is required, not just a config flip.
2. **`goms-prod` has no authentication anywhere, and the API is invokable by any unauthenticated
   caller on the internet** (tracked as DRIFT-001, accepted 2026-08-27 as temporary debt). Turning
   on Admin Data Import against this backend would let **any anonymous internet visitor bulk-write
   production reference data** — not a hypothetical, a literal reading of the current IAM policy
   and the app's `publicProcedure`-only router design. This was already recognized and explicitly
   gated by the team's own 2026-08-27 enablement plan, which is still fully in force and unresolved.
   The user's acceptance criterion ("a user with only the website URL can upload...") is true today
   for *any* user with the URL, not just an authorized one, unless this is closed first.

Everything below explains these findings and lays out the sequence to close them safely.

---

## 1. Migration safety check against `goms-prod`

**Method:** `goms-prod`'s Postgres (`goms-pg`, private IP, no public IP, VPC-only) has no route
from this machine. Direct `psql` isn't possible from outside the VPC. Instead of trying to
reconstruct the data through the public API (which would mean thousands of individual requests
against a production service rate-limited to 300 req/5min — both slow and an inappropriate load
against production), a **one-off, read-only execution of the existing `goms-migrate` Cloud Run Job**
was used — same VPC/service-account/secret access the job already has for real migrations, with its
`args` overridden for this single execution only to run a small inline Node script that issued
exactly the 4 `SELECT`/`GROUP BY`/`HAVING` queries below and printed the result to Cloud Logging.
**No `INSERT`/`UPDATE`/`DELETE`/`migrate up` ran.** Verified afterward that the job's own persisted
definition (`command`/`args`/`env`) is unchanged — `gcloud run jobs describe goms-migrate` still
shows the original `node node_modules/node-pg-migrate/bin/node-pg-migrate.js up` / `DATABASE_URL`
only.

**Queries run** (exactly the migration's own uniqueness scopes, from
`apps/api/migrations/1787750000000_admin-import-hardening.sql`):

```sql
-- org hierarchy codes, case/whitespace-insensitive, scoped to the org domain
SELECT lower(trim(code)) c, count(*) FROM hierarchy_nodes
WHERE domain='org' AND code IS NOT NULL GROUP BY lower(trim(code)) HAVING count(*)>1;

-- geo hierarchy codes, scoped by type_key + state_code (post-ff0c9460 fix — geo codes
-- legitimately collide across states/levels, so this is the real production scope)
SELECT type_key, state_code, lower(trim(code)) c, count(*) FROM hierarchy_nodes
WHERE domain='geo' AND code IS NOT NULL
GROUP BY type_key, state_code, lower(trim(code)) HAVING count(*)>1;

-- employee codes, excluding the ordinary-CRUD 'EMP-NEW-%' placeholder pattern
SELECT lower(trim(code)) c, count(*) FROM employees
WHERE code NOT LIKE 'EMP-NEW-%' GROUP BY lower(trim(code)) HAVING count(*)>1;

-- BOM parent/component pairs
SELECT parent_sku_id, component_sku_id, count(*) FROM commercial_bom_items
GROUP BY parent_sku_id, component_sku_id HAVING count(*)>1;
```

**Result (2026-08-31, execution `goms-migrate-qfwvf`):**

| Check | Duplicates found |
|---|---|
| `hierarchy_nodes` (org) | **0** |
| `hierarchy_nodes` (geo, type_key+state_code scoped) | **0** |
| `employees` (excl. `EMP-NEW-%`) | **0** |
| `commercial_bom_items` (parent, component) | **0** |

Sanity counts confirmed this hit real production data, not an empty DB: 7,251 `hierarchy_nodes`
rows, 2 employees, 1 BOM item — matching the 2026-08-31 functional parity audit's independently
reported figures exactly.

Also confirmed: **none of the 4 new unique indexes exist yet** on `goms-prod`
(`hierarchy_nodes_org_code_ci_idx`, `hierarchy_nodes_geo_type_code_state_ci_idx`,
`employees_code_ci_idx`, `commercial_bom_items_parent_component_idx` — all absent from
`pg_indexes`), and the migration's own name does not appear in the `pgmigrations` tracking table.
**The migration has not been run against `goms-prod`.**

**Conclusion: the migration is safe to run against `goms-prod` as-is.** No pre-existing duplicate
would be rejected by the new unique indexes, and the two new `admin_import_runs` columns
(`session_id`, `excluded_rows`) are additive/nullable-or-defaulted, so they carry no data risk
either. This holds only for data as of 2026-08-31 — re-run the same check immediately before the
actual migration if real time passes between this report and applying it, since `goms-prod` is a
live, writable system today (DRIFT-001, below).

---

## 2. What's actually running on `goms-prod` right now

| Component | Current state |
|---|---|
| Cloud SQL (`goms-pg`) | Running, private IP only, real reference data loaded (7,251 hierarchy nodes / 2 employees / 1 BOM item / full commercial masters incl. `preSales` — loaded 2026-08-27 via one-time script, topped up 2026-08-31). No transactional data (customers/opportunities/BOQs) by original design decision. |
| Cloud Run `goms-api` | Live at `https://goms-api-2vhbzi24iq-el.a.run.app`, 100% traffic on revision `goms-api-00011-tzk`, image digest `sha256:50fba19d...` (pushed 2026-08-31T10:52 UTC). **Live-verified this image predates the session-redesign**: `adminImport.listDomains` resolves to a real (flag-gated) procedure, but `adminImport.session.validate` returns `"No procedure found on path"` — the new session router does not exist in this build. |
| Firebase Hosting | `https://goms-prod.web.app`, rewrites `/api/**` to the Cloud Run service (same-origin, no CORS in play). Frontend bundle is from the same era as the API image — also predates the session wizard UI. |
| IAM on `goms-api` | `allUsers` → `roles/run.invoker` (DRIFT-001, ACTIVE, tracked, not yet resolved). |
| `ADMIN_IMPORT_ENABLED` (backend) | Unset. |
| `VITE_ADMIN_IMPORT_ENABLED` (frontend build) | Unset. |
| Authentication | **None exists anywhere in the app** — `apps/api/src/trpc.ts` defines only `publicProcedure` and the feature-flag-only `adminImportProcedure`. No `adminProcedure`, no `protectedProcedure`, no session/token verification of any kind, confirmed by reading the file directly. |
| `infra/prod/` Terraform state | **Drifted from what's committed.** A stale `tfplan` file (generated 2026-08-27) sitting in `infra/prod/` would, if applied blindly, roll the `goms-api` image back to an older tag and drop scaling config that's since changed manually. **Do not `terraform apply` in `infra/prod` without a fresh `terraform plan` first** — several `gcloud run deploy`/`gcloud run services update` calls have happened outside Terraform since that plan was captured. |

---

## 3. Required backend/infra changes for the import feature — separated from unrelated changes

### Required (the feature does not work in production without these)

1. **DB migration** — `apps/api/migrations/1787750000000_admin-import-hardening.sql`. Confirmed
   safe (§1). Run via the existing `goms-migrate` Cloud Run Job's normal `up` command (no override
   needed — that's its default behavior).
2. **New `goms-api` image build + deploy**, built from current `main`, containing the full
   `apps/api/src/import/*` redesign: session orchestrator (`session/orchestrator.ts`), dependency
   graph, fuzzy-candidate matching, `needs-review` row action, vacant-employee support,
   `departmentHeadOf`, the `preSales` 5th flat-master sheet, and the `dist/import/data/*.json`
   postbuild copy step (already present in `apps/api/package.json`'s `build` script — confirm it
   survives whatever build path is used to produce this image, since its 2026-08-27 omission is
   exactly what 500'd `previewGeographyLoad` last time).
3. **New frontend build + Firebase Hosting deploy** — the multi-file session wizard
   (`e9fc9563`/`a33d1db5`/`b59ec516`/etc.) replacing the old per-domain `ImportWizard` route, and
   the xlsx/xls upload support. Must be built with `VITE_ADMIN_IMPORT_ENABLED=true` baked in (it's
   a build-time Vite env var, not runtime-toggleable after the fact) alongside the existing
   `VITE_API_BASE_URL=https://goms-prod.web.app`.
4. **`ADMIN_IMPORT_ENABLED=true`** on the `goms-api` Cloud Run service env (backend gate) — this is
   the one piece already anticipated in `infra/prod/cloudrun.tf`'s comment, currently left unset on
   purpose.
5. **Real authentication in front of `adminImport.*`** (see §4 — this is the actual blocker, not a
   nice-to-have).

None of the above requires a new runtime dependency on the backend — the redesign plan's own Tech
Stack section is explicit that no new npm package was introduced; `xlsx`/SheetJS is frontend-only
(parsing happens in-browser, rows go to the API as plain JSON) and was already installed and
committed in an earlier phase.

### Bundled into recent commits but NOT required for the import feature — flagged so a deploy doesn't silently carry them

The most recent commit (`7d8485b2`, message "added xlsx/xls to import function") is a large omnibus
commit that mixes the above with several unrelated changes:

| File(s) | What it actually is | Why it's unrelated |
|---|---|---|
| `apps/api/src/client-ip.ts`, `app.ts`'s `TRUST_PROXY` wiring, `infra/prod/cloudrun.tf`'s `TRUST_PROXY` env | Fixes the per-IP rate limiter collapsing into one shared bucket behind Firebase Hosting (BUG-002/DRIFT-001 companion fix) | A general correctness fix for **all** traffic, not import-specific. Already deployed to `goms-prod` on 2026-08-27 per the drift register — re-deploying it again is harmless (it's already live) but it's not something the import rollout needs to "add." |
| `cloudbuild.yaml` (new) | A Cloud Build CI pipeline definition | Unrelated to import logic. If this represents a decision to move off GitLab CI (whose shared-runner minutes are exhausted per prior session notes), that's a separate infrastructure decision worth its own review, not something to wave through as part of an import deploy. |
| `public/cursors/*.svg`, `tailwind.config.ts`, `src/index.css` | Custom cursor assets / Tailwind config tweaks | Pure cosmetic frontend polish, no relation to import. |
| `src/components/TopBar.tsx`, `src/lib/api-environment.ts` | The "Connected to goms-prod" badge fix (BUG-001) | Already fixed and deployed 2026-08-27 per the drift register. Harmless to re-ship, not a new requirement. |
| `src/features/import/ImportDialog.tsx`, `workbookToCsv.ts` | **A different, older, already-live feature** — the org-hierarchy bulk-CSV "import children" tool (`importChildren`) | **Naming collision risk worth flagging explicitly**: this "import" is not the Admin Data Import module (`src/modules/admin-data-import/`). It's a pre-existing, unrelated CSV bulk-add tool for hierarchy branches, already live in production today, unaffected by anything in this report. Don't conflate the two when reviewing a deploy diff. |
| `scripts/prod-reference-import.ts`, `scripts/admin-import-fixtures/build-realistic-fixtures.ts` | The one-time reference-data-load script and its fixture generator | Already used once (2026-08-27) to seed `goms-prod`'s baseline reference data and closed out. Not needed again to enable the ongoing self-service feature — keep for audit trail, don't re-run. |
| `docs/superpowers/**/*.md` (plan/audit/drift-register updates, ~4,800 lines) | Documentation | No runtime effect either way. |

None of these are harmful to deploy alongside the real requirement — they're just not *why* the
deploy is happening, and `cloudbuild.yaml` in particular deserves its own look before it's treated
as settled.

---

## 4. The actual blocker: no authentication in front of a bulk-write endpoint

This isn't a new concern raised by this report — it's the exact scenario the team's own
`docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md` was written to
prevent, and that plan's Gate 1 is still fully open:

> "Flipping `ADMIN_IMPORT_ENABLED=true` on `goms-prod` today would mean any unauthenticated visitor
> could overwrite production reference data... categorically worse than DRIFT-001's existing
> read/write exposure, because import `commitRows()` calls are bulk, multi-table, and designed to
> be destructive-by-design for the domain's `status`/`active` columns."

Concretely, today: `allUsers` has `run.invoker` on `goms-api` (§2), and every procedure — including
every `adminImport.*` procedure once the flag is on — is `publicProcedure`. There is no login, no
session, no token, no role, nothing that distinguishes an authorized Amnex admin from any other
visitor to the URL. The user's stated acceptance criterion — "a user with only the website URL can
upload the agreed Excel files" — is, read literally, already achievable by flipping two env vars
and redeploying. **The problem is that it would be true for every internet user, not a specific
authorized one**, which is a materially different (and much riskier) thing than what was asked for.

This is a decision only the business/product owner can make, not something to resolve silently one
way or the other. Two honest paths forward:

- **Path A — do it right, per the existing plan.** Build real authentication (Gates 1–5 of the
  2026-08-27 plan: an `adminProcedure` enforced server-side, a real identity provider decision —
  still blocked on Amnex IT confirming an SSO/IdP per
  `docs/superpowers/analysis/2026-08-26-goms-identity-provider-decision.md` — a named admin
  roster, MFA policy, audit trail tying commits to a real identity), then enable Admin Data Import
  as a true admin-only feature. This is the only path that satisfies "an *authorized* user" rather
  than "anyone with the link," and it also closes DRIFT-001 project-wide, not just for import.
- **Path B — a narrower, faster stopgap scoped to only this one surface.** E.g., a shared
  admin secret / signed link / Google Sign-In restricted to a specific allow-listed list of Amnex
  email addresses, gating only `adminImport.*`, while the rest of the app stays on today's
  DRIFT-001 posture unchanged. Smaller lift than full SSO, but it's still new auth code that needs
  building and reviewing — not a config flip — and it means the app ends up with two different
  security postures (import: gated; everything else: still open) until Path A eventually lands.

I have not chosen between these — it's a real risk/timeline trade-off, not a technical judgment
call, and the team already deliberately declined to make this call unilaterally once before (the
drift register's "Admin Data Import — explicitly kept dark in production" entry, 2026-08-27).

---

## 5. Safest production deployment sequence

Assuming **Path A or Path B is chosen and its auth work is done and merged** — nothing below should
run before that:

```
0. Re-run §1's duplicate-key check (cheap, 15s) — confirm still zero duplicates,
   since goms-prod is live and writable between this report and the actual deploy.
       │
       ▼
1. Apply the DB migration ONLY
   `goms-migrate` Cloud Run Job, default `args` (node-pg-migrate up) — no override needed.
   Verify: the 4 new indexes + 2 new admin_import_runs columns exist; app still serves
   normally (this migration is purely additive — no existing route depends on the new
   indexes yet, since the old image doesn't even know they exist).
       │
       ▼
2. Build and deploy the new goms-api image, auth gate included, ADMIN_IMPORT_ENABLED
   still UNSET at this point.
   Verify via curl: `adminImport.session.validate` now resolves to a real procedure
   (still 404s on the flag, not "No procedure found") — proves the new code shipped
   without yet exposing it. Re-verify the app's ordinary CRUD paths (customers, hierarchy,
   sales, commercial) still work exactly as before — this image also carries every other
   accumulated fix since the last prod deploy, not only import code.
       │
       ▼
3. Build and deploy the new frontend (VITE_ADMIN_IMPORT_ENABLED=true baked in,
   VITE_API_BASE_URL unchanged). The route becomes reachable in the UI but every
   adminImport.* call still 404s server-side until step 4 — a safe, inert intermediate
   state if steps 3 and 4 need to be split across a change window.
       │
       ▼
4. Flip ADMIN_IMPORT_ENABLED=true on goms-api (targeted terraform apply on
   infra/prod/cloudrun.tf, or gcloud run services update --update-env-vars for a faster
   iteration — reconcile Terraform state afterward either way, given the existing drift).
   This is the moment the feature becomes live and callable.
       │
       ▼
5. Verify end-to-end against production for real, with a throwaway low-risk domain first
   (Tax Classes or Currencies, matching the original phased build order) — download
   template → fill a row → upload → preview → commit → confirm the change appears in
   Commercial Calculator's reference data immediately. Only then attempt an
   Account-Mapping-relevant domain (org hierarchy / employees / sales roster).
       │
       ▼
6. Confirm the commit audit trail records the authenticated admin's identity
   (Gate 5 of the 2026-08-27 plan) — not just "an import happened."
       │
       ▼
7. Hand the URL to the named authorized admin(s) only. Do not publish/link it from
   any general navigation path (it already isn't, per the parity audit).
```

**Do not apply the stale `infra/prod/tfplan`** sitting in the repo as-is (§2) — regenerate a fresh
plan before any `terraform apply` in `infra/prod`, since it would silently revert the image tag and
drop scaling config that's changed since it was captured.

**Rollback if step 5/6 finds a problem:** Cloud Run traffic-shift back to `goms-api-00011-tzk`
(instant, already the documented rollback mechanism — `docs/superpowers/analysis/
goms-prod-rollback-runbook.md`) undoes the code deploy immediately. The DB migration from step 1 is
purely additive (new indexes + nullable/defaulted columns) — it does **not** need to be rolled back
just because a later step needs a redo; only run its down-migration if the indexes themselves turn
out to be wrong, which §1 found no evidence of.

---

## 6. Mapping back to the acceptance criterion

> "A user with only the website URL can upload the agreed Excel files, complete the import with
> minimal manual intervention, and the resulting data is stored in production GCP and immediately
> reflected throughout the application, including Account Mapping and all dependent Commercial
> Calculator fields."

- **"stored in production GCP, immediately reflected"** — already true by construction once
  enabled: `commit` writes directly to the same Cloud SQL instance every other production screen
  reads from in the same transaction-per-domain-in-dependency-order model (§3 of the redesign
  design doc), no caching layer sits in between. Confirmed by this session's own DB check hitting
  live, current data (§1). No additional work needed here beyond deploying the feature itself.
- **"Account Mapping and Commercial Calculator fields"** — org hierarchy, employees, and commercial
  masters/SKUs/BOM are exactly 4 of the 11 domains the redesign's dependency graph already handles
  (`apps/api/src/import/session/dependencyGraph.ts`) in the correct order, so this isn't extra
  scope — it's the existing feature.
- **"a user with only the website URL"** — literally true today if the flags are flipped, but
  without §4's gate it's true for *any* internet user, not the intended authorized one. This is the
  one part of the acceptance criterion that needs a real decision (§4) before anything is deployed.
- **"minimal manual intervention"** — matches the redesign's whole premise (single multi-file
  session, auto-detected domains, one combined preview, one commit) rather than the old
  one-domain-at-a-time wizard. No gap here once deployed.

---

## 7. Path B, fleshed out — a concrete design sketch (not started, not approved)

Re-checked 2026-08-31: **Amnex IT still has not answered** the SSO/IdP question (no commit, doc, or
memory update since 2026-08-26 references a resolution). Path A therefore stays externally blocked
regardless of when you're ready to decide — this section exists so Path B is a real, comparable
option rather than a vague "or something smaller," not because it's been chosen.

**Shape:** Firebase Authentication's Google Sign-In provider, gating **only** `adminImport.*` —
nothing else in the app changes, DRIFT-001's broader posture stays exactly as-is and undecided
until Path A eventually lands. Chosen over inventing a new auth mechanism because `goms-prod`
already has a Firebase project (`goms-prod`, used for Hosting today) and Firebase Auth doesn't
require Amnex IT to have anything set up first — any Google account can sign in, and *authorization*
(not just authentication) is enforced separately by an explicit allow-list, not by trusting "any
Google account."

| Piece | What it is | Why this shape |
|---|---|---|
| Enable Firebase Authentication, Google provider, on the `goms-prod` Firebase project | Console/`firebase` CLI config change, no new GCP project | Reuses infra that already exists for Hosting |
| New `apps/api/src/auth/verifyAdminImportToken.ts` | Verifies a Firebase ID token server-side via `firebase-admin`'s `getAuth().verifyIdToken()`, then checks the token's verified email against an allow-list | `firebase-admin` is the one new backend dependency this path needs — a single, well-established package for exactly this job, not a bespoke JWT implementation |
| `ADMIN_IMPORT_ALLOWED_EMAILS` env var (comma-separated) | The actual authorization list — a handful of named Amnex staff | Matches this codebase's existing opt-in-env-var convention (`ADMIN_IMPORT_ENABLED`, `CORS_ALLOWED_ORIGINS`); answers Gate 3's "who is authorized" with an explicit, auditable list rather than "anyone who can sign in with Google" |
| `adminImportProcedure` (`apps/api/src/trpc.ts`) chains through the new check, in addition to the existing `ADMIN_IMPORT_ENABLED` check | Both the feature flag AND a verified, allow-listed identity must hold | This is exactly the "later swap to `adminProcedure` is a one-line change per procedure" the original import design already anticipated — Path B fills that slot with a narrower gate instead of the full `user`/`admin` model |
| Frontend: a sign-in screen in front of `/admin/data-import`, attaching the ID token to every `adminImport.*` call | New, small — reuses Firebase's client SDK (already a natural fit given Firebase Hosting is already in use) | Every other route/screen is untouched — this is deliberately not a general login page for the whole app |
| Commit audit trail | `adminImport.commit`'s existing audit record gains the verified email alongside the import batch | Directly closes Gate 5 (attributable commits) for this narrower scope |

**What this does NOT do**, on purpose: it doesn't touch DRIFT-001 (every other procedure stays
`publicProcedure`, unauthenticated), doesn't introduce a general `user`/`admin` role model, and
doesn't require Amnex IT to confirm anything. It's scoped as tightly as possible to unblock this one
feature without pre-committing to what full auth eventually looks like.

**Still real work, not a config flip**: a new backend module + dependency, a new frontend sign-in
flow, enabling Firebase Auth on the project, and testing all of it — realistically a similar order
of magnitude to the DB-migration-plus-redeploy work in §3, not a single afternoon. It also means
living with two different security postures (import: gated; everything else: open) until Path A
eventually closes DRIFT-001 for good — worth being honest about rather than presenting as free.

---

## Open items requiring your decision before any deployment happens

1. **Path A vs. Path B (§4, §7)** — full SSO/IdP-backed auth (still stuck on Amnex IT, unresolved as
   of this update), or the narrower Google-Sign-In-plus-allow-list stopgap sketched in §7, scoped to
   just `adminImport.*`? This is the one blocking decision; everything else in this report is ready
   to execute once it's made.
2. If Path B looks right, the next concrete step is a real implementation plan for §7 (brainstorming
   the exact allow-list source — env var vs. a small DB table — and the sign-in UI's shape) before
   any code gets written, following this project's usual design-before-implementation discipline.
