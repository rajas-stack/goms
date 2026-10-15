# Security and Code Review

Date: 2026-10-15 (Asia/Calcutta). APK building was explicitly excluded.
This is a source review and local verification record, not production security sign-off.

## Fixed and Verified

- ONLYOFFICE internal downloads retain the configured host even when a signed file URL contains a double-slash pathname. Added three origin-pinning regressions. Existing callback signatures, origin allowlists, redirect rejection and download limits remain enforced.
- Google ID-token verification now requires expiry, issuance and subject claims. Added missing-claim tests without relaxing issuer, audience, signature, nonce or verified-domain checks.
- Document cleanup and startup RBAC synchronization no longer log raw SDK/database errors. Added a cleanup regression proving that SDK details and storage paths are not logged.
- The HTTP boundary now returns generic framework errors and 404 responses. Query credentials and non-tRPC driver messages are not echoed in these responses/logs. Status codes and rate-limit retry headers are preserved. Added four boundary regressions.
- The source credential checker includes saved, nonignored untracked files as well as tracked source. Added tests for detection, redaction and ignored local files; CI runs them.
- Sync locking rejects JSON `null` metadata without crashing or deleting an unverifiable lock. Added a fail-closed regression.
- Grid freeze-column tests wait for exiting menus before opening another, retaining the behavioral assertions.
- Updated stale dependency-audit documentation and documented provider-specific authentication limits in [SECURITY.md](../../SECURITY.md).

## Verification Results

| Check | Result |
| --- | --- |
| Complete logic/domain suite | 120 files, 1,221 tests passed |
| Complete database-backed API suite | 94 files, 1,529 tests passed |
| Final HTTP-boundary, application, production-security and document-route recheck | 4 files, 42 tests passed |
| Final OAuth HTTP-route recheck | 1 file, 51 tests passed |
| Affected grid component suite | 39 tests passed |
| UI permission security regression | 1 test passed |
| Complete script gate | 16 runner checks passed, including credential scanning and lock regressions |
| Frontend TypeScript project build | Passed |
| API TypeScript compilation, including final HTTP changes | Passed |
| npm audit, production and development | Zero known vulnerabilities |
| Source credential patterns and Firebase hosting policy | Passed |
| Git whitespace/error check | Passed |

The full API run started before the final HTTP-boundary edit. Its affected HTTP/application/security/document routes and OAuth routes were rerun after that edit; the table does not imply a single final full-suite run. API tests used disposable PostgreSQL, not the application database. Full browser and full component suites were not rerun during this security follow-up. No Gradle build, APK, deployment or manual GitHub push was performed by this review.

Detailed logs and the redacted history report are outside the repository at `E:\goms\.goms-sync\security-review`.

## History Secret Scan

Gitleaks scanned all refs from a local Git-metadata snapshot with full redaction: 653 scanned commits and approximately 1.01 GB of patch content. Git warned that exhaustive rename detection was skipped for a large changeset; no custom secret-rule suppressions were added. The scan does not cover unreachable objects, ignored local files, external repositories or cloud secret stores, or later commits made in the shared workspace.

The scanner exited nonzero with 29 candidates, all reviewed by source location:

- 22 Docker image tags containing commit hashes, not API keys.
- Five deliberately fake test secrets used by ONLYOFFICE and OAuth error-redaction tests.
- One Firebase browser API key in historical CI configuration. Firebase web keys are public configuration, but their API/application restrictions still need review. See [Firebase key guidance](https://firebase.google.com/docs/projects/api-keys).
- One historical `VITE_SUPABASE_ANON_KEY` JWT with the `anon` role in `.env.example`, not a service-role credential. The current application no longer configures that client. Historical backend availability, token validity and database policies were not tested. If that backend is still active, verify least-privilege grants/RLS or retire its public access. Public client keys do not replace authorization; see [Supabase key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

No private production credential was confirmed by this scan. Do not describe the raw scanner result as zero findings, or the classified result as proof that no secret exists.

## Still Open Before Production Sign-Off

1. **Repository protection:** GitHub's branch API reports `main` as `protected: false`. An owner must review/enable the required PR approvals, status checks, push restrictions, secret protection and production deployment rules. No repository policy was changed here.
2. **Uploads:** MIME/size checks are not malware scanning or comprehensive file-signature validation. Add quarantine/scanning and an executable/macro/archive policy; direct Drive uploads also need Workspace controls or a mediated pipeline.
3. **Cloud controls:** Verify deployed IAM/ingress, database isolation, secret management, HTTPS/CSP, audit migrations and alert recipients. Source configuration and tests do not prove the deployed configuration matches.
4. **Identity lifecycle:** Verify MFA, offboarding, token revocation and shared-secret rotation. GOMS OAuth access tokens remain valid until expiry after refresh-session revocation. Production sensitive mutations intentionally reject OAuth identities without recent-authentication evidence; provider-aware reauthentication remains a functional limitation, not a reason to bypass the gate.
5. **Operational validation:** Test backup restoration, incident response, authenticated staging role/record-boundary checks and an independent penetration test. Review the historical public-client configuration described above.
6. **Native verification:** Android toolchain files changed in the shared workspace, but native compilation/instrumentation were not run in this review because APK work was canceled. No native success is claimed.

The verified source issues above are resolved. The external controls and validation items remain explicit open work; passing tests and clean dependency advisories cannot establish zero security risk.
