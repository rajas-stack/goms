# GOMS Dev Remote Cutover Checkpoint

**Date:** 2026-08-26
**Scope:** Stage A of the 2026-08-26 cutover readiness report — dev-only cutover-readiness changes, a real browser-based test against `goms-dev`, and this checkpoint. No production auth was added, no self-managed runner was created, no UI was redesigned, no server-side whole-app backup/restore endpoint exists. `VITE_API_BASE_URL` is unset by default everywhere in the repo right now.

**Bottom line: 17/17 browser assertions passed** across all 8 requested surfaces plus a real UI-driven create+delete round-trip, with zero console errors, zero CORS errors, and zero unhandled network failures, after two fixes (below) were found and deployed to `goms-api` on `goms-dev`.

---

## 1. What was implemented (Stage A)

| Change | File(s) | Commit |
|---|---|---|
| Fastify CORS with an explicit allow-list (`http://localhost:5173` + configurable `CORS_ALLOWED_ORIGINS`) — never `origin: true`/`*` | `apps/api/src/server.ts`, `apps/api/package.json` | `b357ba98` |
| "Connected to goms-dev" indicator, subtle badge next to the module label, visible only when `VITE_API_BASE_URL` is set | `src/components/TopBar.tsx`, `src/components/ui/Icon.tsx` (added `Database` icon) | `b357ba98` |
| Backup/Restore controls hidden in remote mode, replaced with a short explanatory note | `src/features/settings/SettingsDialog.tsx` | `b357ba98` |
| `bootstrapRepository()` skipped entirely in remote mode (renders immediately, no IndexedDB open/read) | `src/main.tsx` | `b357ba98` |
| Fastify `maxParamLength` raised 100 → 2000 — found live during testing, see §2 | `apps/api/src/server.ts` | `df1f8bdc` |

`VITE_API_BASE_URL` was not touched in any tracked config, script, or CI file — confirmed via `grep` before and after this work, same two call sites as before (`src/data/repository.ts:27`, `src/data/remote/repository.ts:27`).

**Deployed to `goms-dev`** (both changes, two revisions — `goms-api-00019-78x` then `goms-api-00020-vj7`, both user-approved before deploying since Cloud Run redeploys are gated by the permission classifier). Built and pushed locally via Docker + `gcloud run deploy`, bypassing GitLab CI, whose shared-runner minutes are still exhausted (see `project-gitlab-ci-minutes` memory) — same image/deploy shape CI itself uses, tagged by commit SHA. Both deploys are instantly reversible via `gcloud run services update-traffic goms-api --to-revisions=<prior>=100` if ever needed; the prior revision (`goms-api-00018` or earlier) is still retained by Cloud Run.

## 2. A real blocker found during testing, not anticipated in the readiness report

The first full browser run showed CORS errors in the console on Home and elsewhere — but `curl`-based CORS preflight checks against the deployed service had already passed cleanly. Reproducing the exact failing request via `curl` with an `Origin` header (rather than trusting the browser's own error text) showed the real cause: **HTTP 414, not a CORS rejection.**

Fastify's router defaults `maxParamLength` to 100 characters. tRPC's fastify adapter matches a batched request's comma-joined procedure list (`hierarchy.listStates,hierarchy.listOrgRoots,hierarchy.listDepartments,...`) as a single route parameter, and `httpBatchLink` freely coalesces every query fired in the same tick into one request — the Home page alone batches 6-7 procedures on mount, trivially over 100 characters. The resulting 414 response carries no CORS headers at all (rejected by the router before the CORS hook ever runs), and Chrome's console reports any such headerless cross-origin failure as a generic "blocked by CORS policy" message — a real, misleading red herring.

Fixed with one Fastify constructor option (`routerOptions: { maxParamLength: 2000 }`), verified locally against a real Postgres before redeploying (the identical request that 414'd returned 200 with the correct `Access-Control-Allow-Origin` header afterward), then deployed to `goms-dev` with explicit approval. Re-running the full browser suite afterward showed zero console/network/CORS errors.

**Worth flagging for whoever picks up Stage B or later frontend work:** this was masked entirely in every prior `curl`-based smoke test across the whole migration, because single hand-written `curl` calls never batch enough procedures together to hit the limit — it only surfaces under real React Query usage on a real page. If a future page fires an even larger batch (e.g. many simultaneous searches — the Command Palette's incremental-query batching came close), the same class of failure could recur at a higher procedure count; 2000 chars gives real headroom but isn't unlimited.

## 3. Browser test results — pass/fail per surface and workflow

Method: a real Chromium browser (Playwright, headless, 1440×900), driving the actual `npm run dev` server with `VITE_API_BASE_URL` pointed at `goms-dev` via an untracked `.env.local` (see the companion remote-dev test procedure doc), with console/page-error/network-failure/4xx-5xx listeners attached for the entire run.

| # | Surface / workflow | Result | Evidence |
|---|---|---|---|
| 1 | **Home / Landing** | ✅ PASS | Loads; "Connected to goms-dev" badge visible; "Offices mapped"/"Employees tracked" stats resolve to real numbers from `goms-dev` (not stuck on the loading dash) — proves `repository.listStates()` succeeded over the wire |
| 2 | **StateWorkspace** (`/state/27`, Maharashtra) | ✅ PASS | Loads; shows real seeded org data (Department of Housing, MHADA — matching the 2026-08-26 seed-import reconciliation) |
| 3 | **CRUD: create** | ✅ PASS | Real UI flow (FAB → "Create Department" → state picker, pre-filled Maharashtra → name form → submit) created `ZZ-SMOKE-DEPT-<ts>`; appeared in the DOM immediately |
| 4 | **CRUD: verify against remote, not just local UI state** | ✅ PASS | Independently re-read via a direct `fetch` to `goms-api` (not the React Query cache) — the created row was really there, with a real UUID |
| 5 | **CRUD: cleanup delete** | ✅ PASS | Deleted via the same live API; goms-dev confirmed back to its exact prior state (`curl` re-check afterward: 0 leftover `ZZ-SMOKE` departments) |
| 6 | **Directory** | ✅ PASS | Loads with real content (573 chars of rendered body text, non-empty) |
| 7 | **Meetings** | ✅ PASS | Loads with real content |
| 8 | **SalesWorkspace** | ✅ PASS | Loads with real content (2347 chars — the largest of the simple pages, consistent with the 30-person sales roster) |
| 9 | **Commercial Calculator** | ✅ PASS | Loads with real content |
| 10 | **Relationship Analytics** | ✅ PASS | Loads with real content |
| 11 | **Command Palette** (Ctrl+K) | ✅ PASS | Opens; typing "Maharashtra" returns real matching results from the live backend |
| 12 | **Settings dialog — remote-mode message** | ✅ PASS | Shows the "aren't available while connected" explanatory note |
| 13 | **Settings dialog — Backup/Restore hidden** | ✅ PASS | Neither "Export full backup" nor "Choose backup file…" appears anywhere in the dialog while in remote mode |

**17/17 individual assertions passed** (some rows above bundle more than one assertion — 17 is the exact count from the automated run).

**Diagnostics across the entire run, after the two fixes:**
- Console errors: **none**
- Unhandled page errors: **none**
- CORS-related issues: **none**
- 4xx/5xx responses: **none**
- Request failures: one benign `ERR_ABORTED` on the cleanup `deleteNode` call — an artifact of the test script closing the browser immediately after firing that request via `page.evaluate`, not a real failure (the delete itself returned `200` and was independently re-confirmed via `curl` afterward: 0 leftover rows).

## 4. What this does and does not prove

**Proven:** every requested surface renders real `goms-dev` data correctly in a real browser with `VITE_API_BASE_URL` set; a real write (department create) made through the actual UI reaches the real backend and is independently readable; CORS is correctly scoped (allow-list works, and — separately confirmed earlier — an origin not on the list is rejected); no regressions to default (in-memory) behavior (`npx tsc -b` clean, root `npm test` 247/247, `apps/api` test 142/142 against a real local Postgres, `npm run build` clean, all run with `VITE_API_BASE_URL` unset).

**Not in scope for this checkpoint, still open:** production authentication (deliberately deferred to Stage B, per instruction), rate limiting, monitoring/alerting, deploy rollback runbook — all still exactly as documented in the 2026-08-26 cutover readiness report §3. `VITE_API_BASE_URL` remains unset by default; today's testing used a personal, untracked `.env.local`, reverted back to its pre-existing (unrelated, Supabase-era) content immediately after testing finished.

## 5. Recommendation

Stage A's dev cutover-readiness changes work correctly end-to-end against the live seeded `goms-dev`, including a real fix for a real (if narrow) production-adjacent bug that would have affected any sufficiently query-heavy page regardless of cutover. Waiting for approval before starting Stage B (production auth, rate limiting, monitoring/alerting, deploy rollback).
