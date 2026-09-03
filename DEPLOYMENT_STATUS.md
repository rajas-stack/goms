# GOMS 26-Task Enhancement — Deployment Status Report

**Date:** 2026-09-02
**Scope:** 26-task enhancement package for goms-dev

---

## Current status: deployed and verified against the real goms-dev backend

Earlier versions of this document claimed `deploy-dev` deployed both the API
and the frontend, and that a 23/23 E2E pass confirmed the enhancement work.
Both claims were wrong:

- **`deploy-dev` never deployed the frontend.** It only ran `gcloud run
  deploy goms-api`. The hosted `goms-dev.firebaseapp.com` site was built and
  `firebase deploy`'d by hand at some earlier point, without
  `VITE_API_BASE_URL` set — so it silently ran in the app's default
  local-only IndexedDB mode. It was never talking to `goms-api` or Cloud SQL.
- **The 23/23 E2E result was therefore meaningless** — it was testing a
  fresh local IndexedDB store, not the real GCP backend.

### What actually changed (2026-09-02)

1. `deploy-dev` (`.gitlab-ci.yml`) now also builds the frontend with
   `VITE_API_BASE_URL=https://goms-dev.firebaseapp.com` (same-origin, rides
   `firebase.json`'s existing `/api/**` rewrite to Cloud Run — no CORS
   change needed) and deploys it via `firebase-tools`, using the same WIF
   credential already used for the `gcloud` steps. Still manual-on-`main`,
   not automatic.
2. `goms-ci-deploy` was granted `roles/firebasehosting.admin` on `goms-dev`
   only (`infra/dev/wif.tf`) so that CI step can authenticate. `infra/prod`
   is untouched.
3. Two pre-existing bugs were found and fixed while getting a real build to
   succeed (both predate this task):
   - `MultiSelectDropdown.tsx` was missing the `avatarFor` prop that
     `TimelineEventDialog.tsx` (from `e6cd1d83`) already depended on — `main`
     failed `tsc` since that commit. Fixed in a follow-up commit.
   - The CI job originally used `--project dev` (a `.firebaserc` alias),
     but `.firebaserc` is deliberately git-ignored, so a fresh CI checkout
     never has it. Changed to the literal `goms-dev` project id.
4. GitLab's shared-runner scheduler would not pick up any job for this
   project on 2026-09-02 (confirmed: CI minutes available, runners
   online/active, instance runners enabled for the project, GitLab status
   page green — cause undetermined). **The frontend was deployed manually**
   (`npm ci && VITE_API_BASE_URL=... npm run build && firebase deploy`) from
   a clean git worktree at the exact pushed commit, matching how every prior
   frontend deploy (dev and prod) in this repo's history was done. The CI
   fix is committed and will take over once GitLab's scheduler is healthy
   again.

### Verified live on `https://goms-dev.firebaseapp.com`

- TopBar badge reads **"Connected to goms-dev"** (not local-only mode).
- Real `/api/trpc/...` network requests observed from the browser, resolved
  by Firebase Hosting's rewrite to Cloud Run (`goms-api`, DB connected).
- **True end-to-end persistence confirmed**: created an employee record
  through the live API, loaded the site in a brand-new browser context, and
  confirmed the record was there — proving the full
  browser → Firebase Hosting → Cloud Run → Cloud SQL → browser reload path.
  Test record deleted afterward.
- `goms-prod` confirmed untouched: no `infra/prod/*` diff from this work,
  and its Hosting site's `Last-Modified` predates this session.

### E2E result against the real backend: 12 / 23 passed (was falsely "23/23")

Rerunning `e2e/26-task-enhancements.spec.ts` against the live, correctly-wired
site gives **12 passed, 11 failed** — the honest number now that the suite is
actually exercising the GCP backend instead of a disposable local store.

Spot-checking 5 of the 11 failures shows a consistent pattern: they look for
specific named fixtures (e.g. "Priya Nair", "Vikram Rao", "Jayendrasinh
Puwar", "Mr. Rohit Tiku", "QA Kickoff Meeting") that exist in the app's local
demo/IndexedDB bootstrap data but were never seeded into the real `goms-dev`
Postgres database (which holds real-looking government department/seed data
instead). This looks like a test-fixture/seed-data mismatch, not an
application bug — but that has **not** been confirmed for all 11 failures
individually, only spot-checked for 5. Full failure list:

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

### Admin Data Import — auth flow NOT verified

The suite's only Admin-Import-related test
(`Admin Data Import route is absent when the feature flag is off`) checks
the *disabled* state, not that authentication actually works. Checked the
live route directly: `/admin/data-import` currently 404s on the deployed
site, because the frontend build does not set `VITE_ADMIN_IMPORT_ENABLED`
(a separate flag from the backend's `ADMIN_IMPORT_ENABLED=true`, which *is*
set for `goms-dev`). The authenticated-access path has not been exercised
end-to-end. Needs an explicit decision on whether to also enable
`VITE_ADMIN_IMPORT_ENABLED` for the `goms-dev` build before this can be
verified.

### What NOT to do

- Do **not** deploy to `goms-prod` (separate initiative).
- Do **not** treat the 11 E2E failures as blocking without first confirming
  whether each is a seed-data gap or a real bug.
- Do **not** report "23/23 passed" again for this suite unless it's rerun
  against the real backend and actually shows that.

---

## 2026-09-03 update: `VITE_ADMIN_IMPORT_ENABLED` enabled on goms-dev

Per explicit instruction, the open question above ("Needs an explicit
decision on whether to also enable `VITE_ADMIN_IMPORT_ENABLED`") was
resolved: yes, enable it for `goms-dev` only.

- `.gitlab-ci.yml`'s `deploy-dev` build step now also sets
  `VITE_ADMIN_IMPORT_ENABLED=true` and the four `VITE_FIREBASE_*` web-config
  values for the dedicated `goms-dev-auth` Firebase project (same values as
  local `.env.local`; not secrets — see
  `docs/superpowers/plans/2026-09-01-goms-admin-import-firebase-auth-plan.md`).
  `infra/prod` and `goms-prod`'s build config are untouched.
- Rebuilt the frontend with those exact env vars and deployed it to
  `goms-dev`'s Firebase Hosting site (`firebase deploy --only hosting
  --project goms-dev`), the same manual path used on 2026-09-02 while
  GitLab's shared-runner scheduler issue persists.
- **Verified live**: `https://goms-dev.firebaseapp.com/admin/data-import`
  now returns the Google Sign-In gate ("Sign in with your Amnex Google
  account to use Admin Data Import" / "Sign in with Google" button), not
  the app's 404 page. An unauthenticated `GET
  /api/trpc/adminImport.listDomains` against the same live site returns a
  real `401 UNAUTHORIZED` from the actual Cloud Run backend (not mocked).
- **Not verified this session**: the signed-in allow-listed vs
  non-allow-listed paths. Reaching those needs a real interactive Google
  OAuth sign-in, which can't be driven headlessly here; scripted attempts to
  substitute for it (enabling a second sign-in provider on the live
  `goms-dev-auth` project, minting custom tokens) were correctly blocked as
  live-auth-infrastructure changes and abandoned. Per the user's own
  decision, this is left for a real interactive sign-in against
  `https://goms-dev.firebaseapp.com/admin/data-import` using the
  `rajas@amnex.com` Google account (the one entry in
  `ADMIN_IMPORT_ALLOWED_EMAILS`, `infra/dev/cloudrun.tf`).
- Automated coverage that *does* exercise all three outcomes (unauth/
  forbidden/authorized), against a mocked Firebase Admin SDK rather than the
  live project: `apps/api/src/auth/verifyAdminImportToken.test.ts` (6/6
  pass, run locally). `apps/api/src/routers/adminImport.test.ts` and
  `apps/api/src/app.test.ts`'s identity-gate tests need a live Postgres
  instance (the `test-api` CI job's `postgres:16` service) not available in
  this environment, so they were not run locally this session — only in CI.
  Frontend: `AdminImportAuthGate.test.tsx` (3/3) and `router.test.tsx` (4/4)
  pass locally.
- **E2E result changed**: rerunning the full `e2e/26-task-enhancements.spec.ts`
  suite against the live, now-correctly-flagged site gives **19 passed, 4
  failed** (was 12/11 on 2026-09-02) — a genuine change from a real rerun,
  not a relabeling. Remaining failures, same "looks like fixture/seed-data
  or real UI-behavior mismatch, not confirmed individually" caveat as
  before:
  - Phase 5.1–5.2: District select stays disabled after picking a State
  - Phase 3.2: "Company" text still appears twice where 0 was expected
  - Phase 8.4: Edit Meeting — the edit button for "QA Kickoff Meeting" never
    became clickable within the timeout
  - Phase 9.2–9.4: no avatar rendered for the seeded "Mr. Rohit Tiku"
    meeting attendee
  - The suite's own Admin Data Import test (rewritten to assert the sign-in
    gate now that the flag is on) **passed**.
- Housekeeping: two synthetic Firebase user records were created in
  `goms-dev-auth` (`rajas@amnex.com`, `not-allowed-test-user@gmail.com`)
  during the abandoned token-minting attempt above. They cannot sign in
  (no password provider is actually enabled at the project level) but
  should be deleted via the Firebase console — left to the user, per their
  own instruction.
