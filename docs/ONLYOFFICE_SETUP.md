# Document maker: ONLYOFFICE Docs setup

The **Document maker** module (`/document-maker`, left rail) keeps real `.docx`, `.xlsx` and `.pptx` files and opens
them in **ONLYOFFICE Docs Community Edition** (open source, AGPL v3, self-hosted). GOMS stores the files (Postgres
`maker_documents`); the Document Server only renders the editor and hands edited files back.

```
Browser ──(tRPC makerDocuments.editorConfig)──► GOMS API ── signed config (JWT) ──► Browser
Browser ── loads ONLYOFFICE_URL/web-apps/apps/api/documents/api.js, opens the editor iframe
Document Server ── GET  ONLYOFFICE_INTERNAL_API_URL/api/document-maker/files/:id?token=…   ──► GOMS API (file bytes)
Document Server ── POST ONLYOFFICE_INTERNAL_API_URL/api/document-maker/callback/:id?token=… ──► GOMS API
GOMS API ── downloads the edited file from the Document Server (status 2 / 6), stores a new version + new key
```

## 1. Start Postgres and the Document Server (Docker Desktop)

`docker/onlyoffice/docker-compose.yml` runs both backing services for local development (the API and web app run
on the host with `npm run dev`):

```bash
cp docker/onlyoffice/.env.example docker/onlyoffice/.env      # git-ignored; put real values here only
#   POSTGRES_PASSWORD=<local password>
#   ONLYOFFICE_JWT_SECRET=<32+ random chars>  e.g. node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
docker compose -f docker/onlyoffice/docker-compose.yml --env-file docker/onlyoffice/.env up -d
```

- Postgres listens on `127.0.0.1:5432`, the Document Server on `http://localhost:8082`; both restart unless stopped
  and keep their data in named volumes (`goms_pgdata`, `onlyoffice_data`, `onlyoffice_library`, `onlyoffice_logs`).
- The Document Server takes 1–2 minutes on first start. `http://localhost:8082/healthcheck` returns `true` when ready.
- Single-container alternative (no Postgres):
  `docker run -i -t -d -p 8082:80 --restart=always -e JWT_SECRET=<secret> onlyoffice/documentserver`
- Fonts: the image ships the standard set. To add company fonts, mount them into
  `/usr/share/fonts/truetype/custom` and run `docker exec <container> /usr/bin/documentserver-generate-allfonts.sh`.
- **Community Edition limit:** 20 simultaneous connections (open editors) across all users; beyond that new editors
  open read-only.
- Full containerised stack (API + web in Docker too): `compose.yaml` + `compose.onlyoffice.yaml`; there the API
  reaches the Document Server as `http://onlyoffice` and the secret comes from `.docker/secrets/onlyoffice_jwt`.

## 2. API — `apps/api/.env.local` (git-ignored)

```dotenv
DATABASE_URL=postgresql://goms:<POSTGRES_PASSWORD>@localhost:5432/goms
ONLYOFFICE_JWT_SECRET=<same value as in docker/onlyoffice/.env>   # >= 32 chars; never commit it
ONLYOFFICE_URL=http://localhost:8082                              # browser-reachable Document Server
ONLYOFFICE_INTERNAL_API_URL=http://host.docker.internal:8080      # how the container reaches this API (PORT, default 8080)
# ONLYOFFICE_INTERNAL_URL=http://onlyoffice                        # only when the API reaches the Document Server by another URL
```

Then apply migrations and start the API:

```bash
cd apps/api && npm run migrate up   # creates maker_documents (down step drops it)
npm run dev
```

- `host.docker.internal` resolves to the host from Docker Desktop containers; the compose file also maps it on Linux.
  The host firewall must allow the container to reach the API port.
- Without the ONLYOFFICE variables the editor page says the editor is not set up; list, upload, rename, duplicate
  and delete still work. Download links also need `ONLYOFFICE_JWT_SECRET` (they are signed with it).
- The API must be allowed to accept the browser origin: `http://localhost:5173` is allowed by default outside
  production.

## 3. Web — `.env.local` at the repo root (git-ignored)

```dotenv
VITE_API_BASE_URL=http://localhost:8080
VITE_ONLYOFFICE_URL=http://localhost:8082
```

- The API sends the Document Server URL with every signed config. `VITE_ONLYOFFICE_URL` pins it: the page refuses to
  load `api.js` from any other origin. Leave it unset to accept whatever the API says.
- Restart Vite after changing `.env.local`.
- In local/offline mode (no `VITE_API_BASE_URL`) files are kept in the browser (IndexedDB) and the editor page explains
  that editing needs the server — the Document Server cannot download a file that only exists in your browser.
- **Production CSP:** `firebase.json` sends a strict Content-Security-Policy. Add the Document Server origin to
  `script-src` (api.js), `frame-src` (editor iframe) and `connect-src` before enabling the editor in a deployed build.

## 4. Security model

- **JWT both ways (HS256, `ONLYOFFICE_JWT_SECRET`).** The editor config is signed by the API; the Document Server
  rejects unsigned or altered configs. Every callback must carry a valid token (body `token` or `Authorization:
  Bearer`), or it is refused with 403.
- **URL tokens.** File and callback URLs carry tokens bound to the document id and purpose (`file` 12 h and tied to
  the exact version key, `download` 5 min, `callback` 30 days).
- **SSRF guard.** The API downloads edited files only from the `ONLYOFFICE_URL` / `ONLYOFFICE_INTERNAL_URL` origins,
  over http(s), with no credentials and no redirects, capped at 50 MB.
- **File checks.** Only `.docx` / `.xlsx` / `.pptx`, and the bytes must be a zip (`PK\x03\x04`). Uploads are capped at
  5 MB (they travel inside one 8 MB API request); versions saved from the editor at 50 MB.
- **Ownership.** Every user-facing procedure verifies the signed-in @amnex.com user and only touches that user's rows.
- **Versions.** Each save (callback status 2 or 6) stores a new version and a new `document_key`, so the Document
  Server never serves a stale cached copy. Saves are recorded in `commercial_audit_logs` (`entity_type =
  'maker_document'`).

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| "ONLYOFFICE server not running" | `ONLYOFFICE_URL` unreachable from the browser, or the container is still starting. |
| Editor shows "Download failed" | The container cannot reach `ONLYOFFICE_INTERNAL_API_URL` (check `host.docker.internal`, port, firewall). |
| "The document security token is not correctly formed" | The container `JWT_SECRET` and the API `ONLYOFFICE_JWT_SECRET` differ. |
| Edits are not saved | The callback cannot reach the API, or the API cannot reach the download URL — set `ONLYOFFICE_INTERNAL_URL`. API logs show `document_maker.callback_failed`. |
| "not this build's VITE_ONLYOFFICE_URL" | The API's `ONLYOFFICE_URL` and the web build's `VITE_ONLYOFFICE_URL` disagree. |
