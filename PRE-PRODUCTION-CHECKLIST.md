# GOMS Pre-Production Checklist

**Target:** Google OAuth Sign-In & Identity Linking Cutover  
**Scope:** Production Deployment Gates, Staged Verification & Soak Period Controls  
**Status:** In Progress (Documentation Update — Shorter Soak Period Approved)  
**Strict Safety Constraint:** Documentation update only. Do not push, merge, or deploy as part of this update. Each production-changing stage requires separate, explicit owner approval.

---

## 1. Scope Boundary & Stage Separation

> [!IMPORTANT]
> **Owner Approval Scope:** The approval received applies to the **48-consecutive-hour minimum soak period only**.
> It does **NOT** authorize production migrations, production backfills, secret or configuration changes, deployments, traffic shifts, OAuth-only mode, or Firebase removal.
>
> Each stage is strictly isolated and requires its own separate owner approval before execution:
> 1. **Stage 1 (Release 1):** Code deployment & additive migration, with Firebase authentication remaining active and default.
> 2. **Stage 2 (R3 Backfill):** Standalone data backfill linking Google subjects to saved settings.
> 3. **Stage 3 (48-Hour Soak):** 48 consecutive hours of active monitoring under live traffic.
> 4. **Stage 4 (OAuth Cutover):** Transition to OAuth provider mode and client handoff.
> 5. **Stage 5 (Firebase Removal):** Complete decommissioning of Firebase authentication dependencies.

---

## 2. Decision & Change History

| Date | Previous Decision | Updated Decision | Rationale / Conditions | Approved By |
|---|---|---|---|---|
| **2026-10-14** | Baseline minimum **7-day soak** required in production with Firebase active. | N/A (Baseline policy established) | High confidence window to observe full weekly enterprise usage cycles and assure zero regression in saved settings. | Project Owner |
| **2026-10-15** | Minimum 7-day soak period. | Minimum soak period changed to **48 consecutive hours**. | Shorter soak approved subject to strict entry prerequisites, comprehensive real-time telemetry, zero duplicate subjects, explicit pause/restart triggers for reliability/integrity impact, and an end-of-soak evidence report. | Project Owner |

---

## 3. Pre-Production Staging & Gate Checklist

### Stage 1: Release 1 Deployment & Verification (Separate Approval Required)
- [ ] **Approval Gate:** Owner has explicitly approved Release 1 deployment.
- [ ] **Database Pre-Check:** Cloud SQL on-demand backup created and verified (`gcloud sql backups create`).
- [ ] **Additive Migration:** Apply migration `1791764900000_google-integration-sub-link` via Cloud Run job `goms-migrate`.
  - [ ] Column `google_sub` added (nullable `TEXT`).
  - [ ] Partial unique index `google_integration_settings_google_sub_key` created (`WHERE google_sub IS NOT NULL`).
  - [ ] Zero mutation or deletion of existing row counts.
- [ ] **API Deployment:** Deploy Cloud Run revision with:
  - [ ] `AUTH_PROVIDER=firebase` (Firebase auth remains active and default).
  - [ ] Additive dual-identity lookup capability enabled (`verifyLinkedIdentity`).
- [ ] **Verification:**
  - [ ] Health check `health.check` returns 200 OK.
  - [ ] Existing Firebase authentication flows work uninterrupted.
  - [ ] Read-only settings queries succeed without auto-stamping when `EMERGENCY_READ_ONLY=true`.

---

### Stage 2: R3 Backfill Execution (Separate Approval Required)
- [ ] **Approval Gate:** Owner has explicitly approved R3 backfill execution.
- [ ] **Backfill Execution:** Run the approved R3 backfill script against production Cloud SQL.
- [ ] **Settings-Coverage Verification Gate:**
  - [ ] `SELECT COUNT(*)` confirms **zero duplicate Google subjects** (`google_sub`).
  - [ ] Confirms **zero unresolved information-bearing rows** (all rows with non-empty settings have resolved identities).
  - [ ] Record baseline counts of linked rows vs. unlinked legacy rows.

---

### Stage 3: 48-Hour Consecutive Soak Period

#### A. Entry Conditions — When the 48-Hour Clock Starts
The 48-hour soak timer **MUST NOT** start until all five conditions are verified and recorded:
- [ ] **Gate 1:** Release 1 is deployed and verified in production, with Firebase authentication actively serving all user sessions.
- [ ] **Gate 2:** The separately approved R3 backfill has completed successfully with zero schema or data corruption.
- [ ] **Gate 3:** The settings-coverage check confirms **zero duplicate Google subjects** and **zero unresolved information-bearing rows**.
- [ ] **Gate 4:** Representative existing-user sign-in and saved-settings validation checks pass (verified read & write of user integration settings).
- [ ] **Gate 5:** Real-time monitoring filters are active and rollback readiness is confirmed.
- [ ] **Timestamp Recorded:** Record exact start timestamp (`UTC` and `IST`): `YYYY-MM-DDTHH:MM:SSZ`.

#### B. During the Soak — Telemetry & Observability
Continuously monitor production logs and metrics. Record counts and sanitized diagnostics only (never record access tokens, refresh tokens, auth codes, or user credentials).

- [ ] **Identity-Linking Errors:** Filter for linking failures, schema mismatches, or unhandled token subject extraction errors.
- [ ] **Authentication Failures:** Filter for abnormal spikes in Firebase or OAuth token rejections.
- [ ] **API 5xx Responses:** Track Cloud Run 5xx response rates (must remain within known baseline).
- [ ] **Duplicate Subjects:** Run periodic SQL checks to guarantee the partial unique index invariant holds (`google_sub IS NOT NULL`).
- [ ] **Saved-Settings Continuity:** Validate that existing users retain access to their saved Docs, Sheets, and Cloud Project IDs across logins.

#### C. Pause & Restart Protocol
- [ ] **Pause Trigger:** If any blocking issue, elevated error rate, or settings resolution failure appears:
  1. Immediately pause the soak timer.
  2. Record the pause timestamp and sanitized diagnostics.
  3. Investigate root cause and prepare a fix.
- [ ] **Resume vs. Restart Decision:**
  - **Resume:** Allowed only if the issue was external/environmental and did **not** affect data integrity or authentication reliability, after verification passes.
  - **RESTART 48-HOUR CLOCK:** Mandatory if data integrity (corrupted rows, duplicate subjects, overwritten settings) or authentication reliability was impacted. Reset timer to 0 hours upon resolving and verifying the fix.

#### D. End-of-Soak Evidence Report
At the completion of 48 consecutive hours without unhandled blocking incidents, compile the evidence report containing:
- [ ] Exact soak start and end timestamps (minimum 48 consecutive hours).
- [ ] Total coverage counts: stamped rows, unstamped legacy rows, and proof of zero unresolved information-bearing rows.
- [ ] Authentication error counts and API 5xx counts, clearly distinguished from known baseline failures.
- [ ] Saved-settings continuity verification results and duplicate-subject verification query results (count = 0).
- [ ] Logging protection verification (confirm no tokens or secrets appeared in logs).
- [ ] Rollback readiness confirmation (current revision IDs and database state verified).
- [ ] Statement of any outstanding or residual risks.

---

### Stage 4: OAuth Cutover Package (Separate Approval Required)
- [ ] **Gate:** Evidence report reviewed and formally approved by the project owner.
- [ ] Prepare cutover package:
  - [ ] Production secret injection (`goms-google-oauth-client-secret`, `goms-auth-session-secret`).
  - [ ] Cloud Run environment revision to `AUTH_PROVIDER=both` (and later `oauth`).
  - [ ] Frontend hosting build switch (`VITE_AUTH_PROVIDER=oauth`).
  - [ ] Traffic shift rehearsal and rollback plan.
- [ ] Await explicit owner sign-off prior to applying any cutover command.

---

### Stage 5: Firebase Removal (Separate Approval Required)
- [ ] **Gate:** Post-cutover operational period confirms 100% traffic on OAuth sessions.
- [ ] Deprecate and remove Firebase Admin SDK server dependencies.
- [ ] Remove client Firebase packages and configuration.
- [ ] Final architecture sign-off by project owner.

---

## 4. Rollback Readiness Reference

| Layer | Rollback Mechanism | Target State | Impact |
|---|---|---|---|
| **API Code** | `gcloud run services update-traffic goms-api --to-revisions=<LAST_KNOWN_GOOD>=100` | Prior revision | Instant traffic shift. Additive column/tables remain inert. |
| **Frontend** | `firebase hosting:clone` or rollback via Firebase Console | Prior hosting release | Reverts UI auth client to prior build. |
| **Database** | Migration `1791764900000` is additive (`ADD COLUMN IF NOT EXISTS`, partial unique index) | No DB rollback needed for app rollback | Column `google_sub` is ignored by prior code. |
| **Emergency** | Set `EMERGENCY_READ_ONLY=true` | Read-only mode across mutating routes | Prevents any writes while preserving query capabilities. |

