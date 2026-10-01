# GOMS 26-Task Enhancement Deployment & Testing Guide

**Date:** 2026-09-02
**Status:** Deployed to goms-dev and verified against the real GCP backend.
**Test Suite:** `e2e/26-task-enhancements.spec.ts` — 23 tests (not 60+; see below)

---

## Deployment status

### Completed (2026-09-02)

- `goms-dev.firebaseapp.com` frontend deployed with
  `VITE_API_BASE_URL=https://goms-dev.firebaseapp.com` — it now actually
  talks to `goms-api` / Cloud SQL instead of running local-only.
- `.gitlab-ci.yml`'s `deploy-dev` job updated to do this on every future
  manual trigger (still gated `when: manual`, not automatic).
- `goms-ci-deploy` granted `roles/firebasehosting.admin` on `goms-dev` only
  (`infra/dev/wif.tf`); `infra/prod` untouched.
- Two pre-existing bugs fixed (both predate this deployment task, found
  while getting a real build to compile): a missing `avatarFor` prop on
  `MultiSelectDropdown.tsx`, and a `.gitlab-ci.yml` firebase-deploy command
  that relied on the git-ignored `.firebaserc` alias instead of the literal
  project id.
- This specific deploy was done **manually** (clean git worktree, `npm ci`,
  `npm run build`, `firebase deploy`) because GitLab's shared-runner
  scheduler would not pick up any job for this project on 2026-09-02 despite
  healthy quota/runners/platform status. The CI fix is committed and will
  take over automatically once that's resolved — re-trigger `deploy-dev`
  from the pipeline view when it is.

### Previous claims in this document were inaccurate

This doc previously said `deploy-dev` deploys "Cloud Run + Firebase" — it
only ever deployed Cloud Run. It also described a 60+ test suite; the actual
file (`e2e/26-task-enhancements.spec.ts`) has 23 `test()` blocks. Numbers
below are corrected to match the real file and a real run against goms-dev.

---

## Running the E2E suite

```bash
npx playwright test e2e/26-task-enhancements.spec.ts --reporter=list
```

`playwright.config.ts` already defaults `baseURL` to
`https://goms-dev.firebaseapp.com`; override with `BASE_URL=...` if needed.

## Result of the 2026-09-02 run against the real goms-dev backend

**12 passed, 11 failed** (previously misreported as "23/23" — that run was
against local-only IndexedDB mode, not this backend).

Spot-checking 5 of the 11 failures shows they wait on specific named
fixtures (e.g. "Priya Nair", "Vikram Rao", "Jayendrasinh Puwar", "Mr. Rohit
Tiku", "QA Kickoff Meeting") that exist in the app's local demo/IndexedDB
bootstrap data but were not found in the real `goms-dev` Postgres database.
That looks like a seed-data/fixture mismatch rather than an application bug,
but this has only been confirmed for 5 of the 11 — treat the rest as
unconfirmed until checked individually. Full list of failing tests:

- Phase 5.1–5.2: Department contact picker (State → District → City)
- Phase 5.2: Multi-contact numbers on department
- Phase 3.2: Company field relabeled to read-only Department
- Phase 2.2: People directory search filters
- Phase 2.1: Employee profile picture clipboard paste target
- Phase 4.1: Create opportunity, pick Sales person
- Phase 8.4: Edit Meeting updates the same record, type read-only
- Phase 6.1–6.3: GM auto-derives when RM is changed, persists in org chart
- Phase 9.1–9.2: Employee avatars render in directory/detail view
- Phase 9.2–9.4: Avatars render for opportunity owners/meeting attendees
- Ownership set on an employee reflected consistently after reload

**Before re-running and reporting a pass count**: don't accept a green
result as meaningful unless the hosted frontend is confirmed to actually be
calling the goms-dev API (check the TopBar "Connected to goms-dev" badge,
or that requests hit `/api/trpc/...` in the network tab) — a build without
`VITE_API_BASE_URL` will pass or fail differently against its own disposable
local store, which tells you nothing about the real backend.

## Admin Data Import — not covered by this suite

The suite's one Admin-Import test
(`Admin Data Import route is absent when the feature flag is off`) only
checks the *disabled* state. It does not test that Firebase auth or
authorized access actually works. Live-checked separately: `/admin/data-import`
currently 404s on the deployed site because the frontend build doesn't set
`VITE_ADMIN_IMPORT_ENABLED` (the backend's `ADMIN_IMPORT_ENABLED=true` is
already set for `goms-dev`, but that's a separate flag). Verifying the real
auth flow requires deciding whether to enable that frontend flag for the
`goms-dev` build first.

## Manual persistence check (done 2026-09-02, outside the E2E suite)

Created an employee via a direct call to the live
`/api/trpc/employees.create` endpoint, loaded `goms-dev.firebaseapp.com` in
a brand-new browser context, and confirmed the record was visible —
verifying the full browser → Firebase Hosting → Cloud Run → Cloud SQL →
browser reload path end-to-end. Test record deleted via `employees.delete`
afterward.

## What NOT to do

- Do **not** deploy to `goms-prod` (separate initiative).
- Do **not** report a pass count from this suite without confirming the
  hosted frontend was actually calling the goms-dev API for that run.
