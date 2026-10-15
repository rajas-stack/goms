# GOMS Google OAuth & Identity Linking Release Runbook

**Spec:** [docs/superpowers/specs/2026-10-06-google-oauth-login-design.md](../specs/2026-10-06-google-oauth-login-design.md)  
**Implementation Plan:** [docs/superpowers/plans/2026-10-06-google-oauth-login-implementation-plan.md](../plans/2026-10-06-google-oauth-login-implementation-plan.md)  
**Pre-Production Checklist:** [PRE-PRODUCTION-CHECKLIST.md](../../../PRE-PRODUCTION-CHECKLIST.md)  
**Target Environments:** `goms-dev` (staging verification) $\rightarrow$ `goms-prod` (staged release)  
**Strict Safety Policy:** Documentation update only. Do not push, merge, or deploy as part of this update. Each production-changing stage requires separate, explicit owner approval.

---

## 1. Scope Boundary & Staged Isolation

> [!IMPORTANT]
> **Owner Approval Scope:** The approval received authorizes changing the minimum soak period from 7 days to **48 consecutive hours** under strict entry gates and monitoring conditions.
>
> It does **NOT** authorize production migrations, production backfills, secret/configuration changes, deployments, traffic shifts, OAuth-only mode, or Firebase removal.
>
> Each stage is isolated and requires its own separate owner sign-off:
> - **Stage 1:** Release 1 Deployment & Additive Migration (Firebase active & default).
> - **Stage 2:** R3 Backfill & Coverage Verification.
> - **Stage 3:** 48-Hour Consecutive Soak Period & Evidence Reporting.
> - **Stage 4:** OAuth Cutover Package & Traffic Shift.
> - **Stage 5:** Firebase Auth Deprecation & Removal.

---

## 2. Decision & Change History

| Date | Stage / Item | Previous Decision | Updated Decision | Rationale & Approved Conditions |
|---|---|---|---|---|
| **2026-10-14** | Production Soak Duration | Minimum **7-day soak** required in production. | N/A (Baseline established) | Establish confidence across full weekly enterprise cycle before removing Firebase sign-in. |
| **2026-10-15** | Production Soak Duration | Minimum 7-day soak required. | Minimum soak period reduced to **48 consecutive hours**. | Approved by project owner subject to 5 strict clock-start conditions, continuous monitoring, zero duplicate Google subjects, sanitized diagnostics, mandatory 48-hour restart on data/auth reliability impact, and comprehensive evidence report. |

---

## 3. Stage 1: Release 1 Deployment & Verification

*Precondition:* Explicit owner approval for Stage 1 deployment.

### 3.1 Pre-Deployment Database Snapshot
Take an on-demand Cloud SQL backup before executing any migration:
```bash
gcloud sql backups create \
  --instance=goms-prod-db \
  --project=goms-prod \
  --description="pre-release-1-google-sub-migration"
```

### 3.2 Additive Migration Execution
Apply migration `1791764900000_google-integration-sub-link` via the Cloud Run migration job:
```bash
gcloud run jobs execute goms-migrate \
  --project=goms-prod \
  --region=asia-south1
```

**Verify migration invariants:**
1. Column added safely: `google_sub TEXT` on `google_integration_settings`.
2. Partial unique index exists: `google_integration_settings_google_sub_key` on `(google_sub) WHERE google_sub IS NOT NULL`.
3. Zero rows deleted or modified. Pre-existing rows retain `google_sub = NULL`.

### 3.3 API Deployment (Firebase Auth Still Enabled)
Deploy Cloud Run revision with the reviewed container image:
- `AUTH_PROVIDER=firebase` (Firebase authentication remains active and default).
- `verifyLinkedIdentity` enabled to link identities dynamically via `firebase.identities['google.com']`.
- Verify procedures: `health.check` returns 200 OK; Firebase sign-in and token verification work unchanged.

---

## 4. Stage 2: R3 Backfill & Coverage Verification

*Precondition:* Explicit owner approval for Stage 2 R3 backfill.

### 4.1 Execute Backfill
Run the reviewed R3 backfill script to associate known Google subjects with existing `google_integration_settings` rows based on verified records:
```bash
# Executed via one-off admin task or migration script in goms-prod
```

### 4.2 Verify Settings Coverage & Integrity Gates
Run verification queries against production database:

1. **Duplicate Google Subjects Check (MUST BE ZERO):**
```sql
SELECT google_sub, COUNT(*) 
FROM google_integration_settings 
WHERE google_sub IS NOT NULL 
GROUP BY google_sub 
HAVING COUNT(*) > 1;
```
*Gate:* Returns 0 rows.

2. **Unresolved Information-Bearing Rows Check (MUST BE ZERO):**
```sql
SELECT COUNT(*) 
FROM google_integration_settings 
WHERE google_sub IS NULL 
  AND settings IS NOT NULL 
  AND settings::text != '{}'::text;
```
*Gate:* Confirms 0 unresolved information-bearing rows requiring manual assignment.

3. **Record Coverage Counts:**
Record total rows, linked rows (`google_sub IS NOT NULL`), and unlinked placeholder rows.

---

## 5. Stage 3: 48-Hour Consecutive Soak Runbook

### 5.1 When the 48-Hour Clock Starts
The 48-hour soak timer starts counting **ONLY** after all 5 gates pass:
1. **Release 1 is deployed and verified**, with Firebase authentication still active.
2. **The separately approved R3 backfill** has completed successfully.
3. **The settings-coverage check confirms** zero duplicate Google subjects and zero unresolved information-bearing rows.
4. **Representative existing-user sign-in and saved-settings checks pass** (verified that test/pilot accounts retrieve their saved Docs/Sheets settings).
5. **Monitoring and rollback readiness are confirmed** (alert policies active, runbook verified).

*Action:* Record exact start timestamp:
`SOAK_START_TIMESTAMP = YYYY-MM-DDTHH:MM:SSZ`

---

### 5.2 During the Soak: Monitoring & Observability

Monitor production continuously. **Record counts and sanitized diagnostics only.** Never print or store tokens, auth codes, secrets, or user credentials in logs.

#### Telemetry & Cloud Logging Filters
1. **Identity-Linking Errors:**
```
resource.type="cloud_run_revision"
jsonPayload.event="google_integration.link_error" OR jsonPayload.event="auth.identity_mismatch"
```
2. **Authentication Failures:**
```
resource.type="cloud_run_revision"
jsonPayload.event="auth.failure" OR jsonPayload.error="UNAUTHORIZED"
```
3. **API 5xx Server Errors:**
```
resource.type="cloud_run_revision"
httpRequest.status>=500
```
4. **Duplicate Subject Invariant Verification:**
Run periodic read-only query during soak:
```sql
SELECT COUNT(*) FROM (
  SELECT google_sub FROM google_integration_settings 
  WHERE google_sub IS NOT NULL 
  GROUP BY google_sub HAVING COUNT(*) > 1
) duplicates;
```
Must remain strictly `0`.

5. **Saved-Settings Continuity:**
Verify that users fetching integration settings (`googleIntegrations.get`) experience continuity without settings reset or data loss.

---

### 5.3 Pause & Restart Protocol

If a blocking issue, data inconsistency, or authentication failure occurs:

1. **Pause Immediately:**
   - Record pause timestamp and current elapsed soak duration.
   - Collect sanitized diagnostics (error counts, affected endpoints, request IDs).
   - Begin triage and isolate cause.
2. **Evaluate Impact on Data Integrity or Authentication Reliability:**
   - **Case A: External/Unrelated transient issue (no integrity/auth impact):**
     Resolve issue, verify tests pass, and **resume** the remaining soak time.
   - **Case B: Data integrity or authentication reliability was affected:**
     *(e.g., duplicate subject detected, settings lost/overwritten, identity resolution bug, unexpected 5xx in auth)*:
     - Resolve the issue and apply reviewed fix.
     - Re-verify all Stage 1 & Stage 2 gates.
     - **RESTART THE 48-HOUR SOAK PERIOD FROM ZERO.** Clock resets completely.

---

### 5.4 End-of-Soak Evidence Report

At `SOAK_START_TIMESTAMP + 48 hours` of consecutive uninterrupted soak, generate the evidence report:

```markdown
# 48-Hour Soak Evidence Report

- **Exact Soak Start Time:** YYYY-MM-DDTHH:MM:SSZ
- **Exact Soak End Time:**   YYYY-MM-DDTHH:MM:SSZ (Total: 48 consecutive hours)
- **Coverage Counts:**
  - Total settings rows: <N>
  - Linked rows (google_sub populated): <N>
  - Unresolved information-bearing rows: 0 (Verified)
- **Error & Failure Diagnostics:**
  - Identity linking errors: <N> (Sanitized summary)
  - Authentication failures: <N> (Baseline vs. anomalous)
  - API 5xx errors: <N> (Distinguished from known baseline)
- **Saved-Settings & Invariant Checks:**
  - Duplicate Google subjects: 0 (Verified via query)
  - Saved-settings continuity checks: PASSED
- **Logging & Security Protection:**
  - Logging protection verified: No tokens/secrets in logs (PASSED)
  - Rollback readiness: Current revision IDs recorded and validated (CONFIRMED)
- **Outstanding / Residual Risks:**
  - <Detail any observed edge cases or confirm none>
```

---

## 6. Stage 4: OAuth Cutover Package (Separate Approval Required)

If every gate in the evidence report passes, prepare the OAuth Cutover Package for project owner review:

1. **Configuration Revision:**
   - Add Secret Manager secret versions (`GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_SESSION_SECRET`).
   - Stage `AUTH_PROVIDER=both` $\rightarrow$ verify OAuth sign-in path alongside Firebase.
   - Cutover `AUTH_PROVIDER=oauth` $\rightarrow$ GOMS OAuth session tokens become primary.
2. **Frontend Deployment:**
   - Deploy web build with `VITE_AUTH_PROVIDER=oauth`.
3. **Rollback Plan:**
   - Prepared command to shift traffic back to Release 1 revision in under 60 seconds if regressions occur.

*Constraint:* Do not execute cutover without explicit owner authorization.

---

## 7. Stage 5: Firebase Removal (Separate Approval Required)

After a sustained post-cutover operational period:
1. Decommission Firebase Admin SDK initialization in `apps/api/src/app.ts`.
2. Remove client Firebase SDK dependencies and configuration from `src/lib/firebaseAuth.ts`.
3. Verify clean code base with no residual Firebase auth artifacts.

