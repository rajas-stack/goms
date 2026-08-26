# GOMS Remote-Dev Test Procedure

**Purpose:** How to opt a local dev environment into pointing at `goms-dev`'s live backend, for anyone who needs to reproduce or repeat the browser-based remote-mode testing done for the 2026-08-26 Dev Remote Cutover Checkpoint. This never changes any default — `npm run dev`/`npm test`/`npm run build` stay in-memory/IndexedDB unless you deliberately opt in as below.

## 1. Opt in via `.env.local`

`VITE_API_BASE_URL` is read by Vite automatically from `.env.local` (gitignored — see `.gitignore:18`, `.env.*` with `!.env.example`). Add one line to your own `.env.local` (create the file if you don't have one):

```
VITE_API_BASE_URL=https://goms-api-ckskxj3iza-el.a.run.app
```

**Never commit this.** It's already excluded by `.gitignore`, but double-check `git status` shows nothing under `.env.local` before any commit while it's set.

Then start the dev server as normal:

```
npm run dev
```

You should see a small "Connected to goms-dev" indicator next to the module name in the top bar — that's the signal you're in remote mode, not local IndexedDB. If you don't see it, `VITE_API_BASE_URL` isn't being picked up (check the file name/location — it must be `.env.local` at the repo root, not `apps/api/.env.local` or similar).

## 2. Turn it off again

Delete the line (or the whole file, if you added it fresh) and restart `npm run dev`. There is no other place `VITE_API_BASE_URL` is set — `src/data/repository.ts:27` and `src/data/remote/repository.ts:27` are the only two files that read it, and neither has a fallback default other than "unset."

## 3. What's different in remote mode

- Every read/write goes to `goms-dev`'s live Postgres via `goms-api` — not your local IndexedDB. Data you see is shared with whoever else is pointed at the same backend; anything you write is a real change there, not a local-only edit.
- `bootstrapRepository()` (the IndexedDB hydration step in `main.tsx`) is skipped entirely — there's nothing local to hydrate.
- Settings' Export/Restore Backup controls are hidden, replaced with a short note — they operate on local IndexedDB, which would be misleading (and pointless) once you're reading/writing the server instead.

## 4. If you get CORS errors

`apps/api`'s CORS allow-list (`apps/api/src/server.ts`) only permits `http://localhost:5173` by default (Vite's default dev port) plus whatever `CORS_ALLOWED_ORIGINS` is set to server-side. If you run Vite on a different port (`--port` override, or another app already holding 5173), your origin won't be in the allow-list and every request will fail with a real CORS error — either free up port 5173, or ask for your origin to be added to `CORS_ALLOWED_ORIGINS`. Don't work around this by changing the server to `origin: true`/`*` — see the 2026-08-26 cutover readiness report §3.1 for why that's a real security gap, not a formality, given every procedure is currently a `publicProcedure` with no auth of its own.

## 5. Known gotcha reproducing live smoke scripts against this API

The tRPC endpoints want the **non-batched** POST/GET body shape (`{"key": ..., "input": {...}}` directly in the body/query, not `httpBatchLink`'s `?batch=1`/`{"0":{"json":...}}` envelope) when hand-written with `curl`. The frontend's own `RemoteRepository` uses `httpBatchLink` and works fine through the browser — this only matters if you're scripting requests by hand outside the app.
