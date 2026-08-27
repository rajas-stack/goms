# GOMS Stage B: Production Readiness Plan

**Date:** 2026-08-26
**Scope:** Stage B of the 2026-08-26 cutover readiness report — a concrete, reviewable plan for authentication/authorization, rate limiting, monitoring/alerts, rollback runbook, the production GCP environment, and frontend hosting. This is a **plan only**. Nothing has been provisioned, no code has been written, `VITE_API_BASE_URL` remains unset by default, and no self-managed GitLab runner has been created. Stage A (dev cutover) is accepted as complete and is not touched by anything below.

**How this plan was built:** every claim about "current state" below was verified by reading the actual code/Terraform in this repo today (`apps/api/src/`, `infra/dev/*.tf`, `.gitlab-ci.yml`, `docs/superpowers/specs/2026-08-24-goms-gcp-backend-architecture-design.md`), not assumed. Where a decision needs the user's judgment rather than a technical fact, it's flagged explicitly instead of guessed.

---

## 0. What already exists that this plan builds on

- **The GCP backend architecture design** (`docs/superpowers/specs/2026-08-24-goms-gcp-backend-architecture-design.md`) already made two decisions this plan inherits rather than re-litigates:
  - §5: **Firebase Hosting** for the frontend (scoped to static hosting + custom domain/HTTPS + an `/api/**` rewrite to Cloud Run) — selected specifically because it needs no load balancer, which for a <50-user internal tool is typically the single largest fixed cost in the whole stack.
  - §15/§20: no auth today is a **deliberate, accepted trade-off** for the phase already shipped, not an oversight, with "Identity Platform + IAP as a documented future phase" flagged as the thing to design next. This plan is that next phase.
- **No user/role/auth concept exists anywhere in the codebase today** — confirmed by grep and by an earlier design note in `docs/superpowers/plans/2026-08-03-commercial-calculator-catalog-settings-split.md:15`: *"GOMS has no role or auth concept anywhere in the codebase (confirmed: no `currentUser`/`isAdmin`/`useRole`/`Permission` symbol exists)."* Every tRPC procedure across all 10 routers (`apps/api/src/index.ts`) is `publicProcedure` (`apps/api/src/trpc.ts` defines exactly one procedure type). `created_by`/`changed_by` columns exist in three migrations (SKUs/BOM, BOQ, opportunities) but are unpopulated `TEXT` seams — the frontend's own `Opportunity` draft type explicitly omits `createdBy` when saving (`src/features/nodes/WorkFormDialog.tsx:17`), confirming nothing writes to it today.
- **`health.check`** (`apps/api/src/routers/health.ts`) already does a real `SELECT 1` against Postgres and returns `{ok: true, db: 'connected'}`, or throws (surfacing as a non-200) if the DB is unreachable — this is already a correct uptime-check target, no app change needed for §3 below.
- **59 mutation procedures** exist across 8 routers today (`commercial`: 21, `employees`: 12, `hierarchy`: 8, `sales`: 5, `customers`/`follow-ups`/`opportunities`/`ownership`: 3 each) — this is the concrete surface §1 and §2 below have to cover.

---

## 1. Authentication and authorization

> **STATUS (2026-08-26): PAUSED pending Amnex IT confirmation.** The rest of this plan (§2-§7) is approved for further design. This section's conclusion — app-level session/JWT auth, §1.2 — is **not yet a final decision**. Before implementing anything in §1, a focused identity-provider investigation was requested to compare a managed-identity option (federated to an existing Amnex corporate IdP, if one exists) against self-managed email/password. That investigation found **no evidence of an existing Amnex corporate identity/SSO provider anywhere in this repo or related project memory** — this is an organizational fact this codebase cannot establish. The user is confirming directly with Amnex IT whether GOMS users authenticate through Microsoft 365/Entra ID, Google Workspace, or another SSO/IdP. **Do not implement self-managed email/password, or any other auth mechanism, until that answer comes back and the identity decision is explicitly approved.** §1.2-§1.4 below are retained as the reasoning for "no IAP" (still sound — see note) but §1.4's specific mechanism (email/password JWT) is provisional, not approved.
>
> **What stays true regardless of the IT answer:** §1.2's case against IAP specifically (needs a load balancer, breaks the Firebase Hosting decision) is independent of which identity provider Amnex turns out to use — a load-balancer-free *managed* identity layer (e.g. Firebase Authentication/Identity Platform, which verifies tokens via a backend SDK rather than proxying traffic through a load balancer) can federate to Google Workspace, Microsoft Entra ID (OIDC), or plain email/password without changing that conclusion. Once the IdP answer is known, the remaining comparison is "managed identity layer, configured for whichever provider Amnex confirms (or none)" vs. "fully self-managed JWT" — across user lifecycle, password reset/MFA, session handling, role mapping, frontend/backend integration cost, GCP cost, and operational burden, per the user's original request. That comparison has not been written yet, deliberately, so as not to pre-load a recommendation before the one open fact (Amnex's IdP situation) is known.

### 1.1 Current state

Every procedure is public. Cloud Run's `roles/run.invoker` is granted to `allUsers` (`infra/dev/cloudrun.tf:73`), deliberately, per the architecture doc. No login screen, no session, no user table exists in the frontend or backend.

### 1.2 Does IAP fit? No — and this is a load-bearing decision, not a coin flip

Identity-Aware Proxy was evaluated and rejected, for reasons specific to this stack, not in the abstract:

1. **IAP requires an external HTTPS Load Balancer in front of the protected backend.** GOMS today has *no* load balancer anywhere — Cloud Run is reached either directly (`*.run.app`, dev) or via Firebase Hosting's declarative rewrite (§5 of the architecture doc), which is a CDN-edge rewrite, not a load balancer IAP can attach to. Adding IAP means adding the exact always-on-cost load balancer that Firebase Hosting was *specifically chosen to avoid* (architecture doc §5.1: "that forwarding rule is not a rounding error — it is typically the single largest fixed line item in the entire stack"). This directly conflicts with the user's own constraint here: don't introduce Cloud Armor/LB infrastructure unless the auth design actually requires it. IAP is the one auth design that *would* require it — so picking IAP would mean silently reopening the frontend-hosting decision too.
2. **IAP gates by Google identity, not by GOMS-specific role.** It answers "is this a known Google/Workspace account" — it says nothing about whether that person should see the Commercial Calculator's admin-only "Reference Data"/"Approval Matrix" surfaces (see 1.3) versus ordinary BOQ authoring. IAP would still need an application-level role check bolted on top for anything beyond all-or-nothing access — at which point it's not actually saving the app-level work, only adding infra cost on top of it.
3. **GOMS has no existing identity source to gate on.** There's no evidence in this repo of Google Workspace being the org's identity provider for GOMS users specifically (it may or may not be — this is a fact only the user can confirm, and is flagged in §7's checklist). Even if it is, point 1 still holds: the LB cost is triggered regardless.

**Decision: application-level session/JWT auth**, not IAP. This is the same conclusion the architecture doc's own §15 gestures at ("Authentication and IAP are an explicit future phase... Identity-Aware Proxy... is the cheapest way to add a login gate later" was written *before* this plan traced the LB dependency through to the hosting decision — tracing it through changes the recommendation from "IAP is cheapest" to "IAP is cheapest only if you're willing to reopen the hosting decision," which this plan is not doing without the user weighing in explicitly).

### 1.3 Minimum roles/permissions, derived from the actual screens and mutations — not invented

There is exactly one prior design signal in this codebase about roles, and it points at a two-tier split. The Commercial Calculator's catalog-settings design (`docs/superpowers/plans/2026-08-03-commercial-calculator-catalog-settings-split.md:86-111,330-331`) already separates:

- **Ordinary staff surfaces** — the 9 screens in `src/app/routes/` (Home, StateWorkspace, Directory, Meetings, SalesWorkspace, Commercial Calculator's BOQ authoring, Relationship Analytics) plus Command Palette/Settings — used routinely by Sales/Pre-Sales/Commercial staff.
- **"Genuinely rare, genuinely admin"** surfaces — Commercial Calculator's Reference Data and Approval Matrix (masters: verticals, product editions, currencies, SKU categories, billing types, tax classes, approval matrix, pre-sales — the `commercial.masters.*` mutations), described in that plan as touched by "true admins," "maybe quarterly."

**Minimum viable roles: `user` and `admin`.**

| Role | Can do |
|---|---|
| `user` (default for every logged-in account) | Everything in `hierarchy`, `employees`, `sales`, `ownership`, `opportunities`, `follow-ups`, `customers`, `search`, and `commercial`'s BOQ/SKU/product authoring mutations. This is "any internal GOMS user doing their job." |
| `admin` | Everything `user` can do, **plus** `commercial.masters.*` create/update/delete (verticals, product editions, currencies, SKU categories, billing types, tax classes, approval matrix, pre-sales), and — once built — user management (invite/deactivate/change role). |

This is a floor, not a ceiling: nothing here rules out a finer-grained role later (e.g. read-only auditor), but nothing in the current 9 screens or 59 mutations demonstrates a need for more than 2 roles today, and inventing more would be exactly the "choose an architecture for convenience" the user asked to avoid — in this case convenience in the other direction (over-engineering).

### 1.4 Concrete mechanism

1. **New `users` table** (migration, `apps/api/migrations/`): `id uuid`, `email text unique`, `password_hash text`, `role text check (role in ('user','admin'))`, `created_at`, `is_active boolean default true`.
2. **`auth` router**: `login` (email+password → verify via `bcrypt`/`argon2` → issue a signed JWT, short-lived access token + refresh, or a simple server-side session row — exact token strategy is an implementation detail, not an architecture one) and `me` (returns the current session's user+role, for the frontend to gate UI).
3. **tRPC context + middleware** (`apps/api/src/trpc.ts`): add a `createContext` that reads the auth token from the request, verifies it, and attaches `{user}` to context. Add `protectedProcedure` (requires a valid session, any role) and `adminProcedure` (requires `role === 'admin'`), both built with `t.procedure.use(...)` middleware, alongside the existing `publicProcedure` (kept for `health.check` and `auth.login` only).
4. **Migrate routers incrementally**, mirroring the same "one router at a time" discipline already used for the Repository-domain migration (per the 2026-08-24 plan's own established pattern): swap `publicProcedure` → `protectedProcedure` for all mutation procedures first (the actual write-access risk), then queries, then swap `commercial.masters.*`'s mutations specifically to `adminProcedure`.
5. **Frontend**: a login screen, token stored (httpOnly cookie preferred over `localStorage` for XSS resistance), attached to the tRPC client's headers in `src/data/remote/repository.ts`. Populate `createdBy`/`changedBy` from the session's user id instead of leaving those columns null, closing the seam the schema already left open.
6. **Cloud Run `allUsers` invoker grant is removed** only once this ships and is verified — until then, app-level auth alone is the gate; removing `allUsers` prematurely (before app auth exists) would just break the app with no compensating protection.

---

## 2. Rate limiting

> **STATUS (2026-08-26): IMPLEMENTED, tested, not deployed.** `@fastify/rate-limit` is registered in `apps/api/src/app.ts` (extracted from `server.ts` into a `buildApp()` factory so it's testable via Fastify's `.inject()`) with the exact defaults below (300/5min global). 5 new tests in `apps/api/src/app.test.ts` cover: requests under the limit, exceeding the limit (429 + standard error shape), a batched tRPC request (6 procedures via the real `@trpc/client` `httpBatchLink`, routed through `.inject()`) costing exactly 1 request against the limit — not 6 — directly re-exercising the same batching mechanism behind the 2026-08-26 `maxParamLength` incident, and a no-regression check that CORS + `health.check`'s response shape are unaffected. Full suite: 147/147 (142 pre-existing + 5 new), `tsc -b` clean, root tests 247/247, component tests 126/126, production build clean. **Not deployed anywhere** — verified entirely locally (a temporary Docker Postgres for `apps/api`'s test suite, removed after). No login-specific limit yet, since auth is paused (§1).

### 2.1 Current state

None, anywhere — no Cloud Armor, no load balancer (Cloud Run is hit directly), no `@fastify/rate-limit` or equivalent in `apps/api/src/server.ts`.

### 2.2 Decision: Fastify-level limiter, no Cloud Armor/LB

Consistent with §1's decision (app-level auth, no load balancer), rate limiting stays at the Fastify layer: **`@fastify/rate-limit`**, registered in `apps/api/src/server.ts` alongside the existing `@fastify/cors` registration. This needs zero new infrastructure and is a same-day change.

**One real limitation, stated plainly (not hidden):** tRPC's `httpBatchLink` coalesces many procedure calls into one HTTP request (already documented behavior — see the `maxParamLength` incident in the 2026-08-26 dev checkpoint). A per-request limiter therefore rate-limits *batches*, not individual procedure calls — a page that fires 7 queries in one batch consumes one request's worth of budget, not seven. This is fine for abuse protection (the thing being limited is "how fast can a client hammer the server," which a batch already amortizes) but means the limiter cannot distinguish "one expensive mutation" from "one cheap query" within a shared HTTP path. Cloud Run's multi-instance scaling also means this limiting is **per-instance, not globally accurate** across all replicas — the same accepted trade-off already recorded in the architecture doc §15/§20. Both limitations get a real fix only by adding Cloud Armor + a load balancer, which §1 already decided not to introduce for this phase.

### 2.3 Concrete limits

Two tiers, both keyed by IP (`@fastify/rate-limit`'s default):

| Scope | Limit | Rationale |
|---|---|---|
| Global (`app.register(rateLimit, {global: true, ...})`) | 300 requests / 5 minutes per IP | Generous enough for real usage (the Home page alone batches 6-7 procedures per load; a busy user clicking through several screens shouldn't get throttled), tight enough to blunt a scripted hammering attempt. |
| `auth.login` specifically (a route-level override) | 5 requests / minute per IP | The one endpoint where brute-force/credential-stuffing is a real, specific risk once §1 ships — every other endpoint requires a valid session already, so the login endpoint is the actual attack surface worth a tighter, separate limit. |

Both numbers are starting points, not tuned against real traffic (none exists yet) — call this out as something to revisit once `goms-prod` has real usage data, rather than presenting them as final.

---

## 3. Monitoring and alerts

> **STATUS (2026-08-26): TERRAFORM WRITTEN, VALIDATED, NOT APPLIED (dev or prod).** `infra/dev/monitoring.tf` (and an identical `infra/prod/monitoring.tf`) implement the uptime check + 4 alert policies below. `terraform validate` passes for both directories. **No notification channel was created or guessed** — both files reference `var.notification_channel_ids`, a required variable with no default (`variables.tf` in each directory), so `plan`/`apply` fails explicitly and immediately until a real recipient is supplied, rather than silently paging nobody. `var.api_hostname` is similarly required with no default. Neither directory was `apply`'d — `infra/dev` because applying wasn't requested and would touch real `goms-dev` infra without the notification-channel decision made yet; `infra/prod` because the project doesn't exist.

### 3.1 Current state

None beyond the app's own business audit-log tables (`commercial_audit_logs`), which record business events, not infra health. No Cloud Monitoring dashboards, uptime checks, or alert policies exist in Terraform today (confirmed: no `monitoring.tf` or `google_monitoring_*` resource anywhere in `infra/dev/`).

### 3.2 Plan — three additions, all standard Terraform resources, zero app code changes

A new `infra/prod/monitoring.tf` (mirrored into `infra/dev/monitoring.tf` too, since dev should get the same cheap visibility — this is infra, not a prod-only concern):

1. **Uptime check** against `health.check`:
   ```hcl
   resource "google_monitoring_uptime_check_config" "goms_api_health" {
     display_name = "goms-api health"
     timeout      = "10s"
     period       = "60s"
     http_check {
       path         = "/api/trpc/health.check"
       port         = 443
       use_ssl      = true
       validate_ssl = true
     }
     monitored_resource {
       type = "uptime_url"
       labels = {
         project_id = var.project_id
         host       = var.api_hostname # goms-api-<hash>-<region>.a.run.app, or the Firebase Hosting domain once §6 ships
       }
     }
   }
   ```
   This already verifies DB connectivity end-to-end, because `health.check` itself does a real `SELECT 1` (§0) — a failure of Postgres reachability surfaces as a failed uptime check, not just "the container is up." No separate DB-specific uptime probe is needed.
2. **Alert policy on the uptime check** — notify on N consecutive failures (recommend N=2 at the 60s period, i.e. ~2 minutes of real downtime before paging, to avoid single-blip false alarms):
   ```hcl
   resource "google_monitoring_alert_policy" "goms_api_down" {
     display_name = "goms-api uptime check failing"
     combiner     = "OR"
     conditions {
       display_name = "Uptime check failed"
       condition_threshold {
         filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\""
         comparison      = "COMPARISON_LT"
         threshold_value = 1
         duration        = "120s"
         aggregations {
           alignment_period   = "60s"
           per_series_aligner = "ALIGN_NEXT_OLDER"
         }
       }
     }
     notification_channels = [google_monitoring_notification_channel.ops.id]
   }
   ```
3. **Cloud SQL alerts** — CPU, storage, and connection-count thresholds; these metrics are emitted automatically by Cloud SQL once the instance exists, no extra instrumentation:
   ```hcl
   resource "google_monitoring_alert_policy" "goms_pg_cpu" {
     display_name = "goms-pg CPU > 80%"
     combiner     = "OR"
     conditions {
       display_name = "CPU utilization"
       condition_threshold {
         filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
         comparison      = "COMPARISON_GT"
         threshold_value = 0.8
         duration        = "300s"
         aggregations { alignment_period = "300s", per_series_aligner = "ALIGN_MEAN" }
       }
     }
     notification_channels = [google_monitoring_notification_channel.ops.id]
   }
   # + storage utilization and connection-count variants, same shape, different metric.type
   ```
4. **Notification channel** — the one genuinely non-technical decision: **who gets paged and how (email vs. Slack webhook)**. This is flagged in §7's checklist rather than guessed at — a placeholder `google_monitoring_notification_channel` with the wrong recipient is worse than not having one, since it creates false confidence.

---

## 4. Rollback / runbook

> **STATUS (2026-08-26): WRITTEN.** Full runbook at `docs/superpowers/analysis/goms-prod-rollback-runbook.md` — the two `gcloud` commands, the full migration decision tree (§2.1-§2.3 there), and the IAM roles required. Nothing in it has been executed against any real environment.

### 4.1 Cloud Run revision rollback

Cloud Run retains every prior revision automatically and supports instant traffic-shifting — this capability already exists at the platform level and needs no new infrastructure, only a documented procedure:

```bash
# List revisions, newest first, to find the last-known-good one
gcloud run revisions list --service=goms-api --project=goms-prod --region=asia-south1

# Shift 100% of traffic back to it
gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 \
  --to-revisions=<last-good-revision>=100
```

This is what Stage A already used on `goms-dev` twice (per the 2026-08-26 dev checkpoint) and is instant and safe — the old revision's container image is untouched and still running the old code.

### 4.2 Database migration recovery — a separate path, not the same button

**Rolling back a Cloud Run revision does not roll back an applied database migration.** These are two independent systems: Cloud Run traffic-shifting only changes which container image serves requests; `node-pg-migrate` migrations, once applied via the `goms-migrate` Cloud Run Job, are permanent changes to the live schema/data until a separate, explicit action reverses them. A bad deploy that shipped both a bad app revision *and* a bad migration needs **two separate recovery actions**, not one:

1. **App rollback** (§4.1) — reverts code immediately, independent of the migration's state.
2. **Migration assessment**, handled case by case:
   - **Additive/backward-compatible** migration (new nullable column, new table, new index) — the rolled-back old app code simply ignores the new schema element. No action needed; this is the case every production migration should be written to hit, by following an expand/contract pattern (add new schema first, deploy code that uses it, only drop/rename old schema in a *later*, separate migration once the new code has been running safely).
   - **Destructive** migration (dropped/renamed column, a backfill that mutated existing data) — requires either a hand-written down-migration (if `node-pg-migrate`'s down function was written and is safe to run) or restoring from a Cloud SQL point-in-time-recovery backup (already enabled — `infra/dev/database.tf:20-22`, `point_in_time_recovery_enabled = true`) to a moment before the migration ran. **PITR restore is a heavy, data-loss-risking operation** (anything written after the restore point is lost) and must be a deliberate, explicit decision by whoever's on call — never an automatic step.

**Runbook rule to adopt going forward:** every production migration should default to expand/contract (additive first) specifically so that §4.1's instant, low-risk app rollback is *always* sufficient on its own, and §4.2's PITR path stays a rare last resort rather than a routine part of rollback.

### 4.3 Runbook document

A short `docs/superpowers/analysis/goms-prod-rollback-runbook.md` (written once this plan is approved, not today) should contain exactly: the two commands from §4.1, the migration-assessment decision tree from §4.2, and who has the IAM permissions (`roles/run.admin` on `goms-prod`) to execute them under time pressure.

---

## 5. Production GCP environment — what needs duplicating from `goms-dev`

> **STATUS (2026-08-26): TERRAFORM SKELETON WRITTEN, VALIDATED, NOT INITIALIZED AGAINST REAL BACKEND, NOT APPLIED.** `infra/prod/*.tf` now mirrors this table (`backend.tf`, `variables.tf`, `network.tf`, `database.tf`, `storage.tf`, `wif.tf`, `cloudrun.tf`, `monitoring.tf`), `terraform validate` passes (via `init -backend=false`, since the real `goms-prod-tfstate` GCS bucket doesn't exist). `goms-seed-import` is correctly not present. Two deliberate deviations from pure duplication, both called out in `cloudrun.tf`'s header comment for the user to confirm or override: (1) `goms-prod` gets **no `allUsers` invoker grant** — unlike dev's original launch decision, prod hasn't shipped yet so there's no "removing it breaks live usage" argument; named-principal access should be granted explicitly once pre-cutover validators are identified. (2) The §5 open question about `deploy-prod`'s git ref was resolved by reasoning rather than left open: `wif.tf` stays identical to dev (same `ref == "main"` condition) because the real promotion gate is a future `when: manual` CI stage, not a different WIF-level ref restriction — that CI stage itself is out of scope for now (shared-runner quota still exhausted, no CI redesign requested). **Nothing has been applied — the `goms-prod` project doesn't exist.**

Per the architecture doc §16, production is a **separate GCP project** (`goms-prod`), not a folder/prefix inside the dev project — project-level isolation gives IAM/billing/network boundaries for free, so a dev mistake structurally cannot touch prod. Everything below is **what to duplicate, not a provisioning action** — nothing here is applied until approved.

| Category | What exists in `goms-dev` today | What `goms-prod` needs |
|---|---|---|
| **Project** | `goms-dev` (existing) | New GCP project `goms-prod`, billing linked |
| **Terraform layout** | `infra/dev/*.tf`, state in GCS bucket `goms-dev-tfstate` prefix `goms/dev` | New `infra/prod/*.tf` mirroring the same 7 files (`network.tf`, `database.tf`, `storage.tf`, `backend.tf`, `wif.tf`, `variables.tf`, `cloudrun.tf`), own state bucket/prefix (e.g. `goms-prod-tfstate`, `goms/prod`) — never share state with dev |
| **Networking** | `goms-vpc`, `goms-subnet-asia-south1` (10.10.0.0/24), PSA range, in the dev project | Identical resource shapes, recreated in the prod project (GCP networking is project-scoped — nothing here can be "shared" from dev even if wanted) |
| **Database** | `goms-pg` Cloud SQL instance, `db-f1-micro`, private IP only, PITR enabled | A separate Cloud SQL instance in `goms-prod` — **not** a bigger tier by default; keep `db-f1-micro` to start (matches the "cost-sensitive" framing already established) unless the user has a specific prod-traffic reason to size up now, which should be an explicit call, not a default |
| **Secrets** | `goms-db-password`, `goms-db-url` in Secret Manager, dev project | Same two secrets, recreated in `goms-prod`'s own Secret Manager — **never** the same secret values as dev (a fresh `random_password` per environment) |
| **Service accounts** | `goms-api-runtime` (Cloud SQL Client + Secret Accessor + Storage Object Admin, scoped), `goms-ci-deploy` (Run Admin + Artifact Registry Writer + actAs runtime SA), WIF pool `gitlab-pool` restricted to `main` branch | Identical least-privilege shape, new service accounts in `goms-prod`. **Open question for the user:** does `deploy-prod` deploy from the same `main` branch as `deploy-dev` (current `wif.tf` attribute condition is already locked to `ref == "main"`), or does prod deploy need a separate ref/tag/manual trigger? This affects whether prod needs its own WIF provider with a different `attribute_condition`, not just a duplicate of dev's. |
| **Storage** | `${project_id}-attachments` bucket, uniform access, `public_access_prevention = enforced` | Same bucket shape in `goms-prod`, project-scoped name |
| **Cloud Run** | `goms-api` service (`allUsers` invoker — see §1.6, this changes once auth ships), `goms-migrate` job, `goms-seed-import` job (dev-only demo/reference data tool) | `goms-api` service + `goms-migrate` job, same shape. **`goms-seed-import` is explicitly not duplicated** — it imports the frontend's demo/reference seed data, which has no place in production. Production's initial load is the real one-time data migration described in the architecture doc §19.1 (a different script/job, scoped separately once the user confirms what real data — if any — needs to move into prod at cutover) |
| **Monitoring** | None today (§3) | New `infra/prod/monitoring.tf` per §3.2, applied to both `goms-dev` and `goms-prod` (dev gets the same cheap visibility, since it costs nothing extra to add) |
| **Frontend hosting** | None (GitLab Pages still serves today's build) | Firebase Hosting project linked to `goms-prod` (§6) |

---

## 6. Frontend hosting

**Decision: Firebase Hosting**, as already selected in the architecture doc §5.3 — this plan doesn't reopen that choice, only makes it concrete for prod, because §1's auth decision (app-level, not IAP) means the load-balancer alternative (§5.2 of that doc) is never actually needed. Cheapest sensible GCP-native option confirmed still holds: Firebase Hosting's free tier (10 GB stored, 360 MB/day served) comfortably covers a <50-user internal SPA at zero incremental infrastructure cost, versus an Application Load Balancer's always-on forwarding-rule cost.

**Preserves the existing Vite app unchanged** — no rebuild of the SPA itself, just a new deploy target:

```json
// firebase.json — new file, apps/web root (or repo root, matching the existing `npm run build` output at dist/)
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "/api/**", "run": { "serviceId": "goms-api", "region": "asia-south1" } },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

This also **removes the need for the manual `cp dist/index.html dist/404.html` SPA-routing workaround** the current GitLab Pages `pages` CI job needs (`.gitlab-ci.yml`) — Firebase Hosting's catch-all rewrite handles client-side routing natively.

**HTTPS/custom domain:** Firebase Hosting provisions and auto-renews a managed TLS certificate once a custom domain is added via `firebase hosting:sites` / the Firebase console and the domain's DNS is pointed at Firebase's assigned records — this needs the user to already own (or be willing to acquire) a domain; no domain purchase is assumed or actioned by this plan.

**API CORS origin:** because the `/api/**` rewrite serves the API from the *same origin* as the frontend once this ships, the browser's real production traffic never triggers a CORS preflight at all — this closes the CORS surface down to just the allow-list already in place (`apps/api/src/server.ts`'s `CORS_ALLOWED_ORIGINS`), which should be set to the prod custom domain (e.g. `CORS_ALLOWED_ORIGINS=https://goms.<domain>`) as defense-in-depth for the case of someone testing directly against the bare `*.run.app` URL — not because same-origin production traffic needs it.

---

## 7. Final checklist — what's still required before the first real production cutover

Decisions and facts only the user can supply, plus the concrete build-out, in the order they actually block each other:

- [ ] **Approve this plan** (or redirect it) — specifically the app-level-auth-over-IAP call in §1.2, since everything downstream (rate limiting stays app-level, frontend hosting stays Firebase, no load balancer) is built on that one decision holding.
- [ ] **Confirm the 2-role model (`user`/`admin`) is sufficient** — §1.3's grounding is real but is a floor, not a promise that no third role will ever be needed.
- [ ] **Confirm login mechanism**: email+password (self-managed, simplest, no external dependency) vs. an existing SSO/IdP if the org already has one for other internal tools — this repo has no evidence either way.
- [ ] Implement §1: `users` table migration, `auth` router, `protectedProcedure`/`adminProcedure` middleware, router-by-router migration off `publicProcedure`, frontend login screen + token wiring.
- [ ] Implement §2: `@fastify/rate-limit`, global + `auth.login`-specific limits.
- [ ] **Who gets paged, and how** (email address / Slack webhook) — §3.2's notification channel is a placeholder without this.
- [ ] Apply `infra/prod/monitoring.tf` (and its dev counterpart) per §3.
- [ ] Write and store `docs/superpowers/analysis/goms-prod-rollback-runbook.md` per §4.3.
- [ ] **Acquire billing account + create the `goms-prod` GCP project** — a real, user-owned action (billing, org policy) this plan does not take on its own.
- [ ] **Confirm prod's deploy trigger** (same `main` branch as dev, or a separate ref/manual trigger) — affects `infra/prod/wif.tf`'s `attribute_condition` (§5's open question).
- [ ] Stand up `infra/prod/*.tf` mirroring §5's table, applied only after project creation and explicit go-ahead.
- [ ] **Own or acquire the production custom domain** — needed before §6's Firebase Hosting custom-domain step.
- [ ] Configure Firebase Hosting (`firebase.json`, custom domain, DNS) per §6.
- [ ] **Clarify what real data (if any) needs to land in `goms-prod` at cutover** — a fresh empty production database, or a migration from some existing non-GOMS source? This determines whether §5's "production data load" is a no-op or a real migration job that needs its own design pass (explicitly out of scope for this plan, which only says `goms-seed-import`'s demo data is *not* the answer).
- [ ] Add `deploy-prod` to `.gitlab-ci.yml`, gated `when: manual`, promoting the exact image tag already validated in `goms-dev` (per architecture doc §18) — no rebuild between dev and prod.
- [ ] Stand up `goms-prod` under a temporary hostname first (Cloud Run's default `*.run.app`, or a preview subdomain) and validate end-to-end — including a rehearsal of §4's rollback commands — before any DNS cutover, per the architecture doc's own §19.2 cutover procedure.
- [ ] Lower the production DNS TTL in advance of the actual cutover window, per §19.2.
- [ ] A final security-review pass once §1/§2 are implemented and before DNS cutover (a dedicated pass, not a rubber stamp — auth code is exactly the kind of change worth one).
- [ ] **Explicit go/no-go from the user** for the actual DNS cutover moment — this is the one step in the entire sequence with no safe automatic default, by design (§19.2's own point: the cutover window should be a short, announced maintenance window, not a silent switch).

---

## Summary

| Area | Recommendation | Requires new infra beyond app code? |
|---|---|---|
| Auth | App-level session/JWT, 2 roles (`user`/`admin`) | No — no load balancer, no IAP |
| Rate limiting | `@fastify/rate-limit`, global + login-specific tiers | No |
| Monitoring | Uptime check on `health.check` + Cloud SQL/Cloud Run alert policies + 1 notification channel | Yes — standard Terraform, no LB/Cloud Armor |
| Rollback | Cloud Run traffic-shift (instant) + a documented, separate migration-recovery path (PITR as last resort) | No |
| Prod GCP environment | New `goms-prod` project, full duplication of §5's table, minus `goms-seed-import` | Yes — a full environment, applied only after approval |
| Frontend hosting | Firebase Hosting (already-decided §5 of the architecture doc), unchanged Vite app | Yes — Firebase project + custom domain, no load balancer |

**Nothing in this plan has been provisioned. `VITE_API_BASE_URL` remains unset by default. No Cloud Armor/load balancer was introduced. No self-managed GitLab runner was created.** Waiting for review before starting any implementation, per instruction.
