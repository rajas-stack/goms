# GOMS Production Security Readiness — What's Prepared Ahead of Auth

**Date:** 2026-08-26
**Status:** Documentation only. Auth implementation stays paused pending the Amnex IT identity-provider answer (`2026-08-26-goms-identity-provider-decision.md`). Nothing in this document changes any procedure's access level, adds any middleware, or touches `infra/dev/cloudrun.tf`'s `allUsers` grant. This closes Stage B plan §7's checklist framing into a concrete, ready-to-execute reference for the day §1 is unblocked.

---

## 1. Every procedure today, and what it becomes

Verified directly against `apps/api/src/index.ts` and every router file (not assumed): **all 10 routers are composed under `appRouter`, and every procedure in all of them is `publicProcedure` — there is exactly one procedure type today (`apps/api/src/trpc.ts`).**

| Router | Mutations (count) | Becomes |
|---|---|---|
| `health` | 0 | Stays `publicProcedure` — the uptime check (Stage B §3) must keep working with no auth, by design. |
| `customers` | 3 | `protectedProcedure` |
| `hierarchy` | 8 | `protectedProcedure` |
| `employees` | 12 | `protectedProcedure` |
| `sales` | 5 | `protectedProcedure` |
| `ownership` | 3 | `protectedProcedure` |
| `opportunities` | 3 | `protectedProcedure` |
| `followUps` | 3 | `protectedProcedure` |
| `search` | 0 (query-only) | `protectedProcedure` once queries are migrated (see §3) |
| `commercial` | 21 total | **Split — see §2** |

## 2. The one router that splits: `commercial`

`commercial` is composed of 5 sub-routers (`apps/api/src/routers/commercial.ts:1333-1339`). Only `masters` is admin-gated — every other sub-router is ordinary `protectedProcedure`, matching the 2-role model's grounding (Stage B plan §1.3: masters are "genuinely rare, genuinely admin," touched "maybe quarterly"; everything else is routine BOQ/SKU authoring any user does):

| Sub-router | Mutations | Procedure names (`apps/api/src/routers/commercial.ts`) | Becomes |
|---|---|---|---|
| `commercial.masters` | 4 | `create` (L98), `update` (L149), `delete` (L219), `setEditionFeatures` (L243) | **`adminProcedure`** |
| `commercial.skus` | 3 | `create` (L425), `update` (L486), `delete` (L537) | `protectedProcedure` |
| `commercial.bom` | 3 | `create` (L563), `update` (L585), `delete` (L623) | `protectedProcedure` |
| `commercial.boq` | 8 | `create` (L890), `update` (L928), `addLineItem` (L972), `updateLineItem` (L1032), `removeLineItem` (L1129), `reorderLineItems` (L1149), `updateStatus` (L1179), `delete` (L1308) | `protectedProcedure` |
| `commercial.auditLogs` | 0 (query-only) | — | `protectedProcedure` once queries migrate |

**This is the entire admin-only surface: 4 procedures, all under `commercial.masters`.** Nothing else in the current 59-mutation surface needs a role check beyond "logged in" — inventing a third role or gating anything else would be exactly the over-engineering Stage B plan §1.3 already ruled out.

## 3. Migration order, once §1 is unblocked

Mirrors the same "one router at a time" discipline already used for the Repository-domain migration (Stage B plan §1.4 item 4), applied concretely:

1. `users` table migration + `auth` router (`login`, `me`) + `protectedProcedure`/`adminProcedure` middleware in `trpc.ts` — ships with `health.check` and `auth.login` still `publicProcedure`, everything else still unchanged and working.
2. **Mutations first** (the actual write-access risk), router by router: `customers` → `hierarchy` → `employees` → `sales` → `ownership` → `opportunities` → `followUps` → `commercial.skus`/`commercial.bom`/`commercial.boq` → `commercial.masters` (→ `adminProcedure` specifically, last, since it's the smallest and most isolated surface — easiest to verify in isolation).
3. **Queries second**, same router order — lower risk (read access, not write), but still gated once every mutation is already protected, so there's no window where reads are open but writes are locked (a confusing intermediate state to debug).
4. Only after every router is migrated: remove Cloud Run's `allUsers` invoker grant (§5 below) — never before, since removing it earlier would break the app with no compensating protection in place yet.

## 4. `createdBy`/`changedBy`: where they'll come from

Confirmed today: `created_by`/`changed_by` are real, already-migrated `TEXT` columns — unpopulated seams, not something that needs a new migration when auth ships:

- **Migrations that already have the columns:** `1787647096930_commercial-skus-bom.sql`, `1787650774037_commercial-boq.sql`, `1787654497473_opportunities-ownership-followups.sql`.
- **Routers that already read/write them as plain data** (e.g. `apps/api/src/routers/opportunities.ts:23`'s stage-change history read) without anything populating them on write today: `commercial.ts`, `opportunities.ts`, `ownership.ts`, `sales.ts`, `follow-ups.ts`.
- **Frontend confirmation the seam is real and open:** `src/features/nodes/WorkFormDialog.tsx:17` — `OpportunityDraft` explicitly `Omit`s `createdBy` from what's saved. Nothing populates this today, by construction, not oversight.

**Once auth ships:** every mutation handler that currently leaves `created_by`/`changed_by` null (or omits them) populates them from `ctx.user.id` — available on every `protectedProcedure` call via the tRPC context §1.4 item 3 already scopes (`createContext` attaching `{user}`). This is a mechanical change per router at the same time each router migrates off `publicProcedure` (§3 above), not a separate pass — doing it in the same commit as the procedure-type swap keeps "who can call this" and "who does this say made the change" from drifting apart.

## 5. Cloud Run `allUsers` invoker grant — exactly where it lives, per environment

| Environment | Current state | What changes, and when |
|---|---|---|
| `goms-dev` | **Grants `allUsers`** — `infra/dev/cloudrun.tf` (the `google_cloud_run_v2_service_iam_member` resource near L69-74 per the Stage B plan's citation), deliberately, per the original architecture doc's no-auth-yet phase. | Must be **removed** once auth ships and is verified end-to-end on `goms-dev` — not before (§3 step 4). This is a real Terraform change to an already-applied resource, so it needs its own deliberate `terraform apply`, reviewed separately from the auth code itself. |
| `goms-prod` | **Does not grant `allUsers`** — confirmed by direct file comparison, `infra/prod/cloudrun.tf` has no equivalent resource at all. This is a deliberate deviation from pure dev-duplication (flagged in that file's own header comment): prod hasn't shipped yet, so there's no "removing it breaks live usage" argument dev has. | Named-principal access should be granted explicitly once pre-cutover validators are identified (Stage B plan §5) — and once auth ships, `goms-prod` never needs the `allUsers` grant removed, because it's never granted in the first place. |

## 6. Frontend login integration points — where the wiring lands, not built yet

Confirmed today: **zero auth-related code exists anywhere in `src/`** (no login route, no token storage, no auth context). The integration points below are exactly where §1.4 item 5's login screen + token wiring would land, identified by what's already there for it to connect to:

| Concern | Existing hook point | What gets added |
|---|---|---|
| tRPC client headers | `src/data/remote/repository.ts:26-28` — `RemoteRepository`'s `createTRPCClient`/`httpBatchLink` call, currently no `headers` option | `httpBatchLink({ url, headers: () => ({ authorization: \`Bearer ${token}\` }) })` (or an httpOnly-cookie approach needing no explicit header, per §1.4 item 5's stated preference) |
| Render gate | `src/main.tsx:34-38` — already branches on `VITE_API_BASE_URL` before rendering | A login screen becomes the thing rendered instead of the app shell when in remote mode and no valid session exists — same branch point, new condition |
| Remote-mode indicator | `src/components/TopBar.tsx:45-52` — already shows a "Connected to goms-dev" badge when `VITE_API_BASE_URL` is set | Natural place to also surface the logged-in user's identity/role once auth exists, alongside the existing remote-mode badge |
| Repository construction | `src/data/repository.ts:27-29` — already switches between `RemoteRepository`/in-memory based on `VITE_API_BASE_URL` | No change needed structurally — `RemoteRepository`'s constructor is where the token/header wiring above actually lands |
| Local-mode unaffected | `SettingsDialog.tsx`, `bootstrapRepository()` | **Explicitly out of scope for auth** — local/default mode has no server to authenticate against; auth only ever applies to remote mode, never to the local in-memory/IndexedDB path (regression-tested in `src/main.test.tsx`, `src/features/settings/SettingsDialog.test.tsx`) |

## 7. What this document does not do

It does not implement `protectedProcedure`/`adminProcedure`, does not create the `users` table, does not remove `goms-dev`'s `allUsers` grant, and does not build a login screen. All of that stays paused on the Amnex IT identity-provider answer, per `2026-08-26-goms-identity-provider-decision.md`. What exists here is the exact, verified map of what changes and where, so implementation can start immediately once that answer lands — no re-discovery needed.
