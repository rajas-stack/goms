# Setup and deployment

## Repository layout

`src/` contains the web application. `apps/api/` contains the backend and SQL migrations. `packages/domain/` contains shared rules and types. `android/` contains the native Android wrapper. `public/` contains browser-served static assets. `infra/` contains cloud infrastructure definitions. `docker/` and the Compose files define local containers.

## Local development

Install dependencies with `npm ci`; the root postinstall builds the domain package. Start the frontend with `npm run dev`. The usual frontend address is `http://localhost:5173`, subject to port availability. Backend development uses `npm run dev --workspace @goms/api` and needs a database connection plus the appropriate authentication settings. Database-backed frontend operation is enabled through `VITE_API_BASE_URL`; otherwise the repository uses local IndexedDB-backed data. The sign-in gate and provider configuration remain separate from that storage-mode choice.

## Docker

Follow [DOCKER.md](../DOCKER.md) for secret generation, public configuration, startup, optional reference-data seeding, ONLYOFFICE, logs and backups. The default web address is `http://localhost:8088`. Do not copy private credentials into documentation or images.

## Cloud and CI

Firebase Hosting is configured to serve `dist/` and forward `/api/**` to Cloud Run. Terraform describes development and production networking, database, storage, identities and monitoring. GitLab and GitHub workflow files contain tests, security checks and deployment/build automation. Environment-specific prerequisites and configuration are documented under `infra/dev/` and `infra/prod/`; a checked-in definition does not prove an applied deployment.

## Updates

Build shared domain code before consuming changed exports. Apply database migrations through the supported migration runner before running API code that requires those schema changes. Rebuild the frontend when changing Vite build-time variables. Back up the database and retained secrets before updates that require rollback planning.
