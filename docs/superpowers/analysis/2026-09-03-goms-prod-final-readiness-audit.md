> **2026-09-03, later same day — UPDATE:** All 5 blockers below were resolved this session. See
> `2026-09-03-goms-prod-blocker-resolution.md` for the full resolution report (E2E now 23/23,
> apps/api DB suite 393/393 on a clean disposable Postgres, migration pre-check clean, fresh
> `infra/prod` terraform plan reviewed and NOT applied). Release candidate is now
> `b8b187059dbe828895971e0214a2fb4a1842f514`. Still **NO-GO pending explicit user approval and the
> terraform plan review** — nothing has been deployed to `goms-prod`.

# GOMS Production Readiness Audit — Final Go/No-Go

**Date:** 2026-09-03
**Status:** Investigation + one emergency mitigation only. Nothing else deployed, migrated, or
changed on `goms-prod` as part of this audit.
**Trigger:** Final production-readiness check after manual authenticated Admin Data Import
verification passed on `goms-dev`, before any `goms-prod` promotion.

---

## 0. Emergency finding, mitigated during this audit

**`goms-prod` was found live-exposing unauthenticated bulk-write access to Admin Data Import.**
Confirmed by direct query, not inference:

| Check | Result |
|---|---|
| `gcloud run services describe goms-api --project=goms-prod` | `ADMIN_IMPORT_ENABLED=true` |
| IAM invoker | `allUsers` → `roles/run.invoker` (no auth of any kind) |
| Running image | `goms-api:54a7d6ab...` — commit `54a7d6ab`, 2026-08-31, predates the entire
Firebase auth-gate implementation (`943b362b`, 2026-09-01) |
| Live probe | `curl https://goms-api-2vhbzi24iq-el.a.run.app/api/trpc/adminImport.listDomains` → **HTTP 200**, real production row counts returned, no credentials sent |

This directly contradicts the "goms-prod untouched" assumption carried in prior session notes —
something flipped this out-of-band since 2026-09-01. Because the running image predates the auth
code entirely, there was no identity check of any kind in front of `adminImport.*`: any internet
user who found the URL could have called `session.commit` and bulk-written/overwritten production
reference data.

**Mitigated, with explicit user approval, during this audit:**
```
gcloud run services update goms-api --project=goms-prod --region=asia-south1 \
  --remove-env-vars=ADMIN_IMPORT_ENABLED
```
Result: revision `goms-api-00014-shs` deployed; `adminImport.listDomains` now returns
`404 {"code":"NOT_FOUND"}`, matching the intended flag-off behavior. No image change, no data
touched, no other route affected. Confirmed via a second live probe post-fix.

**This closes the live incident but does not itself make `goms-prod` ready for a real promotion —
see below.**

---

## 1. Exact commit state

| Ref | SHA |
|---|---|
| `HEAD` | `5c5be7b1ae4a49ebb50dec4d03e3d706ab3b0cd7` |
| `origin/main` | `5c5be7b1ae4a49ebb50dec4d03e3d706ab3b0cd7` |
| local `main` | `5c5be7b1ae4a49ebb50dec4d03e3d706ab3b0cd7` |

All three coincide — no unpushed local commits, no divergence from origin.

**`goms-dev`'s validated state, cross-checked against this:**
- Backend (Cloud Run `goms-api`, project `goms-dev`): image tag `dfa01084` — an ancestor of HEAD.
  The 6 commits between `dfa01084` and HEAD (`891bd30f` … `5c5be7b1`, all the "Import modal /
  sign-in / sign-out" fixes) touch **only** `src/` (frontend) — confirmed via
  `git diff --stat dfa01084..HEAD -- apps/api/` returning empty. The deployed backend image is
  current for everything that's been manually verified.
- Frontend (Firebase Hosting, site `goms-dev`): last release **2026-09-03 16:30:51**, which is
  *after* HEAD's own commit timestamp (16:23:21) — consistent with the hosted frontend actually
  being built from HEAD, which is what the manual sign-in/sign-out/modal verification exercised.

**Conclusion: HEAD (`5c5be7b1`) is the exact validated state to promote — for the frontend outright,
and for the backend once the migrations in §6 are applied (the backend hasn't needed a new image
since `dfa01084`, but HEAD's newer commits assume DB schema `dfa01084`'s image never needed).**

---

## 2. Uncommitted / concurrent-session WIP — confirmed NOT part of what's being promoted

The working tree carries substantial uncommitted changes and untracked files. None of this is
part of `HEAD` and **none of it should be swept into a prod promotion**:

| File(s) | What it is | Disposition |
|---|---|---|
| `infra/prod/cloudrun.tf` (uncommitted diff) | Terraform written to retroactively describe a manual `gcloud run deploy` to `54a7d6ab` **and** flip `ADMIN_IMPORT_ENABLED=true` in prod with **no** `FIREBASE_PROJECT_ID`/`ADMIN_IMPORT_ALLOWED_EMAILS` — i.e., codifying the exact incident just mitigated in §0. This is a stale draft from before the auth plan existed (its own comments reference the Aug 31 safety report, not the Sept 1 auth work). | **Discard.** Do not commit, do not apply. If Terraform state needs to be reconciled with the *post-mitigation* live state, that's new work, written fresh, after a real prod-auth decision is made (§4). |
| `apps/api/src/import/engine.ts`/`.test.ts`, `apps/api/src/import/domains/*.ts`, `src/modules/admin-data-import/{domainDetection,sessionUpload,templates}.ts` + new `__fixtures__/`, `headerDetection.test.ts` | New, untested-in-this-audit import-engine work: case-insensitive enum matching (`Active`/`ACTIVE`/`active`) and a `cascadeRejectOnRejectedReference` fix for a real crash class (a rejected parent row silently "resolving" a child's reference). Looks like solid, well-tested WIP — but it's mid-flight, uncommitted, and outside the scope this audit was asked to certify. | **Not part of this promotion.** Finish, test, commit, and get it through its own dev-verification cycle separately. |
| `src/app/routes/SalesWorkspace.tsx`, `PeopleDirectory.tsx`, `EmployeeFormDialog.tsx`, `WorksEditor.tsx` | Added `data-testid` attributes only | Cosmetic/test-infra, harmless either way, but still uncommitted — **not part of this promotion** until committed. |
| `package.json`/`package-lock.json` | Added `@playwright/test` devDependency | Dev tooling only, no runtime effect — **not part of this promotion** until committed. |
| `.gcloudignore` (`src` → `/src`) | Anchors the ignore pattern to repo root instead of matching any `src` dir at any depth | Looks like a real, isolated bug fix (an unanchored `src` glob would also ignore e.g. `node_modules/**/src`), but uncommitted — **not part of this promotion** until committed. |
| `E2E_DEPLOYMENT_TEST_GUIDE.md`, 3 `.xlsx` files, `goms_changes_1st sept.xlsx`, `docs/superpowers/analysis/2026-09-01-production-verification-assets/`, various plan/analysis `.md` files | Documentation and test fixtures | No runtime effect either way; fine to commit for audit-trail purposes but irrelevant to promotion readiness. |

**Verification of "clean HEAD" claim:** stashed all of the above (`git stash push -u`), confirmed
`git status` showed a clean tree at HEAD, ran `tsc --noEmit` in both `apps/api` and the frontend
workspace (both exit clean, zero errors), then restored the stash exactly (`git stash pop`,
re-diffed to confirm identical). **HEAD compiles cleanly with none of this WIP present.**

---

## 3. The real scope of "promote goms-dev's validated state" — bigger than Admin Import alone

`goms-prod`'s running image (`54a7d6ab`, 2026-08-31) is **45 commits behind `HEAD`**
(`git log 943b362b..HEAD --oneline | wc -l` = 45, and `54a7d6ab` is older still). Those 45 commits
are not incremental — they include the entire Firebase auth rollout, avatars across the app,
timeline agenda/outcome/next-steps, department State/District/City + multi-contact, hierarchy
Department→Department nesting, the Add Activity consolidation, MultiSelectDropdown fixes, and the
Admin Data Import modal/UX rework, on top of the auth work itself.

**Promoting "the validated state" is therefore a full release, not a narrow Admin-Import patch.**
That changes the risk calculus: this is not a small, reversible config flip, it's a multi-week
batch of frontend, backend, and schema changes going to production in one deploy, immediately
after an unrelated live security incident was just closed on the same service.

---

## 4. Production Admin Import authentication — explicitly NOT ready, and that's fine

The `goms-dev` auth implementation deliberately used a **dedicated dev-only Firebase project**
(`goms-dev-auth`), per `docs/superpowers/plans/2026-09-01-goms-admin-import-firebase-auth-plan.md`'s
Task 6 and Global Constraints — chosen specifically so nothing about `goms-prod`'s Firebase project
or Authentication configuration would be touched by dev iteration. Concretely, for `goms-prod`:

- No `FIREBASE_PROJECT_ID` or `ADMIN_IMPORT_ALLOWED_EMAILS` env var exists on `goms-prod`'s
  Cloud Run service today (confirmed live).
- `goms-prod`'s own Firebase project (used today only for Hosting) has never had Authentication
  enabled (per the Aug 31 report, unconfirmed to have changed since).
- The code being promoted (`HEAD`) is safe to ship as-is: `verifyAdminImportToken` fails closed
  (`UNAUTHORIZED`) with no `FIREBASE_PROJECT_ID` configured, and `ADMIN_IMPORT_ENABLED` gates
  everything upstream of that anyway.

**Recommendation, matching the already-existing plan documents' own conclusion:** promote the code,
but leave `ADMIN_IMPORT_ENABLED` unset on `goms-prod` after promotion, exactly as it is right now
post-mitigation. Enabling Admin Data Import in production is a separate, explicit decision (Path A
full-SSO vs. a `goms-prod`-specific Path B allow-list, mirroring Task 6 but for prod's own Firebase
project) — not something this promotion should silently carry.

---

## 5. Test suite status

| Suite | Result | Notes |
|---|---|---|
| Frontend logic tests (`npm test` → `vitest run`, `vite.config.ts`) | **383/383 pass** | Pure-logic, no DOM. |
| Frontend component tests (`npm run test:component`) | **317/320 pass, 3 fail** | All 3 failures are in `src/features/employees/TimelineEventDialog.test.tsx`, attendee-picker (`getByRole('checkbox', {name:'Asha Rao'})` not found). Matches prior session's documented pre-existing failure, reproduced identically today — **not a new regression**. |
| `apps/api` (DB-backed, `npm --workspace apps/api test`) | **Could not verify in this sandbox** | Every test failed with `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` — a local Postgres is reachable on `localhost:5432` but `apps/api/.env`'s credentials don't authenticate against it, and Docker Desktop isn't running here to spin up a disposable one. This is an environment gap, not evidence of a code defect — `tsc --noEmit` on `apps/api` at clean HEAD passes with zero errors. GitLab CI's `test-api` job (real `postgres:16` service, migrate-then-test) is the actual source of truth for this suite, but GitLab CI minutes have been reported exhausted since 2026-08-26 (prior session note) — **whether `test-api` has actually run green against current HEAD is unconfirmed.** |
| E2E (`e2e/26-task-enhancements.spec.ts`, per `E2E_DEPLOYMENT_TEST_GUIDE.md`, 2026-09-02 run against real `goms-dev`) | **12/23 pass, 11 fail** | 5 of 11 spot-checked as seed-data/fixture mismatches (named fixtures like "Priya Nair" exist in local demo data, not in `goms-dev`'s real Postgres) — likely non-blocker. **The other 6 are explicitly documented as unconfirmed**, including "GM auto-derives when RM is changed, persists in org chart" and "Ownership set on an employee reflected consistently after reload" — these read more like real persistence bugs than fixture issues and haven't been individually triaged. |
| MoveDialog "real mutation" | **Non-blocker, coverage exists elsewhere** | `src/features/nodes/MoveDialog.test.tsx` only asserts the UI calls a *mocked* `moveMutateAsync` with the right args — it doesn't exercise a real backend write. But the actual move logic has its own DB-backed test at `apps/api/src/routers/hierarchy.test.ts` (part of the unverified `apps/api` suite above) and an in-memory-repo equivalent at `src/data/in-memory/hierarchy.test.ts` (which passed, in the logic run above). The gap is real but already covered at the right layer — it's not evidence of a missing check, just split across files. |

---

## 6. Database / migrations for prod

`apps/api/migrations/` has 4 migrations not yet confirmed applied to `goms-prod`:

```
1787741760367_admin-import-runs.sql
1787750000000_admin-import-hardening.sql
1788000000000_admin-import-actor-email.sql
1788100000000_timeline-events-agenda-outcome-nextsteps.sql
```

The Aug 31 safety report directly confirmed (via a one-off read-only `goms-migrate` job execution)
that as of 2026-08-31, none of `admin-import-hardening`'s 4 new unique indexes existed on
`goms-prod`, and its own migration name was absent from `pgmigrations`. Nothing in the record since
suggests these have been applied. **Do not assume they have been — re-run the same read-only
duplicate-key check (Aug 31 report §1) immediately before migrating, since `goms-prod` is live and
writable, then apply via the existing `goms-migrate` Cloud Run Job's default `up` command (no
override needed).** This audit did not re-run that check — it's a required pre-deploy step, not
something to infer from a 3-day-old report.

---

## 7. `infra/prod` review (not modified)

- No stale `tfplan` file exists in `infra/prod/` today (the one flagged in the Aug 31 report is
  gone) — but Terraform state is still known to have drifted from what's committed: `goms-prod`'s
  image tag, `ADMIN_IMPORT_ENABLED` (until this audit's fix), and scaling config have all been
  changed live via `gcloud run services update`/`deploy`, outside Terraform, per both the
  uncommitted diff's own comments and this audit's live queries.
- **A fresh `terraform plan` in `infra/prod` has not been run as part of this audit** (deliberately,
  to avoid running plan/apply against a directory whose tracked file has an uncommitted, must-be-
  discarded edit sitting on top of it). Run one only after discarding §2's stray
  `infra/prod/cloudrun.tf` diff and deciding the real committed image tag for promotion.
- `google_cloud_run_v2_service_iam_member.public_invoke` (`allUsers`) is unchanged and expected —
  `goms-prod` has no authentication in front of any route by original design (DRIFT-001, accepted
  debt project-wide, not something this promotion is scoped to close).

---

## 8. `goms-prod` current state — confirmed touched, now stabilized

Contrary to the "goms-prod untouched" assumption: `goms-prod` was manually updated to image
`54a7d6ab` and had `ADMIN_IMPORT_ENABLED=true` set, both out-of-band from Terraform, at some point
after 2026-09-01. Post-mitigation (§0), `goms-prod` is now:
- Running `goms-api:54a7d6ab` (2026-08-31 code, pre-dates auth work) — **unchanged by this audit**,
  still the oldest concern in §3.
- `ADMIN_IMPORT_ENABLED` unset — restored to safe/expected state.
- IAM `allUsers` invoker — unchanged, expected (DRIFT-001, project-wide, out of scope here).
- No DB writes, migrations, or Terraform applies made.

---

## 9. GO / NO-GO: **NO-GO**

Not ready for a full promotion today. Concrete blockers, in priority order:

### Blockers (must resolve before promoting)

1. **Uncommitted stray `infra/prod/cloudrun.tf` diff must be discarded, not committed.** It
   re-encodes the exact incident just mitigated (§0, §2) — applying it would re-expose
   unauthenticated bulk-write.
2. **`apps/api`'s DB-backed test suite is unverified against current HEAD.** Local sandbox can't
   run it (credential/Docker gap); GitLab CI's ability to run it is in question (reported-exhausted
   minutes since 2026-08-26). This suite covers the actual session-commit/import/hierarchy-move
   logic that would be going live — promoting without a confirmed-green run here is promoting
   blind on the parts of the code most capable of corrupting production data.
3. **6 of 11 E2E failures are unconfirmed as fixture-mismatch vs. real bug**, including two
   (GM auto-derive persistence, ownership-after-reload) that read like genuine persistence issues
   in features that would ship as part of this promotion.
4. **Pre-deploy migration safety check (Aug 31 report §1) must be re-run fresh** against
   `goms-prod`'s current live data before applying the 4 pending migrations — not assumed still
   valid from a 3-day-old snapshot.
5. **No fresh `terraform plan` has been run against `infra/prod`** since discovering the drift —
   required before any `apply`, per the repo's own established discipline (Aug 31 report §2/§5).

### Non-blockers (track, don't gate on)

- 3 pre-existing `TimelineEventDialog` attendee-picker test failures — reproduced identically to
  the prior session's report, not a new regression, narrow UI-test scope.
- 5 of 11 E2E failures plausibly explained by seed-data/fixture mismatch against `goms-dev`'s real
  Postgres, not an app defect.
- `MoveDialog`'s mock-only frontend test — real coverage exists at the router/repository layer.
- Uncommitted import-engine WIP (`caseInsensitiveEnum`, `cascadeRejectOnRejectedReference`) and the
  `data-testid`/Playwright/`.gcloudignore` changes — good work, just not in scope for this
  promotion; finish and land them on their own schedule.
- `ADMIN_IMPORT_ENABLED` staying unset on `goms-prod` after promotion — this is the *correct*
  state, not a gap, until a real prod-auth decision is made (§4).

### What "GO" will look like once these clear

Once blockers 1–5 are resolved, promotion is: apply the 4 pending migrations via `goms-migrate`,
deploy a `goms-api` image built from `5c5be7b1` (or later, once the current WIP lands and is
included deliberately) to `goms-prod`'s Cloud Run service with `ADMIN_IMPORT_ENABLED` left unset,
deploy the matching frontend build to `goms-prod`'s Firebase Hosting, smoke-test ordinary CRUD
paths (customers, hierarchy, sales, commercial) plus confirm `/admin/data-import` still 404s/is
absent, then reconcile `infra/prod/cloudrun.tf` to match. Rollback path is the same one the Aug 31
report already established: Cloud Run traffic-shift back to the current revision
(`goms-api-00014-shs`) is instant and doesn't require touching the additive-only migrations.
