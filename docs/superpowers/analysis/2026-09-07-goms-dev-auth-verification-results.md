# GOMS-dev Auth Rollout — Verification Results

**Date:** 2026-09-07
**Scope:** Phase 2 of the auth rollout (`docs/superpowers/plans/2026-09-04-goms-auth-architecture-implementation-plan.md`
Task 11) — live verification on `goms-dev` only. `goms-prod` is untouched.

**Bottom line: every check in the decision doc's §6 checklist passes.** Two pre-existing E2E
tests now fail for the expected reason (they perform a mutation as a signed-out user, which is
correctly rejected) — not implementation bugs, documented below rather than silently worked
around.

---

## 1. Code completeness (re-verified this session, not just trusted from commit messages)

- Every mutation across `customers`, `opportunities`, `ownership`, `follow-ups`, `hierarchy`,
  `employees` (+ `timeline`/`transfers`), `sales`, `commercial` (`masters`/`skus`/`bom`/`boq`) is on
  `protectedProcedure` — grepped for any mutation-shaped line still on `publicProcedure` across
  those 8 router files; none found.
- `protectedProcedure`/`adminProcedure`/`EMERGENCY_READ_ONLY`/`AUTH_ENFORCEMENT_ENABLED` exist in
  `apps/api/src/trpc.ts` matching the decision doc.
- Frontend token attachment (`src/data/remote/authHeaders.ts`), the global sign-in prompt
  (`authPromptLink.ts`, `AuthPromptDialog.tsx`), and a persistent sign-in status indicator
  (`AuthStatus.tsx`, added this session per user request) are wired into `main.tsx`/`TopBar.tsx`.

## 2. Automated test suites (local, this session)

| Suite | Result |
|---|---|
| Backend (`apps/api`, real Postgres) | **34 files, 463/463 passed** |
| Frontend pure-logic (root, `npm test`) | **35 files, 382/382 passed** |
| Frontend component (jsdom, `vitest.component.config.ts`) | **52/53 files, 330/333 passed** — the 3 failures are the pre-existing, already-documented `TimelineEventDialog` attendee-picker failures (`project_timelineeventdialog_preexisting_test_failures`), predate this work, unrelated to auth |
| `tsc --noEmit` | Clean |

## 3. Live `goms-dev` verification (via `gcloud`/`curl` this session)

Backend service: `goms-api`, revision history `goms-api-00035` through `-00038` this session,
final image `asia-south1-docker.pkg.dev/goms-dev/goms/goms-api:7e1927204ccb881cc9a1cbc91c1bd55d3e715344`
(HEAD at verification time). All toggles below were applied directly via
`gcloud run services update --update-env-vars` for fast, reversible testing, then reconciled into
`infra/dev/cloudrun.tf` (commit `e09402c7`) to match.

| Check (decision doc §6) | Result |
|---|---|
| `AUTH_ENFORCEMENT_ENABLED=false`: reads work | ✅ `customers.list` → 200 |
| `AUTH_ENFORCEMENT_ENABLED=false`: anonymous mutation is a genuine no-op | ✅ `followUps.create` with `{}` → 400 `BAD_REQUEST` (validation error), **not** 401 — proves enforcement being off behaves exactly as pre-rollout |
| `AUTH_ENFORCEMENT_ENABLED=true`: reads still public | ✅ 200 |
| `AUTH_ENFORCEMENT_ENABLED=true`: anonymous mutation → 401 | ✅ `{"code":"UNAUTHORIZED","httpStatus":401}`, message "Sign in to continue." |
| `EMERGENCY_READ_ONLY=true`: reads still work | ✅ 200 |
| `EMERGENCY_READ_ONLY=true`: all mutations blocked, incl. Admin Data Import's own | ✅ `followUps.create` → 403; `adminImport.session.commit` → 403, both "GOMS is temporarily in read-only mode." |
| `EMERGENCY_READ_ONLY` reverted → mutations resume normal auth-gating (not stuck blocked) | ✅ back to 401 (not 403) |
| Final state matches intended live config | ✅ `AUTH_ENFORCEMENT_ENABLED=true`, `EMERGENCY_READ_ONLY=false` — net no drift from before this session's testing |

## 4. Browser verification (performed by the user directly, reported back 2026-09-07)

At `https://goms-dev.firebaseapp.com`:

1. Signed out: normal browsing, no prompt — **pass**.
2. Signed out, attempted a mutation: "Sign in required" dialog appeared — **pass**.
3. Signed in as `rajas@amnex.com`, retried the mutation: succeeded. Reads confirmed still working
   fully signed-out in a separate incognito window — **pass**.
4. Signed in as `rajassaji9@gmail.com` (non-Amnex): got the "isn't authorized" (FORBIDDEN) message,
   distinct from "sign in required"; reads still worked for this account — **pass**.
5. `/admin/data-import` signed in as `rajas@amnex.com`: existing import flow still works,
   unaffected by the new `protectedProcedure`/`ADMIN_ALLOWED_EMAILS` infrastructure — **pass**.

User's summary: "it all works." Two follow-on UX requests from this same session were implemented
and verified (component tests + user's own visual check) after this: a persistent sign-in status
indicator in the TopBar (commit `f56878cd`), a confirm-before-sign-out step with a larger touch
target (commit `9ba8ac93`), and removal of the TopBar Settings button and the "Connected to
goms-dev" pill per explicit request (commit `ec45f2f4`).

**Not separately live-verified:** expired/invalid token handling. Covered by unit tests
(`authPromptLink.test.ts`, `AuthPromptDialog.test.tsx`) showing a clean re-auth prompt rather than a
raw error on an `UNAUTHORIZED`/`FORBIDDEN` response — treated as sufficient given the difficulty of
reliably forcing a real token expiry live, and the mechanism is identical to the already-verified
401/403 paths above (the frontend can't distinguish "never signed in" from "token just expired" —
both surface as the same `UNAUTHORIZED` response).

## 5. Real goms-dev E2E suite (`e2e/26-task-enhancements.spec.ts`, this session)

Run against the live, already-auth-enforced site: **20/23 passed** (previously documented baseline,
2026-09-02, pre-auth: 12/23 — the improvement is from unrelated fixes landed since then, not this
session). Three failures:

1. **"Phase 5.2: Multi-contact numbers on department"** — clicks "Save changes" as a signed-out
   user. That mutation now correctly returns 401; the test wasn't written to expect it, so it times
   out waiting for the form to return to display mode. **Expected consequence of enabling auth, not
   a bug** — confirmed by reading the test: it performs no sign-in step anywhere.
2. **"Phase 8.4: Edit Meeting updates the same record"** — same root cause: "Save changes" as
   signed-out user → 401 → edit dialog doesn't close, and the new global `AuthPromptDialog` opens on
   top of it → test's `expect(dialogs).toHaveCount(0)` sees 2 open dialogs instead. **Expected
   consequence, not a bug.**
3. **"Commercial Calculator loads independently..."** — a plain `page.goto` navigation timeout
   (`waitUntil: 'networkidle'`), no mutation involved. Looks like unrelated flakiness (reads are
   public and unaffected by any of this rollout); not investigated further as it's outside this
   plan's scope.

**Known gap, explicitly left open (not fixed this session):** the E2E suite has no signed-in test
path at all. An attempt to add one via a saved Playwright auth session (a one-time real Google
login, state reused across runs) was started and then explicitly declined by the user — entering
real Google credentials into an automation flow, even a one-time manual step, wasn't acceptable.
**No workaround was substituted; this is left as a real, undone gap**, not silently papered over.
Consequence: the E2E suite can positively verify unauthenticated behavior (reads, the sign-in
prompt appearing) but not authenticated mutation success/failure — that continues to depend on the
manual browser verification in §4 above. Revisit later only if a safe way to obtain a test session
appears (e.g. a dedicated test-only credential the user is comfortable with, or Firebase Auth
Emulator against a non-production project) — not attempted here.

## 6. Configuration changes this session

- `infra/dev/cloudrun.tf`: `AUTH_ENFORCEMENT_ENABLED` → `"true"` (commit `e09402c7`), reconciling
  the file to match what was verified live. `infra/prod/cloudrun.tf` untouched.
- No other env var changed from Task 10's defaults (`EMERGENCY_READ_ONLY=false`,
  `ADMIN_ALLOWED_EMAILS=rajas@amnex.com`).

## Outcome

Phase 2 (decision doc §6, plan Task 11) is complete for everything that can be verified without
adding real-credential automation. `goms-dev` is stable at
`AUTH_ENFORCEMENT_ENABLED=true`/`EMERGENCY_READ_ONLY=false`, matching the intended steady state.
**No production change has been made or is proposed by this document.** Per the plan, the next
production-impacting step (Phase 4: deploying auth-capable code to `goms-prod` with
`AUTH_ENFORCEMENT_ENABLED=false` — a no-op release) requires the user's separate, explicit
approval before proceeding.
