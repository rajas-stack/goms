# Security and integrations

## Authentication and authorization

The application supports Firebase Google sign-in and a GOMS-managed Google OAuth flow, selected by configuration. Verified Amnex identity, procedure-specific authentication, server-side RBAC and administrator checks govern access. Browser visibility and lock controls are user-interface behavior; the API remains the authorization boundary. Read the identity module, tRPC middleware and RBAC policy registry for the exact rules.

## Data protection

Portal credentials use passphrase-based encryption with Web Crypto, PBKDF2/SHA-256 and AES-GCM. OAuth tokens are managed through the session implementation, including refresh-token rotation and hashing. Production code also includes rate/operation limits, audit events, security headers and an emergency read-only switch. Inspect configuration and tests to determine which protections apply in a particular environment.

## Integration catalog

The catalog lists Gmail, Drive, Docs, Sheets, Calendar, Chat, Meet, Maps, Translate, Sites, Notes/Keep, NotebookLM and Tasks. Each service has its own mode, scopes, registered feature pages and enablement configuration. API adapters, web access and cloud services have different capabilities; a catalog entry alone does not mean every product capability is embedded. User/provider credentials and Google-side API configuration determine what works.

Google Drive is used for DMS configuration. Google Cloud Storage supports signed attachment upload/download operations. Jev AI requires its server-side API key. Document maker needs no extra service: Office apps reach `/api/dav/…` with a short random session id that is re-checked against the file's owner or share on every request, and download links are signed with a key derived from `AUTH_SESSION_SECRET`. Its Google Drive copy uses the owner's own Drive (`drive.file` scope). See the relevant feature source and [Docker guide](../DOCKER.md) for setup.

## Secrets and documentation

Keep real environment files, passwords, passphrases, OAuth tokens, service-account keys and production database URLs out of this folder and version control. Document variable names and purpose instead. Local Compose secrets are stored outside tracked documentation and mounted at runtime; cloud secret-management configuration is defined separately.

Sources: [identity](../apps/api/src/auth/identity.ts), [tRPC middleware](../apps/api/src/trpc.ts), [RBAC registry](../apps/api/src/auth/rbac/registry/index.ts), [credential encryption](../src/features/tender-websites/credentialLock.ts), [integration catalog](../src/features/integrations/catalog.ts).
