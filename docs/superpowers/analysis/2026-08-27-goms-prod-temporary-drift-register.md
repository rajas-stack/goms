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

`apps/api/src/app.ts` does not set Fastify's `trustProxy`. Behind the Firebase
Hosting rewrite, `request.ip` is therefore the Google front-end's address rather
than the real client's, so the per-IP rate limit collapses into a single shared
bucket of 300 requests / 5 minutes for the entire internet. That is both a
DoS-amplification risk and a self-inflicted outage risk once real traffic
arrives. Fixing it requires enabling `trustProxy` and confirming the limiter
keys off `X-Forwarded-For`.

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
response and never throws. `GeographyExplorer.tsx` already branches on
`hasVillageMap === false` and falls back to the flat name-only village list from
`/villages/**` (which IS uploaded). So drilling to taluka level shows the village
*list* but not village *polygons*, via a fallback path the code was designed
around. Expect `404`s on `/village-shapes/**` in the network log at taluka level;
these are expected while this entry is ACTIVE.

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

**Status:** OPEN, shipped to production 2026-08-27. Not fixed in this deploy
(the deployment brief was to stop after the first hosted validation).
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
