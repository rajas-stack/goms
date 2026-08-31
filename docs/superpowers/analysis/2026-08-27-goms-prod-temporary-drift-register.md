# GOMS Production — Temporary Drift Register

**Created:** 2026-08-27
**Purpose:** Track deliberate, known-unsafe deviations applied to `goms-prod` to
unblock the pre-production/demo phase. Every entry here is a debt that MUST be
repaid. This file is the checklist for that repayment.

**Rule:** nothing gets added here without an explicit owner decision, and nothing
gets removed here without the removal actually having been executed and verified
against `goms-prod`.

---

## DRIFT-001 — `allUsers` can invoke the production API

**Status:** ACTIVE (applied 2026-08-27)
**Severity:** High — the production API is reachable by anyone on the internet.
**Scope:** `goms-prod` / Cloud Run service `goms-api` / region `asia-south1`.
`goms-dev` is NOT affected.

### What was applied

```
gcloud run services add-iam-policy-binding goms-api \
  --project=goms-prod \
  --region=asia-south1 \
  --member=allUsers \
  --role=roles/run.invoker
```

Before: the service had an empty IAM policy (no bindings) and returned
`HTTP 403` to unauthenticated callers.
After: unauthenticated callers reach the application; `/api/trpc/health.check`
returns `{"ok":true,"db":"connected"}`.

### Why it was applied

Firebase Hosting's `/api/**` → Cloud Run rewrite (`firebase.json`) cannot invoke
a private Cloud Run service. Firebase Hosting does not present an end-user
credential to the backing service, so the rewrite requires the service to permit
unauthenticated invocation. With application-level authentication intentionally
deferred for this phase, there is no other mechanism that lets the hosted
frontend reach the API.

### What this actually exposes

This is not merely "the API is public". Because application authentication does
not exist yet, **every procedure is `publicProcedure`** — so read *and write*
access to production data is open to anyone who finds the URL:

- Full read of all production business data.
- Unauthenticated create / update / delete on customers, employees,
  opportunities, sales, commercial and ownership data.
- The only limiter is a Fastify per-IP rate limit (300 requests / 5 minutes).

Mitigations deliberately NOT relied upon: the URL being unpublished
(security through obscurity), and the database currently being empty (a
transient condition that ends the moment real data is loaded).

### Removal criteria — do ALL of these

- [ ] Application authentication is implemented and enforced server-side on every
      non-public procedure (not just hidden in the UI).
- [ ] The frontend authenticates to the API through a mechanism that works
      through the Firebase Hosting rewrite, or the frontend stops using the
      rewrite in favour of a directly-authenticated call path.
- [ ] Then revoke:
      ```
      gcloud run services remove-iam-policy-binding goms-api \
        --project=goms-prod \
        --region=asia-south1 \
        --member=allUsers \
        --role=roles/run.invoker
      ```
- [ ] Verify an unauthenticated request returns `403` again.
- [ ] Verify the hosted frontend still works end-to-end after the revoke.
- [ ] Move this entry to a RESOLVED section with the date it was revoked.

### Related open risk (not itself drift, but made worse by DRIFT-001)

**Status: fixed in code 2026-08-27, deployed to `goms-prod` 2026-08-27.** See
BUG-002 below for the full writeup — `apps/api/src/app.ts` did not set
Fastify's `trustProxy`. Behind the Firebase Hosting rewrite, `request.ip` was
therefore the Google front-end's address rather than the real client's, so the
per-IP rate limit collapsed into a single shared bucket of 300 requests / 5
minutes for the entire internet. That was both a DoS-amplification risk and a
self-inflicted outage risk once real traffic arrives. Fix: `apps/api/src/
client-ip.ts` (new) plus `app.ts` wiring; `TRUST_PROXY=firebase-hosting` added
to `infra/prod/cloudrun.tf`'s `goms-api` service env. Regression-tested
(`apps/api/src/app.test.ts`'s "proxy trust and per-client rate-limit keying"
suite, `apps/api/src/client-ip.test.ts`). **Deployed**: new image built,
pushed to `asia-south1-docker.pkg.dev/goms-prod/goms/goms-api:bootstrap`,
`terraform apply` run (targeted, `goms_api`+`goms_migrate` only — the state's
tainted markers on both resources were cleared first via `terraform untaint`,
since applying the pre-existing plan as-is would have destroyed and recreated
both). Live-verified: `x-ratelimit-limit: 300` header present on
`https://goms-prod.web.app/api/trpc/health.check`, confirming the limiter is
now keyed via `Fastly-Client-IP` rather than the shared Google-front-end
address.

---

## DRIFT-002 — First hosted frontend deploy omits village boundary data

**Status:** ACTIVE (applied 2026-08-27)
**Severity:** Low — cosmetic/functional degradation only, no security impact.
**Scope:** Firebase Hosting site for `goms-prod` only.

### What was applied

`firebase.json`'s `hosting.ignore` was extended with:

```
"**/village-shapes/**",
"**/*.gz",
"**/*.br"
```

This cuts the upload from ~601 MB / ~13k files to ~42 MB / 6,454 files.

### Why

Staged first deployment: `dist/village-shapes` alone is 494 MB across ~6,450
JSON files, which dominates deploy time and risk for the initial cutover. The
`.gz`/`.br` artifacts (produced by `vite-plugin-compression2`) are dead weight on
Firebase Hosting, which negotiates and applies its own compression at the edge
and never serves these sibling files.

### User-visible effect

`src/features/geography/village-shapes.ts` `loadVillageShapes()` fetches
`/village-shapes/<stateCode>/<talukaCode>.json`, returns `[]` on a non-OK
response OR a parse failure, and never throws. `GeographyExplorer.tsx` already
branches on `hasVillageMap === false` and falls back to the flat name-only
village list from `/villages/**` (which IS uploaded). So drilling to taluka
level shows the village *list* but not village *polygons*, via a fallback path
the code was designed around.

**Corrected 2026-08-31** (live-verified against `goms-prod`, per that date's
functional parity audit): the actual network response is **`HTTP 200`**, not
`404` as this entry originally claimed. Firebase Hosting's catch-all SPA
rewrite (`firebase.json`'s `{ "source": "**", "destination": "/index.html" }`)
serves `index.html` for any path it doesn't recognize as a real uploaded
file — including `/village-shapes/**`, since that whole path was excluded
from the upload. `res.ok` is therefore `true` (a 200 satisfies `!res.ok`'s
check at `village-shapes.ts:28`), so the code actually falls through to
`res.json()` on the HTML body, which throws a parse error caught by the
outer `try/catch` (`village-shapes.ts:31-32`) — same end result (`[]`
returned, graceful fallback), different mechanism than originally documented.
Expect `200`s (serving the SPA shell's HTML, not real village JSON) on
`/village-shapes/**` in the network log at taluka level while this entry is
ACTIVE — not `404`s.

The `.gz`/`.br` exclusion has no user-visible effect at all.

### Removal criteria

- [ ] Decide whether village polygons are needed in the hosted product at all,
      or whether they should move to a bucket/CDN rather than Hosting.
- [ ] If they stay on Hosting: drop `"**/village-shapes/**"` from
      `hosting.ignore` and redeploy, then confirm polygons render at taluka
      level and no `/village-shapes/**` 404s remain.
- [ ] Keep the `.gz`/`.br` exclusions permanently — they are a correct
      optimisation, not drift. Once village-shapes is resolved, move those two
      lines out of this register and treat them as normal configuration.

---

## Non-drift, recorded for completeness

- `VITE_ADMIN_IMPORT_ENABLED` is left unset in the hosted build and
  `ADMIN_IMPORT_ENABLED` is left unset on the production API. Both flags are
  strict opt-ins (`=== 'true'` / `!== 'true'`), so unset means the Admin Data
  Import routes and procedures are absent. This is the intended production
  posture while authentication is absent, not drift.
- The production database is reachable but empty. No seed/import has been run
  against `goms-prod`.

---

## BUG-001 — Hosted production build displays "Connected to goms-dev"

**Status:** Fixed in code 2026-08-27, deployed to `goms-prod` 2026-08-27 (same
`npm run build` + `firebase deploy --only hosting` that also carried the
Admin Data Import feature staying dark — see below). Live-verified via
headless Chromium against `https://goms-prod.web.app`: badge now reads
"Connected to goms-prod".
**Severity:** Cosmetic, but actively misleading to anyone operating the system.

`src/components/TopBar.tsx:48` hardcodes the badge text:

```tsx
<Icon name="Database" size={11} />
Connected to goms-dev
```

The surrounding `Tooltip` correctly interpolates `remoteApiBaseUrl`, so hovering
shows the truth ("Reading and writing live data at https://goms-prod.web.app")
while the always-visible badge says `goms-dev`. The badge renders whenever
`VITE_API_BASE_URL` is set at all — it has never been environment-aware.

**This is a label bug only.** It was verified from network evidence that the
hosted build really does talk to `goms-prod`: every `/api/trpc` request goes to
`https://goms-prod.web.app/api/trpc` and no request reaches any other API
origin. Nothing is misrouted.

**Fix:** derive the label from `remoteApiBaseUrl` (or drop the environment name
from the badge and leave it in the tooltip) rather than hardcoding it. Requires
a rebuild and redeploy.

**Implemented:** `src/lib/api-environment.ts` (new) resolves the badge label
from `VITE_API_BASE_URL` — a Firebase Hosting origin (`*.web.app`/
`*.firebaseapp.com`) yields its project id (`goms-prod.web.app` → `goms-prod`),
anything else falls back to the host itself rather than guessing, with an
optional `VITE_API_ENV_LABEL` override for a bare Cloud Run host. Wired into
`src/components/TopBar.tsx`. Verified in a real headless-Chromium run of three
separately-built bundles (default/local, `VITE_API_BASE_URL=https://goms-prod.
web.app`, `VITE_API_BASE_URL=https://goms-dev.web.app`) — each showed the
correct badge text and no `goms-dev` leakage on the prod build. Regression
tests: `src/lib/api-environment.test.ts`, `src/components/TopBar.test.tsx`.
**Deployed 2026-08-27** and confirmed live.

### Admin Data Import — explicitly kept dark in production (decision reaffirmed 2026-08-27)

Even with authentication out of scope for this phase per this session's own
instruction, `ADMIN_IMPORT_ENABLED` stays permanently unset in
`infra/prod/cloudrun.tf`, and `VITE_ADMIN_IMPORT_ENABLED` was never set for
the frontend build — an explicit user decision made mid-session, overriding
an earlier, broader instruction to enable it. Reasoning as stated:
"Authentication is explicitly deferred, so Admin Data Import must remain
unavailable from the public production site" — i.e. accepting DRIFT-001's
existing unauthenticated read/write exposure on the CRUD routers already live
is one thing; opening an *additional*, bulk-multi-table-write surface with no
auth in front of it is a separate, larger decision this session chose not to
make unilaterally. Live-verified: `adminImport.listDomains` against the
direct Cloud Run URL returns `404 NOT_FOUND` (the env-gate 404, not an auth
failure — see `apps/api/src/trpc.ts`'s `adminImportProcedure`). See
`docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md`
for the original fully-gated (post-auth) enablement plan — still the plan of
record for a *permanent* enablement.

**One-time exception, executed and closed out same day.** The user approved a
narrower path: temporarily set `ADMIN_IMPORT_ENABLED=true` for exactly as
long as it took to run a one-time reference-data load, then remove it again.
Timeline:
1. `ADMIN_IMPORT_ENABLED=true` applied via `terraform apply` (targeted,
   `goms_api` only).
2. While testing, found and fixed a real bug: `apps/api`'s `tsc` build never
   copied `src/import/data/*.json` (the bundled geography reference data)
   into `dist/`, so `adminImport.previewGeographyLoad` 500'd on the deployed
   image. Fixed via a new `copy-import-data` postbuild step
   (`apps/api/package.json`); rebuilt and redeployed before the load could
   proceed.
3. New script `scripts/prod-reference-import.ts` (reuses the same
   `buildSeed()`/`buildOwnershipFixture()` demo dataset
   `scripts/seed-import.ts` uses, reshaped into the Admin Data Import
   wizard's row format) ran in dry-run mode first, its full per-domain
   summary shown to the user, explicit commit approval obtained, then run
   with `--commit`.
4. **Result**: all 11 domains committed cleanly — 7,178 geography rows, 72
   org hierarchy nodes, 4 currencies, 5 tax classes, 4 approval matrix
   entries, 29 flat commercial masters, 48 catalog commercial masters, 2
   employees (10 vacant government seats excluded — the demo data models
   them with a blank name, which the import schema requires non-blank;
   skipped rather than inventing a placeholder name), 60 sales
   roster rows, 9 SKUs, 1 BOM item. The `preSales` commercial master (4 rows)
   has no Admin Data Import domain and was not imported. Re-ran the dry run
   immediately after commit: every domain reported 100% "unchanged", 0
   rejects, confirming idempotent state.
5. Live-verified via headless Chromium: Directory shows the 2 employees, Map
   shows the org hierarchy, Commercial Calculator loads without error, no
   console/page errors on any checked route.
6. `ADMIN_IMPORT_ENABLED` removed via `terraform apply` immediately after
   step 5. Live-verified: `adminImport.listDomains` returns `404` again;
   `health.check` and `hierarchy.listStates` (now returning real data)
   confirm the app is otherwise unaffected.

**Production data state as of this entry**: `goms-prod` now holds real
reference/master data (not real Amnex business data — the same demo dataset
used to seed `goms-dev`). Transactional data (customers, opportunities, BOQs)
remains empty, per the original production-data-strategy decision.

---

## Validation record — 2026-08-27 first hosted deploy

Deployed `dist` (6,454 files, ~42 MB) to `https://goms-prod.web.app`, built with
`VITE_API_BASE_URL=https://goms-prod.web.app`. Verified in headless Chromium:

- Site loads (HTTP 200); no console errors, no uncaught page errors, no 4xx/5xx.
- Only request origins are `goms-prod.web.app`, `fonts.googleapis.com`,
  `fonts.gstatic.com`. No direct `*.run.app` and no `goms-dev` traffic.
- `/api/**` rewrite reaches Cloud Run: 14 `/api/trpc` calls, all HTTP 200,
  `server: Google Frontend`.
- Home, /map, /directory, /sales, /commercial-calculator, /state/27 all render.
- `/admin/data-import` and `/admin/data-import/geography` both render the
  app's 404 screen ("This record isn't in the registry") — routes absent.
- CRUD through the same-origin rewrite: `customers.create` → 200 with a
  Postgres UUID; after a **full page reload** the row was still returned by
  `customers.list`; `customers.delete` → 200; list returned to 0 rows. The
  temporary record was removed, leaving production clean.
- No CORS errors (the rewrite makes API calls same-origin, so CORS is not
  exercised at all from the hosted site).

**Production data state:** the database is reachable and migrated but contains
no rows — `hierarchy.listStates` returns `[]`, Directory shows "0 people",
Home shows 0 Offices / 0 Employees. Home's "36 States & UTs / 736 Districts"
come from the bundled static `src/data/india-admin.json`, not the API. Because
of this, every UI-driven create flow is currently unusable: Create Person /
Create Department dead-end at "No state found for code 0" (no org roots exist),
and Create BOQ blocks on absent Department / Vertical / SKU / currency
reference data. That is why the CRUD check was performed against
`customers.create`, the one write path with no foreign-key prerequisites. No
seed or import was run.
