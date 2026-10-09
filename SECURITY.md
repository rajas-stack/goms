# GOMS security deployment and verification

## Implemented in this hardening change

- Hosted production (`NODE_ENV=production`, or `SECURITY_ENFORCEMENT_ENABLED=true`) always authenticates business procedures, enforces RBAC and refuses insecure explicit rollout settings. Local development retains its existing offline behavior.
- Verified Google identities on the Amnex domain are required. Firebase revocation/disabled-user checks run on authenticated production requests. Sessions must be renewed after 12 hours; credential/passphrase and permission mutations require sign-in within 15 minutes.
- API responses cannot be cached, browser origins are restricted, HTTP request and weighted operation budgets apply, and batches are limited to 25 operations. Budgets are per instance; deploy an edge/distributed limiter for fleet-wide protection.
- HTTP receive/connection timeouts and production SQL/idle-transaction timeouts bound slow requests and stalled database work.
- Production mutations and credential-envelope reads require a durable security audit intent before execution. Completion failures produce alerts and leave the intent available for investigation. Audit events store identity, procedure and outcome, never request payloads or secrets. They do not claim that a browser-side password reveal was observed by the server.
- Shared passphrase administration requires administrative access; website deletion checks the persisted editing lock atomically. Existing RBAC governs module and field permissions. UI-only locks elsewhere are not a substitute for API authorization.
- AES-GCM encryption and PBKDF2 remain in place; new encryption requires passphrases of 12–1024 characters. Existing shorter passphrases can still decrypt for migration. A downloaded encrypted envelope can be attacked offline: use long, unique passphrases and tightly restrict ciphertext access.
- Revealed portal credentials clear when hidden, after two minutes, or after an authentication event; asynchronous decrypt results cannot repopulate a cleared view. Account changes clear query caches and Drive grants. Local retry throttling is a usability safeguard, not offline brute-force protection.
- Hosting CSP rejects inline scripts, framing and object embedding. Theme initialization is external. Google sign-in, Google APIs, fonts and the currently installed Tesseract worker/core paths are allowlisted; verify new third-party dependencies before changing the policy.
- Containers run as a non-root user and exclude development tools and local secrets. The migration CLI remains a production dependency because the migration job shares the API image. CI performs dependency audits, security regression tests, basic tracked-source credential pattern checks, GitHub CodeQL analysis and container vulnerability/secret scans. The basic pattern checker is not a full Git-history secret scanner.
- Production dependency audit is clean after patching Capacitor, Fastify, Firebase transport dependencies, React Router and Cloud Storage. Vitest was upgraded to remove vulnerable test-runner dependencies. Seven remaining audit findings concern the Tailwind 3 development/build chain (five high, two moderate), excluded from the production container. A Tailwind 4 migration needs separate visual/build validation; keep build inputs trusted and CI credentials restricted in the meantime.

## Required before production deployment

1. Apply `1791764000000_security-events.sql` and the pending application migrations before deploying the API. Audit table failure blocks protected writes.
2. Set `FIREBASE_PROJECT_ID`, `AUTH_ENFORCEMENT_ENABLED=true`, `READ_AUTH_ENFORCEMENT_ENABLED=true`, `RBAC_MODE=enforce`, exact HTTPS `CORS_ALLOWED_ORIGINS` and actual `ADMIN_ALLOWED_EMAILS`. Provision administrator identities and employee roles before enforcement; do not guess production permissions.
3. Configure the frontend Firebase web application and its approved authentication domains. Firebase public configuration and OAuth client IDs are not secrets. Keep private keys, client secrets and database credentials in Secret Manager.
4. Apply/review the production Terraform changes, including the runtime Firebase Auth reader role, administrator email variable and security alerts. Revocation checking needs runtime credentials and Firebase user-read permission. Cloud configuration is not changed merely by editing Terraform.
5. Deploy Firebase Hosting headers with the frontend. Update the pinned API image explicitly after staging validation; this change does not apply infrastructure or deploy live production automatically.
6. Set real alert notification channels. Audit/authentication/permission failure alerts without recipients do not notify anyone. Retain and restrict security events and cloud logs under the organization's data-retention policy.

## Controls requiring external setup or additional systems

- Enforce Workspace MFA/passkeys and administrator session/device policies. Offboarding must disable/revoke the Firebase user, remove Workspace/Drive sharing and application roles, and rotate shared credentials where appropriate. Workspace suspension alone is not proof of Firebase session revocation.
- Review actual Cloud Run ingress/IAM drift, database networking and least-privilege database/runtime roles. Preserve the required Firebase Hosting API access path while restricting alternate access where supported. Review broad signing/storage roles before reducing them.
- Enable server-side malware scanning/quarantine and file-signature validation before treating uploads as trusted. Existing MIME/size checks are not malware detection. Direct Google Drive uploads bypass the application backend; they require Drive/Workspace controls or a redesigned upload pipeline. Executable content, macros and archive expansion require explicit policy.
- Restrict Drive folder sharing, approve OAuth scopes in Workspace, verify required APIs/billing, and review whether full Drive scope can be replaced by `drive.file`. Background sync would require a separate server-side encrypted refresh-token design.
- Run a full-history secret scan and rotate any exposed credentials; enable repository secret scanning/push protection, protected branches and production deployment restrictions.
- Test backup restoration/PITR, least-privilege backup access, incident response and the emergency read-only switch. Restoring a backup does not restore lost user passphrases.
- Test every role against record-ID substitution, exports, signed downloads, document relationships, and field updates. Run an independent authenticated penetration test. Do not interpret passing unit tests as proof of complete application security.

## Verification

Run the CI security checks and production-mode negative tests. In staging, check rejected anonymous/non-Amnex/revoked users, disabled accounts, role-denied reads/writes, locked deletion, audit database outages, cross-origin requests, oversized batches and account-switch cleanup. Exercise Google popup sign-in, Drive file operations, signed GCS uploads/downloads and OCR under the deployed CSP. Confirm cloud logs contain no bearer tokens, passphrases, decrypted credentials or raw database errors.

References: [OWASP ASVS](https://cheatsheetseries.owasp.org/IndexASVS), [Firebase revocation](https://firebase.google.com/docs/auth/admin/manage-sessions), [Google OAuth practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).
