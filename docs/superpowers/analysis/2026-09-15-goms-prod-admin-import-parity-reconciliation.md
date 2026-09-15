# GOMS Prod Admin Import — Parity Audit Finding #1 Reconciliation

**Date:** 2026-09-15
**Trigger:** Finding #1 of the 2026-09-15 dev-vs-prod parity audit — `infra/prod/cloudrun.tf`'s
comment claimed `ADMIN_IMPORT_ENABLED` "stays unset" on `goms-prod`, but the live service has had
it set to `"true"` (with a populated `ADMIN_IMPORT_ALLOWED_EMAILS`) since some point after
2026-09-04. This document records what was inspected and what was changed.
**Not deployed. No GCP/Firebase setting touched. No access enabled or disabled.** The only change
made is to `infra/prod/cloudrun.tf`'s comment/declared env vars, bringing the file in line with
already-live reality.

## 1. Confirmed live state (`gcloud run services describe goms-api --project=goms-prod`)

- Revision `goms-api-00021-4gx`, 100% traffic, image commit `e27132ca86d5cb1adc1ba0f8192d6fb11f37cc34`.
- Relevant env vars: `ADMIN_IMPORT_ENABLED=true`, `ADMIN_IMPORT_ALLOWED_EMAILS=rajas@amnex.com,rajassaji9@gmail.com,shubham16@amnex.com`, `FIREBASE_PROJECT_ID=goms-prod`, `AUTH_ENFORCEMENT_ENABLED=true`, `EMERGENCY_READ_ONLY=false`.
- `infra/prod/cloudrun.tf` declared neither `ADMIN_IMPORT_ENABLED` nor `ADMIN_IMPORT_ALLOWED_EMAILS` at all — the file wasn't just stale, it had no representation of these two env vars whatsoever, so a `terraform apply` of the prior file would have silently unset them on the live service.

## 2. Effective auth path for Admin Import on prod (read from source, not inferred)

Call chain: `adminImportProcedure` (`apps/api/src/trpc.ts`) →

1. **Feature gate:** `ADMIN_IMPORT_ENABLED !== 'true'` → `404 NOT_FOUND` (indistinguishable from the route not existing). Currently passes (`true` live).
2. **Authentication (unconditional — does not depend on `AUTH_ENFORCEMENT_ENABLED`):** `verifyAdminImportToken` (`apps/api/src/auth/verifyAdminImportToken.ts`) → `verifyFirebaseToken` (`apps/api/src/auth/identity.ts`):
   - Requires an `Authorization: Bearer <idToken>` header.
   - Verifies the token via the Firebase Admin SDK (`getFirebaseAuth()`, `apps/api/src/auth/firebaseAdmin.ts`), initialized with `projectId: process.env.FIREBASE_PROJECT_ID` — on prod that's `goms-prod` itself. The SDK validates the token's signature against Google's public certs and checks `aud`/`iss` match `goms-prod` — a real cryptographic check, not a shape/format check.
   - Requires `email_verified === true`.
3. **Authorization:** the verified email (case-insensitive) must appear in `ADMIN_IMPORT_ALLOWED_EMAILS` (`isAllowListed`, `apps/api/src/auth/identity.ts`) — currently the 3 addresses listed above. Anyone else's real, verified Google identity is rejected with `403 FORBIDDEN`.

**Conclusion:** the "real auth gate" the old Terraform comment said didn't exist for prod has, in fact, existed unconditionally since `adminImportProcedure` was written — it was never contingent on the separate `AUTH_ENFORCEMENT_ENABLED` mutation-auth rollout. Enabling the flag on prod does not expose an unauthenticated endpoint; it exposes an endpoint gated by a verified `goms-prod` Google identity plus a 3-person allow-list.

## 3. Confirmed: production frontend does not expose this feature

- No `deploy-prod` stage exists in `.gitlab-ci.yml` — `goms-prod` Hosting releases are manual/out-of-band, same convention as the API.
- `VITE_ADMIN_IMPORT_ENABLED` is set to `true` only inside `deploy-dev`'s build step (`.gitlab-ci.yml`); no prod build has ever set it.
- Verified directly against the live artifact: fetched `https://goms-prod.web.app`'s current JS bundle and searched it — no `admin/data-import` route string and no `goms-dev-auth` reference anywhere in it (the dev bundle, fetched the same way, contains both).

So today, the only way to reach `adminImport.*` on prod is a direct API call carrying a valid `goms-prod` Firebase ID token for one of the 3 allow-listed emails — there is no UI path, accidental or otherwise.

## 4. What was actually changed this session

- `infra/prod/cloudrun.tf`: replaced the stale "stays unset" comment with an accurate description of the live state (§1 above), declared `ADMIN_IMPORT_ENABLED = "true"` and `ADMIN_IMPORT_ALLOWED_EMAILS` matching the confirmed live values, and documented the auth path (§2) and frontend non-exposure (§3) inline.
- This is a documentation/IaC-description change only. It was not applied (`terraform apply` was not run), nothing was deployed, and no GCP/Firebase setting was touched — it only makes the file's *description* of prod match what `gcloud` already showed as live.

## 5. Not addressed by this reconciliation (open items, unchanged)

- Whether the 2026-08-27 enablement plan's Gates 1–5 (`docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md`) were followed before this was flipped on live is not evidenced in the repo — that plan proposed a different mechanism (`adminProcedure` chaining) than what's actually live (`verifyAdminImportToken`'s own allow-list, from the later 2026-09-01 Firebase Auth plan). Reconstructing exactly when/why the switch happened out-of-band is out of scope here.
- No audit-trail/logging review was done for who has actually called `adminImport.*` on prod.
- Whether the 3-person allow-list is still the intended roster is unreviewed — this document only confirms it matches what's live, not that it's correct.
