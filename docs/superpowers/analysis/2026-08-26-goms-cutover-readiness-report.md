# GOMS Cutover Readiness Report

**Date:** 2026-08-26
**Purpose:** Close the remaining cutover-readiness gaps identified by the 2026-08-25 readiness review, now that `goms-dev` has been seeded (7,430 rows, full reconciliation passed — see `project-goms-backend-migration-progress` memory, 2026-08-26 entry). This report covers five things: (1) a live Commercial Masters smoke test against the now-seeded database, (2) an audit of the three local-only data surfaces (`backup.ts`, `migrations.ts`, `bootstrapRepository`) with a recommended design — not implemented, (3) a minimum production security/readiness plan, (4) the exact frontend cutover sequence, (5) a browser-local vs. centrally-shared data classification.

**No code was changed. No production system was touched. `VITE_API_BASE_URL` remains unset everywhere.** `goms-seed-import` remains provisioned in `goms-dev`, untouched, per instruction.

---

## 1. Live Commercial Masters smoke test against the seeded `goms-dev`

**Why this is a different test from the existing Phase 4 checkpoint:** the retroactive Phase 4 verification recorded in `docs/superpowers/plans/2026-08-25-goms-repository-domains-migration-plan.md` (`## Phase 4: commercial masters`) ran against an *empty* database and left it empty. That proved the router's logic works in isolation. It did not prove the router behaves correctly once real, interdependent seed data (8 verticals, 6 product editions, 4 currencies, FK chains) is already sitting in the same tables. This test does that.

**Method:** live `curl` calls against the deployed `goms-api` Cloud Run URL (`https://goms-api-ckskxj3iza-el.a.run.app`), read-write-delete, cleaned up immediately after each check. All smoke rows used a `ZZ-SMOKE-`/`ZZ-P-` code prefix so they're trivially distinguishable from real seed data at every step.

**Baseline confirmed before touching anything:**
- `health.check` → `{"ok":true,"db":"connected"}`
- `commercial.masters.list({key:"verticals"})` → 8 rows: `TRAF, TRANSIT, DATA, SMARTCITY, GIS, AGRI, UTILITY, CLOUD` (matches the 2026-08-26 seed-import reconciliation exactly)
- `productEditions` → 6 rows including `STD`; `currencies` → 4 rows, `INR` confirmed `isBaseCurrency: true`

**Live assertions run against the seeded database (all passed):**

| Behavior | Result |
|---|---|
| Create a new vertical (`ZZ-SMOKE-<ts>`) alongside 8 existing ones | Succeeded, `displayOrder: 8` (correctly appended after existing rows, not colliding) |
| Duplicate code, case-insensitive, same key | `CONFLICT`: `"Code \"zz-smoke-<ts>\" is already used by another verticals row."` |
| Identical code string, different key (`skuCategories`) | Succeeded — confirms uniqueness is scoped per `master_key`, not global, even with 94 real rows already in the table |
| Create a `products` row with a nonexistent `verticalId` | `BAD_REQUEST`: `"No such verticals row: 00000000-0000-0000-0000-000000000000"` |
| Create a `products` row under the real smoke vertical | Succeeded, FK correctly resolved |
| Delete the vertical while its product child still exists | `CONFLICT`: `"Cannot delete this verticals row — 1 row(s) still reference it."` |
| Delete leaf → root (product → skuCategory → vertical) | All succeeded |

**Cleanup verification:** `verticals` list re-checked after every step. One leftover from an earlier ad-hoc reachability check (`ZZ-SMOKE-1787723673`, created while debugging the correct tRPC request shape) was caught and deleted. Final state confirmed: **exactly 8 verticals, the original 8 codes, zero rows with a `ZZ-` prefix anywhere** in `verticals`, `products`, or `skuCategories`. `goms-dev`'s reconciled seed data is untouched.

**Conclusion:** `commercial.masters` behaves correctly against a populated database — uniqueness scoping, FK validation, and delete guards all hold with real coexisting data, not just in an empty-table test. This closes the "Commercial Masters live smoke test" item cleanly.

**Note for future live testing against this API:** the tRPC client uses **non-batched** POST bodies (`{"key": ..., "input": {...}}` directly, not `httpBatchLink`'s `?batch=1` / `{"0":{"json":...}}` envelope) despite the frontend's `RemoteRepository` using `httpBatchLink` — the server clearly also accepts the plain single-call form, and that's what worked reliably in this session. Worth remembering for the next person who writes a smoke script by hand.

---

## 2. Audit: `backup.ts`, `migrations.ts`, `bootstrapRepository` — recommended design, not implemented

### Current state (verified by reading the code, not assumption)

- **`bootstrapRepository()`** (`src/data/in-memory/repository.ts:1804`) — called once in `main.tsx` before first render. Reads the IndexedDB snapshot via `persist.ts`'s `loadSnapshot()` and hydrates the in-memory store (`impl.hydrate(saved)`). This is **entirely local**: it has no awareness of `RemoteRepository` or `VITE_API_BASE_URL` at all. When the remote backend is active, this function still runs, still hydrates `impl` (the in-memory singleton) from IndexedDB — it just becomes irrelevant, since `repository.ts`'s top-level ternary already picked `RemoteRepository` and nothing reads `impl` anymore. Harmless dead work, not a correctness bug, but wasted IndexedDB I/O on every page load in remote mode.
- **`getFullSnapshot()` / `restoreFromBackup()`** (`src/data/in-memory/repository.ts:1818`, `:1827`) — same story. `getFullSnapshot()` returns `impl.snapshot()` (the in-memory store's current state); `restoreFromBackup()` calls `impl.hydrate(data)` then schedules an IndexedDB write. Both are re-exported unchanged from `src/data/repository.ts:24` regardless of which repository is active. **This is the real problem**: `SettingsDialog.tsx` wires these to "Export Backup" / "Restore Backup" buttons that are visible and clickable in the UI no matter what `VITE_API_BASE_URL` is. In remote mode, clicking "Export Backup" would silently export the stale/empty local `impl` state (not the server's real data), and "Restore Backup" would silently write into `impl` and IndexedDB — a store nothing else reads — giving the user a "Backup restored" success toast that changed nothing they can see. This is a genuine correctness trap, not a missing feature: it looks like it works and doesn't.
- **`migrations.ts`** itself has no coupling to the remote backend at all — it's pure data-transformation logic (`migrateSnapshot`) over a `GormsData`-shaped object, used by both `persist.ts` (loading an IndexedDB snapshot) and `backup.ts` (validating an uploaded backup file). It doesn't need to change based on which repository is active; it operates on the *shape* of a full data snapshot, not on where that snapshot lives.
- **`RemoteRepository`** (`src/data/remote/repository.ts`) confirmed to have **zero** equivalent surface — no `getFullSnapshot`/`restoreFromBackup`/bootstrap-equivalent method, and no server-side procedure for "dump everything" or "load everything" exists in `apps/api`'s routers either (checked: only per-domain CRUD procedures, nothing whole-database-shaped).

### Recommended approach (design only)

**Bootstrap.** `bootstrapRepository()` should become a no-op — or simply not be called — when `VITE_API_BASE_URL` is set. There is nothing to bootstrap: `RemoteRepository` has no local cache to hydrate; every read already goes over the wire. The cleanest shape: move the `VITE_API_BASE_URL` branch that already exists in `repository.ts:27` up one level, so `main.tsx` calls `bootstrapRepository()` only in the in-memory branch, and renders immediately (no async wait) in the remote branch. This avoids the wasted IndexedDB open/read on every load once remote mode is real, and avoids a false sense that "bootstrap" means something in remote mode.

**Backup/restore.** Recommend **not** trying to make `getFullSnapshot`/`restoreFromBackup` transparently work against the remote backend (a "download everything from Postgres as one JSON, then re-upload it" endpoint would need to stream ~7,400+ rows across a dozen tables through a single tRPC call, with no pagination story, no partial-failure story, and no obvious use case once real data lives in a real database with its own backup mechanism — Cloud SQL already has daily backups + PITR for that). Instead:
1. **Gate the Settings dialog's Export/Restore Backup UI on `VITE_API_BASE_URL` being unset.** When the remote backend is active, hide those two buttons (or replace them with a short explanatory note: "Backup/restore isn't available in server-connected mode — the server's data is backed up automatically"). This is the one-line fix that actually matters: it removes the silent-no-op trap without needing any new backend work.
2. **Leave `backup.ts`/`migrations.ts`/`getFullSnapshot`/`restoreFromBackup` exactly as they are for in-memory mode** — they remain fully correct and useful there (local dev, offline use, anyone not pointed at a remote backend).
3. If a real "export the server's data" need shows up later, treat it as a deliberate, separately-scoped feature (e.g. an admin-only CSV/JSON export endpoint per domain, or a `pg_dump`-based Cloud SQL export triggered by an operator) — not an extension of the existing local-only backup mechanism, which was never designed for a multi-table relational dataset with FK ordering.

**Why this shape and not a "make it work over the wire" fix:** the local backup format (`BackupEnvelope` wrapping a flat `GormsData` object) has no concept of relational integrity, id-remapping, or partial-import — it's a direct serialization of the in-memory store's own shape. Reusing it against Postgres would mean re-solving the exact id-remapping/insert-ordering problem `scripts/seed-import.ts` already solved once for the one-time seed — but generically, for arbitrary user-triggered import at any time, which is a materially harder and riskier problem (a bad restore could corrupt live relational data, not just overwrite a JS object in memory). Hiding the UI in remote mode is the correct-sized fix for what's actually needed right now.

---

## 3. Minimum production security/readiness plan

Scope: the smallest set of changes that would make `goms-dev`'s current design defensible for production, once real (non-seed-only) data and real users are in play. This is a plan to review, not a change made — nothing below has been implemented.

### 3.1 Authentication / authorization

**Current state:** `goms-api`'s Cloud Run `roles/run.invoker` is granted to `allUsers` (`infra/dev/cloudrun.tf:72-73`, explicitly commented as deliberate for launch). Every tRPC procedure is `publicProcedure` — there is no auth context anywhere in `apps/api`, and no CORS plugin is registered on the Fastify server (`apps/api/src/server.ts` — confirmed by reading `apps/api/package.json`: no `@fastify/cors` dependency at all). Today this means: anyone with the URL can read or write any row in any table, and a browser calling the API cross-origin would additionally fail on CORS (see §4's cutover-blocker note) — so paradoxically the *missing* CORS setup is currently the only thing standing between the public internet and unauthenticated writes from a browser.

**Minimum viable production posture:**
1. Put a real identity layer in front of Cloud Run before removing the `allUsers` grant. The two realistic options for this stack: (a) **Identity-Aware Proxy (IAP)** in front of Cloud Run if every user already has a Google identity (simplest, no app code changes, GCP-native) — but the current setup uses a raw `*.run.app` URL with Direct VPC egress, so IAP would need a load balancer in front of Cloud Run, which doesn't exist today; (b) an **app-level session/JWT layer** (e.g. a login endpoint issuing a signed token, checked by tRPC middleware) if users need app-specific roles rather than raw Google-identity gating. Given GOMS has no existing user/login model anywhere in the frontend, (b) is a bigger lift — **recommend scoping "who are our actual users and what should they be able to do" as its own short design pass before picking an implementation**, rather than defaulting to IAP for expedience.
2. Once an identity exists, add a tRPC middleware (`protectedProcedure` alongside today's `publicProcedure`) and migrate routers one at a time — this mirrors exactly the phase-by-phase migration discipline already used for the Repository domains, so it's a familiar shape to execute.
3. Until real auth exists, **do not point real/sensitive data at this backend** — this stance already holds today (only seed/reference data is present) and should keep holding until 3.1 is closed.

### 3.2 Rate limiting

**Current state:** none, anywhere — no Cloud Armor, no load balancer (Cloud Run is hit directly), no app-level limiter in Fastify.

**Minimum viable production posture:** the cheapest real protection, given there's no load balancer today, is an **app-level limiter** (`@fastify/rate-limit`, a few lines in `server.ts`) keyed by IP, applied globally to start rather than per-procedure. This requires no new infrastructure and is a same-day change once decided on. A Cloud Armor policy is the "real" answer long-term but requires putting Cloud Run behind an external Application Load Balancer first — a bigger infra change that should be bundled with the auth work in §3.1 if IAP is chosen (IAP already needs that load balancer), not done twice.

### 3.3 Monitoring / alerting

**Current state:** none beyond the app's own business audit-log tables (`commercial_audit_logs`), which record business events, not infra health. No Cloud Monitoring dashboards, uptime checks, or alert policies exist in Terraform today.

**Minimum viable production posture:** three cheap additions, all standard GCP resources addable to `infra/dev/cloudrun.tf` (or a new `monitoring.tf`) with no app code changes:
1. A **Cloud Monitoring uptime check** against `goms-api`'s `health.check` endpoint — the endpoint already exists and already returns real DB-connectivity status (`{"ok":true,"db":"connected"}`), so this is literally just pointing GCP's uptime checker at something that already works.
2. An **alert policy** on that uptime check (notify on N consecutive failures) plus one on Cloud SQL (CPU/storage/connection-count thresholds — Cloud SQL exposes these metrics automatically once the instance exists, no extra instrumentation needed).
3. A notification channel (email/Slack) wired to both — the only real decision needed here is who gets paged and how, not a technical one.

### 3.4 Application deploy rollback

**Current state:** CI (`deploy-dev` job) auto-deploys on every push to `main`, no manual gate, no revision pinning. Cloud Run itself keeps every prior revision and supports instant traffic-shifting between them — that capability already exists at the platform level and is unused.

**Minimum viable production posture:**
1. Add a `gcloud run services update-traffic goms-api --to-revisions=<previous>=100` step as a documented (or scripted) manual rollback command — this needs zero CI changes, since Cloud Run already retains revision history; it's purely an operational runbook entry (a few lines: "list revisions, pick the last-good one, shift traffic").
2. Once real users are on this, consider gating `deploy-dev` (or a future `deploy-prod`) behind a manual approval step in GitLab CI (`when: manual`) rather than auto-deploying every push — cheap, no new infra, just a `.gitlab-ci.yml` change.
3. Migrations remain the sharper edge here: `goms-migrate` applies schema changes independently of the app deploy, with no automatic rollback story for a bad migration (matches the existing finding — "manual" migration process, spec §14.1 defers this deliberately). A rollback runbook should explicitly call out that **rolling back the app revision does not roll back an applied migration** — those need to be handled as two separate recovery paths, not conflated.

---

## 4. Frontend cutover plan — introducing `VITE_API_BASE_URL` without breaking local IndexedDB dev

**Current wiring (verified):** exactly two files reference the flag — `src/data/repository.ts:27` (`repository = import.meta.env.VITE_API_BASE_URL ? new RemoteRepository() : inMemoryRepository`) and `src/data/remote/repository.ts:27` (the tRPC client's base URL). No `.env` file in the repo sets it; it's unset in every dev/test/build command today. This is already about as clean a flag as it could be — the risk in cutover isn't the flag mechanism, it's everything downstream of flipping it.

**Newly found blocker not in the 2026-08-25 review: no CORS support.** `apps/api/src/server.ts` registers no `@fastify/cors` plugin (confirmed: not a dependency in `apps/api/package.json` at all). A `curl` or a Node-based test client never notices this (no browser = no CORS enforcement), which is why the extensive `curl`-based smoke testing across every phase never caught it. But the moment `VITE_API_BASE_URL` points a real browser tab at `goms-api-*.run.app` from a different origin (`localhost:5173` in dev, or whatever the eventual frontend-hosting domain is in production — see the readiness review's still-unstarted "Frontend hosting" item), **every request will fail the CORS preflight and the app will appear completely broken**, with no useful error beyond a browser console CORS message. This must be fixed (`@fastify/cors` registered with the correct allowed origin(s)) before any real cutover test, not discovered during one.

**The cutover sequence, staged to never break default local dev:**

1. **Fix CORS first** (`apps/api/src/server.ts` — add `@fastify/cors`, origin allow-list including `localhost:5173` for dev and the future hosting domain for prod). This is infrastructure-adjacent app code, not a frontend change, and is needed regardless of how the rest of cutover is staged.
2. **Never touch the default value.** `VITE_API_BASE_URL` stays unset in `package.json` scripts, `vite.config.ts`, CI, and any committed `.env` file. The in-memory/IndexedDB repository remains the default for `npm run dev`, `npm test`, and `npm run build` indefinitely — this is already true today and should be a hard invariant, not just an accident of current state.
3. **Opt-in only, via a local `.env.local`** (already gitignored by Vite convention — confirm `.env.local` is in `.gitignore`, it should be by default) — a developer who wants to test against `goms-dev` sets `VITE_API_BASE_URL=https://goms-api-ckskxj3iza-el.a.run.app` in their own untracked `.env.local` and restarts `npm run dev`. No code change needed for this — Vite already reads `.env.local` automatically. This is the "non-default build/env" step the 2026-08-25 stance notes called for, made concrete.
4. **Add a visible mode indicator.** Because `RemoteRepository` currently throws (or, with the `Partial<Repository>` typing, would be `undefined`) on any call to backup/bootstrap-adjacent surfaces — and because the seeded `goms-dev` data is a *reference dataset*, not the same as any given developer's local IndexedDB state — a developer pointed at the remote backend needs to know it at a glance (e.g. a small banner reading "Connected to goms-dev" driven by `!!import.meta.env.VITE_API_BASE_URL`). Cheap, prevents confusion between "my local edits" and "the shared dev database," and is a natural place to also hide the Backup/Restore buttons per §2's recommendation.
5. **Widen from opt-in to default only after**, in order: (a) §3.1's auth story is closed enough that an open `goms-dev` isn't a concern for whoever's using it, (b) a real frontend-hosting deployment exists (today there is none — the readiness review's "Frontend hosting: Not started" finding still holds, confirmed unchanged in this session), (c) the backup/restore UI gating from §2 has actually shipped, not just been designed.
6. **Production cutover is a separate, later decision** from "make `goms-dev` usable by developers" — the two should not be conflated. Widening the *default* in local dev (step 5) is about developer experience; actually serving production traffic through this backend is gated on all of §3, a real prod GCP project (today only `goms-dev` exists), and explicit user sign-off, matching the standing constraint already in place.

**What this plan deliberately does not do:** it does not propose flipping the default anywhere in this pass, does not touch CI, and does not start any of the above steps — it's the sequence to execute once reviewed and approved.

---

## 5. Browser-local vs. centrally-shared data — recommended classification

Two genuinely different categories exist in the current design, and cutover should preserve that split rather than trying to force everything through one mechanism:

| Category | What it is | Recommended handling post-cutover |
|---|---|---|
| **Centrally shared (belongs in Postgres, via `Repository`)** | Everything already ported: hierarchy/geo tree, employees, sales roster, commercial masters/SKUs/BOM/BOQs, ownership, opportunities, follow-ups, customers, audit logs. This is organizational data multiple users need to see the same version of. | Already fully covered by `RemoteRepository` (114/114 methods) — no design work needed here, just the cutover sequence in §4. |
| **Deliberately browser-local, should stay that way** | UI/session state with no cross-user meaning: any client-only view preferences, in-progress unsaved form state, the `PERSIST_FAILED_EVENT`/toast machinery in `persist.ts` (inherently about *this browser's* IndexedDB health), `import.meta.hot` dev-reload guards. Nothing found in a `localStorage`/`sessionStorage` grep beyond IndexedDB usage in `persist.ts` itself — the app doesn't currently split its local state across multiple mechanisms. | No change needed — this is already correctly local-only and has no `Repository` method, so it's untouched by `VITE_API_BASE_URL` regardless. |
| **Ambiguous — needs an explicit decision, not a default** | Whole-app **backup/restore** (§2) and **bootstrap** (§2). These aren't "local by nature" the way UI state is — they're operational tooling that happened to be built local-only because that's all that existed at the time. | Recommendation given in §2: keep them local-only and gate their UI off in remote mode, rather than trying to make them mean "backup the server" — that's a different, harder feature that should be scoped separately if actually needed (e.g. relying on Cloud SQL's own backup/PITR instead, which already exists and already covers this need at the infra level). |
| **Static reference assets bundled with the frontend** | `src/data/india-admin.json`, `subdistricts.json` (India geo reference data — this session's git status shows active, unrelated work in progress on these files and the `public/villages/*.json` tree; not part of this report's scope, noted only so it isn't mistaken for cutover-related). | These are build-time static assets, not `Repository`-mediated data, and were already correctly excluded from the seed-import's scope (the seed-import script consumes them to *build* hierarchy rows, but the raw JSON files themselves stay bundled with the frontend either way — no cutover implication). |

**The one governing principle to carry forward:** if a piece of state has a `Repository` method, it's centrally shared and cutover-ready today. If it doesn't, it was either deliberately scoped out (per-browser UI/session state — correctly local) or never had a "should this be shared" decision made for it (backup/bootstrap — needs the §2 UI-gating decision, not new backend work).

---

## Summary

| Item | Status |
|---|---|
| Live Commercial Masters smoke test against seeded `goms-dev` | **Done** — §1, all assertions passed, cleanup verified, real seed data untouched |
| Backup/migrations/bootstrap audit + recommended design | **Documented, not implemented** — §2: gate the Settings UI on `VITE_API_BASE_URL`, leave the mechanism local-only |
| Minimum production security/readiness plan | **Documented, not implemented** — §3: auth/authz needs its own design pass (no user/login model exists yet), rate limiting and monitoring are same-day GCP-native additions, rollback is mostly a runbook away given Cloud Run's existing revision history |
| Frontend cutover plan | **Documented, not implemented** — §4: **found a new blocker (no CORS support)** that must be fixed before any real browser-based cutover test, independent of everything else being ready |
| Browser-local vs. centrally-shared classification | **Done** — §5 |

**Recommendation:** do not enable `VITE_API_BASE_URL` yet. The CORS gap (§4) means a naive flip wouldn't just be premature, it would be broken outright for any real browser use. Combined with the still-open auth/rate-limiting/monitoring gaps (§3) and the backup/restore UI trap (§2), there's a clear, ordered punch list to close before cutover is worth reattempting — none of it is large, but none of it should be skipped either. Waiting for review before starting implementation, per instruction.
