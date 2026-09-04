# GOMS Authentication Architecture — Decision Record

**Date:** 2026-09-04
**Status:** Decided by explicit user instruction. This document is the spec for
`docs/superpowers/plans/2026-09-04-goms-auth-architecture-implementation-plan.md`. Nothing in this
document is implemented yet — see that plan for the build sequence, and its own header for the
current rollout status.

**Context this decision closes:** `goms-prod` has no authentication of any kind today (tracked as
DRIFT-001, `docs/superpowers/analysis/2026-08-27-goms-prod-temporary-drift-register.md`) — every
tRPC procedure is `publicProcedure`, and live `goms-prod` currently grants `allUsers` →
`roles/run.invoker` on its Cloud Run service **out-of-band, not through Terraform**
(`infra/prod/cloudrun.tf`'s own header comment, confirmed via `gcloud run services get-iam-policy`
2026-09-04). Any unauthenticated caller on the internet can today write to production reference and
business data. The full corporate-SSO question (`2026-08-26-goms-identity-provider-decision.md`,
Option A vs Option B) remains open and blocked on an Amnex IT answer that never arrived — this
decision does not wait for it, because it doesn't need to: Amnex's Google Workspace domain
(`@amnex.com`) already gives every real Amnex user a Google account, so plain Firebase Authentication
with a Google provider — the same mechanism already shipped for Admin Data Import
(`2026-09-01-goms-admin-import-firebase-auth-plan.md`) — closes the write-access hole without
federation, a new IdP integration, or waiting on IT.

---

## 1. Authentication model

- **Reads (queries) stay public** in this phase — no login required to browse/query GovCore.
- **Every mutation, across all business routers, requires authentication.**

This preserves today's browsing experience and closes only the actual vulnerability (unauthenticated
writes), without a broader, unrequested login wall.

## 2. Ordinary user authorization

The normal authenticated-user boundary is **a verified `@amnex.com` Google account** — not a
maintained allow-list:

- A verified (`email_verified: true`) Google account whose email ends in `@amnex.com` → authorized
  for ordinary GOMS mutations.
- Any other Google account (verified or not) → authenticated with Google, but not authorized for
  ordinary mutations.
- No per-user roster to maintain for this tier — it scales to every current and future Amnex
  employee automatically, unlike an explicit allow-list.

## 3. Admin authorization

A **separate, explicit admin allow-list** stays in place for administrative functions — generalized
from the existing `ADMIN_IMPORT_ALLOWED_EMAILS` pattern (`apps/api/src/auth/verifyAdminImportToken.ts`)
rather than copy-pasted per feature, and rather than treating every `@amnex.com` account as an admin:

- Admin Data Import keeps its own allow-list (`ADMIN_IMPORT_ALLOWED_EMAILS`), unchanged.
- A new, separate allow-list (`ADMIN_ALLOWED_EMAILS`) is introduced as reusable infrastructure for
  future master-data administration surfaces (e.g. `commercial.masters`) — built now, applied to a
  concrete router later, as a distinct, separately-scoped decision (not part of this rollout).

## 4. Frontend

- The main app's single remote tRPC client (`src/data/remote/repository.ts` — the choke point every
  business-router call goes through) attaches the current Firebase ID token to every request.
- Signed-out users keep full read/browse access; attempting a mutation surfaces a clear "Sign in with
  Google" prompt, triggered centrally (not duplicated at each of the ~60 mutation call sites).
- An authenticated non-`@amnex.com` account sees a clear "not authorized" message distinct from
  "not signed in."
- An expired/invalid token is handled cleanly — re-prompts for sign-in rather than surfacing a raw
  error.

## 5. Emergency read-only switch

`EMERGENCY_READ_ONLY`, a plain (non-secret) environment variable, default unset/`false`:

- When `true`, blocks every mutation centrally (reads keep working), regardless of whether the
  broader auth-enforcement flag (§6) is itself on or off — an incident kill switch independent of the
  auth rollout's own stage.
- Toggled via Cloud Run env var + redeploy of config only (no image rebuild) — reversible in minutes.
- Verified on `goms-dev` before it is ever relied on in `goms-prod`.

## 6. Rollout sequence

1. Implement backend auth middleware + mutation protection, gated behind a new
   `AUTH_ENFORCEMENT_ENABLED` flag (default unset/`false` — off means every procedure behaves exactly
   as it does today, a deliberate no-op).
2. Implement frontend token attachment + sign-in/re-auth handling.
3. Implement `EMERGENCY_READ_ONLY`.
4. Test all of the above thoroughly on `goms-dev`.
5. Verify existing authenticated flows (Admin Data Import) still work unaffected, against real GCP.
6. Verify: anonymous mutation → 401; `@amnex.com` mutation → success; non-Amnex authenticated
   mutation → denied; `EMERGENCY_READ_ONLY` → reads work, writes blocked; expired-token handling.
7. Deploy to production with `AUTH_ENFORCEMENT_ENABLED` left off — a no-op release — verify it, and
   only then flip the flag, **on the user's explicit approval**.

`goms-prod` is not touched by the implementation itself — only by this final, separately-approved
flag flip once `goms-dev` has proven the whole path end-to-end.

**Prerequisites for the production flip specifically** (found during the implementation's final
whole-branch review, 2026-09-04 — none of these exist yet in `goms-prod` and must land before
`AUTH_ENFORCEMENT_ENABLED=true` is ever set there):

1. `infra/prod/cloudrun.tf` needs a `FIREBASE_PROJECT_ID` env var pointing at a real, Authentication-
   enabled Firebase project for `goms-prod` (its current Firebase project is Hosting-only). Without
   it, `verifyIdToken` rejects every token — flipping the flag with this missing would 401 every
   mutation for every user, with no working sign-in path to recover.
2. `goms-prod`'s frontend build needs the four `VITE_FIREBASE_API_KEY`/`VITE_FIREBASE_AUTH_DOMAIN`/
   `VITE_FIREBASE_PROJECT_ID`/`VITE_FIREBASE_APP_ID` values set at build time, matching that same
   project. (The implementation itself makes their absence non-fatal — the app no longer white-
   screens without them — but sign-in simply won't work without them either.)
3. `goms-prod`'s own Firebase project needs Google added as an enabled sign-in provider (mirrors the
   dev-only `goms-dev-auth` project's setup, `2026-09-01-goms-admin-import-firebase-auth-plan.md`
   Task 6, but for `goms-prod`'s own project this time).

None of this is part of the current implementation plan — it's the concrete checklist for whoever
executes the eventual, separately-approved production flip.

## 7. Production test-data cleanup — re-confirmed by live read-only query, 2026-09-04

**Update, same day:** the initial repo/doc search below found no trace of these records — but a
fresh, read-only query against the real `goms-dev` and `goms-prod` Postgres (via the same one-off
Cloud Run Job override used for the earlier `ZVERIFY-*` investigation) found that **three of the four
named items are real rows in both `goms-dev` and `goms-prod`**, not just local seed fixtures. The
fourth ("5 ownership test rows") does not resolve cleanly — see below.

**Original repo-only search (superseded by the live query, kept for context):** `QA-001`/`QA-002`/a
"QA Test" department and `BOQ-2026-000003` did not appear in this repo's committed docs or code —
`src/data/seed.ts` only has the same names as local in-memory demo fixtures, and
`2026-09-03-goms-prod-final-readiness-audit.md:144` explicitly (and, it turns out, incorrectly for
the live-DB question) frames them as local-only. The repo search was not wrong about the docs; it was
answering the wrong question — these records were loaded into the real databases without ever being
named in a committed doc.

### Confirmed in `goms-prod` (read-only query, 2026-09-04)

| Record | Table | id | Notes |
|---|---|---|---|
| `QA Test` department | `hierarchy_nodes` | `52db2727-3314-47d0-b566-1eb488fb65cc` | code `QATD`, domain `org`, status `active`. Zero child hierarchy nodes, zero other employees under it. |
| `QA-001` (Vikram Rao) | `employees` | `892935a3-31e7-465a-a032-3d735b7899f7` | `org_node_id` = the QA Test department above. Zero `timeline_events`/`transfers`/`employee_charges` reference this id. |
| `QA-002` (Priya Nair) | `employees` | `33d06367-b625-4525-8653-bf3f63b5034e` | Same department. Same zero-dependents result. |
| `BOQ-2026-000003` | `commercial_boqs` | `1d2a1953-57b8-4957-ad01-7aa8c4bf5e97` | `department_id` = the QA Test department; `customer_name` = "Priya Nair" (QA-002's name) — clearly created against this same seed/demo data, status `approved`, created 2026-08-31. Has 2 `commercial_boq_line_items` (cascade-deleted with the BOQ, `ON DELETE CASCADE`) and 4 `commercial_audit_logs` rows (no FK — not cascade-deleted, become an orphaned-but-harmless historical trail, same as this repo's existing precedent of leaving `admin_import_runs` audit rows in place after deleting the test data they logged). |

**Confirmed dependency order for a real cleanup (FK constraints checked directly against the
migrations):** `commercial_boqs.department_id` and `employees.org_node_id` both
`REFERENCES hierarchy_nodes(id) ON DELETE RESTRICT` — the department row cannot be deleted while the
BOQ or the two employees still reference it. Delete in this order:

1. `DELETE FROM commercial_boqs WHERE id='1d2a1953-57b8-4957-ad01-7aa8c4bf5e97' AND boq_number='BOQ-2026-000003'` (cascades the 2 line items automatically; leave the 4 audit log rows in place).
2. `DELETE FROM employees WHERE id IN ('892935a3-31e7-465a-a032-3d735b7899f7','33d06367-b625-4525-8653-bf3f63b5034e') AND code IN ('QA-001','QA-002')`.
3. `DELETE FROM hierarchy_nodes WHERE id='52db2727-3314-47d0-b566-1eb488fb65cc' AND code='QATD'`.

Same guarded-transaction style as the earlier `ZVERIFY-*` cleanup (`DELETE ... WHERE id=$1 AND
code=$2`, rolled back if any statement doesn't affect exactly 1 row) applies directly here. **Not yet
executed — per instruction, awaiting explicit approval before any `goms-prod` deletion.**

The identical three records also exist in `goms-dev` (different ids, same codes/names) — same
cleanup applies there too, lower-stakes, if desired.

### "5 ownership test rows" — does not resolve cleanly, flagged rather than guessed

`goms-prod`'s `ownership_assignments` table has 8 rows total, not 5, and none are tied to the QA Test
department/employees/BOQ above at all. Exactly 5 of the 8 belong to one salesperson
(`sales_person_id = d45a9764-e7c0-42ee-8604-a59d446a1a13`) — a count-match for "5," but that
salesperson is **Akash Swain (`akash13@amnex.com`), status `active`** — a real name and a real
`@amnex.com` address, not an obviously synthetic test account. Of those 5 rows: 1 references a real,
still-existing org node (`MEITY`); the other 4 reference an opportunity and three "contact" entities
that **no longer exist** (`opportunities`/`customers` lookups both returned 0 rows for those ids) —
dangling references to already-deleted records, which is a real but separate data-integrity
observation (this schema's `ownership_assignments.entity_id` is a loose polymorphic reference with no
FK, so deleting an opportunity/contact never cleans up the ownership row that pointed at it).

**This does not look like "test data" in the way the other three items clearly are**, and deleting a
real employee's ownership history on a guess would be a mistake if the guess is wrong. Not included
in the cleanup plan above. If you can confirm what "5 ownership test rows" actually refers to (a
different table, a different filter, or confirmation that Akash Swain's 5 rows are in fact meant),
I'll fold it into the same guarded-transaction cleanup; otherwise this stays open as a separate,
unresolved item.

## 8. Read access stays public — an intentional decision, not an oversight

Recorded here explicitly per instruction: in this phase, every query/read procedure remains
`publicProcedure` — anyone with the URL can browse/read GOMS data without signing in. This is a
deliberate scope boundary (§1), not something left open by accident.

**Follow-up recommendation, for a future explicit decision:** once mutation auth (this plan) has been
live in `goms-prod` for a period and is stable, revisit whether reads should also require
authentication. Arguments for gating reads eventually: GOMS holds internal org-structure, employee,
and commercial-pricing data that arguably shouldn't be world-readable by URL alone, even read-only;
gating reads would also let `created_by`/`viewed_by`-style auditing extend to read access, not just
writes. Arguments for leaving reads public longer: it's zero-risk from a data-integrity standpoint
(nothing to corrupt), keeps today's zero-friction browsing experience for every internal user without
requiring them to ever sign in, and gating reads is a strictly larger, separate migration (every
router's queries, not just its mutations) that shouldn't be bundled into closing the write-access
hole. No recommendation is made on timing here — this is a decision for the user to make once the
mutation-auth rollout (this plan) has proven itself in production.

## 9. Explicit constraints on how this gets implemented

- `goms-prod` is not touched during implementation — build and verify entirely on `goms-dev`.
- `AUTH_ENFORCEMENT_ENABLED` is not turned on in `goms-prod` until the user explicitly approves it,
  separately from approving the code/infra changes themselves.
