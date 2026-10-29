# Running GOMS with Docker Compose

The Compose stack runs the web app, API, shared domain package and PostgreSQL. It builds the current source, applies every SQL migration (including nested migration folders), waits for API/database health, and serves SPA routes through Nginx. PostgreSQL data survives container restarts. Android and iOS remain native clients; their server is this API.

## Start locally

Install Docker Desktop with Linux containers and Compose v2. From the repository root (`E:\goms\goms` on this workstation):

```powershell
node docker/setup.mjs
Copy-Item .env.docker.example .env.docker
# Edit .env.docker with your Firebase public web-app configuration.
docker compose --env-file .env.docker up --build -d
```

Open **http://localhost:8088**. The API and PostgreSQL are reachable within the Compose network; only the frontend is published on localhost. To change the port, set both `GOMS_PORT` and `GOMS_ORIGIN` in `.env.docker` and rebuild the frontend. Firebase must permit `localhost` as an authorized domain. The application's existing verified Amnex sign-in gate still applies. `ADMIN_ALLOWED_EMAILS` should contain your administrator's Amnex email; grant additional roles through the existing Access page.

`.env.docker` contains public configuration only. `docker/setup.mjs` creates random passwords/session keys under the Git-ignored `.docker/secrets` directory without overwriting existing files. These are mounted as Docker secrets and never copied into images. Back up these files together with the database. On a deployed server, supply these same secret mount paths through your secret manager.

A fresh database has empty business tables. To load the application's existing reference/organization data once, before entering your own records:

```powershell
docker compose --env-file .env.docker --profile tools run --build --rm seed
```

The seed tool refuses to run against non-empty target tables. It is optional and never runs automatically during startup.

## Google OAuth, Drive and uploads

For GOMS Google OAuth, set `AUTH_PROVIDER=oauth` in `.env.docker`, and fill `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.docker/secrets/api.json`. Register **http://localhost:8088/api/oauth/google/callback** on your Google OAuth client. The frontend and API share this origin. Rebuild the web image when changing public configuration.

Drive/DMS integrations still need their provider credentials and configuration in Settings. GCS uploads require `ATTACHMENTS_BUCKET` plus a signing-capable Google service account copied to `.docker/secrets/google_credentials.json`. Leave its generated empty JSON file in place when you do not use GCS. Jev AI requires `JEV_API_KEY` in `.docker/secrets/api.json`. These external services are not emulated by Compose.

## Document maker

Files open in the installed Word, Excel or PowerPoint, which read and save them over WebDAV at `/api/dav/…` on this origin; every save is stored as a version in Postgres. No extra service is needed. Download links are signed with a key derived from `AUTH_SESSION_SECRET`.

## Operations and backups

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f api migrate web
docker compose --env-file .env.docker down
docker compose --env-file .env.docker up --build -d
```

`down` preserves database volumes. Do not add `--volumes` unless you intend to erase stored data. To back up without shell redirection corrupting binary data on Windows:

```powershell
docker compose --env-file .env.docker exec db pg_dump -U goms -d goms -Fc -f /tmp/goms.dump
docker compose --env-file .env.docker cp db:/tmp/goms.dump ./goms.dump
```

To roll back application code, check out the desired commit and rebuild the images against the existing volume. Take a database backup before updates; schemas with incompatible migrations require restoring the corresponding backup rather than blindly reversing migrations.

This stack is configured for local development: API `NODE_ENV=development`, authenticated reads/writes and RBAC enforcement, localhost binding, no public database port. For public hosting, supply HTTPS, production environment/security settings, real secret-manager mounts and tested backups. Existing production API builds with `apps/api/Dockerfile` retain `NODE_ENV=production` by default. Startup ordering follows [Docker Compose readiness conditions](https://docs.docker.com/compose/how-tos/startup-order/).
