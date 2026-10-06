# RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the approved 8-role (plus System Admin) / 26-module RBAC policy on the server for every tRPC procedure, with field-level edit and read control, shipped dark behind `RBAC_MODE=off|shadow|enforce`.

**Architecture:** The policy (matrix, field atoms, masks) and its pure evaluators live in `@goms/domain` so server and UI share one source. One `PROCEDURE_POLICY` registry (`'router.procedure'` → requirements) is evaluated by a single tRPC middleware wired into `apps/api/src/trpc.ts`; a procedure with several requirements must pass **all** of them. Roles come from `org_people` / `sales_persons` plus a `user_role_overrides` table. SKU cost/floor masking runs in response hooks. The UI reads `auth.me` and reuses the same evaluators.

**Tech Stack:** TypeScript (NodeNext ESM), tRPC 11.18, Fastify 5, Postgres via node-pg-migrate, Zod, Vitest 2 (real shared Postgres for API tests, `fileParallelism: false`), React 18 + TanStack Query, Firebase auth.

**Spec:** [docs/superpowers/specs/2026-10-06-rbac-design.md](../specs/2026-10-06-rbac-design.md) (approved 2026-10-06 with two corrections: Solution Lead read-only for all roles; multi-requirement procedures must pass every requirement; amended the same day: Sales derives from `active`/`onLeave` only (A6), and a **System Admin** role is added, spec §3.4).

## Global Constraints

Copied from the spec; every task inherits them.

- Roles are exactly the eight functional roles `sales`, `presales`, `bid`, `legal`, `cxo`, `delivery`, `it`, `finance` (`FUNCTIONAL_ROLES`) plus `system_admin` (allow-list only). `ROLES` is the nine, `system_admin` last. Levels are exactly `N`, `R`, `P` (explicit field-level edit), `W`.
- `RBAC_MODE` is `off` (default) | `shadow` | `enforce`, evaluated **only when `AUTH_ENFORCEMENT_ENABLED` is `"true"`**. `off` is an exact no-op: behavior, errors and the 18 currently-public queries are unchanged. `AUTH_ENFORCEMENT_ENABLED` and `READ_AUTH_ENFORCEMENT_ENABLED` are already `"true"` in dev and prod, so they must **not** be used to gate RBAC.
- Role derivation is only: Pre-sales ← org dept `Pre-Sales`; Bid ← `Bid Management`; Legal ← `Legal`; CXO ← `Leadership`; Sales ← `sales_persons` (`status IN ('active','onLeave')` — `resigned` and `inactive` do not derive Sales; match on `lower(official_email)`). **Finance, IT and Delivery are override-only; System Admin is allow-list-only (`ADMIN_ALLOWED_EMAILS`) and is never an override.** No other label (Business Units, Technology, Finance dept, Chairman's Office) maps to a role. CXO is additive and never removes functional roles.
- Max level across effective roles; union of permitted fields and scopes. Rows outside every write scope fall back to Read. There is no row-level read scoping.
- A procedure has one authorization requirement normally; a cross-module procedure declares several and **every one must pass**. Fail closed: an unregistered procedure, or a patch key with no atom, is denied.
- Solution Lead is read-only for every role in v1: `ownership.assign` / `ownership.end` on `role='solutionLead'` are denied to everyone, including `W` roles and System Admin.
- SKU `sku.costs` (8 `SKU_COST_FIELDS`) and `sku.floor` (`floorPrice`, `minimumAllowedPrice`, `internalPrice`) are visible only to Pre-sales, Finance, CXO and System Admin. Masked values are `null` plus `maskedFields: string[]`, never `0`. Server-side. The existing `SKU_SENSITIVE_FIELDS` change-reason rule stays.
- Admin Data Import stays outside RBAC (own allow-list + `ADMIN_IMPORT_ENABLED`). `ADMIN_ALLOWED_EMAILS` members are the **System Admins** (spec §3.4): unrestricted, replacing the earlier break-glass IT. They cannot be granted, revoked or removed through the UI or the override table, and they are the only gate on `access.*` while `RBAC_MODE=off`.
- **System Admin** (spec §3.4): `W`·all on every policy module; every atom except the frozen Solution Lead atom (`FROZEN_ATOMS`), including the exclusive ones (SKU cost / floor / tax, tax-class and currency masters, BOQ approve); create/delete on every module with such operations (all but #23, #24, #26); reads masked SKU fields. Authentication, the `@amnex.com` check and `EMERGENCY_READ_ONLY` still apply to it, and Admin Data Import stays separate. Test accounts become System Admin only via `makeSystemAdmin(label)` (the allow-list), never via `setRole`.
- Baseline (authenticated, zero roles): Geography read only; everything else None.
- `console.log` JSON is the only log channel (the API has no Fastify logger). Shadow denials: `{"event":"rbac.would_deny", ...}`.
- Commits: one local commit per task, message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Never push or deploy without the user's explicit approval** (each push burns GitLab CI minutes; the prod flag flip needs its own separate approval).
- Tests: run the full local unit and component suites before any push. API tests need the local Postgres (`DATABASE_URL`) with migrations applied; the local DB has no seed data.

## Review Focus

Failure modes the spec implies but a straight reading of the tasks would not exercise. Each has a test in the task named in brackets.

1. **Email case / whitespace.** `Rajas@Amnex.com ` in `org_people` / `sales_persons` / roster must still resolve to the login `rajas@amnex.com`. [Task 5]
2. **Unknown or extra patch key.** A typo or a field that has no atom must be denied, not silently ignored (zod strips unknown keys, so the guard sees keys the handler never would). [Tasks 8, 10]
3. **Sales role without a roster row.** A Sales override on someone with no `sales_persons` row must read fine but never match `own`; the denial must say so clearly. [Tasks 3, 8]
4. **Signed-out call to a newly-gated read.** Must fail `UNAUTHORIZED` (so the existing sign-in prompt appears), never an RBAC `FORBIDDEN` (which would show "no access"). [Task 13]
5. **RBAC denial vs. sign-in dialog.** `authPromptLink` turns every `FORBIDDEN` into the "sign in with @amnex.com" dialog; an RBAC denial must carry a marker so it shows a normal error instead. [Tasks 6, 15]
6. **System Admin membership.** It comes only from `ADMIN_ALLOWED_EMAILS` (case/whitespace-insensitive), wins over any override, can never be stored as an override (DB `CHECK`), and the access API refuses to set or remove overrides on those accounts. [Tasks 4, 5, 14]

## Spec gaps found while planning — need your sign-off

Planning against the real code exposed gaps the approved spec does not cover. **The spec is not edited** (per your instruction). Each task below implements the recommended default; if you reject one, the "if rejected" line says what to revert.

| # | Gap | Recommended default (implemented) | If rejected |
|---|---|---|---|
| A1 | **Creator scope.** `bids.create` / `opportunities.create` record no owner, so a Sales user who creates a Pipeline row is not `own` and could not edit it (Pipeline/Campaign are `W·own`). | Add nullable `opportunities.created_by`; `own` also matches `created_by = user`. Set on create. (Task 4, 7, 12) | Sales loses edit on rows they just created until an owner is assigned. |
| A2 | **BOQ → SKU dependent read.** Bid has `R†` on BOQs but `N` on SKUs; BOQ screens read SKUs by id. | `com.boqs ≥ R` implies read on `com.skus` (still masked) and `com.masters`. (Task 3, 10) | Bid/Sales BOQ screens would hit `FORBIDDEN` for SKU names. |
| A3 | **Saved views** are in no module. | Personal views: allowed for anyone who can read rows. Global views: need write on `bid.columns`. (Task 8) | Pick another owner module for global views. |
| A4 | **Cross-module read lookups.** Search spans modules; owner badges use `ownership.resolve*`; owner/Geo-BU columns need salesperson names, but Legal/Delivery/Finance are `N` on Sales Team. | Search results are filtered per category→module. `ownership.resolve*` read passes if the user can read ownership **or** any row/contact/department module. `sales.listPersons/getPerson/currentPostings` pass for row readers but return a **redacted** projection (no personal email, mobile, notes) to roles without Sales Team read. (Tasks 9, 10) | Those roles see `FORBIDDEN` / blank names on rows. |
| A5 | **Analytics modules have no server procedure** (the numbers are computed in the browser from data the user may legitimately read), except `search.relationshipAnalytics`. `an.financial` cannot be server-enforced without masking opportunity value (a spec non-goal). | `an.operational` enforced on `search.relationshipAnalytics`; `an.*` otherwise hide UI only. (Tasks 9, 16) | Accept UI-only, or add opportunity-value masking as new scope. |
| A6 | **`resigned` Sales status.** `sales_persons.status` allows `active, onLeave, resigned, inactive`; the spec said `<> 'inactive'`, so a `resigned` salesperson would keep Sales. | **Changed by the user 2026-10-06 (not the original default):** Sales derives only from `status IN ('active','onLeave')`; `resigned` and `inactive` do not. The spec §3.2 is amended to match. Shared constant `SALES_ROLE_STATUSES`. (Tasks 1, 5, 14) | n/a — decided. |

Informational consequences of the approved rules (no action needed, but expect them):

- **Legal and `reviewChange`.** Because a data-rewriting accept needs the affected field's module too, Legal (`L2` only) can reject any corrigendum change but can accept only changes that rewrite nothing; accepting a tender-link or milestone change needs Bid.
- **CXO Go/No-Go.** Recording `decision` auto-derives the bid stage (`goApproved` / `dropped`) and syncs the opportunity stage inside the handler. That derived write is intended (it is the existing domain rule) and is not separately checked.
- **`boq.approve` and `ownership.solutionLead` are exclusive atoms.** `W` does not imply them; only an explicit `P` set grants `boq.approve` (CXO), and nothing grants `ownership.solutionLead`.
- **Bid-less opportunities** (created from Account Mapping) are authorized as the `bidTracker` sheet.
- **The grid today lets users edit Solution Lead** (`editable: 'solutionLead'` in `gridColumns.ts`, an end-then-assign two-call write). With `RBAC_MODE=off` that is unchanged; under RBAC it becomes read-only for everyone. Whether to also remove that write path outside RBAC is a separate decision.

## Amendments applied 2026-10-06 (user directives after plan approval)

| Change | Effect | Tasks |
|---|---|---|
| **A6 changed** | Sales derives only from `sales_persons.status IN ('active','onLeave')`; `resigned` and `inactive` do not. Shared constant `SALES_ROLE_STATUSES`. | 1, 5, 14 |
| **System Admin role** (spec §3.4) | Ninth role `system_admin`. Membership is `ADMIN_ALLOWED_EMAILS` only (the two permanent accounts); never derived, never an override (DB `CHECK`), not removable through the UI. Unrestricted: `W`·all on every module, every atom except the frozen Solution Lead, create/delete wherever the module has such operations, reads masked SKU fields, full Role & Access and Audit access. Authentication and `EMERGENCY_READ_ONLY` still apply; Admin Data Import stays separate. Replaces the break-glass IT. | 1–5, 8–10, 14, 15, 17, 20, 21 |

Judgment calls I made while writing the amendment (veto any of them and I will change it):

1. **Solution Lead stays frozen even for System Admin.** Your standing rule is "read-only for every role", and the reason is data integrity (replacing a lead is two calls and only owners auto-close), not access level. A System Admin therefore cannot write it through RBAC.
2. **No create/delete grant on the three view-only modules** (#23, #24, #26): no such operation exists, and the audit trail stays append-only. System Admin is still `W` on them.
3. **System Admin replaces rather than adds to the break-glass IT**; IT is now only an ordinary override-granted role.
4. **`system_admin` is not a valid override role** (the `user_role_overrides` `CHECK` keeps the eight functional roles), so the UI and API can neither grant nor revoke it.

Operations prerequisite (not done by this plan): `ADMIN_ALLOWED_EMAILS` lists one account on goms-dev and none on goms-prod. Both environments need both System Admin accounts before RBAC is used; that is a Cloud Run configuration change needing your approval and Shubham's exact address.

## File Structure

**Domain (`packages/domain/src/rbac/`)** — pure, no I/O, shared with the UI

| File | Responsibility |
|---|---|
| `types.ts` | `Role`, `Level`, `Scope`, `Grant`, `RbacMode`, `UserFacts`, `ScopeFacts` |
| `atoms.ts` | atom constants (`W_ONLY_ATOMS`, `EXCLUSIVE_ATOMS`), field→atom maps, `atomsForPatch` |
| `policy.ts` | module list, matrix cells, create/delete lists, field sets, `GRANTS`, `validatePolicy` |
| `mask.ts` | masked atoms, `canReadAtom`, `maskSkuRow`, `maskAuditEntry`, `redactSalesPerson` |
| `evaluate.ts` | `inScope`, `accessFor`, `allows`, implied reads |
| `index.ts` | barrel |

**API (`apps/api/src/`)**

| File | Responsibility |
|---|---|
| `auth/rbac/mode.ts` | `rbacMode()` |
| `auth/rbac/userFacts.ts` | effective roles + identity facts, TTL cache |
| `auth/rbac/denial.ts` | `RbacDenial`, `DenyCall` |
| `auth/rbac/rows.ts` | DB loaders → `ScopeFacts` for bid / opportunity / follow-up / meeting / roster / owned entity |
| `auth/rbac/decide.ts` | `evaluateCheck`, `decide` |
| `auth/rbac/guard.ts` | `evaluateCall` (caller resolution, shadow logging, enforce) |
| `auth/rbac/registry/types.ts` `helpers.ts` `builders.ts` | `Check`/`Requirement`/`PolicyEntry`, simple and row-aware requirement builders |
| `auth/rbac/registry/opportunity.ts` `accountMapping.ts` `commercial.ts` `admin.ts` `index.ts` | the per-procedure policy, composed into `PROCEDURE_POLICY` |
| `routers/access.ts` / `routers/auth.ts` | override management + readiness; `auth.me` |
| `lib/ownershipContext.ts` / `lib/pendingUploads.ts` | extracted shared helpers (break import cycles with `trpc.ts`) |
| `migrations/1790800000000_rbac-role-overrides.sql`, `1790900000000_rbac-created-by-and-email-indexes.sql` | schema |
| `testHelpers/rbacFixtures.ts` | DB fixtures + role grants for tests |

**Frontend (`src/`)**: `lib/permissions.tsx` (provider, `usePermissions`, `<Can>`), `components/NoAccess.tsx`, `modules/admin-access/*` (Role & Access screen), plus targeted edits listed per task.

---

## Phase A — Domain policy (pure)

### Task 1: Policy types and the 26-module matrix

**Files:**
- Create: `packages/domain/src/rbac/types.ts`
- Create: `packages/domain/src/rbac/atoms.ts` (constants only in this task)
- Create: `packages/domain/src/rbac/policy.ts`
- Create: `packages/domain/src/rbac/policy.test.ts`
- Create: `packages/domain/src/rbac/index.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './rbac/index.js'`)
- Modify: `packages/domain/tsconfig.json` (exclude tests from `dist`)
- Modify: `vite.config.ts:16` (let the root vitest run the domain tests)

**Interfaces:**
- Produces: `ROLES`, `Role`, `Level`, `Scope`, `Grant`, `RbacMode`, `ModuleKey`, `PolicyModuleKey`, `MODULES`, `FIELD_SETS`, `GRANTS`, `grantFor(module, role)`, `validatePolicy(): string[]`, `DERIVED_ROLE_DEPARTMENTS`, `SALES_ROLE_STATUSES`, `FUNCTIONAL_ROLES`, `FROZEN_ATOMS`, `SYSTEM_ADMIN_VIEW_ONLY_MODULES`, `W_ONLY_ATOMS`, `EXCLUSIVE_ATOMS`. Later tasks import all of these from `@goms/domain`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/rbac/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DERIVED_ROLE_DEPARTMENTS, FIELD_SETS, GRANTS, MODULES, SALES_ROLE_STATUSES, SYSTEM_ADMIN_VIEW_ONLY_MODULES, grantFor, validatePolicy,
} from './policy.js'
import { EXCLUSIVE_ATOMS, FROZEN_ATOMS, W_ONLY_ATOMS } from './atoms.js'
import { FUNCTIONAL_ROLES, ROLES } from './types.js'

describe('RBAC policy matrix', () => {
  it('has the 26 spec modules and exactly one derived module (the Master Grid)', () => {
    expect(MODULES).toHaveLength(26)
    expect(MODULES.filter((m) => m.key === 'opp.master')).toHaveLength(1)
    expect(Object.keys(GRANTS)).toHaveLength(25)
    expect(Object.keys(GRANTS)).not.toContain('opp.master')
  })

  it('passes every structural invariant', () => {
    expect(validatePolicy()).toEqual([])
  })

  it('matches representative cells of the approved matrix (spec §10)', () => {
    expect(grantFor('opp.bidTracker', 'sales')).toEqual({ level: 'P', scope: 'own', sets: ['S1'], create: true, delete: false })
    expect(grantFor('opp.bidTracker', 'presales')).toEqual({ level: 'P', scope: 'asg', sets: ['P1'], create: false, delete: false })
    expect(grantFor('opp.bidTracker', 'bid')).toEqual({ level: 'W', scope: 'all', sets: [], create: true, delete: true })
    expect(grantFor('opp.bidTracker', 'cxo')).toEqual({ level: 'P', scope: 'all', sets: ['X1'], create: false, delete: false })
    expect(grantFor('opp.pipeline', 'sales')).toMatchObject({ level: 'W', scope: 'own', create: true, delete: false })
    expect(grantFor('com.skus', 'finance')).toMatchObject({ level: 'P', sets: ['F1'] })
    expect(grantFor('com.approvalMatrix', 'cxo')).toMatchObject({ level: 'W', create: true, delete: true })
    expect(grantFor('com.approvalMatrix', 'finance')).toMatchObject({ level: 'R', create: false, delete: false })
    expect(grantFor('com.boqs', 'cxo')).toMatchObject({ level: 'P', sets: ['X2'] })
    expect(grantFor('am.ownership', 'bid')).toMatchObject({ level: 'P', sets: ['B1'], create: true, delete: true })
    expect(grantFor('am.customers', 'it')).toMatchObject({ level: 'R' })
    expect(grantFor('admin.access', 'it')).toMatchObject({ level: 'W', create: true, delete: true })
  })

  it('gives Delivery read-only grants only — it has no assignment slot to scope writes to', () => {
    for (const grant of Object.values(GRANTS).map((g) => g.delivery)) {
      expect(['N', 'R']).toContain(grant.level)
      expect(grant.scope).toBe('all')
      expect(grant.create || grant.delete).toBe(false)
    }
  })

  it('derives roles only from the four decided departments; Finance, IT and Delivery are override-only', () => {
    expect(DERIVED_ROLE_DEPARTMENTS).toEqual({ presales: 'Pre-Sales', bid: 'Bid Management', legal: 'Legal', cxo: 'Leadership' })
  })

  it('derives Sales only from active and onLeave roster entries (plan gap A6): resigned and inactive do not count', () => {
    expect([...SALES_ROLE_STATUSES]).toEqual(['active', 'onLeave'])
  })

  it('adds System Admin as a ninth, allow-list-only role after the eight functional roles', () => {
    expect([...FUNCTIONAL_ROLES]).toEqual(['sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance'])
    expect([...ROLES]).toEqual([...FUNCTIONAL_ROLES, 'system_admin'])
    expect(Object.keys(DERIVED_ROLE_DEPARTMENTS)).not.toContain('system_admin')
  })

  it('gives System Admin W·all on every module, with create/delete everywhere except the three view-only modules', () => {
    for (const module of Object.keys(GRANTS) as (keyof typeof GRANTS)[]) {
      const g = grantFor(module, 'system_admin')
      expect(g, module).toMatchObject({ level: 'W', scope: 'all', sets: [] })
      const viewOnly = (SYSTEM_ADMIN_VIEW_ONLY_MODULES as readonly string[]).includes(module)
      expect(g.create, `${module} create`).toBe(!viewOnly)
      expect(g.delete, `${module} delete`).toBe(!viewOnly)
    }
    expect([...SYSTEM_ADMIN_VIEW_ONLY_MODULES].sort()).toEqual(['admin.audit', 'an.financial', 'an.operational'])
  })

  it('System Admin can create and delete wherever any functional role can (it is a strict superset)', () => {
    for (const module of Object.keys(GRANTS) as (keyof typeof GRANTS)[]) {
      for (const role of FUNCTIONAL_ROLES) {
        const g = grantFor(module, role)
        if (g.create) expect(grantFor(module, 'system_admin').create, `${module}/${role} create`).toBe(true)
        if (g.delete) expect(grantFor(module, 'system_admin').delete, `${module}/${role} delete`).toBe(true)
      }
    }
  })

  it('freezes the Solution Lead atom: exclusive, in no partial set, and denied even to System Admin', () => {
    expect([...FROZEN_ATOMS]).toEqual(['ownership.solutionLead'])
    for (const atom of FROZEN_ATOMS) {
      expect(EXCLUSIVE_ATOMS.has(atom)).toBe(true)
      for (const atoms of Object.values(FIELD_SETS)) expect(atoms).not.toContain(atom)
    }
  })

  it('keeps W-only atoms out of every partial set and pins the exclusive-atom list', () => {
    for (const [name, atoms] of Object.entries(FIELD_SETS)) {
      for (const atom of atoms) expect(W_ONLY_ATOMS, `${name} contains ${atom}`).not.toContain(atom)
    }
    expect([...EXCLUSIVE_ATOMS].sort()).toEqual(
      ['boq.approve', 'master.currencies', 'master.taxClasses', 'ownership.solutionLead', 'sku.costs', 'sku.floor', 'sku.tax'],
    )
  })

  it('has a grant for every role in every module', () => {
    for (const module of Object.keys(GRANTS)) for (const role of ROLES) expect(GRANTS[module as keyof typeof GRANTS][role]).toBeDefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/domain/src/rbac/policy.test.ts`
Expected: FAIL — `Failed to resolve import "./policy.js"` (and the include glob does not match yet, so first make Step 3's config edit if vitest reports "No test files found").

- [ ] **Step 3: Wire up the test location and write the implementation**

Edit `vite.config.ts` line 16:

```ts
    include: ['src/**/*.test.ts', 'packages/domain/src/**/*.test.ts'],
```

Edit `packages/domain/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/domain/src/rbac/types.ts`:

```ts
/** The eight roles derived from the org chart / roster or granted by an override (spec §3.2, §3.3). */
export const FUNCTIONAL_ROLES = ['sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance'] as const
export type FunctionalRole = (typeof FUNCTIONAL_ROLES)[number]

/** Every role, `system_admin` last. System Admin is allow-list-only (`ADMIN_ALLOWED_EMAILS`, spec §3.4): never derived,
 *  never an override — so overrides, the override API and the access UI use FUNCTIONAL_ROLES, not ROLES. */
export const ROLES = [...FUNCTIONAL_ROLES, 'system_admin'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  sales: 'Sales', presales: 'Pre-sales', bid: 'Bid', legal: 'Legal', cxo: 'CXO', delivery: 'Delivery', it: 'IT', finance: 'Finance',
  system_admin: 'System Admin',
}

export type Level = 'N' | 'R' | 'P' | 'W'
export const LEVEL_ORDER: Record<Level, number> = { N: 0, R: 1, P: 2, W: 3 }
export const maxLevel = (a: Level, b: Level): Level => (LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b)

/** Write scope. `own` is Sales-only, `asg` is Pre-sales / Legal / Bid only (validated in policy.ts). */
export type Scope = 'all' | 'own' | 'asg'

export type RbacMode = 'off' | 'shadow' | 'enforce'

export interface Grant {
  level: Level
  scope: Scope
  /** Named partial sets (FIELD_SETS keys). Non-empty only for level `P`. */
  sets: readonly string[]
  create: boolean
  delete: boolean
}

/** Who is calling — resolved once per request on the server, and by `auth.me` for the UI. */
export interface UserFacts {
  email: string
  roles: readonly Role[]
  /** The caller's `sales_persons.id`, matched on official email. */
  salesPersonId: string | null
  /** The caller's `delivery_team_members.id`s, per team. */
  teamMemberIds: { presales: readonly string[]; legal: readonly string[]; bid: readonly string[] }
}

/** What makes a particular row `own` / `asg` for someone. */
export interface ScopeFacts {
  /** `sales_persons.id`s that make the row "own": effective owner, active delegate / solution lead, Geo/BU-sales. */
  salesOwnerIds: readonly string[]
  /** Lower-cased creator email, when the row records one. */
  createdBy: string | null
  /** The row's team-slot ids (`delivery_team_members.id`). */
  assigned: { presales: string | null; legal: string | null; bid: string | null }
}
```

Create `packages/domain/src/rbac/atoms.ts`:

```ts
/** Atoms only a `W` grant can hold; they are never placed in a partial set (spec §6.2). */
export const W_ONLY_ATOMS: readonly string[] = [
  'bid.stage', 'bid.verify', 'bid.archive', 'bid.move', 'opp.tenderId', 'opp.dates', 'opp.stage',
]

/** Atoms `W` does NOT imply: they are granted only by an explicit partial set, or by nobody.
 *  - sku.* / master.taxClasses / master.currencies: Finance-controlled commercial fields (spec §6.3).
 *  - boq.approve: BOQ approve/reject is CXO-only (spec §14.7).
 *  - ownership.solutionLead: Solution Lead is read-only for every role in v1 — no set contains it. */
export const EXCLUSIVE_ATOMS: ReadonlySet<string> = new Set([
  'sku.costs', 'sku.floor', 'sku.tax', 'master.taxClasses', 'master.currencies', 'boq.approve', 'ownership.solutionLead',
])

/** Atoms NO role can edit, System Admin included (spec §3.4, §6.2): Solution Lead is a data-integrity freeze — replacing
 *  a lead is two calls and only owners auto-close — not an access level. Every frozen atom is also exclusive. */
export const FROZEN_ATOMS: ReadonlySet<string> = new Set(['ownership.solutionLead'])
```

Create `packages/domain/src/rbac/policy.ts`:

```ts
import { W_ONLY_ATOMS } from './atoms.js'
import { FUNCTIONAL_ROLES, ROLES, type Grant, type Level, type Role, type Scope } from './types.js'

export const MODULES = [
  { key: 'opp.bidTracker', label: 'Bid Tracker rows', group: 'Opportunity' },
  { key: 'opp.pipeline', label: 'Pipeline rows', group: 'Opportunity' },
  { key: 'opp.campaign', label: 'Campaign rows', group: 'Opportunity' },
  { key: 'opp.master', label: 'Master Grid', group: 'Opportunity' },
  { key: 'bid.milestones', label: 'Milestones & dates', group: 'Opportunity' },
  { key: 'bid.corrigenda', label: 'Corrigenda', group: 'Opportunity' },
  { key: 'bid.documents', label: 'Tender documents', group: 'Opportunity' },
  { key: 'bid.protected', label: 'Protected values', group: 'Opportunity' },
  { key: 'bid.columns', label: 'Grid columns', group: 'Opportunity' },
  { key: 'am.contacts', label: 'People & Contacts', group: 'Account Mapping' },
  { key: 'am.departments', label: 'Customer Departments & Offices', group: 'Account Mapping' },
  { key: 'am.geography', label: 'Geography', group: 'Account Mapping' },
  { key: 'am.customers', label: 'Customers', group: 'Account Mapping' },
  { key: 'am.meetings', label: 'Meetings', group: 'Account Mapping' },
  { key: 'am.followUps', label: 'Follow-ups & Action Queue', group: 'Account Mapping' },
  { key: 'am.ownership', label: 'Ownership assignments', group: 'Account Mapping' },
  { key: 'team.sales', label: 'Sales Team', group: 'Teams' },
  { key: 'team.org', label: 'Company Org Structure', group: 'Teams' },
  { key: 'com.masters', label: 'Commercial reference masters', group: 'Commercial' },
  { key: 'com.approvalMatrix', label: 'Approval Matrix', group: 'Commercial' },
  { key: 'com.skus', label: 'SKU catalog & BOM', group: 'Commercial' },
  { key: 'com.boqs', label: 'BOQs & proposals', group: 'Commercial' },
  { key: 'an.operational', label: 'Operational analytics', group: 'Analytics' },
  { key: 'an.financial', label: 'Financial analytics', group: 'Analytics' },
  { key: 'admin.access', label: 'Role & Access Management', group: 'Admin' },
  { key: 'admin.audit', label: 'Audit Logs', group: 'Admin' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']
/** The Master Grid is derived: it has no grant and no authorization path of its own. */
export type PolicyModuleKey = Exclude<ModuleKey, 'opp.master'>

export function moduleLabel(key: ModuleKey): string {
  return MODULES.find((m) => m.key === key)?.label ?? key
}

/** Named partial sets (spec §6.2). Atoms are defined by the maps in atoms.ts / the registry. */
export const FIELD_SETS: Record<string, readonly string[]> = {
  S1: ['opp.client', 'opp.value', 'opp.emd', 'opp.teamSales', 'bid.nextAction', 'bid.custom'],
  P1: ['bid.nextAction', 'bid.custom'],
  L1: ['bid.nextAction', 'bid.custom'],
  X1: ['bid.decision'],
  L2: ['corrigendum.review'],
  DOC1: ['doc.upload'],
  B1: ['ownership.bidEntity'],
  S2: ['sales.ownProfile'],
  F1: ['sku.costs', 'sku.floor', 'sku.tax'],
  F2: ['master.taxClasses', 'master.currencies'],
  X2: ['boq.approve'],
}

/** Role-derivation departments (spec §3.2). Finance, IT and Delivery are override-only. */
export const DERIVED_ROLE_DEPARTMENTS = {
  presales: 'Pre-Sales', bid: 'Bid Management', legal: 'Legal', cxo: 'Leadership',
} as const

/** `sales_persons.status` values that derive the Sales role (plan gap A6). `resigned` and `inactive` do not. */
export const SALES_ROLE_STATUSES = ['active', 'onLeave'] as const

/** Modules with no create/delete operation: System Admin is `W` on them but holds no create/delete grant, and the
 *  audit trail stays append-only (spec §3.4). */
export const SYSTEM_ADMIN_VIEW_ONLY_MODULES: readonly PolicyModuleKey[] = ['an.operational', 'an.financial', 'admin.audit']

type Row = readonly [string, string, string, string, string, string, string, string]

/** Cell grammar: LEVEL[/SCOPE[/SETS]] — columns in FUNCTIONAL_ROLES order:
 *  sales, presales, bid, legal, cxo, delivery, it, finance. Scope defaults to `all`.
 *  System Admin has no column: buildGrants gives it W·all everywhere (spec §3.4). */
const CELLS: Record<PolicyModuleKey, Row> = {
  'opp.bidTracker':     ['P/own/S1', 'P/asg/P1', 'W', 'P/asg/L1', 'P/all/X1', 'R', 'R', 'R'],
  'opp.pipeline':       ['W/own', 'P/asg/P1', 'R', 'R', 'R', 'R', 'R', 'R'],
  'opp.campaign':       ['W/own', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'bid.milestones':     ['R', 'R', 'W', 'R', 'R', 'R', 'R', 'R'],
  'bid.corrigenda':     ['R', 'R', 'W', 'P/all/L2', 'R', 'R', 'R', 'R'],
  'bid.documents':      ['R', 'P/asg/DOC1', 'W', 'P/asg/DOC1', 'R', 'R', 'N', 'R'],
  'bid.protected':      ['R', 'R', 'W', 'R', 'R', 'R', 'R', 'R'],
  'bid.columns':        ['R', 'R', 'W', 'R', 'R', 'R', 'W', 'R'],
  'am.contacts':        ['W', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'am.departments':     ['W', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'am.geography':       ['R', 'R', 'R', 'R', 'R', 'R', 'W', 'R'],
  'am.customers':       ['N', 'N', 'N', 'N', 'N', 'N', 'R', 'N'],
  'am.meetings':        ['W/own', 'R', 'R', 'N', 'R', 'R', 'N', 'N'],
  'am.followUps':       ['W/own', 'R', 'R', 'R', 'R', 'R', 'N', 'N'],
  'am.ownership':       ['W/own', 'R', 'P/all/B1', 'N', 'W', 'N', 'R', 'N'],
  'team.sales':         ['P/own/S2', 'R', 'R', 'N', 'W', 'N', 'R', 'N'],
  'team.org':           ['R', 'R', 'R', 'R', 'W', 'R', 'R', 'R'],
  'com.masters':        ['R', 'W', 'R', 'N', 'R', 'N', 'N', 'P/all/F2'],
  'com.approvalMatrix': ['N', 'R', 'N', 'N', 'W', 'N', 'N', 'R'],
  'com.skus':           ['R', 'W', 'N', 'N', 'R', 'N', 'N', 'P/all/F1'],
  'com.boqs':           ['R', 'W', 'R', 'N', 'P/all/X2', 'N', 'N', 'R'],
  'an.operational':     ['R', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'an.financial':       ['N', 'N', 'N', 'N', 'R', 'N', 'N', 'R'],
  'admin.access':       ['N', 'N', 'N', 'N', 'R', 'N', 'W', 'N'],
  'admin.audit':        ['N', 'N', 'N', 'N', 'R', 'N', 'R', 'N'],
}

/** The Create / Delete columns of spec §10. A delete is still limited to rows inside the grant's write scope. */
const CREATE_DELETE: Record<PolicyModuleKey, { create: readonly Role[]; delete: readonly Role[] }> = {
  'opp.bidTracker':     { create: ['sales', 'bid'], delete: ['bid'] },
  'opp.pipeline':       { create: ['sales'], delete: ['bid'] },
  'opp.campaign':       { create: ['sales'], delete: ['bid'] },
  'bid.milestones':     { create: ['bid'], delete: ['bid'] },
  'bid.corrigenda':     { create: ['bid'], delete: ['bid'] },
  'bid.documents':      { create: ['bid', 'presales', 'legal'], delete: ['bid'] },
  'bid.protected':      { create: ['bid'], delete: ['bid'] },
  'bid.columns':        { create: ['bid', 'it'], delete: ['bid', 'it'] },
  'am.contacts':        { create: ['sales'], delete: ['it'] },
  'am.departments':     { create: ['sales'], delete: ['it'] },
  'am.geography':       { create: ['it'], delete: ['it'] },
  'am.customers':       { create: [], delete: [] },
  'am.meetings':        { create: ['sales'], delete: ['sales'] },
  'am.followUps':       { create: ['sales'], delete: ['sales'] },
  'am.ownership':       { create: ['sales', 'bid', 'cxo'], delete: ['sales', 'bid', 'cxo'] },
  'team.sales':         { create: ['cxo', 'it'], delete: ['cxo', 'it'] },
  'team.org':           { create: ['cxo'], delete: ['cxo'] },
  'com.masters':        { create: ['presales'], delete: ['presales'] },
  'com.approvalMatrix': { create: ['cxo'], delete: ['cxo'] },
  'com.skus':           { create: ['presales'], delete: ['presales'] },
  'com.boqs':           { create: ['presales'], delete: ['presales'] },
  'an.operational':     { create: [], delete: [] },
  'an.financial':       { create: [], delete: [] },
  'admin.access':       { create: ['it'], delete: ['it'] },
  'admin.audit':        { create: [], delete: [] },
}

function parseCell(cell: string): Pick<Grant, 'level' | 'scope' | 'sets'> {
  const [level, scope = 'all', sets = ''] = cell.split('/')
  return { level: level as Level, scope: scope as Scope, sets: sets ? sets.split(',') : [] }
}

function buildGrants(): Record<PolicyModuleKey, Record<Role, Grant>> {
  const out = {} as Record<PolicyModuleKey, Record<Role, Grant>>
  for (const module of Object.keys(CELLS) as PolicyModuleKey[]) {
    const byRole = {} as Record<Role, Grant>
    FUNCTIONAL_ROLES.forEach((role, i) => {
      byRole[role] = {
        ...parseCell(CELLS[module][i]),
        create: CREATE_DELETE[module].create.includes(role),
        delete: CREATE_DELETE[module].delete.includes(role),
      }
    })
    const operable = !SYSTEM_ADMIN_VIEW_ONLY_MODULES.includes(module)
    byRole.system_admin = { level: 'W', scope: 'all', sets: [], create: operable, delete: operable }
    out[module] = byRole
  }
  return out
}

export const GRANTS: Record<PolicyModuleKey, Record<Role, Grant>> = buildGrants()

export function grantFor(module: PolicyModuleKey, role: Role): Grant {
  return GRANTS[module][role]
}

/** Structural invariants; returns human-readable problems (empty = valid). Run by the test suite. */
export function validatePolicy(): string[] {
  const problems: string[] = []
  for (const module of Object.keys(GRANTS) as PolicyModuleKey[]) {
    for (const role of ROLES) {
      const g = GRANTS[module][role]
      const at = `${module}/${role}`
      if (!['N', 'R', 'P', 'W'].includes(g.level)) problems.push(`${at}: bad level ${g.level}`)
      if (g.level === 'P' && g.sets.length === 0) problems.push(`${at}: P needs at least one set`)
      if (g.level !== 'P' && g.sets.length > 0) problems.push(`${at}: only P may name sets`)
      for (const set of g.sets) if (!FIELD_SETS[set]) problems.push(`${at}: unknown set ${set}`)
      if (g.level === 'N' && (g.create || g.delete)) problems.push(`${at}: create/delete need level >= R`)
      if (g.scope === 'own' && role !== 'sales') problems.push(`${at}: only Sales can be scoped to own`)
      if (g.scope === 'asg' && !['presales', 'legal', 'bid'].includes(role)) problems.push(`${at}: asg is for Pre-sales/Legal/Bid`)
      if (g.scope !== 'all' && g.level !== 'P' && g.level !== 'W') problems.push(`${at}: a scope only applies to P/W`)
      if (role === 'delivery' && (g.level === 'P' || g.level === 'W' || g.scope !== 'all' || g.create || g.delete)) {
        problems.push(`${at}: Delivery is read-only in v1`)
      }
      if (role === 'system_admin') {
        const viewOnly = SYSTEM_ADMIN_VIEW_ONLY_MODULES.includes(module)
        if (g.level !== 'W' || g.scope !== 'all' || g.sets.length > 0) problems.push(`${at}: System Admin must be W on scope all`)
        if (g.create === viewOnly || g.delete === viewOnly) problems.push(`${at}: System Admin create/delete must be ${!viewOnly}`)
      }
    }
  }
  for (const [name, atoms] of Object.entries(FIELD_SETS)) {
    for (const atom of atoms) if (W_ONLY_ATOMS.includes(atom)) problems.push(`set ${name}: ${atom} is W-only`)
  }
  return problems
}
```

Create `packages/domain/src/rbac/index.ts`:

```ts
export * from './types.js'
export * from './atoms.js'
export * from './policy.js'
```

Append to `packages/domain/src/index.ts`:

```ts
export * from './rbac/index.js'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/domain/src/rbac/policy.test.ts`
Expected: PASS (7 tests).
Then rebuild the package the API consumes: `npm run build --workspace @goms/domain` — Expected: exits 0, `packages/domain/dist/rbac/policy.js` exists, and no `*.test.js` files appear under `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/domain vite.config.ts
git commit -m "feat(rbac): policy types and the 26-module role matrix" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Field atoms, patch maps and read masking

**Files:**
- Modify: `packages/domain/src/rbac/atoms.ts`
- Create: `packages/domain/src/rbac/mask.ts`
- Create: `packages/domain/src/rbac/atoms.test.ts`, `packages/domain/src/rbac/mask.test.ts`
- Modify: `packages/domain/src/rbac/index.ts`

**Interfaces:**
- Consumes: `SKU_COST_FIELDS` from `packages/domain/src/commercial.ts`; `Role`.
- Produces:
  - `atomsForPatch(patch: unknown, resolve: (key: string) => string | null | undefined): string[] | null` — `undefined` = ignore the key, `null` = unknown key (returns `null` → caller denies), non-object patch → `null`.
  - `OPPORTUNITY_PATCH_ATOMS`, `IGNORED_PATCH_KEYS`, `BID_PATCH_ATOMS`, `salesPersonPatchAtom(key)`, `skuPatchAtom(key)`, `masterKeyAtom(key)`, `lineItemPatchAtom(key)`, `atomLabel(atom)`.
  - `MASKED_ATOM_FIELDS`, `SKU_FLOOR_FIELDS`, `MaskedAtom`, `isMaskedAtom`, `canReadAtom(roles, atom)`, `maskSkuRow(row, roles)`, `maskAuditEntry(entry, roles)`, `redactSalesPerson(person)`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/rbac/atoms.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BID_PATCH_ATOMS, IGNORED_PATCH_KEYS, OPPORTUNITY_PATCH_ATOMS, atomsForPatch, lineItemPatchAtom, masterKeyAtom,
  salesPersonPatchAtom, skuPatchAtom,
} from './atoms.js'

const opp = (k: string) => (IGNORED_PATCH_KEYS.has(k) ? undefined : OPPORTUNITY_PATCH_ATOMS[k] ?? null)

describe('atomsForPatch', () => {
  it('maps every opportunity patch key to its atom and de-duplicates', () => {
    expect(atomsForPatch({ opportunityName: 'x', city: 'Pune', vertical: 'IT', valueAmount: '1' }, opp)!.sort())
      .toEqual(['opp.client', 'opp.identity', 'opp.value'])
  })
  it('ignores the echoed opportunityCode', () => {
    expect(atomsForPatch({ opportunityCode: 'OPP-1', city: 'x' }, opp)).toEqual(['opp.client'])
  })
  it('returns null for a key with no atom (fail closed) and for a non-object patch', () => {
    expect(atomsForPatch({ city: 'x', typoField: 1 }, opp)).toBeNull()
    expect(atomsForPatch(undefined, opp)).toBeNull()
    expect(atomsForPatch([], opp)).toBeNull()
    expect(atomsForPatch('x', opp)).toBeNull()
  })
  it('returns [] for an empty patch', () => {
    expect(atomsForPatch({}, opp)).toEqual([])
  })
})

describe('atom maps', () => {
  it('bid patch keys', () => {
    expect(BID_PATCH_ATOMS).toEqual({ stageKey: 'bid.stage', decision: 'bid.decision', tenderLink: 'opp.identity', sheet: 'bid.move' })
  })
  it('classifies SKU patch keys into costs / floor / tax / other', () => {
    expect(skuPatchAtom('hardwareCost')).toBe('sku.costs')
    expect(skuPatchAtom('floorPrice')).toBe('sku.floor')
    expect(skuPatchAtom('minimumAllowedPrice')).toBe('sku.floor')
    expect(skuPatchAtom('internalPrice')).toBe('sku.floor')
    expect(skuPatchAtom('taxClassId')).toBe('sku.tax')
    expect(skuPatchAtom('listPrice')).toBe('sku.other')
    expect(skuPatchAtom('name')).toBe('sku.other')
  })
  it('classifies master keys and BOQ line-item patch keys', () => {
    expect(masterKeyAtom('taxClasses')).toBe('master.taxClasses')
    expect(masterKeyAtom('currencies')).toBe('master.currencies')
    expect(masterKeyAtom('verticals')).toBe('master.other')
    expect(lineItemPatchAtom('approvalStatus')).toBe('boq.approve')
    expect(lineItemPatchAtom('approverId')).toBe('boq.approve')
    expect(lineItemPatchAtom('quantity')).toBe('boq.lines')
  })
  it('limits Sales own-profile edits to photo, mobile and personal email', () => {
    expect(salesPersonPatchAtom('photoUrl')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('mobile')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('personalEmail')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('officialEmail')).toBe('sales.roster')
    expect(salesPersonPatchAtom('status')).toBe('sales.roster')
  })
})
```

`packages/domain/src/rbac/mask.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SKU_COST_FIELDS } from '../commercial.js'
import { MASKED_ATOM_FIELDS, SKU_FLOOR_FIELDS, canReadAtom, maskAuditEntry, maskSkuRow, redactSalesPerson } from './mask.js'

const sku = {
  id: 's1', name: 'Core', listPrice: 100, partnerPrice: 90, floorPrice: 70, minimumAllowedPrice: 65, internalPrice: 60,
  baseSoftwareCost: 11, implementationCostPerMM: 12, integrationCost: 13, thirdPartyCost: 14,
  hardwareCost: 15, cloudCost: 16, supportCost: 17, trainingCost: 18,
}

describe('SKU read masking', () => {
  it('declares the 8 cost fields and the 3 floor fields as restricted', () => {
    expect(MASKED_ATOM_FIELDS['sku.costs']).toEqual(SKU_COST_FIELDS)
    expect([...SKU_FLOOR_FIELDS]).toEqual(['floorPrice', 'minimumAllowedPrice', 'internalPrice'])
  })
  it('lets only Pre-sales, Finance, CXO and System Admin read costs and floor prices', () => {
    for (const role of ['presales', 'finance', 'cxo', 'system_admin'] as const) {
      expect(canReadAtom([role], 'sku.costs')).toBe(true)
      expect(canReadAtom([role], 'sku.floor')).toBe(true)
    }
    for (const role of ['sales', 'bid', 'legal', 'delivery', 'it'] as const) expect(canReadAtom([role], 'sku.costs')).toBe(false)
    expect(canReadAtom([], 'sku.costs')).toBe(false)
    expect(canReadAtom(['sales', 'finance'], 'sku.costs')).toBe(true) // any one authorised role is enough
  })
  it('nulls masked fields (never 0) and lists them, leaving public price fields intact', () => {
    const masked = maskSkuRow(sku, ['sales'])
    for (const f of [...SKU_COST_FIELDS, ...SKU_FLOOR_FIELDS]) expect((masked as any)[f]).toBeNull()
    expect(masked.listPrice).toBe(100)
    expect(masked.partnerPrice).toBe(90)
    expect([...masked.maskedFields].sort()).toEqual([...SKU_COST_FIELDS, ...SKU_FLOOR_FIELDS].sort())
  })
  it('returns the row untouched for an authorised role, with an empty maskedFields list', () => {
    const out = maskSkuRow(sku, ['presales'])
    expect(out).toMatchObject(sku)
    expect(out.maskedFields).toEqual([])
  })
  it('shows a System Admin every cost and floor-price field', () => {
    const out = maskSkuRow(sku, ['system_admin'])
    expect(out).toMatchObject(sku)
    expect(out.maskedFields).toEqual([])
  })
})

describe('audit masking', () => {
  const entry = { entityType: 'sku', field: 'hardwareCost', oldValue: '15', newValue: '99', reason: 'r' }
  it('blanks old/new values of a restricted SKU field for an unauthorised role', () => {
    expect(maskAuditEntry(entry, ['bid'])).toMatchObject({ field: 'hardwareCost', oldValue: '', newValue: '', masked: true })
  })
  it('leaves other fields, other entities and authorised roles alone', () => {
    expect(maskAuditEntry({ ...entry, field: 'listPrice' }, ['bid'])).toMatchObject({ oldValue: '15', newValue: '99' })
    expect(maskAuditEntry({ ...entry, entityType: 'boq' }, ['bid'])).toMatchObject({ oldValue: '15' })
    expect(maskAuditEntry(entry, ['finance'])).toMatchObject({ oldValue: '15', newValue: '99' })
  })
})

describe('sales person redaction', () => {
  it('keeps what row screens need and drops personal data', () => {
    const person = { id: 'p', name: 'A', officialEmail: 'a@amnex.com', photoUrl: 'u', status: 'active', personalEmail: 'x@y', mobile: '1', altMobile: '2', notes: 'n', metadata: { a: '1' }, employeeCode: 'E1', joinedOn: '2020-01-01', leftOn: null }
    expect(redactSalesPerson(person)).toEqual({
      id: 'p', name: 'A', officialEmail: 'a@amnex.com', photoUrl: 'u', status: 'active',
      personalEmail: '', mobile: '', altMobile: '', notes: '', metadata: {}, employeeCode: '', joinedOn: null, leftOn: null,
    })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/domain/src/rbac/atoms.test.ts packages/domain/src/rbac/mask.test.ts`
Expected: FAIL — missing exports / `./mask.js` not found.

- [ ] **Step 3: Implement**

Append to `packages/domain/src/rbac/atoms.ts`:

```ts
const ATOM_LABELS: Record<string, string> = {
  'opp.identity': 'the name, type, reference or tender link', 'opp.tenderId': 'the Tender ID', 'opp.client': 'the client, city or sector',
  'opp.value': 'the value fields', 'opp.emd': 'the EMD fields', 'opp.dates': 'the dates', 'opp.stage': 'the pipeline stage',
  'opp.teamSales': 'the Geo/BU-sales people', 'opp.teamDelivery': 'the Pre-sales / Legal / Bid people',
  'bid.stage': 'the bid stage', 'bid.decision': 'the Go / No-Go decision', 'bid.move': 'the sheet', 'bid.verify': 'data verification',
  'bid.archive': 'archiving', 'bid.nextAction': 'the next action', 'bid.custom': 'custom columns',
  'corrigendum.review': 'corrigendum review', 'doc.upload': 'tender documents', 'ownership.bidEntity': 'the bid owner',
  'ownership.assign': 'ownership', 'ownership.solutionLead': 'the Solution Lead (read-only)',
  'sales.ownProfile': 'your profile', 'sales.roster': 'the Sales Team roster',
  'sku.costs': 'SKU cost fields', 'sku.floor': 'SKU floor-price fields', 'sku.tax': 'the SKU tax class', 'sku.other': 'SKU details',
  'master.taxClasses': 'tax classes', 'master.currencies': 'currencies', 'master.other': 'reference masters',
  'boq.approve': 'BOQ approvals', 'boq.lines': 'BOQ lines',
}
export const atomLabel = (atom: string): string => ATOM_LABELS[atom] ?? atom

/** Keys the server accepts but ignores (an edit form echoes the locked Opportunity ID back). */
export const IGNORED_PATCH_KEYS: ReadonlySet<string> = new Set(['opportunityCode'])

/** `opportunities.update` patch keys → atoms (from `patchShape` in apps/api/src/routers/opportunities.ts). */
export const OPPORTUNITY_PATCH_ATOMS: Record<string, string> = {
  opportunityName: 'opp.identity', opportunityType: 'opp.identity', referenceNo: 'opp.identity', assignmentName: 'opp.identity',
  gemTenderId: 'opp.tenderId',
  departmentId: 'opp.client', stateCode: 'opp.client', city: 'opp.client', vertical: 'opp.client',
  valueAmount: 'opp.value', valueUnit: 'opp.value', currency: 'opp.value', budgetKnown: 'opp.value', quantity: 'opp.value', component: 'opp.value',
  emdAmount: 'opp.emd', emdUnit: 'opp.emd',
  publishDate: 'opp.dates', submissionDate: 'opp.dates', closedOn: 'opp.dates',
  stageKey: 'opp.stage',
  salesPersonEmail: 'opp.teamSales', geoSalesPersonId: 'opp.teamSales', buSalesPersonId: 'opp.teamSales',
  preSalesPersonId: 'opp.teamDelivery', legalPersonId: 'opp.teamDelivery', bidTeamMemberId: 'opp.teamDelivery',
}

/** `bids.update` patch keys → atoms. */
export const BID_PATCH_ATOMS: Record<string, string> = {
  stageKey: 'bid.stage', decision: 'bid.decision', tenderLink: 'opp.identity', sheet: 'bid.move',
}

/** `sales.update` patch keys: Sales may edit only photo, mobile and personal email on their own row. */
export function salesPersonPatchAtom(key: string): string {
  return key === 'photoUrl' || key === 'mobile' || key === 'personalEmail' ? 'sales.ownProfile' : 'sales.roster'
}

const SKU_COST_KEYS = new Set([
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost',
  'hardwareCost', 'cloudCost', 'supportCost', 'trainingCost',
])
const SKU_FLOOR_KEYS = new Set(['floorPrice', 'minimumAllowedPrice', 'internalPrice'])

/** `commercial.skus.update` patch keys → atoms. */
export function skuPatchAtom(key: string): string {
  if (SKU_COST_KEYS.has(key)) return 'sku.costs'
  if (SKU_FLOOR_KEYS.has(key)) return 'sku.floor'
  if (key === 'taxClassId') return 'sku.tax'
  return 'sku.other'
}

/** `commercial.masters.*` by master key. */
export function masterKeyAtom(key: string): string {
  if (key === 'taxClasses') return 'master.taxClasses'
  if (key === 'currencies') return 'master.currencies'
  return 'master.other'
}

/** `commercial.boq.updateLineItem` patch keys → atoms. */
export function lineItemPatchAtom(key: string): string {
  return key === 'approvalStatus' || key === 'approverId' || key === 'approvalDate' || key === 'approvalRemarks' ? 'boq.approve' : 'boq.lines'
}

/** Maps a patch object's keys to atoms. `undefined` from `resolve` ignores the key; `null` means the key has no
 *  atom (unknown/typo) and the whole patch must be denied. A non-object patch also returns `null`. */
export function atomsForPatch(patch: unknown, resolve: (key: string) => string | null | undefined): string[] | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null
  const atoms = new Set<string>()
  for (const key of Object.keys(patch)) {
    const atom = resolve(key)
    if (atom === undefined) continue
    if (atom === null) return null
    atoms.add(atom)
  }
  return [...atoms]
}
```

Create `packages/domain/src/rbac/mask.ts`:

```ts
import { SKU_COST_FIELDS } from '../commercial.js'
import type { Role } from './types.js'

export const SKU_FLOOR_FIELDS = ['floorPrice', 'minimumAllowedPrice', 'internalPrice'] as const

export type MaskedAtom = 'sku.costs' | 'sku.floor'

export const MASKED_ATOM_FIELDS: Record<MaskedAtom, readonly string[]> = {
  'sku.costs': SKU_COST_FIELDS,
  'sku.floor': SKU_FLOOR_FIELDS,
}

/** Roles that may read each restricted atom (spec §7). */
const MASKED_ATOM_READERS: Record<MaskedAtom, readonly Role[]> = {
  'sku.costs': ['presales', 'finance', 'cxo', 'system_admin'],
  'sku.floor': ['presales', 'finance', 'cxo', 'system_admin'],
}

export const isMaskedAtom = (atom: string): atom is MaskedAtom => atom in MASKED_ATOM_FIELDS

export function canReadAtom(roles: readonly Role[], atom: MaskedAtom): boolean {
  return roles.some((role) => MASKED_ATOM_READERS[atom].includes(role))
}

/** Restricted fields this caller may NOT see. */
export function maskedFieldsFor(roles: readonly Role[]): string[] {
  return (Object.keys(MASKED_ATOM_FIELDS) as MaskedAtom[])
    .filter((atom) => !canReadAtom(roles, atom))
    .flatMap((atom) => [...MASKED_ATOM_FIELDS[atom]])
}

/** Nulls restricted SKU fields (never 0 — a zero would silently corrupt totals) and records which were hidden. */
export function maskSkuRow<T extends object>(row: T, roles: readonly Role[]): T & { maskedFields: string[] } {
  const hidden = maskedFieldsFor(roles)
  const out: Record<string, unknown> = { ...row }
  for (const field of hidden) if (field in out) out[field] = null
  return { ...(out as T), maskedFields: hidden.filter((f) => f in (row as Record<string, unknown>)) }
}

/** Blanks old/new values in an audit entry about a restricted SKU field. */
export function maskAuditEntry<T extends { entityType: string; field: string; oldValue: string; newValue: string }>(
  entry: T, roles: readonly Role[],
): T & { masked?: true } {
  if (entry.entityType === 'sku' && maskedFieldsFor(roles).includes(entry.field)) {
    return { ...entry, oldValue: '', newValue: '', masked: true }
  }
  return entry
}

/** The projection of a Sales Team member that row screens need (owner badges, Geo/BU columns) — no personal data.
 *  Given to roles that can read opportunity rows but have no read on the Sales Team module (gap A4). */
export function redactSalesPerson<T extends Record<string, unknown>>(person: T): T {
  return {
    ...person, personalEmail: '', mobile: '', altMobile: '', notes: '', metadata: {}, employeeCode: '', joinedOn: null, leftOn: null,
  }
}
```

Append to `packages/domain/src/rbac/index.ts`:

```ts
export * from './mask.js'
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/domain/src/rbac`
Expected: PASS (all rbac domain tests so far). Then `npm run build --workspace @goms/domain` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(rbac): field atoms, patch maps and SKU read masking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Access evaluators (scope, merge, baseline, implied reads)

**Files:**
- Create: `packages/domain/src/rbac/evaluate.ts`
- Create: `packages/domain/src/rbac/evaluate.test.ts`
- Modify: `packages/domain/src/rbac/index.ts`

**Interfaces:**
- Consumes: `GRANTS`, `FIELD_SETS`, `EXCLUSIVE_ATOMS`, `Role`, `UserFacts`, `ScopeFacts`, `maxLevel`.
- Produces:
  - `inScope(scope: Scope, role: Role, user: UserFacts, row: ScopeFacts): boolean`
  - `interface Access { level: Level; all: boolean; atoms: ReadonlySet<string>; create: boolean; delete: boolean }`
  - `accessFor(user: UserFacts, module: PolicyModuleKey, row?: ScopeFacts): Access` — with `row` omitted only `scope: 'all'` grants count for write/delete; `create` is never row-scoped unless a parent `row` is given.
  - `allows(access: Access, atom: string): boolean`
  - `IMPLIED_READS: Partial<Record<PolicyModuleKey, readonly PolicyModuleKey[]>>`

- [ ] **Step 1: Write the failing test**

`packages/domain/src/rbac/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { accessFor, allows, inScope } from './evaluate.js'
import { BID_PATCH_ATOMS, EXCLUSIVE_ATOMS, FROZEN_ATOMS, OPPORTUNITY_PATCH_ATOMS, W_ONLY_ATOMS } from './atoms.js'
import { FIELD_SETS, GRANTS, SYSTEM_ADMIN_VIEW_ONLY_MODULES, type PolicyModuleKey } from './policy.js'
import type { Role, ScopeFacts, UserFacts } from './types.js'

const user = (roles: Role[], extra: Partial<UserFacts> = {}): UserFacts => ({
  email: 'u@amnex.com', roles, salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] }, ...extra,
})
const row = (extra: Partial<ScopeFacts> = {}): ScopeFacts => ({
  salesOwnerIds: [], createdBy: null, assigned: { presales: null, legal: null, bid: null }, ...extra,
})

describe('scopes', () => {
  it('own = effective owner / delegate / Geo-BU person, or the row creator', () => {
    const sales = user(['sales'], { salesPersonId: 'sp1' })
    expect(inScope('own', 'sales', sales, row({ salesOwnerIds: ['sp1', 'sp9'] }))).toBe(true)
    expect(inScope('own', 'sales', sales, row({ salesOwnerIds: ['sp9'] }))).toBe(false)
    expect(inScope('own', 'sales', sales, row({ createdBy: 'u@amnex.com' }))).toBe(true)
    expect(inScope('own', 'sales', user(['sales']), row({ createdBy: 'U@Amnex.com'.toLowerCase() }))).toBe(true)
  })
  it('a Sales user with no roster row never matches own by id, and a creator match needs their own email', () => {
    const noRoster = user(['sales'], { salesPersonId: null })
    expect(inScope('own', 'sales', noRoster, row({ salesOwnerIds: ['sp1'] }))).toBe(false)
    expect(inScope('own', 'sales', noRoster, row({ createdBy: 'someone@amnex.com' }))).toBe(false)
  })
  it('asg needs the slot that matches the role, and the slot must be one of the user\'s own ids', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: 'm1', legal: null, bid: null } }))).toBe(true)
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: 'm2', legal: null, bid: null } }))).toBe(false)
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: null, legal: 'm1', bid: null } }))).toBe(false)
  })
})

describe('accessFor — write scopes', () => {
  const sales = user(['sales'], { salesPersonId: 'sp1' })
  it('Sales is full-write on an own Pipeline row and read-only on someone else\'s', () => {
    const own = accessFor(sales, 'opp.pipeline', row({ salesOwnerIds: ['sp1'] }))
    expect(own.level).toBe('W')
    expect(allows(own, 'opp.value')).toBe(true)
    expect(allows(own, 'opp.stage')).toBe(true)
    const other = accessFor(sales, 'opp.pipeline', row({ salesOwnerIds: ['sp2'] }))
    expect(other.level).toBe('R')
    expect(allows(other, 'opp.value')).toBe(false)
  })
  it('Sales on Bid Tracker is Partial (S1) on own rows only', () => {
    const own = accessFor(sales, 'opp.bidTracker', row({ salesOwnerIds: ['sp1'] }))
    expect(own.level).toBe('P')
    expect([...own.atoms].sort()).toEqual(['bid.custom', 'bid.nextAction', 'opp.client', 'opp.emd', 'opp.teamSales', 'opp.value'])
    expect(allows(own, 'bid.stage')).toBe(false)
    expect(allows(own, 'opp.tenderId')).toBe(false)
  })
  it('with no row facts only scope-all grants count (an own-scoped grant gives read only)', () => {
    expect(accessFor(sales, 'opp.pipeline').level).toBe('R')
    expect(accessFor(user(['bid']), 'opp.bidTracker').level).toBe('W')
  })
  it('Pre-sales gets exactly P1 on an assigned row and nothing on others', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    const mine = accessFor(pre, 'opp.bidTracker', row({ assigned: { presales: 'm1', legal: null, bid: null } }))
    expect([...mine.atoms].sort()).toEqual(['bid.custom', 'bid.nextAction'])
    expect(accessFor(pre, 'opp.bidTracker', row()).level).toBe('R')
  })
  it('CXO may record the Go/No-Go decision on any bid but nothing else', () => {
    const cxo = accessFor(user(['cxo']), 'opp.bidTracker', row())
    expect(cxo.level).toBe('P')
    expect(allows(cxo, 'bid.decision')).toBe(true)
    expect(allows(cxo, 'bid.stage')).toBe(false)
  })
})

describe('accessFor — merging roles', () => {
  it('takes the max level and unions fields: the CFO is Legal + Finance + CXO and keeps all of them', () => {
    const cfo = user(['legal', 'finance', 'cxo'])
    const skus = accessFor(cfo, 'com.skus')
    expect(skus.level).toBe('P')
    expect(allows(skus, 'sku.costs')).toBe(true)
    const approval = accessFor(cfo, 'com.approvalMatrix')
    expect(approval.level).toBe('W') // CXO owns it; Finance is only R
    expect(accessFor(cfo, 'bid.corrigenda', row()).level).toBe('P') // Legal L2
  })
  it('any W grant means every non-exclusive atom', () => {
    const both = user(['sales', 'bid'], { salesPersonId: 'sp1' })
    const a = accessFor(both, 'opp.bidTracker', row({ salesOwnerIds: ['sp1'] }))
    expect(a.level).toBe('W')
    expect(allows(a, 'bid.stage')).toBe(true)
  })
})

describe('exclusive and frozen atoms', () => {
  it('Pre-sales is W on SKUs but cannot edit Finance-controlled fields; Finance can', () => {
    const pre = accessFor(user(['presales']), 'com.skus')
    expect(allows(pre, 'sku.other')).toBe(true)
    expect(allows(pre, 'sku.costs')).toBe(false)
    expect(allows(pre, 'sku.tax')).toBe(false)
    const fin = accessFor(user(['finance']), 'com.skus')
    expect(allows(fin, 'sku.costs')).toBe(true)
    expect(allows(fin, 'sku.other')).toBe(false)
  })
  it('Pre-sales is W on masters but not on tax classes / currencies; Finance edits only those', () => {
    expect(allows(accessFor(user(['presales']), 'com.masters'), 'master.other')).toBe(true)
    expect(allows(accessFor(user(['presales']), 'com.masters'), 'master.taxClasses')).toBe(false)
    expect(allows(accessFor(user(['finance']), 'com.masters'), 'master.currencies')).toBe(true)
    expect(allows(accessFor(user(['finance']), 'com.masters'), 'master.other')).toBe(false)
  })
  it('BOQ approve is CXO-only: Pre-sales W does not imply it', () => {
    expect(allows(accessFor(user(['presales']), 'com.boqs'), 'boq.lines')).toBe(true)
    expect(allows(accessFor(user(['presales']), 'com.boqs'), 'boq.approve')).toBe(false)
    expect(allows(accessFor(user(['cxo']), 'com.boqs'), 'boq.approve')).toBe(true)
    expect(allows(accessFor(user(['cxo']), 'com.boqs'), 'boq.lines')).toBe(false)
  })
  it('nobody — not even a W role — can write Solution Lead', () => {
    const cxo = accessFor(user(['cxo']), 'am.ownership', row())
    expect(cxo.level).toBe('W')
    expect(allows(cxo, 'ownership.assign')).toBe(true)
    expect(allows(cxo, 'ownership.solutionLead')).toBe(false)
  })
  it('Bid may assign the bid-level owner only', () => {
    const bid = accessFor(user(['bid']), 'am.ownership', row())
    expect(allows(bid, 'ownership.bidEntity')).toBe(true)
    expect(allows(bid, 'ownership.assign')).toBe(false)
  })
})

describe('create / delete', () => {
  it('create is not row-scoped without a parent row (Sales creating a Pipeline row)', () => {
    expect(accessFor(user(['sales']), 'opp.pipeline').create).toBe(true)
  })
  it('create under a parent row needs the parent in scope (Pre-sales uploading a tender document)', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    expect(accessFor(pre, 'bid.documents').create).toBe(true)
    expect(accessFor(pre, 'bid.documents', row({ assigned: { presales: 'm1', legal: null, bid: null } })).create).toBe(true)
    expect(accessFor(pre, 'bid.documents', row({ assigned: { presales: 'm2', legal: null, bid: null } })).create).toBe(false)
  })
  it('a delete needs the row inside the grant scope (Sales deleting a meeting)', () => {
    const sales = user(['sales'], { salesPersonId: 'sp1' })
    expect(accessFor(sales, 'am.meetings', row({ salesOwnerIds: ['sp1'] })).delete).toBe(true)
    expect(accessFor(sales, 'am.meetings', row({ salesOwnerIds: ['sp2'] })).delete).toBe(false)
    expect(accessFor(sales, 'am.meetings').delete).toBe(false)
  })
})

describe('baseline and implied reads', () => {
  it('a user with no roles can read Geography and nothing else', () => {
    expect(accessFor(user([]), 'am.geography').level).toBe('R')
    expect(accessFor(user([]), 'am.contacts').level).toBe('N')
    expect(accessFor(user([]), 'opp.bidTracker').level).toBe('N')
  })
  it('reading BOQs implies read-only access to SKUs and reference masters (gap A2)', () => {
    const bid = user(['bid'])
    expect(accessFor(bid, 'com.skus').level).toBe('R') // matrix says N; implied by com.boqs R
    expect(accessFor(bid, 'com.masters').level).toBe('R')
    expect(accessFor(bid, 'com.approvalMatrix').level).toBe('N') // not implied
    expect(allows(accessFor(bid, 'com.skus'), 'sku.other')).toBe(false)
  })
  it('a role with no BOQ read gets no implied reads', () => {
    expect(accessFor(user(['legal']), 'com.skus').level).toBe('N')
  })
})

describe('System Admin (spec §3.4)', () => {
  const admin = (extra: Role[] = []) => user(['system_admin', ...extra])
  const everyModule = Object.keys(GRANTS) as PolicyModuleKey[]

  it('is W on every module and on every row, whoever owns it', () => {
    for (const module of everyModule) {
      const a = accessFor(admin(), module, row({ salesOwnerIds: ['someone-else'], createdBy: 'x@amnex.com' }))
      expect(a.level, module).toBe('W')
      expect(a.unrestricted, module).toBe(true)
    }
    expect(accessFor(admin(), 'opp.pipeline').level).toBe('W') // no row facts needed
  })
  it('may edit every atom — the exclusive ones included — except the frozen Solution Lead', () => {
    const atoms = [
      ...W_ONLY_ATOMS, ...EXCLUSIVE_ATOMS, ...Object.values(FIELD_SETS).flat(),
      ...Object.values(OPPORTUNITY_PATCH_ATOMS), ...Object.values(BID_PATCH_ATOMS), 'bid.verify', 'bid.archive', 'ownership.assign',
    ]
    for (const atom of atoms) {
      const expected = !FROZEN_ATOMS.has(atom)
      expect(allows(accessFor(admin(), 'com.skus'), atom), atom).toBe(expected)
      expect(allows(accessFor(admin(), 'opp.bidTracker', row()), atom), atom).toBe(expected)
    }
    expect(allows(accessFor(admin(), 'com.skus'), 'sku.costs')).toBe(true)
    expect(allows(accessFor(admin(), 'com.masters'), 'master.currencies')).toBe(true)
    expect(allows(accessFor(admin(), 'com.boqs'), 'boq.approve')).toBe(true)
    expect(allows(accessFor(admin(), 'am.ownership', row()), 'ownership.assign')).toBe(true)
    expect(allows(accessFor(admin(), 'am.ownership', row()), 'ownership.solutionLead')).toBe(false)
  })
  it('holds create and delete wherever the module has such operations, and not on the view-only modules', () => {
    for (const module of everyModule) {
      const viewOnly = SYSTEM_ADMIN_VIEW_ONLY_MODULES.includes(module)
      const a = accessFor(admin(), module, row())
      expect(a.create, `${module} create`).toBe(!viewOnly)
      expect(a.delete, `${module} delete`).toBe(!viewOnly)
    }
  })
  it('stays unrestricted next to other roles, and gives those roles nothing extra', () => {
    expect(accessFor(admin(['sales', 'legal']), 'com.approvalMatrix').unrestricted).toBe(true)
    expect(accessFor(user(['cxo']), 'com.boqs').unrestricted).toBe(false)
    expect(allows(accessFor(user(['cxo']), 'com.skus'), 'sku.costs')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/domain/src/rbac/evaluate.test.ts`
Expected: FAIL — `Failed to resolve import "./evaluate.js"`.

- [ ] **Step 3: Implement**

Create `packages/domain/src/rbac/evaluate.ts`:

```ts
import { EXCLUSIVE_ATOMS, FROZEN_ATOMS } from './atoms.js'
import { FIELD_SETS, GRANTS, type PolicyModuleKey } from './policy.js'
import { maxLevel, type Level, type Role, type Scope, type ScopeFacts, type UserFacts } from './types.js'

export interface Access {
  level: Level
  /** A `W` grant applies: every atom except the exclusive ones. */
  all: boolean
  /** Atoms granted by applicable `P` sets. */
  atoms: ReadonlySet<string>
  create: boolean
  delete: boolean
  /** System Admin (spec §3.4): every atom is editable except the frozen ones. */
  unrestricted: boolean
}

const NO_ACCESS: Access = { level: 'N', all: false, atoms: new Set(), create: false, delete: false, unrestricted: false }
const READ_ONLY: Access = { level: 'R', all: false, atoms: new Set(), create: false, delete: false, unrestricted: false }

/** Reading the key module grants read-only access to the listed modules (gap A2): BOQ screens look up SKUs and
 *  reference masters by id. The approval matrix is deliberately not implied. */
export const IMPLIED_READS: Partial<Record<PolicyModuleKey, readonly PolicyModuleKey[]>> = {
  'com.boqs': ['com.skus', 'com.masters'],
}

export function inScope(scope: Scope, role: Role, user: UserFacts, row: ScopeFacts): boolean {
  if (scope === 'all') return true
  if (scope === 'own') {
    if (role !== 'sales') return false
    if (user.salesPersonId && row.salesOwnerIds.includes(user.salesPersonId)) return true
    return row.createdBy !== null && row.createdBy === user.email.trim().toLowerCase()
  }
  // asg: the row's slot for this role must be one of the caller's own team-member ids
  if (role === 'presales') return !!row.assigned.presales && user.teamMemberIds.presales.includes(row.assigned.presales)
  if (role === 'legal') return !!row.assigned.legal && user.teamMemberIds.legal.includes(row.assigned.legal)
  if (role === 'bid') return !!row.assigned.bid && user.teamMemberIds.bid.includes(row.assigned.bid)
  return false
}

function rawAccess(user: UserFacts, module: PolicyModuleKey, row?: ScopeFacts): Access {
  let level: Level = 'N'
  let all = false
  const atoms = new Set<string>()
  let create = false
  let del = false
  let unrestricted = false
  for (const role of user.roles) {
    if (role === 'system_admin') unrestricted = true
    const grant = GRANTS[module][role]
    if (grant.level === 'N') continue
    level = maxLevel(level, 'R') // there is no row-level read scoping
    // Without row facts only scope-all grants can be shown to apply to a specific row.
    const applicable = row ? inScope(grant.scope, role, user, row) : grant.scope === 'all'
    if (applicable && (grant.level === 'P' || grant.level === 'W')) {
      level = maxLevel(level, grant.level)
      if (grant.level === 'W') all = true
      else for (const set of grant.sets) for (const atom of FIELD_SETS[set]) atoms.add(atom)
    }
    if (grant.create && (row ? applicable : true)) create = true
    if (grant.delete && applicable) del = true
  }
  return { level, all, atoms, create, delete: del, unrestricted }
}

/** What `user` may do in `module`, optionally for one specific row. */
export function accessFor(user: UserFacts, module: PolicyModuleKey, row?: ScopeFacts): Access {
  if (user.roles.length === 0) return module === 'am.geography' ? READ_ONLY : NO_ACCESS // baseline
  const own = rawAccess(user, module, row)
  if (own.level !== 'N') return own
  for (const [source, targets] of Object.entries(IMPLIED_READS)) {
    if (targets?.includes(module) && rawAccess(user, source as PolicyModuleKey).level !== 'N') return READ_ONLY
  }
  return own
}

/** May this access edit `atom`? Frozen atoms: never. System Admin: everything else. Otherwise `W` covers everything except
 *  exclusive atoms, which only an explicit set grants. */
export function allows(access: Access, atom: string): boolean {
  if (FROZEN_ATOMS.has(atom)) return false
  if (access.unrestricted) return true
  return access.atoms.has(atom) || (access.all && !EXCLUSIVE_ATOMS.has(atom))
}
```

Append to `packages/domain/src/rbac/index.ts`:

```ts
export * from './evaluate.js'
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/domain/src/rbac`
Expected: PASS (all). Then `npm run build --workspace @goms/domain` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(rbac): access evaluators — scopes, role merge, baseline, implied reads" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
## Phase B — API foundation

### Task 4: Migrations — role overrides, `created_by`, email indexes

**Files:**
- Create: `apps/api/migrations/1790800000000_rbac-role-overrides.sql`
- Create: `apps/api/migrations/1790900000000_rbac-created-by-and-email-indexes.sql`
- Create: `apps/api/src/auth/rbac/migrations.test.ts`

**Interfaces:**
- Produces: table `user_role_overrides(id, email, role, effect, reason, created_by, created_at)` with `unique(email, role)`; nullable `created_by TEXT` on `opportunities`, `timeline_events`, `follow_ups` (gap A1); expression indexes on `lower(btrim(...))` of the three email columns used for role resolution.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/migrations.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'

afterEach(async () => {
  await pool.query(`DELETE FROM user_role_overrides WHERE email LIKE 'rbac-mig-%'`)
})

const insert = (email: string, role: string, effect = 'grant', reason = 'test') =>
  pool.query(
    `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,$4,'tester@amnex.com')`,
    [email, role, effect, reason],
  )

describe('user_role_overrides', () => {
  it('accepts a valid grant and a valid revoke', async () => {
    await insert('rbac-mig-a@amnex.com', 'cxo', 'grant')
    await insert('rbac-mig-a@amnex.com', 'legal', 'revoke')
    const { rows } = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email='rbac-mig-a@amnex.com' ORDER BY role`)
    expect(rows).toEqual([{ role: 'cxo', effect: 'grant' }, { role: 'legal', effect: 'revoke' }])
  })
  it('rejects an unknown role, an unknown effect and an empty reason', async () => {
    await expect(insert('rbac-mig-b@amnex.com', 'admin')).rejects.toThrow(/check/i)
    await expect(insert('rbac-mig-b@amnex.com', 'system_admin')).rejects.toThrow(/check/i) // System Admin comes only from ADMIN_ALLOWED_EMAILS
    await expect(insert('rbac-mig-b@amnex.com', 'cxo', 'allow')).rejects.toThrow(/check/i)
    await expect(insert('rbac-mig-b@amnex.com', 'cxo', 'grant', '   ')).rejects.toThrow(/check/i)
  })
  it('stores emails lower-cased only', async () => {
    await expect(insert('RBAC-MIG-C@amnex.com', 'cxo')).rejects.toThrow(/check/i)
  })
  it('allows at most one row per (email, role)', async () => {
    await insert('rbac-mig-d@amnex.com', 'cxo')
    await expect(insert('rbac-mig-d@amnex.com', 'cxo', 'revoke')).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('created_by columns', () => {
  it.each(['opportunities', 'timeline_events', 'follow_ups'])('%s has a nullable created_by', async (table) => {
    const { rows } = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name='created_by'`, [table],
    )
    expect(rows[0]?.is_nullable).toBe('YES')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/migrations.test.ts`
Expected: FAIL — `relation "user_role_overrides" does not exist`.

- [ ] **Step 3: Write the migrations and apply them locally**

`apps/api/migrations/1790800000000_rbac-role-overrides.sql`:

```sql
-- Up Migration

-- Per-person role overrides on top of the roles derived from org_people / sales_persons (RBAC spec §3.3).
-- 'grant' adds a role (e.g. CEO/CFO/CE&TO -> cxo; every Finance, IT and Delivery user); 'revoke' removes a derived one.
-- The eight functional roles only: system_admin is deliberately absent (spec §3.4) — System Admin comes only from
-- ADMIN_ALLOWED_EMAILS, so it can be neither granted nor revoked through this table.
CREATE TABLE user_role_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  role       TEXT NOT NULL CHECK (role IN ('sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance')),
  effect     TEXT NOT NULL CHECK (effect IN ('grant', 'revoke')),
  reason     TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, role)
);

-- Down Migration

DROP TABLE IF EXISTS user_role_overrides;
```

`apps/api/migrations/1790900000000_rbac-created-by-and-email-indexes.sql`:

```sql
-- Up Migration

-- Who created the row (lower-cased email). Nullable: rows that predate RBAC have none.
-- It makes a creator "own" what they just created (RBAC spec §9.1; plan gap A1).
ALTER TABLE opportunities    ADD COLUMN created_by TEXT;
ALTER TABLE timeline_events  ADD COLUMN created_by TEXT;
ALTER TABLE follow_ups       ADD COLUMN created_by TEXT;

-- Role resolution matches a login against these emails on every (cached) request.
CREATE INDEX org_people_email_lower_idx ON org_people (lower(btrim(email))) WHERE email <> '';
CREATE INDEX delivery_team_members_email_lower_idx ON delivery_team_members (lower(btrim(email))) WHERE email <> '';
CREATE INDEX sales_persons_official_email_lower_idx ON sales_persons (lower(btrim(official_email)));

-- Down Migration

DROP INDEX IF EXISTS sales_persons_official_email_lower_idx;
DROP INDEX IF EXISTS delivery_team_members_email_lower_idx;
DROP INDEX IF EXISTS org_people_email_lower_idx;
ALTER TABLE follow_ups      DROP COLUMN IF EXISTS created_by;
ALTER TABLE timeline_events DROP COLUMN IF EXISTS created_by;
ALTER TABLE opportunities   DROP COLUMN IF EXISTS created_by;
```

Apply to the local DB: `cd apps/api && npm run migrate -- up` (uses `DATABASE_URL`). Expected: both migrations listed as applied. (Production is migrated later through the `goms-migrate` job as part of the normal release; nothing here touches prod.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/migrations.test.ts`
Expected: PASS (7 tests). Also run `npm run migrate -- down 2` then `npm run migrate -- up` once to prove both Down sections work; Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations apps/api/src/auth/rbac/migrations.test.ts
git commit -m "feat(rbac): role-override table, created_by columns and email indexes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: RBAC mode, effective roles and identity facts

**Files:**
- Create: `apps/api/src/auth/rbac/mode.ts`
- Create: `apps/api/src/auth/rbac/userFacts.ts`
- Create: `apps/api/src/testHelpers/rbacFixtures.ts`
- Create: `apps/api/src/auth/rbac/mode.test.ts`, `apps/api/src/auth/rbac/userFacts.test.ts`

**Interfaces:**
- Consumes: `DERIVED_ROLE_DEPARTMENTS`, `SALES_ROLE_STATUSES`, `ROLES`, `Role`, `UserFacts`, `RbacMode` from `@goms/domain`; `isAllowListed` from `../identity.js`.
- Produces:
  - `rbacMode(): RbacMode`
  - `normalizeEmail(email: string): string`
  - `loadUserFacts(email: string): Promise<UserFacts>` (60 s TTL cache) and `clearUserFactsCache(): void`
  - Test fixtures: `rbacEmail(label)`, `makeSystemAdmin(label)`, `addOrgPerson(label, departments, opts?)`, `addSalesPerson(label, status?, email?)`, `addTeamMember(team, label, email?)`, `setRole(label, role, effect?)`, `makeBid(opts?)`, `assignOwner(entityType, entityId, salesPersonId, role?)`, `cleanupRbacFixtures()`.

- [ ] **Step 1: Write the fixtures and the failing tests**

`apps/api/src/testHelpers/rbacFixtures.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Role } from '@goms/domain'
import { pool } from '../db.js'
import { clearUserFactsCache } from '../auth/rbac/userFacts.js'

/** Every fixture is named / emailed `RBAC …` / `rbac-…` so cleanup can sweep a shared database safely. */
export const rbacEmail = (label: string): string => `rbac-${label}@amnex.com`

const made = { bids: [] as string[], opportunities: [] as string[] }

export async function addOrgPerson(label: string, departments: string[], opts: { status?: 'active' | 'inactive'; email?: string } = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO org_people (name, level, departments, email, status) VALUES ($1, 4, $2, $3, $4) RETURNING id`,
    [`RBAC ${label}`, departments, opts.email ?? rbacEmail(label), opts.status ?? 'active'],
  )
  clearUserFactsCache()
  return rows[0].id
}

export async function addSalesPerson(label: string, status = 'active', email = rbacEmail(label)): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO sales_persons (name, official_email, status) VALUES ($1, $2, $3) RETURNING id`, [`RBAC ${label}`, email, status],
  )
  clearUserFactsCache()
  return rows[0].id
}

export async function addTeamMember(team: 'preSales' | 'legal' | 'bid', label: string, email = rbacEmail(label)): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO delivery_team_members (team, name, email) VALUES ($1, $2, $3) RETURNING id`, [team, `RBAC ${label}`, email],
  )
  clearUserFactsCache()
  return rows[0].id
}

/** Makes `rbac-<label>@amnex.com` a System Admin the only way the product does: through ADMIN_ALLOWED_EMAILS. */
export function makeSystemAdmin(label: string): void {
  const existing = (process.env.ADMIN_ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)
  process.env.ADMIN_ALLOWED_EMAILS = [...existing, rbacEmail(label)].join(',')
  clearUserFactsCache()
}

/** Grants (or revokes) a role for `rbac-<label>@amnex.com` through the override table. */
export async function setRole(label: string, role: Role, effect: 'grant' | 'revoke' = 'grant'): Promise<void> {
  await pool.query(
    `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,'rbac test','tester@amnex.com')
     ON CONFLICT (email, role) DO UPDATE SET effect = EXCLUDED.effect`,
    [rbacEmail(label), role, effect],
  )
  clearUserFactsCache()
}

export interface BidFixtureOptions {
  sheet?: string
  withBid?: boolean
  createdBy?: string | null
  geoSalesPersonId?: string | null
  buSalesPersonId?: string | null
  preSalesPersonId?: string | null
  legalPersonId?: string | null
  bidTeamMemberId?: string | null
}

/** An opportunity (no department) plus, unless `withBid: false`, its bid on `sheet`. */
export async function makeBid(o: BidFixtureOptions = {}): Promise<{ opportunityId: string; bidId: string | null }> {
  const opp = await pool.query(
    `INSERT INTO opportunities (opportunity_name, created_by, geo_sales_person_id, bu_sales_person_id, pre_sales_person_id, legal_person_id, bid_team_member_id)
     VALUES ('RBAC fixture', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [o.createdBy ?? null, o.geoSalesPersonId ?? null, o.buSalesPersonId ?? null, o.preSalesPersonId ?? null, o.legalPersonId ?? null, o.bidTeamMemberId ?? null],
  )
  const opportunityId = opp.rows[0].id as string
  made.opportunities.push(opportunityId)
  if (o.withBid === false) return { opportunityId, bidId: null }
  const bid = await pool.query(
    `INSERT INTO bids (opportunity_id, bid_code, sheet) VALUES ($1, $2, $3) RETURNING id`,
    [opportunityId, `RBAC-${randomUUID()}`, o.sheet ?? 'bidTracker'],
  )
  made.bids.push(bid.rows[0].id)
  return { opportunityId, bidId: bid.rows[0].id }
}

export async function assignOwner(entityType: string, entityId: string, salesPersonId: string, role = 'owner'): Promise<void> {
  await pool.query(
    `INSERT INTO ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date)
     VALUES ($1,$2,$3,$4,'2020-01-01',$5)`,
    [entityType, entityId, salesPersonId, role, role === 'delegate' ? '2999-01-01' : null],
  )
}

export async function cleanupRbacFixtures(): Promise<void> {
  const ids = [...made.bids, ...made.opportunities]
  if (ids.length) {
    await pool.query('DELETE FROM ownership_assignments WHERE entity_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM follow_ups WHERE entity_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM bid_milestones WHERE bid_id = ANY($1::uuid[])', [made.bids])
    await pool.query('DELETE FROM bids WHERE id = ANY($1::uuid[])', [made.bids])
    await pool.query('DELETE FROM opportunities WHERE id = ANY($1::uuid[])', [made.opportunities])
  }
  made.bids.length = 0
  made.opportunities.length = 0
  await pool.query(`DELETE FROM follow_ups WHERE created_by LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM timeline_events WHERE created_by LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM user_role_overrides WHERE email LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM delivery_team_members WHERE name LIKE 'RBAC %'`)
  await pool.query(`DELETE FROM org_people WHERE name LIKE 'RBAC %'`)
  await pool.query(`DELETE FROM sales_persons WHERE name LIKE 'RBAC %'`)
  delete process.env.ADMIN_ALLOWED_EMAILS // makeSystemAdmin() sets it
  clearUserFactsCache()
}
```

`apps/api/src/auth/rbac/mode.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { rbacMode } from './mode.js'

afterEach(() => { delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE })

describe('rbacMode', () => {
  it('defaults to off', () => { expect(rbacMode()).toBe('off') })
  it('is off whenever auth is not enforced, whatever RBAC_MODE says', () => {
    process.env.RBAC_MODE = 'enforce'
    expect(rbacMode()).toBe('off')
  })
  it('reads shadow and enforce once auth is enforced', () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.RBAC_MODE = 'shadow'
    expect(rbacMode()).toBe('shadow')
    process.env.RBAC_MODE = 'enforce'
    expect(rbacMode()).toBe('enforce')
  })
  it('treats a typo as off rather than guessing', () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.RBAC_MODE = 'enforced'
    expect(rbacMode()).toBe('off')
  })
})
```

`apps/api/src/auth/rbac/userFacts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '../../db.js'
import { addOrgPerson, addSalesPerson, addTeamMember, cleanupRbacFixtures, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { clearUserFactsCache, loadUserFacts, normalizeEmail } from './userFacts.js'

beforeEach(cleanupRbacFixtures)
afterEach(async () => { delete process.env.ADMIN_ALLOWED_EMAILS; vi.restoreAllMocks(); await cleanupRbacFixtures() })

describe('derived roles', () => {
  it.each([
    ['Pre-Sales', 'presales'], ['Bid Management', 'bid'], ['Legal', 'legal'], ['Leadership', 'cxo'],
  ])('%s -> %s', async (department, role) => {
    await addOrgPerson('p', [department])
    expect((await loadUserFacts(rbacEmail('p'))).roles).toEqual([role])
  })

  it('does NOT derive anything from Business Units, Technology or Finance (decisions 2 and 7)', async () => {
    await addOrgPerson('bu', ['Business Units'])
    await addOrgPerson('tech', ['Technology'])
    await addOrgPerson('fin', ['Finance'])
    for (const label of ['bu', 'tech', 'fin']) expect((await loadUserFacts(rbacEmail(label))).roles).toEqual([])
  })

  it('a person in several departments gets several roles (the CFO: Finance + Legal -> legal until overridden)', async () => {
    await addOrgPerson('cfo', ['Finance', 'Legal'])
    expect((await loadUserFacts(rbacEmail('cfo'))).roles).toEqual(['legal'])
    await setRole('cfo', 'cxo')
    await setRole('cfo', 'finance')
    expect((await loadUserFacts(rbacEmail('cfo'))).roles).toEqual(['legal', 'cxo', 'finance'])
  })

  it('ignores inactive org people and people with no email', async () => {
    await addOrgPerson('gone', ['Legal'], { status: 'inactive' })
    await addOrgPerson('noemail', ['Legal'], { email: '' })
    expect((await loadUserFacts(rbacEmail('gone'))).roles).toEqual([])
    expect((await loadUserFacts('')).roles).toEqual([])
  })

  it('matches emails regardless of case and surrounding whitespace (Review Focus 1)', async () => {
    await addOrgPerson('mixed', ['Pre-Sales'], { email: '  RBAC-Mixed@Amnex.com ' })
    expect((await loadUserFacts('rbac-mixed@amnex.com')).roles).toEqual(['presales'])
    expect((await loadUserFacts('  RBAC-MIXED@AMNEX.COM')).roles).toEqual(['presales'])
    expect(normalizeEmail('  A@B.com ')).toBe('a@b.com')
  })
})

describe('Sales role', () => {
  it('comes from the Sales roster, not org_people, and records the roster id', async () => {
    const id = await addSalesPerson('s')
    const facts = await loadUserFacts(rbacEmail('s'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBe(id)
  })
  it('derives Sales only for active and onLeave roster entries; resigned and inactive do not (plan gap A6)', async () => {
    await addSalesPerson('active', 'active')
    await addSalesPerson('onleave', 'onLeave')
    await addSalesPerson('inactive', 'inactive')
    await addSalesPerson('resigned', 'resigned')
    expect((await loadUserFacts(rbacEmail('active'))).roles).toEqual(['sales'])
    expect((await loadUserFacts(rbacEmail('onleave'))).roles).toEqual(['sales'])
    expect((await loadUserFacts(rbacEmail('inactive'))).roles).toEqual([])
    expect((await loadUserFacts(rbacEmail('resigned'))).roles).toEqual([])
    expect((await loadUserFacts(rbacEmail('resigned'))).salesPersonId).toBeNull()
  })
  it('a resigned salesperson can still be granted Sales explicitly by an override', async () => {
    await addSalesPerson('rg', 'resigned')
    await setRole('rg', 'sales')
    expect((await loadUserFacts(rbacEmail('rg'))).roles).toEqual(['sales'])
  })
  it('an override-granted Sales role without a roster row has no salesPersonId (Review Focus 3)', async () => {
    await setRole('norow', 'sales')
    const facts = await loadUserFacts(rbacEmail('norow'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBeNull()
  })
})

describe('overrides', () => {
  it('grant adds a role and revoke removes a derived one', async () => {
    await addOrgPerson('o', ['Legal'])
    await setRole('o', 'legal', 'revoke')
    await setRole('o', 'delivery')
    expect((await loadUserFacts(rbacEmail('o'))).roles).toEqual(['delivery'])
  })
  it('Finance, IT and Delivery exist only through overrides', async () => {
    for (const role of ['finance', 'it', 'delivery'] as const) await setRole(role, role)
    for (const role of ['finance', 'it', 'delivery'] as const) expect((await loadUserFacts(rbacEmail(role))).roles).toEqual([role])
  })
  it('ADMIN_ALLOWED_EMAILS members are System Admins (not IT), even if an override revokes IT', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = `${rbacEmail('boss')}, other@amnex.com`
    await setRole('boss', 'it', 'revoke')
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['system_admin'])
  })
  it('System Admin is allow-list-only: nothing else produces it', async () => {
    await addOrgPerson('lead', ['Leadership'])
    await setRole('techie', 'it')
    expect((await loadUserFacts(rbacEmail('lead'))).roles).toEqual(['cxo'])
    expect((await loadUserFacts(rbacEmail('techie'))).roles).toEqual(['it'])
    expect((await loadUserFacts(rbacEmail('stranger'))).roles).toEqual([])
  })
  it('matches the allow-list regardless of case and whitespace, and never for an empty login (Review Focus 6)', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = `  ${rbacEmail('boss').toUpperCase()} , `
    expect((await loadUserFacts('  RBAC-BOSS@amnex.com ')).roles).toEqual(['system_admin'])
    expect((await loadUserFacts('')).roles).toEqual([])
  })
  it('adds System Admin to whatever the person already holds, last in ROLES order', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('boss')
    await addOrgPerson('boss', ['Legal'])
    await setRole('boss', 'finance')
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['legal', 'finance', 'system_admin'])
  })
})

describe('team membership facts', () => {
  it('links a login to roster rows by the roster email, or through the org-person link', async () => {
    const direct = await addTeamMember('preSales', 'direct')
    const orgId = await addOrgPerson('linked', ['Pre-Sales'])
    const { rows } = await pool.query(
      `INSERT INTO delivery_team_members (team, name, email, org_person_id) VALUES ('legal', 'RBAC linkedmember', '', $1) RETURNING id`, [orgId],
    )
    const d = await loadUserFacts(rbacEmail('direct'))
    expect(d.teamMemberIds).toEqual({ presales: [direct], legal: [], bid: [] })
    const l = await loadUserFacts(rbacEmail('linked'))
    expect(l.teamMemberIds.legal).toEqual([rows[0].id])
  })
  it('ignores inactive roster members', async () => {
    const id = await addTeamMember('bid', 'idle')
    await pool.query(`UPDATE delivery_team_members SET status='inactive' WHERE id=$1`, [id])
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('idle'))).teamMemberIds.bid).toEqual([])
  })
})

describe('cache', () => {
  it('serves repeat lookups from memory until cleared', async () => {
    await addOrgPerson('c', ['Legal'])
    await loadUserFacts(rbacEmail('c'))
    const spy = vi.spyOn(pool, 'query')
    await loadUserFacts(rbacEmail('c'))
    expect(spy).not.toHaveBeenCalled()
    clearUserFactsCache()
    await loadUserFacts(rbacEmail('c'))
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/auth/rbac/mode.test.ts src/auth/rbac/userFacts.test.ts`
Expected: FAIL — `Failed to resolve import "./mode.js"` / `"./userFacts.js"`.

- [ ] **Step 3: Implement**

`apps/api/src/auth/rbac/mode.ts`:

```ts
import type { RbacMode } from '@goms/domain'

/** `RBAC_MODE` = off (default) | shadow | enforce — and only meaningful when auth is enforced, because RBAC needs an
 *  identity. A misspelled value is `off`: the deployed default is a no-op, never a guess. */
export function rbacMode(): RbacMode {
  if (process.env.AUTH_ENFORCEMENT_ENABLED !== 'true') return 'off'
  const raw = process.env.RBAC_MODE
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off'
}
```

`apps/api/src/auth/rbac/userFacts.ts`:

```ts
import { DERIVED_ROLE_DEPARTMENTS, ROLES, SALES_ROLE_STATUSES, type Role, type UserFacts } from '@goms/domain'
import { pool } from '../../db.js'
import { isAllowListed } from '../identity.js'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; facts: UserFacts }>()

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
export function clearUserFactsCache(): void { cache.clear() }

/** Effective roles (spec §3.1): derived ∪ override grants − override revokes; ADMIN_ALLOWED_EMAILS members are then added
 *  as System Admin (spec §3.4), which no override can remove.
 *  Also resolves the caller's roster ids, which scope checks need. Cached per email for 60 s. */
export async function loadUserFacts(rawEmail: string): Promise<UserFacts> {
  const email = normalizeEmail(rawEmail)
  const hit = cache.get(email)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts

  const roles = new Set<Role>()
  let salesPersonId: string | null = null
  let teamMemberIds: UserFacts['teamMemberIds'] = { presales: [], legal: [], bid: [] }

  if (email) {
    const org = await pool.query(
      `SELECT departments FROM org_people WHERE status = 'active' AND lower(btrim(email)) = $1`, [email],
    )
    for (const row of org.rows) {
      for (const [role, department] of Object.entries(DERIVED_ROLE_DEPARTMENTS)) {
        if ((row.departments as string[]).includes(department)) roles.add(role as Role)
      }
    }

    const sales = await pool.query(
      `SELECT id FROM sales_persons WHERE status = ANY($2::text[]) AND lower(btrim(official_email)) = $1 LIMIT 1`, [email, [...SALES_ROLE_STATUSES]],
    )
    if (sales.rows[0]) { roles.add('sales'); salesPersonId = sales.rows[0].id }

    const overrides = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email = $1`, [email])
    for (const { role, effect } of overrides.rows) {
      if (effect === 'grant') roles.add(role as Role)
      else roles.delete(role as Role)
    }
    // System Admin (spec §3.4): the admin allow-list is the only source, applied after the overrides so none can remove it.
    if (isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS)) roles.add('system_admin')

    const members = await pool.query(
      `SELECT m.id, m.team FROM delivery_team_members m
         LEFT JOIN org_people p ON p.id = m.org_person_id
        WHERE m.status = 'active' AND (lower(btrim(m.email)) = $1 OR lower(btrim(p.email)) = $1)`,
      [email],
    )
    const ids = (team: string) => members.rows.filter((m) => m.team === team).map((m) => m.id as string)
    teamMemberIds = { presales: ids('preSales'), legal: ids('legal'), bid: ids('bid') }
  }

  const facts: UserFacts = { email, roles: ROLES.filter((r) => roles.has(r)), salesPersonId, teamMemberIds }
  cache.set(email, { at: Date.now(), facts })
  return facts
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && npx vitest run src/auth/rbac/mode.test.ts src/auth/rbac/userFacts.test.ts`
Expected: PASS. (`roles` come back in `ROLES` order — sales, presales, bid, legal, cxo, delivery, it, finance — and the assertions are written in that order.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): RBAC_MODE, effective-role resolution and identity facts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Decision engine, guard middleware and the `trpc.ts` tiers

**Files:**
- Create: `apps/api/src/auth/rbac/denial.ts`
- Create: `apps/api/src/auth/rbac/registry/types.ts`, `registry/helpers.ts`, `registry/index.ts`
- Create: `apps/api/src/auth/rbac/decide.ts`, `apps/api/src/auth/rbac/guard.ts`
- Modify: `apps/api/src/trpc.ts` (error marker, `rbacGate`, tiers, `rbacReadProcedure`)
- Create: `apps/api/src/auth/rbac/guard.test.ts`

**Interfaces:**
- Consumes: Task 3 `accessFor`/`allows`; Task 5 `rbacMode`, `loadUserFacts`.
- Produces:
  - `class RbacDenial extends Error { detail: { module; action; atom? } }`, `class DenyCall extends Error`
  - `type Check = { module: PolicyModuleKey; action: 'read'|'create'|'update'|'delete'; atoms?: string[]; row?: ScopeFacts; anyOf?: PolicyModuleKey[] }`
  - `type Requirement = (raw: any, user: UserFacts) => Check | null | Promise<Check | null>` (`null` = this requirement does not apply to this input)
  - `interface PolicyEntry { requirements: Requirement[]; mask?: (data: unknown, user: UserFacts) => unknown; kind?: 'public' | 'outside' | 'self' }`
  - `PROCEDURE_POLICY: Record<string, PolicyEntry>` (mutable; filled in Phase C)
  - helpers `read(m)`, `readAny(...ms)`, `create(m)`, `write(m, atoms?)`, `remove(m)`, `ROW_MODULES`, `readRows`
  - `evaluateCheck(check, user): Denial | null`, `decide(path, raw, user)`, `evaluateCall({mode, path, rawInput, ctx})`
  - `trpc.ts`: `rbacReadProcedure`, `formatError`; `protectedProcedure` / `protectedReadProcedure` now include the RBAC gate.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/guard.test.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatError, protectedProcedure, protectedReadProcedure, rbacReadProcedure, router } from '../../trpc.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addSalesPerson, cleanupRbacFixtures, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { read, write } from './registry/helpers.js'
import { PROCEDURE_POLICY } from './registry/index.js'

const testRouter = router({
  open: protectedProcedure.mutation(() => 'ok'),
  both: protectedProcedure.mutation(() => 'both'),
  unregistered: protectedProcedure.query(() => 'nope'),
  reader: protectedReadProcedure.query(() => 'rows'),
  geo: rbacReadProcedure.query(() => 'geo'),
  masked: protectedReadProcedure.query(() => ({ secret: 1, shown: 2 })),
})

const enforce = (mode: 'shadow' | 'enforce' = 'enforce') => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = mode }
const as = (label: string) => testRouter.createCaller(contextForEmail(rbacEmail(label)))

beforeEach(async () => {
  await cleanupRbacFixtures()
  PROCEDURE_POLICY.open = { requirements: [write('opp.bidTracker')] } // a generic write needs W
  PROCEDURE_POLICY.both = { requirements: [write('opp.bidTracker'), write('am.departments')] } // cross-module: every one must pass
  PROCEDURE_POLICY.reader = { requirements: [read('com.skus')] }
  PROCEDURE_POLICY.geo = { requirements: [read('am.geography')] }
  PROCEDURE_POLICY.masked = { requirements: [read('com.skus')], mask: (d) => ({ ...(d as object), secret: null }) }
})
afterEach(async () => {
  for (const k of ['open', 'both', 'unregistered', 'reader', 'geo', 'masked']) delete PROCEDURE_POLICY[k]
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
  vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('mode off (the deployed default)', () => {
  it('is an exact no-op: even an unregistered procedure runs, with no identity at all', async () => {
    await expect(testRouter.createCaller({}).unregistered()).resolves.toBe('nope')
    await expect(testRouter.createCaller({}).open()).resolves.toBe('ok')
  })
  it('stays off if RBAC_MODE is set but auth is not enforced', async () => {
    process.env.RBAC_MODE = 'enforce'
    await expect(testRouter.createCaller({}).open()).resolves.toBe('ok')
  })
  it('does not apply response masks', async () => {
    await expect(testRouter.createCaller({}).masked()).resolves.toEqual({ secret: 1, shown: 2 })
  })
})

describe('mode enforce', () => {
  beforeEach(() => enforce())

  it('fails closed on a procedure with no registry entry', async () => {
    await setRole('bidder', 'bid')
    const err = await as('bidder').unregistered().catch((e) => e)
    expect(err).toBeInstanceOf(TRPCError)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(err.message).toMatch(/No access policy is registered/)
  })
  it('allows a role with the level and denies one without, with an RbacDenial cause', async () => {
    await setRole('bidder', 'bid')
    await setRole('lawyer', 'legal')
    await expect(as('bidder').open()).resolves.toBe('ok')
    const err = await as('lawyer').open().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(err.message).toMatch(/permission to edit Bid Tracker rows/)
  })
  it('a cross-module procedure needs EVERY requirement (never just one module)', async () => {
    await setRole('bidder', 'bid')              // W on Bid Tracker rows, but only R on Customer Departments
    await setRole('both', 'bid'); await setRole('both', 'sales'); await addSalesPerson('both')
    await expect(as('bidder').both()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(as('both').both()).resolves.toBe('both') // Bid W on rows + Sales W on departments
  })
  it('gives a user with no role the Geography baseline and nothing else', async () => {
    await expect(as('nobody').geo()).resolves.toBe('geo')
    await expect(as('nobody').reader()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('applies the entry mask to the response', async () => {
    await setRole('pre', 'presales')
    await expect(as('pre').masked()).resolves.toEqual({ secret: null, shown: 2 })
  })
  it('evaluates calls independently (one denied call does not poison its neighbours)', async () => {
    await setRole('bidder', 'bid')
    await setRole('lawyer', 'legal')
    const [a, b, c] = await Promise.allSettled([as('bidder').open(), as('lawyer').open(), as('bidder').geo()])
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect(c.status).toBe('fulfilled')
  })
  it('rejects a signed-out call to a gated read with UNAUTHORIZED, not an RBAC denial (Review Focus 4)', async () => {
    const err = await testRouter.createCaller({}).geo().catch((e) => e)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('keeps the existing non-Amnex rejection, which is not an RBAC denial', async () => {
    const err = await testRouter.createCaller(contextForEmail('someone@gmail.com')).geo().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('works for protectedReadProcedure even when READ_AUTH is off (RBAC resolves the caller itself)', async () => {
    await setRole('pre', 'presales')
    await expect(as('pre').reader()).resolves.toBe('rows')
  })
})

describe('mode shadow', () => {
  it('logs a would-be denial as JSON and lets the call through', async () => {
    enforce('shadow')
    await setRole('lawyer', 'legal')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(as('lawyer').open()).resolves.toBe('ok')
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('rbac.would_deny'))!
    expect(JSON.parse(line)).toMatchObject({ event: 'rbac.would_deny', path: 'open', email: rbacEmail('lawyer'), module: 'opp.bidTracker', action: 'update' })
  })
  it('logs an unregistered procedure too, and an unauthenticated caller', async () => {
    enforce('shadow')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(testRouter.createCaller({}).geo()).resolves.toBe('geo')
    await setRole('bidder', 'bid')
    await expect(as('bidder').unregistered()).resolves.toBe('nope')
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('"path":"geo"') && l.includes('unauthenticated'))).toBe(true)
    expect(lines.some((l) => l.includes('"path":"unregistered"'))).toBe(true)
  })
})

describe('formatError', () => {
  const shape = { message: 'm', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } }
  it('marks an RBAC denial so the client does not show the sign-in dialog', () => {
    const error = new TRPCError({ code: 'FORBIDDEN', cause: new RbacDenial('x', { module: 'm', action: 'a' }) })
    expect((formatError({ shape, error }) as any).data.rbacDenied).toBe(true)
  })
  it('leaves an ordinary FORBIDDEN unmarked and still masks internal errors', () => {
    expect((formatError({ shape, error: new TRPCError({ code: 'FORBIDDEN' }) }) as any).data.rbacDenied).toBeUndefined()
    expect(formatError({ shape, error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }) }).message).toBe('Internal server error')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/guard.test.ts`
Expected: FAIL — `Failed to resolve import "./denial.js"` (and `formatError` / `rbacReadProcedure` not exported from `trpc.js`).

- [ ] **Step 3: Implement**

`apps/api/src/auth/rbac/denial.ts`:

```ts
/** Thrown (as the `cause` of a FORBIDDEN TRPCError) when RBAC refuses a call. The error formatter turns it into
 *  `data.rbacDenied: true` so the client can tell it apart from "sign in with an @amnex.com account". */
export class RbacDenial extends Error {
  constructor(message: string, readonly detail: { module: string; action: string; atom?: string }) {
    super(message)
    this.name = 'RbacDenial'
  }
}

/** Thrown by a registry requirement when the input itself cannot be authorised (e.g. an unsupported `entityType`). */
export class DenyCall extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DenyCall'
  }
}
```

`apps/api/src/auth/rbac/registry/types.ts`:

```ts
import type { PolicyModuleKey, ScopeFacts, UserFacts } from '@goms/domain'

export type CheckAction = 'read' | 'create' | 'update' | 'delete'

export interface Check {
  module: PolicyModuleKey
  action: CheckAction
  /** update: the atoms the call touches. `undefined` = a generic write (needs W); `[]` = any write level. */
  atoms?: string[]
  /** The row being touched, when the module has own/asg scopes (or a parent row for a create). */
  row?: ScopeFacts
  /** read: passes if the user can read ANY of these modules (dependent reads, gap A4). */
  anyOf?: PolicyModuleKey[]
}

/** One authorization requirement. `null` = it does not apply to this input (e.g. no sheet move in the patch). */
export type Requirement = (raw: any, user: UserFacts) => Check | null | Promise<Check | null>

export interface PolicyEntry {
  /** All must pass (logical AND). Normally one; a cross-module procedure lists one per module. */
  requirements: Requirement[]
  /** Post-processes the response for this caller (SKU masking, search filtering, roster redaction). */
  mask?: (data: unknown, user: UserFacts) => unknown
  /** public: no checks (liveness). outside: governed elsewhere (Data Import). self: the caller's own identity. */
  kind?: 'public' | 'outside' | 'self'
}
```

`apps/api/src/auth/rbac/registry/helpers.ts`:

```ts
import type { PolicyModuleKey } from '@goms/domain'
import type { Requirement } from './types.js'

export const ROW_MODULES: PolicyModuleKey[] = ['opp.bidTracker', 'opp.pipeline', 'opp.campaign']

export const read = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'read' })
export const readAny = (...anyOf: PolicyModuleKey[]): Requirement => () => ({ module: anyOf[0], action: 'read', anyOf })
export const create = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'create' })
export const write = (module: PolicyModuleKey, atoms?: string[]): Requirement => () => ({ module, action: 'update', atoms })
export const remove = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'delete' })

/** Reading any opportunity row = reading at least one of the three sheet modules. */
export const readRows: Requirement = readAny(...ROW_MODULES)
```

`apps/api/src/auth/rbac/registry/index.ts`:

```ts
import type { PolicyEntry } from './types.js'

/** `'router.procedure'` → policy. Filled by the per-area modules in Phase C (tasks 8–10, 13, 14). */
export const PROCEDURE_POLICY: Record<string, PolicyEntry> = {}
```

`apps/api/src/auth/rbac/decide.ts`:

```ts
import {
  accessFor, allows, atomLabel, canReadAtom, isMaskedAtom, moduleLabel, type UserFacts,
} from '@goms/domain'
import { DenyCall } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import type { Check, PolicyEntry } from './registry/types.js'

export interface Denial { module: string; action: string; atom?: string; message: string }

/** Does `user` satisfy one check? Returns the denial, or null when allowed. */
export function evaluateCheck(check: Check, user: UserFacts): Denial | null {
  const label = moduleLabel(check.module)
  const deny = (what: string, atom?: string): Denial => ({
    module: check.module, action: check.action, atom, message: `You don't have permission to ${what}.`,
  })

  if (check.action === 'read') {
    const modules = check.anyOf ?? [check.module]
    return modules.some((m) => accessFor(user, m, check.row).level !== 'N') ? null : deny(`view ${label}`)
  }
  const access = accessFor(user, check.module, check.row)
  if (check.action === 'create') return access.create ? null : deny(`create in ${label}`)
  if (check.action === 'delete') return access.delete ? null : deny(`delete from ${label}`)

  if (access.level !== 'P' && access.level !== 'W') return deny(`edit ${label}`)
  if (check.atoms === undefined) return access.all ? null : deny(`edit ${label}`)
  for (const atom of check.atoms) {
    if (!allows(access, atom)) return deny(`edit ${atomLabel(atom)}`, atom)
    // A role cannot edit a field it is not allowed to read.
    if (isMaskedAtom(atom) && !canReadAtom(user.roles, atom)) return deny(`edit ${atomLabel(atom)}`, atom)
  }
  return null
}

export async function decide(path: string, raw: unknown, user: UserFacts): Promise<{ denial: Denial | null; entry: PolicyEntry | undefined }> {
  const entry = PROCEDURE_POLICY[path]
  if (!entry) {
    return { entry, denial: { module: 'unregistered', action: 'call', message: `No access policy is registered for ${path}.` } }
  }
  if (entry.kind) return { entry, denial: null }
  for (const requirement of entry.requirements) {
    let check: Check | null
    try {
      check = await requirement(raw, user)
    } catch (e) {
      if (e instanceof DenyCall) return { entry, denial: { module: 'input', action: 'call', message: e.message } }
      throw e
    }
    if (!check) continue
    const denial = evaluateCheck(check, user)
    if (denial) return { entry, denial }
  }
  return { entry, denial: null }
}
```

`apps/api/src/auth/rbac/guard.ts`:

```ts
import { TRPCError } from '@trpc/server'
import type { RbacMode, UserFacts } from '@goms/domain'
import { isAmnexAccount, verifyFirebaseToken } from '../identity.js'
import { decide } from './decide.js'
import { RbacDenial } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import type { PolicyEntry } from './registry/types.js'
import { loadUserFacts } from './userFacts.js'

export interface CallOutcome { entry: PolicyEntry | undefined; user: UserFacts | null }

function logShadow(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'rbac.would_deny', ...fields }))
}

/** Authorises one procedure call. In `shadow` it only logs; in `enforce` it throws. Never called when mode is `off`. */
export async function evaluateCall(args: {
  mode: Exclude<RbacMode, 'off'>
  path: string
  rawInput: unknown
  ctx: { authHeader?: string; user?: { email: string } }
}): Promise<CallOutcome> {
  const { mode, path, rawInput, ctx } = args
  const entry = PROCEDURE_POLICY[path]
  if (entry?.kind) return { entry, user: null }

  let email = ctx.user?.email
  if (!email) {
    // Public reads and reads with READ_AUTH off arrive here unauthenticated: resolve the caller ourselves.
    try {
      const verified = await verifyFirebaseToken(ctx.authHeader)
      if (!isAmnexAccount(verified.email)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
      }
      email = verified.email
    } catch (e) {
      if (mode === 'enforce') throw e
      logShadow({ path, email: null, module: 'identity', action: 'call', message: 'unauthenticated' })
      return { entry, user: null }
    }
  }

  const user = await loadUserFacts(email)
  const { denial } = await decide(path, rawInput, user)
  if (!denial) return { entry, user }
  if (mode === 'shadow') {
    logShadow({ path, email: user.email, module: denial.module, action: denial.action, atom: denial.atom, message: denial.message })
    return { entry, user }
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: denial.message, cause: new RbacDenial(denial.message, denial) })
}
```

Edit `apps/api/src/trpc.ts`. Add imports at the top:

```ts
import { rbacMode } from './auth/rbac/mode.js'
import { evaluateCall } from './auth/rbac/guard.js'
import { RbacDenial } from './auth/rbac/denial.js'
```

Replace the `initTRPC` block with:

```ts
/** Exported for testing. An RBAC denial is flagged (`data.rbacDenied`) so the client can show a normal "no
 *  permission" message instead of the "sign in with your @amnex.com account" dialog every FORBIDDEN used to trigger. */
export function formatError({ shape, error }: { shape: any; error: TRPCError }) {
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    return { ...shape, message: 'Internal server error' }
  }
  if (error.cause instanceof RbacDenial) {
    return { ...shape, data: { ...shape.data, rbacDenied: true } }
  }
  return shape
}

export const t = initTRPC.context<Context>().create({ errorFormatter: formatError })
```

Add, after `assertNotReadOnly()` / `authEnforced()` and before `protectedProcedure`:

```ts
/** RBAC (docs/superpowers/specs/2026-10-06-rbac-design.md). `off` (the default, and always when auth is not
 *  enforced) is an exact no-op. Otherwise looks the procedure up in PROCEDURE_POLICY and evaluates every one of its
 *  requirements; `shadow` only logs a denial, `enforce` throws FORBIDDEN. The entry's `mask` post-processes the
 *  response for this caller. */
const rbacGate = t.middleware(async ({ ctx, path, getRawInput, next }) => {
  const mode = rbacMode()
  if (mode === 'off') return next()
  const { entry, user } = await evaluateCall({ mode, path, rawInput: await getRawInput(), ctx })
  const result = await next()
  if (result.ok && entry?.mask && user) return { ...result, data: entry.mask(result.data, user) }
  return result
})
```

Change the two tiers and add the third. `protectedProcedure` gets `.use(rbacGate)` as its last `.use(...)`:

```ts
    return next({ ctx: { ...ctx, user } })
  })
  .use(rbacGate)
```

`protectedReadProcedure` becomes:

```ts
export const protectedReadProcedure = publicProcedure
  .use(async ({ ctx, next }) => {
    if (!readAuthEnforced()) {
      return next({ ctx })
    }
    const user = await verifyFirebaseToken(ctx.authHeader)
    if (!isAmnexAccount(user.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    return next({ ctx: { ...ctx, user } })
  })
  .use(rbacGate)

/** For the 17 reads that were `publicProcedure` (hierarchy + commercial masters/BOM/edition features). With
 *  RBAC_MODE=off it is exactly `publicProcedure`; in `shadow` it logs; in `enforce` it requires a verified
 *  @amnex.com login plus the per-procedure read permission (RBAC spec §8). */
export const rbacReadProcedure = publicProcedure.use(rbacGate)
```

(Keep the long explanatory comments that precede the existing tiers; only the chain changes.)

If the compiler rejects returning a spread copy of `result` from the middleware, assign instead: `result.data = entry.mask(result.data, user); return result` — the test "applies the entry mask to the response" is the arbiter.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/guard.test.ts src/trpc.test.ts`
Expected: PASS — the new guard tests and the **unchanged** existing `trpc.test.ts` (proves `off` is a no-op for every existing tier).
Then: `cd apps/api && npx tsc -p tsconfig.json --noEmit` — Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): decision engine, guard middleware and RBAC tiers in trpc.ts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Row-scope loaders (and two import-cycle refactors)

**Files:**
- Create: `apps/api/src/lib/ownershipContext.ts` (moved out of `routers/ownership.ts`)
- Create: `apps/api/src/lib/pendingUploads.ts` (moved out of `routers/documents.ts`)
- Modify: `apps/api/src/routers/ownership.ts`, `apps/api/src/routers/bids.ts:12`, `apps/api/src/routers/documents.ts`
- Create: `apps/api/src/auth/rbac/rows.ts`
- Create: `apps/api/src/auth/rbac/rows.test.ts`

**Why the refactors:** `trpc.ts` imports the registry, the registry imports row loaders, and the loaders need `loadOwnershipContext` (today in `routers/ownership.ts`, which imports `trpc.ts`) and `pendingUploads` (in `routers/documents.ts`). Moving them to `lib/` breaks the cycle without behavior change.

**Interfaces:**
- Produces (all in `rows.ts`):
  - `type RowModule = 'opp.bidTracker' | 'opp.pipeline' | 'opp.campaign'`; `SHEET_MODULE`; `sheetModule(sheet: unknown): RowModule`
  - `interface RowTarget { module: RowModule; bidId: string | null; opportunityId: string; facts: ScopeFacts }`
  - `isUuid(v: unknown): v is string`
  - `rowForBid(id: unknown): Promise<RowTarget | null>`, `rowForOpportunity(id)`
  - `rowForOwnedEntity(entityType: unknown, entityId: unknown): Promise<ScopeFacts | null>` (`bid | opportunity | contact | orgNode`)
  - `rowForSalesPerson(id): Promise<ScopeFacts | null>`
  - `rowForFollowUp(id): Promise<{ entityType: string; entityId: string; facts: ScopeFacts } | null>`
  - `rowForTimelineEvent(id): Promise<ScopeFacts | null>`
  - `rowForDocument(id): Promise<ScopeFacts | null>`, `rowForCitation(id): Promise<ScopeFacts | null>`
  - `milestoneInfo(id): Promise<{ bidId: string; key: string } | null>`
  - `corrigendumChangeInfo(changeId): Promise<{ bidId: string; fieldKey: string } | null>`
  - `assignmentInfo(id): Promise<{ entityType: string; entityId: string; role: string } | null>`
  - `savedViewScope(id): Promise<'global' | 'personal' | null>`
  - `domainOfNode(id): Promise<'geo' | 'org' | 'sales' | null>`

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/rows.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import {
  addSalesPerson, addTeamMember, assignOwner, cleanupRbacFixtures, makeBid,
} from '../../testHelpers/rbacFixtures.js'
import {
  domainOfNode, isUuid, rowForBid, rowForFollowUp, rowForOpportunity, rowForOwnedEntity, rowForSalesPerson, savedViewScope, sheetModule,
} from './rows.js'

beforeEach(cleanupRbacFixtures)
afterEach(cleanupRbacFixtures)

describe('sheet → module', () => {
  it('maps every owned sheet, defaulting an unknown or missing one to Bid Tracker', () => {
    expect(sheetModule('bidTracker')).toBe('opp.bidTracker')
    for (const s of ['pipeline-funnel', 'pipeline-backup', 'pipeline-commits']) expect(sheetModule(s)).toBe('opp.pipeline')
    expect(sheetModule('campaign')).toBe('opp.campaign')
    expect(sheetModule(undefined)).toBe('opp.bidTracker')
    expect(sheetModule('nonsense')).toBe('opp.bidTracker')
  })
})

describe('rowForBid', () => {
  it('returns null for garbage and for a missing id, without letting Postgres see a bad uuid', async () => {
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(await rowForBid('not-a-uuid')).toBeNull()
    expect(await rowForBid(undefined)).toBeNull()
    expect(await rowForBid('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
  it('reports the sheet module, the team slots and a lower-cased creator', async () => {
    const pre = await addTeamMember('preSales', 'a')
    const { bidId, opportunityId } = await makeBid({ sheet: 'pipeline-backup', createdBy: 'RBAC-Maker@Amnex.com', preSalesPersonId: pre })
    const row = (await rowForBid(bidId))!
    expect(row).toMatchObject({ module: 'opp.pipeline', bidId, opportunityId })
    expect(row.facts.createdBy).toBe('rbac-maker@amnex.com')
    expect(row.facts.assigned).toEqual({ presales: pre, legal: null, bid: null })
  })
  it('collects Geo/BU people, the bid-level owner and a solution lead as "own" — the opportunity owner is shadowed by a bid-level owner', async () => {
    const [geo, bu, bidOwner, oppOwner, lead] = await Promise.all(['geo', 'bu', 'bo', 'oo', 'sl'].map((l) => addSalesPerson(l)))
    const { bidId, opportunityId } = await makeBid({ geoSalesPersonId: geo, buSalesPersonId: bu })
    await assignOwner('bid', bidId!, bidOwner)
    await assignOwner('opportunity', opportunityId, oppOwner)
    await assignOwner('bid', bidId!, lead, 'solutionLead')
    const owners = (await rowForBid(bidId))!.facts.salesOwnerIds
    for (const id of [geo, bu, bidOwner, lead]) expect(owners).toContain(id)
    expect(owners).not.toContain(oppOwner)
  })
  it('inherits the opportunity owner when the bid has none of its own', async () => {
    const owner = await addSalesPerson('oo')
    const { bidId, opportunityId } = await makeBid()
    await assignOwner('opportunity', opportunityId, owner)
    expect((await rowForBid(bidId))!.facts.salesOwnerIds).toContain(owner)
  })
  it('counts an active delegate as own', async () => {
    const delegate = await addSalesPerson('dg')
    const { bidId } = await makeBid()
    await assignOwner('bid', bidId!, delegate, 'delegate')
    expect((await rowForBid(bidId))!.facts.salesOwnerIds).toContain(delegate)
  })
})

describe('rowForOpportunity', () => {
  it('treats a bid-less opportunity as the Bid Tracker sheet', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    expect(await rowForOpportunity(opportunityId)).toMatchObject({ module: 'opp.bidTracker', bidId: null })
  })
})

describe('other row kinds', () => {
  it('a Sales Team row is "own" for exactly that person', async () => {
    const id = await addSalesPerson('r')
    expect(await rowForSalesPerson(id)).toEqual({ salesOwnerIds: [id], createdBy: null, assigned: { presales: null, legal: null, bid: null } })
    expect(await rowForSalesPerson('nope')).toBeNull()
  })
  it('rowForOwnedEntity resolves bid and opportunity, and refuses unknown entity types', async () => {
    const { bidId, opportunityId } = await makeBid({ createdBy: 'rbac-x@amnex.com' })
    expect((await rowForOwnedEntity('bid', bidId))!.createdBy).toBe('rbac-x@amnex.com')
    expect((await rowForOwnedEntity('opportunity', opportunityId))!.createdBy).toBe('rbac-x@amnex.com')
    expect(await rowForOwnedEntity('widget', bidId)).toBeNull()
  })
  it('a contact follow-up carries its creator and its assignee as owners', async () => {
    const assignee = await addSalesPerson('as')
    const emp = await pool.query(`SELECT id FROM employees LIMIT 1`)
    if (!emp.rows[0]) return // no seed data locally: nothing to attach a contact follow-up to
    const fu = await pool.query(
      `INSERT INTO follow_ups (entity_type, entity_id, assignee_id, due_date, status, note, created_by)
       VALUES ('contact', $1, $2, '2999-01-01', 'open', '', 'rbac-c@amnex.com') RETURNING id`, [emp.rows[0].id, assignee],
    )
    const row = (await rowForFollowUp(fu.rows[0].id))!
    expect(row.entityType).toBe('contact')
    expect(row.facts.createdBy).toBe('rbac-c@amnex.com')
    expect(row.facts.salesOwnerIds).toContain(assignee)
  })
})

describe('small lookups', () => {
  it('report null when the row is absent or the id is not a uuid', async () => {
    expect(await savedViewScope('00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await domainOfNode('00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await domainOfNode('garbage')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/rows.test.ts`
Expected: FAIL — `Failed to resolve import "./rows.js"`.

- [ ] **Step 3: Do the two refactors, then implement `rows.ts`**

`apps/api/src/lib/ownershipContext.ts` — move `toAssignment` and `loadOwnershipContext` here **verbatim** from `routers/ownership.ts` (lines 8–42), adding the imports:

```ts
import type { OwnershipContext } from '@goms/domain'
import { pool } from '../db.js'

export function toAssignment(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, salesPersonId: row.sales_person_id,
    role: row.role, startDate: row.start_date, endDate: row.end_date, reason: row.reason,
    batchId: row.batch_id, note: row.note, createdAt: row.created_at, createdBy: null,
  }
}

/** (the existing doc comment, unchanged) */
export async function loadOwnershipContext(): Promise<{ assignments: any[]; ctx: OwnershipContext }> {
  const [assignmentsResult, nodesResult, employeesResult, opportunitiesResult, bidsResult] = await Promise.all([
    pool.query('SELECT * FROM ownership_assignments'),
    pool.query('SELECT id, parent_id AS "parentId" FROM hierarchy_nodes'),
    pool.query('SELECT id, org_node_id AS "orgNodeId" FROM employees'),
    pool.query('SELECT id, department_id AS "departmentId" FROM opportunities'),
    pool.query('SELECT id, opportunity_id AS "opportunityId" FROM bids'),
  ])
  return {
    assignments: assignmentsResult.rows.map(toAssignment),
    ctx: { nodes: nodesResult.rows, employees: employeesResult.rows, opportunities: opportunitiesResult.rows, bids: bidsResult.rows },
  }
}
```

In `routers/ownership.ts`: delete the local `toAssignment` and `loadOwnershipContext`, and add
`import { loadOwnershipContext, toAssignment } from '../lib/ownershipContext.js'` plus `export { loadOwnershipContext }` (keeps any importer working). In `routers/bids.ts:12` change the import to `from '../lib/ownershipContext.js'`.

`apps/api/src/lib/pendingUploads.ts`:

```ts
/** uploadId -> pending upload metadata (see routers/documents.ts). Lives here so the RBAC registry can read it
 *  without importing a router (which would import trpc.ts and form a cycle). */
export const pendingUploads = new Map<string, {
  entityType: string; entityId: string; filename: string; version: string; pendingPath: string; canonicalPath: string
}>()
```

In `routers/documents.ts` replace the `export const pendingUploads = new Map…` declaration (line 26, keep its comment) with
`import { pendingUploads } from '../lib/pendingUploads.js'` and `export { pendingUploads }`.

Verify the refactors changed nothing: `cd apps/api && npx vitest run src/routers/ownership.test.ts src/routers/documents.test.ts src/routers/bids.test.ts` — Expected: PASS, same counts as before the move.

Create `apps/api/src/auth/rbac/rows.ts`:

```ts
import {
  DEFAULT_OWNED_SHEET, activeDelegate, effectiveOwner, isOwnedSheet, type OwnedSheet, type PolicyModuleKey, type ScopeFacts,
} from '@goms/domain'
import { pool } from '../../db.js'
import { loadOwnershipContext } from '../../lib/ownershipContext.js'

export type RowModule = Extract<PolicyModuleKey, 'opp.bidTracker' | 'opp.pipeline' | 'opp.campaign'>

export const SHEET_MODULE: Record<OwnedSheet, RowModule> = {
  bidTracker: 'opp.bidTracker',
  'pipeline-funnel': 'opp.pipeline', 'pipeline-backup': 'opp.pipeline', 'pipeline-commits': 'opp.pipeline',
  campaign: 'opp.campaign',
}
/** Unknown or absent sheet (a bid-less opportunity) is authorised as Bid Tracker. */
export const sheetModule = (sheet: unknown): RowModule => SHEET_MODULE[isOwnedSheet(sheet) ? sheet : DEFAULT_OWNED_SHEET]

export interface RowTarget { module: RowModule; bidId: string | null; opportunityId: string; facts: ScopeFacts }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The guard runs BEFORE zod validates the input, so every loader refuses a non-uuid instead of letting Postgres throw. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

const NO_ASSIGNED = { presales: null, legal: null, bid: null } as const
const lower = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null)
const today = () => new Date().toISOString().slice(0, 10)

/** Sales people who "own" these entities today: effective owner (with the same inheritance the grid's Bid Owner
 *  column uses), active delegate, and active solution lead. */
async function ownerIds(entities: { type: string; id: string }[]): Promise<string[]> {
  const { assignments, ctx } = await loadOwnershipContext()
  const asOf = today()
  const ids = new Set<string>()
  for (const { type, id } of entities) {
    const owner = effectiveOwner(assignments, type, id, asOf, ctx)
    if (owner) ids.add(owner.salesPersonId)
    const delegate = activeDelegate(assignments, type, id, asOf)
    if (delegate) ids.add(delegate.salesPersonId)
    for (const a of assignments) {
      if (a.entityType === type && a.entityId === id && a.role === 'solutionLead' && a.startDate <= asOf && (a.endDate === null || asOf < a.endDate)) {
        ids.add(a.salesPersonId)
      }
    }
  }
  return [...ids]
}

async function target(by: 'bid' | 'opportunity', id: unknown): Promise<RowTarget | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(
    `SELECT b.id AS bid_id, b.sheet, o.id AS opp_id, o.created_by, o.geo_sales_person_id, o.bu_sales_person_id,
            o.pre_sales_person_id, o.legal_person_id, o.bid_team_member_id
       FROM opportunities o LEFT JOIN bids b ON b.opportunity_id = o.id
      WHERE ${by === 'bid' ? 'b.id' : 'o.id'} = $1`, [id],
  )).rows[0]
  if (!row) return null
  // The row's own entity: the bid when there is one (its effective owner inherits from the opportunity), else the opportunity.
  const owners = await ownerIds([row.bid_id ? { type: 'bid', id: row.bid_id } : { type: 'opportunity', id: row.opp_id }])
  return {
    module: sheetModule(row.sheet),
    bidId: row.bid_id ?? null,
    opportunityId: row.opp_id,
    facts: {
      salesOwnerIds: [...new Set([...owners, row.geo_sales_person_id, row.bu_sales_person_id].filter(Boolean) as string[])],
      createdBy: lower(row.created_by),
      assigned: { presales: row.pre_sales_person_id ?? null, legal: row.legal_person_id ?? null, bid: row.bid_team_member_id ?? null },
    },
  }
}
export const rowForBid = (id: unknown) => target('bid', id)
export const rowForOpportunity = (id: unknown) => target('opportunity', id)

/** Rows for the polymorphic `entityType` / `entityId` pairs on ownership, follow-ups, documents, protected values. */
export async function rowForOwnedEntity(entityType: unknown, entityId: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(entityId)) return null
  if (entityType === 'bid') return (await rowForBid(entityId))?.facts ?? null
  if (entityType === 'opportunity') return (await rowForOpportunity(entityId))?.facts ?? null
  if (entityType === 'contact' || entityType === 'orgNode') {
    return { salesOwnerIds: await ownerIds([{ type: entityType, id: entityId }]), createdBy: null, assigned: NO_ASSIGNED }
  }
  return null
}

export async function rowForSalesPerson(id: unknown): Promise<ScopeFacts | null> {
  return isUuid(id) ? { salesOwnerIds: [id], createdBy: null, assigned: NO_ASSIGNED } : null
}

export async function rowForFollowUp(id: unknown): Promise<{ entityType: string; entityId: string; facts: ScopeFacts } | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(`SELECT entity_type, entity_id, assignee_id, created_by FROM follow_ups WHERE id=$1`, [id])).rows[0]
  if (!row) return null
  const owners = row.entity_type === 'contact' ? await ownerIds([{ type: 'contact', id: row.entity_id }]) : []
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    facts: { salesOwnerIds: [...owners, ...(row.assignee_id ? [row.assignee_id] : [])], createdBy: lower(row.created_by), assigned: NO_ASSIGNED },
  }
}

export async function rowForTimelineEvent(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(`SELECT employee_id, attendees, created_by FROM timeline_events WHERE id=$1`, [id])).rows[0]
  if (!row) return null
  const attendees: unknown[] = Array.isArray(row.attendees) ? row.attendees : []
  const attendeeIds = attendees.map((a) => (typeof a === 'object' && a !== null ? (a as any).salesPersonId : null)).filter(Boolean) as string[]
  const owners = await ownerIds([{ type: 'contact', id: row.employee_id }])
  return { salesOwnerIds: [...new Set([...attendeeIds, ...owners])], createdBy: lower(row.created_by), assigned: NO_ASSIGNED }
}

export async function rowForDocument(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const doc = (await pool.query(`SELECT entity_type, entity_id FROM documents WHERE id=$1`, [id])).rows[0]
  return doc ? rowForOwnedEntity(doc.entity_type, doc.entity_id) : null
}

export async function rowForCitation(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const c = (await pool.query(`SELECT document_id FROM document_citations WHERE id=$1`, [id])).rows[0]
  return c ? rowForDocument(c.document_id) : null
}

export async function milestoneInfo(id: unknown): Promise<{ bidId: string; key: string } | null> {
  if (!isUuid(id)) return null
  const m = (await pool.query(`SELECT bid_id, key FROM bid_milestones WHERE id=$1`, [id])).rows[0]
  return m ? { bidId: m.bid_id, key: m.key } : null
}

export async function corrigendumChangeInfo(changeId: unknown): Promise<{ bidId: string; fieldKey: string } | null> {
  if (!isUuid(changeId)) return null
  const r = (await pool.query(
    `SELECT c.bid_id, ch.field_key FROM bid_corrigendum_changes ch JOIN bid_corrigenda c ON c.id = ch.corrigendum_id WHERE ch.id=$1`, [changeId],
  )).rows[0]
  return r ? { bidId: r.bid_id, fieldKey: r.field_key } : null
}

export async function assignmentInfo(id: unknown): Promise<{ entityType: string; entityId: string; role: string } | null> {
  if (!isUuid(id)) return null
  const a = (await pool.query(`SELECT entity_type, entity_id, role FROM ownership_assignments WHERE id=$1`, [id])).rows[0]
  return a ? { entityType: a.entity_type, entityId: a.entity_id, role: a.role } : null
}

export async function savedViewScope(id: unknown): Promise<'global' | 'personal' | null> {
  if (!isUuid(id)) return null
  const v = (await pool.query(`SELECT scope FROM bid_saved_views WHERE id=$1`, [id])).rows[0]
  return v ? (v.scope === 'global' ? 'global' : 'personal') : null
}

export async function domainOfNode(id: unknown): Promise<'geo' | 'org' | 'sales' | null> {
  if (!isUuid(id)) return null
  const n = (await pool.query(`SELECT domain FROM hierarchy_nodes WHERE id=$1`, [id])).rows[0]
  return n ? n.domain : null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/rows.test.ts`
Expected: PASS (the contact follow-up test returns early on an empty local DB; it is a real assertion wherever seed rows exist). Then `npx tsc -p tsconfig.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): row-scope loaders; move ownership context and pending uploads out of routers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Phase C — Procedure registry and enforcement

All 178 procedures are registered across Tasks 8–11 (63 + 62 + 12 hierarchy reads + 33 commercial + 8 admin/health = 178). Registry tests call `decide(path, rawInput, userFacts)` directly: it runs the real registry, row loaders and evaluators but **not** the handler, so tests never trigger GCS signing, deletes or other side effects. Task 6 already proved the middleware wiring.

### Task 8: Registry — Opportunity & Bid procedures (63)

**Files:**
- Create: `apps/api/src/auth/rbac/registry/builders.ts`
- Create: `apps/api/src/auth/rbac/registry/opportunity.ts`
- Modify: `apps/api/src/auth/rbac/registry/index.ts`
- Create: `apps/api/src/auth/rbac/registry/opportunity.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers (`read`, `readAny`, `create`, `write`, `remove`, `readRows`, `ROW_MODULES`), Task 7 loaders, Task 2 atom maps.
- Produces: `opportunityPolicy: Record<string, PolicyEntry>`; `patchAtoms(patch, resolve): string[]` (throws `DenyCall` on an unknown key); `bidRow(action, pick, atoms?)`, `oppRow(action, pick, atoms?)`; `ownershipAtoms(entityType, role): string[]`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/registry/opportunity.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { pool } from '../../../db.js'
import {
  addSalesPerson, addTeamMember, assignOwner, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail, setRole,
} from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { opportunityPolicy } from './opportunity.js'

/** True when RBAC would refuse `path` for `label`. */
async function denied(label: string, path: string, raw?: unknown): Promise<boolean> {
  return (await decide(path, raw, await loadUserFacts(rbacEmail(label)))).denial !== null
}
async function why(label: string, path: string, raw?: unknown): Promise<string | undefined> {
  return (await decide(path, raw, await loadUserFacts(rbacEmail(label)))).denial?.message
}

let salesId: string, rivalId: string
let own: { bidId: string | null; opportunityId: string }      // Bid Tracker, owned by `sales`, assigned to `pre` and `legal`
let pipe: { bidId: string | null; opportunityId: string }     // Pipeline, owned by `sales`
let other: { bidId: string | null; opportunityId: string }    // Bid Tracker, owned by someone else

beforeEach(async () => {
  await cleanupRbacFixtures()
  salesId = await addSalesPerson('sales')       // derives Sales from the roster
  rivalId = await addSalesPerson('rival')
  for (const role of ['bid', 'cxo', 'delivery', 'it', 'finance'] as const) await setRole(role, role)
  const pre = await addTeamMember('preSales', 'pre'); await setRole('pre', 'presales')
  const legal = await addTeamMember('legal', 'legal'); await setRole('legal', 'legal')
  await setRole('prefree', 'presales')           // Pre-sales with no roster slot: never "assigned"
  own = await makeBid({ geoSalesPersonId: salesId, preSalesPersonId: pre, legalPersonId: legal })
  pipe = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: salesId })
  other = await makeBid({ geoSalesPersonId: rivalId })
})
afterEach(cleanupRbacFixtures)

describe('registry coverage for this area', () => {
  it('registers exactly the 63 opportunity / bid procedures', () => {
    expect(Object.keys(opportunityPolicy).sort()).toEqual([
      'bidCorrigenda.create', 'bidCorrigenda.listForBid', 'bidCorrigenda.reviewChange',
      'bidCustomFields.archive', 'bidCustomFields.create', 'bidCustomFields.delete', 'bidCustomFields.list', 'bidCustomFields.reorder',
      'bidCustomFields.setValue', 'bidCustomFields.unarchive', 'bidCustomFields.update', 'bidCustomFields.valuesForBid',
      'bidMilestones.create', 'bidMilestones.delete', 'bidMilestones.listAll', 'bidMilestones.listForBid', 'bidMilestones.update',
      'bidSavedViews.create', 'bidSavedViews.delete', 'bidSavedViews.get', 'bidSavedViews.list', 'bidSavedViews.update',
      'bids.actionQueue.list', 'bids.archive', 'bids.create', 'bids.delete', 'bids.get', 'bids.getForOpportunity', 'bids.listForGrid',
      'bids.markVerified', 'bids.unarchive', 'bids.update',
      'documents.citations.create', 'documents.citations.delete', 'documents.citations.list', 'documents.confirmUpload', 'documents.delete',
      'documents.getDownloadUrl', 'documents.listFor', 'documents.requestUploadUrl',
      'followUps.create', 'followUps.delete', 'followUps.listForEntity', 'followUps.listOpen', 'followUps.setStatus',
      'opportunities.create', 'opportunities.delete', 'opportunities.get', 'opportunities.list', 'opportunities.listByDepartment',
      'opportunities.listStageChanges', 'opportunities.update',
      'ownership.assign', 'ownership.end', 'ownership.listAssignments', 'ownership.listFor', 'ownership.listOwnedBy',
      'ownership.resolveOwner', 'ownership.resolveOwners', 'ownership.transferBookOfBusiness',
      'protectedValues.freeze', 'protectedValues.listFor', 'protectedValues.unfreeze',
    ].sort())
  })
})

describe('reads', () => {
  it('every role with a role can read rows; a user with no role cannot', async () => {
    for (const label of ['sales', 'bid', 'cxo', 'delivery', 'it', 'finance', 'pre', 'legal']) expect(await denied(label, 'bids.listForGrid')).toBe(false)
    expect(await denied('nobody', 'bids.listForGrid')).toBe(true)
    expect(await denied('nobody', 'opportunities.list')).toBe(true)
  })
})

describe('bids.update — field level, scope and sheet moves', () => {
  it('Sales (S1) may not change stage or decision, even on an own row', async () => {
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(true)
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { decision: 'go' } })).toBe(true)
  })
  it('Bid (W) may change the stage; CXO may record only the Go/No-Go decision', async () => {
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(false)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { decision: 'no_go' } })).toBe(false)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(true)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { decision: 'no_go', stageKey: 'qualification' } })).toBe(true)
  })
  it('denies a patch that carries a key with no atom instead of ignoring it (Review Focus 2)', async () => {
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification', typo: 1 } })).toBe(true)
    expect(await why('bid', 'bids.update', { id: own.bidId, patch: { typo: 1 } })).toMatch(/cannot be edited/)
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: 'nonsense' })).toBe(true)
  })
  it('moving a row needs write on BOTH sheets, so a single role cannot move between Bid Tracker and Pipeline', async () => {
    // Sales: W·own on Pipeline and Campaign (own row) — a Pipeline → Campaign move is fine
    expect(await denied('sales', 'bids.update', { id: pipe.bidId, patch: { sheet: 'campaign' } })).toBe(false)
    // …but Bid Tracker is only Partial for Sales, so the source side refuses a move out of it
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { sheet: 'pipeline-funnel' } })).toBe(true)
    // Bid is W on Bid Tracker only; the destination refuses
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { sheet: 'campaign' } })).toBe(true)
  })
  it('a user holding BOTH Sales and Bid roles can move their own Pipeline row into Bid Tracker', async () => {
    const dual = await addSalesPerson('dual'); await setRole('dual', 'bid')
    const row = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: dual })
    expect(await denied('dual', 'bids.update', { id: row.bidId, patch: { sheet: 'bidTracker' } })).toBe(false)
  })
})

describe('opportunities.update — scope', () => {
  it('Sales is full-write on its own Pipeline rows only', async () => {
    expect(await denied('sales', 'opportunities.update', { id: pipe.opportunityId, patch: { valueAmount: '5', vertical: 'IT' } })).toBe(false)
    const rivalPipe = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: rivalId })
    expect(await denied('sales', 'opportunities.update', { id: rivalPipe.opportunityId, patch: { valueAmount: '5' } })).toBe(true)
  })
  it('on Bid Tracker rows Sales gets S1 only: client/value yes, identity and Tender ID no', async () => {
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { city: 'Pune', valueAmount: '9' } })).toBe(false)
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { opportunityName: 'x' } })).toBe(true)
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { gemTenderId: 'x' } })).toBe(true)
    expect(await denied('sales', 'opportunities.update', { id: other.opportunityId, patch: { city: 'Pune' } })).toBe(true)
  })
  it('assigned Pre-sales and Legal cannot edit opportunity data (P1 / L1 hold only the next action and custom fields)', async () => {
    expect(await denied('pre', 'opportunities.update', { id: own.opportunityId, patch: { valueAmount: '1' } })).toBe(true)
    expect(await denied('legal', 'opportunities.update', { id: own.opportunityId, patch: { city: 'x' } })).toBe(true)
  })
  it('ignores the echoed opportunityCode', async () => {
    expect(await denied('bid', 'opportunities.update', { id: own.opportunityId, patch: { opportunityCode: 'OPP-1', city: 'Pune' } })).toBe(false)
  })
  it('a Sales role with no roster row is read-only everywhere, with a clear message (Review Focus 3)', async () => {
    await setRole('norow', 'sales')
    expect(await denied('norow', 'bids.listForGrid')).toBe(false)
    expect(await why('norow', 'opportunities.update', { id: pipe.opportunityId, patch: { valueAmount: '5' } })).toMatch(/permission to edit Pipeline rows/)
  })
  it('a creator is "own" (gap A1)', async () => {
    await setRole('maker', 'sales')
    const made = await makeBid({ sheet: 'pipeline-funnel', createdBy: rbacEmail('maker') })
    expect(await denied('maker', 'opportunities.update', { id: made.opportunityId, patch: { valueAmount: '5' } })).toBe(false)
  })
})

describe('create / delete', () => {
  it('Sales and Bid may create bids; Legal may not', async () => {
    const raw = { newOpportunity: { opportunityName: 'x' }, department: { mode: 'existing', departmentId: randomUUID() } }
    expect(await denied('sales', 'bids.create', raw)).toBe(false)
    expect(await denied('bid', 'bids.create', raw)).toBe(false)
    expect(await denied('legal', 'bids.create', raw)).toBe(true)
  })
  it('creating a bid that also creates a department needs create on Customer Departments too (cross-module)', async () => {
    const raw = { newOpportunity: { opportunityName: 'x' }, department: { mode: 'create', name: 'D', parent: { mode: 'create', name: 'P', stateCode: 24 } } }
    expect(await denied('bid', 'bids.create', raw)).toBe(true)
    expect(await denied('sales', 'bids.create', raw)).toBe(false)
  })
  it('creating onto the Campaign sheet is judged on Campaign', async () => {
    expect(await denied('sales', 'bids.create', { newOpportunity: { opportunityName: 'x' }, sheet: 'campaign', department: { mode: 'existing', departmentId: randomUUID() } })).toBe(false)
    expect(await denied('bid', 'bids.create', { sheet: 'campaign', opportunityId: randomUUID() })).toBe(true)
  })
  it('only Bid may delete a bid or an opportunity', async () => {
    expect(await denied('bid', 'bids.delete', { id: other.bidId })).toBe(false)
    expect(await denied('sales', 'bids.delete', { id: own.bidId })).toBe(true)
    expect(await denied('sales', 'opportunities.delete', { id: own.opportunityId })).toBe(true)
  })
  it('archive, unarchive and verify are W-only atoms', async () => {
    expect(await denied('bid', 'bids.archive', { id: own.bidId })).toBe(false)
    expect(await denied('sales', 'bids.archive', { id: own.bidId })).toBe(true)
    expect(await denied('sales', 'bids.markVerified', { id: own.bidId })).toBe(true)
    expect(await denied('bid', 'bids.markVerified', { id: own.bidId })).toBe(false)
  })
})

describe('milestones and corrigenda (cross-module)', () => {
  async function submissionMilestone(bidId: string) {
    return (await pool.query(
      `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, source) VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline','manual') RETURNING id`, [bidId],
    )).rows[0].id as string
  }
  it('only Bid edits milestones', async () => {
    const id = await submissionMilestone(own.bidId!)
    expect(await denied('bid', 'bidMilestones.update', { id, patch: { label: 'x' } })).toBe(false)
    expect(await denied('sales', 'bidMilestones.update', { id, patch: { label: 'x' } })).toBe(true)
  })
  it('moving the Submission Deadline of a bid on another sheet also needs opp.dates there', async () => {
    const onTracker = await submissionMilestone(own.bidId!)
    const onPipeline = await submissionMilestone(pipe.bidId!)
    expect(await denied('bid', 'bidMilestones.update', { id: onTracker, patch: { dueAt: '2030-01-01' } })).toBe(false)
    expect(await denied('bid', 'bidMilestones.update', { id: onPipeline, patch: { dueAt: '2030-01-01' } })).toBe(true) // Bid is only R on Pipeline
    expect(await denied('bid', 'bidMilestones.update', { id: onPipeline, patch: { label: 'x' } })).toBe(false)        // a label edit touches no opportunity field
  })
  it('Legal can reject a corrigendum change but cannot accept one that rewrites the tender link', async () => {
    const off = appRouter.createCaller({}) // RBAC is off in tests unless a test turns it on
    await off.bidCorrigenda.create({ bidId: own.bidId!, corrigendumNumber: 1, changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://example.com' }] })
    const changeId = (await off.bidCorrigenda.listForBid({ bidId: own.bidId! }))[0].changes[0].id
    expect(await denied('legal', 'bidCorrigenda.reviewChange', { changeId, decision: 'rejected' })).toBe(false)
    expect(await denied('legal', 'bidCorrigenda.reviewChange', { changeId, decision: 'accepted' })).toBe(true)
    expect(await denied('bid', 'bidCorrigenda.reviewChange', { changeId, decision: 'accepted' })).toBe(false)
    expect(await denied('sales', 'bidCorrigenda.reviewChange', { changeId, decision: 'rejected' })).toBe(true)
  })
})

describe('ownership', () => {
  const assign = (entityType: string, entityId: string | null, role?: string) =>
    ({ entityType, entityId, salesPersonId: randomUUID(), role, startDate: '2026-01-01' })

  it('Solution Lead is read-only for EVERY role, including W roles', async () => {
    for (const label of ['cxo', 'sales', 'bid', 'it']) {
      expect(await denied(label, 'ownership.assign', assign('bid', own.bidId, 'solutionLead'))).toBe(true)
    }
    await assignOwner('bid', own.bidId!, salesId, 'solutionLead')
    const { id } = (await pool.query(`SELECT id FROM ownership_assignments WHERE entity_id=$1 AND role='solutionLead'`, [own.bidId])).rows[0]
    expect(await denied('cxo', 'ownership.end', { id, endDate: '2026-06-01' })).toBe(true)
  })
  it('Bid may assign the bid-level owner, but not an opportunity owner and not a delegate', async () => {
    expect(await denied('bid', 'ownership.assign', assign('bid', own.bidId))).toBe(false)
    expect(await denied('bid', 'ownership.assign', assign('opportunity', own.opportunityId))).toBe(true)
    expect(await denied('bid', 'ownership.assign', assign('bid', own.bidId, 'delegate'))).toBe(true)
  })
  it('Sales may reassign only entities it owns; CXO any', async () => {
    expect(await denied('sales', 'ownership.assign', assign('bid', own.bidId))).toBe(false)
    expect(await denied('sales', 'ownership.assign', assign('bid', other.bidId))).toBe(true)
    expect(await denied('cxo', 'ownership.assign', assign('bid', other.bidId))).toBe(false)
  })
  it('a book-of-business transfer is Sales-only from oneself; CXO from anyone', async () => {
    const t = (from: string) => ({ fromSalesPersonId: from, toSalesPersonId: randomUUID(), effectiveDate: '2026-06-01' })
    expect(await denied('sales', 'ownership.transferBookOfBusiness', t(salesId))).toBe(false)
    expect(await denied('sales', 'ownership.transferBookOfBusiness', t(rivalId))).toBe(true)
    expect(await denied('cxo', 'ownership.transferBookOfBusiness', t(rivalId))).toBe(false)
  })
  it('resolved owners are readable by anyone who can read rows, contacts or departments (gap A4)', async () => {
    expect(await denied('legal', 'ownership.resolveOwners', {})).toBe(false)  // Legal is N on the ownership module itself
    expect(await denied('legal', 'ownership.listAssignments')).toBe(true)
  })
})

describe('follow-ups, documents, protected values, columns, saved views', () => {
  it('bid next actions follow the row: assigned Pre-sales and Legal may, an unassigned Pre-sales may not', async () => {
    const raw = { entityType: 'bid', entityId: own.bidId, dueDate: '2030-01-01' }
    expect(await denied('pre', 'followUps.create', raw)).toBe(false)
    expect(await denied('legal', 'followUps.create', raw)).toBe(false)
    expect(await denied('prefree', 'followUps.create', raw)).toBe(true)
    expect(await denied('delivery', 'followUps.create', raw)).toBe(true)
    expect(await denied('bid', 'followUps.create', raw)).toBe(false)
  })
  it('contact follow-ups belong to Account Mapping: Sales may create, Legal may not', async () => {
    const raw = { entityType: 'contact', entityId: randomUUID(), dueDate: '2030-01-01' }
    expect(await denied('sales', 'followUps.create', raw)).toBe(false)
    expect(await denied('legal', 'followUps.create', raw)).toBe(true)
  })
  it('documents attach to bids only, and Pre-sales/Legal may upload only to rows they are assigned to', async () => {
    const upload = (entityType: string) => ({ entityType, entityId: own.bidId, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 })
    expect(await denied('bid', 'documents.requestUploadUrl', upload('widget'))).toBe(true)
    expect(await why('bid', 'documents.requestUploadUrl', upload('widget'))).toMatch(/bids/)
    expect(await denied('pre', 'documents.requestUploadUrl', upload('bid'))).toBe(false)
    expect(await denied('legal', 'documents.requestUploadUrl', upload('bid'))).toBe(false)
    expect(await denied('prefree', 'documents.requestUploadUrl', upload('bid'))).toBe(true)
    expect(await denied('it', 'documents.requestUploadUrl', upload('bid'))).toBe(true)
    expect(await denied('it', 'documents.listFor', { entityType: 'bid', entityId: own.bidId })).toBe(true) // IT is None on Tender documents
    expect(await denied('confirm-unknown', 'documents.confirmUpload', { uploadId: 'nope' })).toBe(true)
  })
  it('protected values: Bid freezes and unfreezes, everyone else reads; only bids have them', async () => {
    expect(await denied('bid', 'protectedValues.freeze', { entityType: 'bid', entityId: own.bidId, fieldKey: 'x' })).toBe(false)
    expect(await denied('sales', 'protectedValues.freeze', { entityType: 'bid', entityId: own.bidId, fieldKey: 'x' })).toBe(true)
    expect(await denied('bid', 'protectedValues.unfreeze', { entityType: 'opportunity', entityId: own.opportunityId, fieldKey: 'x', reason: 'r' })).toBe(true)
    expect(await denied('delivery', 'protectedValues.listFor', { entityType: 'bid', entityId: own.bidId })).toBe(false)
  })
  it('custom columns: Bid and IT manage the schema; values ride on the row (S1 / P1 / L1 hold bid.custom)', async () => {
    expect(await denied('bid', 'bidCustomFields.create', {})).toBe(false)
    expect(await denied('it', 'bidCustomFields.create', {})).toBe(false)
    expect(await denied('sales', 'bidCustomFields.create', {})).toBe(true)
    const v = (bidId: string | null) => ({ bidId, fieldId: randomUUID(), value: 'x' })
    expect(await denied('sales', 'bidCustomFields.setValue', v(own.bidId))).toBe(false)
    expect(await denied('sales', 'bidCustomFields.setValue', v(other.bidId))).toBe(true)
    expect(await denied('pre', 'bidCustomFields.setValue', v(own.bidId))).toBe(false)
    expect(await denied('cxo', 'bidCustomFields.setValue', v(own.bidId))).toBe(true)
  })
  it('saved views: personal for anyone who can read rows, global only for those who manage columns (gap A3)', async () => {
    expect(await denied('legal', 'bidSavedViews.create', { name: 'v', scope: 'personal' })).toBe(false)
    expect(await denied('legal', 'bidSavedViews.create', { name: 'v', scope: 'global' })).toBe(true)
    expect(await denied('bid', 'bidSavedViews.create', { name: 'v', scope: 'global' })).toBe(false)
    expect(await denied('legal', 'bidSavedViews.update', { id: 'allBids', patch: { name: 'x' } })).toBe(false) // system views: the handler refuses
    expect(await denied('legal', 'bidSavedViews.update', { id: randomUUID(), patch: { scope: 'global' } })).toBe(true)
  })
})

describe('System Admin (spec §3.4)', () => {
  beforeEach(() => makeSystemAdmin('root'))

  it('edits every field of every row, moves sheets, creates and deletes', async () => {
    expect(await denied('root', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification', decision: 'go', sheet: 'campaign', tenderLink: 'x' } })).toBe(false)
    expect(await denied('root', 'opportunities.update', { id: other.opportunityId, patch: { gemTenderId: 'x', opportunityName: 'y', submissionDate: '2030-01-01' } })).toBe(false)
    expect(await denied('root', 'bids.create', { newOpportunity: { opportunityName: 'x' }, sheet: 'campaign', department: { mode: 'create', name: 'D', parent: { mode: 'create', name: 'P', stateCode: 24 } } })).toBe(false)
    expect(await denied('root', 'bids.delete', { id: other.bidId })).toBe(false)
    expect(await denied('root', 'bids.markVerified', { id: other.bidId })).toBe(false)
    expect(await denied('root', 'bidCustomFields.create', {})).toBe(false)
    expect(await denied('root', 'protectedValues.freeze', { entityType: 'bid', entityId: own.bidId, fieldKey: 'x' })).toBe(false)
    expect(await denied('root', 'documents.requestUploadUrl', { entityType: 'bid', entityId: own.bidId, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 })).toBe(false)
  })
  it('manages ownership of any entity, but Solution Lead stays read-only even for System Admin', async () => {
    const assign = (entityType: string, entityId: string | null, role?: string) =>
      ({ entityType, entityId, salesPersonId: randomUUID(), role, startDate: '2026-01-01' })
    expect(await denied('root', 'ownership.assign', assign('opportunity', other.opportunityId))).toBe(false)
    expect(await denied('root', 'ownership.assign', assign('bid', other.bidId, 'delegate'))).toBe(false)
    expect(await denied('root', 'ownership.assign', assign('bid', own.bidId, 'solutionLead'))).toBe(true)
    await assignOwner('bid', own.bidId!, salesId, 'solutionLead')
    const { id } = (await pool.query(`SELECT id FROM ownership_assignments WHERE entity_id=$1 AND role='solutionLead'`, [own.bidId])).rows[0]
    expect(await denied('root', 'ownership.end', { id, endDate: '2026-06-01' })).toBe(true)
  })
  it('still judges a patch key with no atom as unauthorisable — System Admin is not a bypass for malformed input', async () => {
    expect(await denied('root', 'bids.update', { id: own.bidId, patch: { typo: 1 } })).toBe(true)
  })
})
```

(`confirm-unknown` is simply a label with no roster row and no roles.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/opportunity.test.ts`
Expected: FAIL — `Failed to resolve import "./opportunity.js"`.

- [ ] **Step 3: Implement**

`apps/api/src/auth/rbac/registry/builders.ts`:

```ts
import { atomsForPatch } from '@goms/domain'
import { DenyCall } from '../denial.js'
import { rowForBid, rowForOpportunity } from '../rows.js'
import type { Requirement } from './types.js'

/** patch → atoms, or refuse the whole call when a key has no atom (fail closed; zod would silently strip it). */
export function patchAtoms(patch: unknown, resolve: (key: string) => string | null | undefined): string[] {
  const atoms = atomsForPatch(patch, resolve)
  if (atoms === null) throw new DenyCall('That change includes a field that cannot be edited.')
  return atoms
}

type RowAction = 'update' | 'delete'

/** A write on one bid's row, authorised in the module of the sheet the bid lives on, with that row's scope facts. */
export const bidRow = (action: RowAction, pick: (raw: any) => unknown, atoms?: (raw: any) => string[]): Requirement =>
  async (raw) => {
    const row = await rowForBid(pick(raw))
    return { module: row?.module ?? 'opp.bidTracker', action, atoms: atoms?.(raw), row: row?.facts }
  }

/** Same, addressed by opportunity id (a bid-less opportunity is authorised as Bid Tracker). */
export const oppRow = (action: RowAction, pick: (raw: any) => unknown, atoms?: (raw: any) => string[]): Requirement =>
  async (raw) => {
    const row = await rowForOpportunity(pick(raw))
    return { module: row?.module ?? 'opp.bidTracker', action, atoms: atoms?.(raw), row: row?.facts }
  }
```

`apps/api/src/auth/rbac/registry/opportunity.ts`:

```ts
import {
  BID_PATCH_ATOMS, IGNORED_PATCH_KEYS, OPPORTUNITY_PATCH_ATOMS, isOwnedSheet, type ScopeFacts,
} from '@goms/domain'
import { pendingUploads } from '../../../lib/pendingUploads.js'
import { DenyCall } from '../denial.js'
import {
  assignmentInfo, corrigendumChangeInfo, milestoneInfo, rowForBid, rowForCitation, rowForDocument, rowForFollowUp,
  rowForOwnedEntity, rowForSalesPerson, savedViewScope, sheetModule,
} from '../rows.js'
import { bidRow, oppRow, patchAtoms } from './builders.js'
import { ROW_MODULES, create, read, readRows, remove, write } from './helpers.js'
import type { Check, PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

const bidPatch = (raw: any) => patchAtoms(raw?.patch, (k) => BID_PATCH_ATOMS[k] ?? null)
const oppPatch = (raw: any) =>
  patchAtoms(raw?.patch, (k) => (IGNORED_PATCH_KEYS.has(k) ? undefined : OPPORTUNITY_PATCH_ATOMS[k] ?? null))

// ---- bids ---------------------------------------------------------------------------------------------------

const sheetCreate: Requirement = (raw) => ({ module: sheetModule(raw?.sheet), action: 'create' })
const departmentCreate: Requirement = (raw) =>
  raw?.department?.mode === 'create' ? { module: 'am.departments', action: 'create' } : null

/** A sheet move also needs the move right on the DESTINATION sheet (the source side is checked by the patch atoms). */
const sheetMove: Requirement = async (raw) => {
  const dest = raw?.patch?.sheet
  if (!isOwnedSheet(dest)) return null
  const row = await rowForBid(raw?.id)
  return { module: sheetModule(dest), action: 'update', atoms: ['bid.move'], row: row?.facts }
}

const bidNextAction = async (bidId: unknown): Promise<Check> => {
  const row = await rowForBid(bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['bid.nextAction'], row: row?.facts }
}

const opportunityDatesOf = async (bidId: unknown): Promise<Check> => {
  const row = await rowForBid(bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['opp.dates'], row: row?.facts }
}

// ---- milestones: the Submission Deadline milestone also writes opportunities.submission_date -------------------

const submissionDateOnCreate: Requirement = (raw) => (raw?.key === 'submissionDeadline' ? opportunityDatesOf(raw?.bidId) : null)
const submissionDateSync = (applies: (raw: any) => boolean): Requirement => async (raw) => {
  const milestone = await milestoneInfo(raw?.id)
  return milestone?.key === 'submissionDeadline' && applies(raw) ? opportunityDatesOf(milestone.bidId) : null
}

// ---- corrigenda: an accepted change rewrites the tender link or a milestone (and maybe the opportunity date) -----

const acceptedChange = async (raw: any) => (raw?.decision === 'accepted' ? corrigendumChangeInfo(raw?.changeId) : null)
const corrigendumTenderLink: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  if (change?.fieldKey !== 'tenderLink') return null
  const row = await rowForBid(change.bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['opp.identity'], row: row?.facts }
}
const corrigendumMilestone: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  return change && change.fieldKey !== 'tenderLink' ? { module: 'bid.milestones', action: 'update' } : null
}
const corrigendumSubmissionDate: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  return change?.fieldKey === 'submissionDeadline' ? opportunityDatesOf(change.bidId) : null
}

// ---- saved views (gap A3) ------------------------------------------------------------------------------------

const viewIsGlobal = async (raw: any): Promise<boolean> =>
  raw?.scope === 'global' || raw?.patch?.scope === 'global' || (await savedViewScope(raw?.id)) === 'global'
const savedViewWrite: Requirement = async (raw) =>
  (await viewIsGlobal(raw)) ? { module: 'bid.columns', action: 'update' } : { module: 'opp.bidTracker', action: 'read', anyOf: ROW_MODULES }

// ---- documents & protected values attach to bids only ------------------------------------------------------------

const BID_ONLY = 'Documents can only be attached to bids.'
const documentRead = (raw: any): Check => {
  if (raw?.entityType !== 'bid') throw new DenyCall(BID_ONLY)
  return { module: 'bid.documents', action: 'read' }
}
const documentCreate = async (entityType: unknown, entityId: unknown): Promise<Check> => {
  if (entityType !== 'bid') throw new DenyCall(BID_ONLY)
  const row = await rowForBid(entityId)
  return { module: 'bid.documents', action: 'create', row: row?.facts }
}
const confirmUpload: Requirement = async (raw) => {
  const pending = pendingUploads.get(raw?.uploadId)
  if (!pending) throw new DenyCall('That upload was not found or has expired.')
  return documentCreate(pending.entityType, pending.entityId)
}
const citationWrite = (by: 'document' | 'citation'): Requirement => async (raw) => {
  const row: ScopeFacts | null = by === 'document' ? await rowForDocument(raw?.documentId) : await rowForCitation(raw?.id)
  return { module: 'bid.documents', action: 'update', atoms: ['doc.upload'], row: row ?? undefined }
}
const protectedValueRead = (raw: any): Check => {
  if (raw?.entityType !== 'bid') throw new DenyCall('Protected values apply to bids only.')
  return { module: 'bid.protected', action: 'read' }
}
const protectedValueWrite = (action: 'create' | 'delete'): Requirement => (raw) => {
  if (raw?.entityType !== 'bid') throw new DenyCall('Protected values apply to bids only.')
  return { module: 'bid.protected', action }
}

// ---- follow-ups: bid-typed ones are the bid's "next action" field; the rest belong to Account Mapping --------------

const followUpWrite = (action: 'update' | 'delete'): Requirement => async (raw) => {
  const followUp = await rowForFollowUp(raw?.id)
  if (followUp?.entityType === 'bid') return bidNextAction(followUp.entityId)
  return { module: 'am.followUps', action, row: followUp?.facts }
}

// ---- ownership: Solution Lead is frozen (read-only for every role in v1) ---------------------------------------------

/** Atoms for an ownership write. `ownership.solutionLead` is held by nobody, so it can never pass. */
export function ownershipAtoms(entityType: unknown, role: unknown): string[] {
  const r = role ?? 'owner'
  if (r === 'solutionLead') return ['ownership.solutionLead']
  if (r === 'owner' && entityType === 'bid') return ['ownership.bidEntity']
  return ['ownership.assign']
}
const ownershipWrite = (kind: 'assign' | 'end'): Requirement => async (raw) => {
  const info = kind === 'assign' ? { entityType: raw?.entityType, entityId: raw?.entityId, role: raw?.role } : await assignmentInfo(raw?.id)
  if (!info) return { module: 'am.ownership', action: 'update', atoms: ['ownership.assign'] }
  const row = await rowForOwnedEntity(info.entityType, info.entityId)
  return { module: 'am.ownership', action: 'update', atoms: ownershipAtoms(info.entityType, info.role), row: row ?? undefined }
}
const bookOfBusinessTransfer: Requirement = async (raw) => ({
  module: 'am.ownership', action: 'update', atoms: ['ownership.assign'], row: (await rowForSalesPerson(raw?.fromSalesPersonId)) ?? undefined,
})

export const opportunityPolicy: Record<string, PolicyEntry> = {
  // reads: any role that can read at least one of the three sheet modules
  ...same([
    'bids.listForGrid', 'bids.get', 'bids.getForOpportunity', 'bids.actionQueue.list',
    'opportunities.list', 'opportunities.listByDepartment', 'opportunities.get', 'opportunities.listStageChanges',
    'bidCustomFields.valuesForBid', 'bidSavedViews.list', 'bidSavedViews.get',
  ], readRows),

  'bids.create': { requirements: [sheetCreate, departmentCreate] },
  'bids.update': { requirements: [bidRow('update', (r) => r?.id, bidPatch), sheetMove] },
  ...same(['bids.archive', 'bids.unarchive'], bidRow('update', (r) => r?.id, () => ['bid.archive'])),
  'bids.markVerified': { requirements: [bidRow('update', (r) => r?.id, () => ['bid.verify'])] },
  'bids.delete': { requirements: [bidRow('delete', (r) => r?.id)] },

  'opportunities.create': { requirements: [create('opp.bidTracker')] },
  'opportunities.update': { requirements: [oppRow('update', (r) => r?.id, oppPatch)] },
  'opportunities.delete': { requirements: [oppRow('delete', (r) => r?.id)] },

  ...same(['bidMilestones.listForBid', 'bidMilestones.listAll'], read('bid.milestones')),
  'bidMilestones.create': { requirements: [create('bid.milestones'), submissionDateOnCreate] },
  'bidMilestones.update': { requirements: [write('bid.milestones'), submissionDateSync((r) => r?.patch?.dueAt !== undefined)] },
  'bidMilestones.delete': { requirements: [remove('bid.milestones'), submissionDateSync(() => true)] },

  'bidCorrigenda.listForBid': { requirements: [read('bid.corrigenda')] },
  'bidCorrigenda.create': { requirements: [create('bid.corrigenda')] },
  'bidCorrigenda.reviewChange': {
    requirements: [write('bid.corrigenda', ['corrigendum.review']), corrigendumTenderLink, corrigendumMilestone, corrigendumSubmissionDate],
  },

  'bidCustomFields.list': { requirements: [read('bid.columns')] },
  'bidCustomFields.create': { requirements: [create('bid.columns')] },
  ...same(['bidCustomFields.update', 'bidCustomFields.reorder', 'bidCustomFields.archive', 'bidCustomFields.unarchive'], write('bid.columns')),
  'bidCustomFields.delete': { requirements: [remove('bid.columns')] },
  'bidCustomFields.setValue': { requirements: [bidRow('update', (r) => r?.bidId, () => ['bid.custom'])] },

  ...same(['bidSavedViews.create', 'bidSavedViews.update', 'bidSavedViews.delete'], savedViewWrite),

  'documents.listFor': { requirements: [documentRead] },
  'documents.getDownloadUrl': { requirements: [read('bid.documents')] },
  'documents.requestUploadUrl': { requirements: [(raw) => documentCreate(raw?.entityType, raw?.entityId)] },
  'documents.confirmUpload': { requirements: [confirmUpload] },
  'documents.delete': { requirements: [remove('bid.documents')] },
  'documents.citations.list': { requirements: [read('bid.documents')] },
  'documents.citations.create': { requirements: [citationWrite('document')] },
  'documents.citations.delete': { requirements: [citationWrite('citation')] },

  'protectedValues.listFor': { requirements: [protectedValueRead] },
  'protectedValues.freeze': { requirements: [protectedValueWrite('create')] },
  'protectedValues.unfreeze': { requirements: [protectedValueWrite('delete')] },

  'followUps.listForEntity': {
    requirements: [(raw) => (raw?.entityType === 'bid'
      ? { module: 'opp.bidTracker', action: 'read', anyOf: ROW_MODULES }
      : { module: 'am.followUps', action: 'read' })],
  },
  'followUps.listOpen': { requirements: [read('am.followUps')] },
  'followUps.create': {
    requirements: [(raw) => (raw?.entityType === 'bid' ? bidNextAction(raw?.entityId) : { module: 'am.followUps', action: 'create' })],
  },
  'followUps.setStatus': { requirements: [followUpWrite('update')] },
  'followUps.delete': { requirements: [followUpWrite('delete')] },

  // ownership: the assignment history screens need the module; owner badges on rows only need to see the owner (gap A4)
  ...same(['ownership.listAssignments', 'ownership.listFor', 'ownership.listOwnedBy'], read('am.ownership')),
  ...same(['ownership.resolveOwner', 'ownership.resolveOwners'], (() => ({
    module: 'am.ownership', action: 'read', anyOf: ['am.ownership', ...ROW_MODULES, 'am.contacts', 'am.departments'],
  })) as Requirement),
  'ownership.assign': { requirements: [ownershipWrite('assign')] },
  'ownership.end': { requirements: [ownershipWrite('end')] },
  'ownership.transferBookOfBusiness': { requirements: [bookOfBusinessTransfer] },
}
```

Edit `apps/api/src/auth/rbac/registry/index.ts`:

```ts
import { opportunityPolicy } from './opportunity.js'
import type { PolicyEntry } from './types.js'

/** `'router.procedure'` → policy. Composed from the per-area modules (tasks 8–11); tests may add and remove keys. */
export const PROCEDURE_POLICY: Record<string, PolicyEntry> = { ...opportunityPolicy }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/opportunity.test.ts src/auth/rbac/guard.test.ts`
Expected: PASS. If an "allowed" assertion fails because a fixture insert violates a NOT NULL you could not see, fix the **fixture**, not the policy. Then `npx tsc -p tsconfig.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): register the opportunity, bid, ownership and follow-up procedures" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Registry — Account Mapping, Teams, search and audit (62 + 12 hierarchy reads)

**Files:**
- Create: `apps/api/src/auth/rbac/registry/masks.ts`
- Create: `apps/api/src/auth/rbac/registry/accountMapping.ts`
- Modify: `apps/api/src/auth/rbac/registry/index.ts`
- Modify: `apps/api/src/testHelpers/rbacFixtures.ts` (add `addNode`, `addEmployee`; extend cleanup)
- Create: `apps/api/src/auth/rbac/registry/accountMapping.test.ts`

**Interfaces:**
- Produces: `accountMappingPolicy: Record<string, PolicyEntry>` (employees 25, hierarchy 20, customers 5, sales 11, orgPeople 4, deliveryTeams 5, search 3, `auditLogs.list` 1 = 74); in `masks.ts`: `SEARCH_CATEGORY_MODULES`, `filterSearchResults(data, user)`, `redactSalesRoster(data, user)`, `maskAuditList(data, user)`, `auditReadRequirement`; fixtures `addNode(domain?, label?)`, `addEmployee(nodeId, label?)`.

- [ ] **Step 1: Extend the fixtures and write the failing test**

Append to `apps/api/src/testHelpers/rbacFixtures.ts`:

```ts
export async function addNode(domain: 'geo' | 'org' | 'sales' = 'org', label = 'node'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, sort_order, metadata)
     VALUES ($1, $2, NULL, 24, $3, 0, '{}') RETURNING id`,
    [domain, domain === 'geo' ? 'state' : 'department', `RBAC ${label}`],
  )
  return rows[0].id
}

export async function addEmployee(nodeId: string, label = 'emp'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO employees (code, name, designation, org_node_id) VALUES ($1, $2, 'Officer', $3) RETURNING id`,
    [`RBAC-${randomUUID().slice(0, 8)}`, `RBAC ${label}`, nodeId],
  )
  return rows[0].id
}
```

In `cleanupRbacFixtures()` add, **after** the opportunities delete and **before** `sales_persons`:

```ts
  await pool.query(`DELETE FROM employees WHERE name LIKE 'RBAC %'`)
  await pool.query(`DELETE FROM hierarchy_nodes WHERE name LIKE 'RBAC %'`)
```

`apps/api/src/auth/rbac/registry/accountMapping.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { SEARCH_CATEGORIES } from '@goms/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../../db.js'
import {
  addEmployee, addNode, addSalesPerson, assignOwner, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole,
} from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { accountMappingPolicy } from './accountMapping.js'
import { SEARCH_CATEGORY_MODULES, filterSearchResults, maskAuditList, redactSalesRoster } from './masks.js'

const facts = async (label: string) => loadUserFacts(rbacEmail(label))
const denied = async (label: string, path: string, raw?: unknown) => (await decide(path, raw, await facts(label))).denial !== null

let salesId: string, rivalId: string, nodeId: string, geoId: string, empId: string
beforeEach(async () => {
  await cleanupRbacFixtures()
  salesId = await addSalesPerson('sales'); rivalId = await addSalesPerson('rival')
  for (const role of ['bid', 'cxo', 'delivery', 'it', 'finance', 'legal', 'presales'] as const) await setRole(role, role)
  nodeId = await addNode('org', 'dept'); geoId = await addNode('geo', 'state')
  empId = await addEmployee(nodeId)
})
afterEach(cleanupRbacFixtures)

describe('coverage', () => {
  it('registers employees (25), hierarchy (20), customers (5), sales (11), orgPeople (4), deliveryTeams (5), search (3) and auditLogs.list', () => {
    const keys = Object.keys(accountMappingPolicy)
    const count = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).length
    expect(count('employees.')).toBe(25)
    expect(count('hierarchy.')).toBe(20)
    expect(count('customers.')).toBe(5)
    expect(count('sales.')).toBe(11)
    expect(count('orgPeople.')).toBe(4)
    expect(count('deliveryTeams.')).toBe(5)
    expect(count('search.')).toBe(3)
    expect(keys).toContain('auditLogs.list')
    expect(keys).toHaveLength(74)
  })
})

describe('People & Contacts vs Customer Departments vs Company Org Structure are independent (decision 5)', () => {
  it('Sales may edit contacts and departments but never the company org chart', async () => {
    expect(await denied('sales', 'employees.update', { id: empId, patch: {} })).toBe(false)
    expect(await denied('sales', 'hierarchy.updateNode', { id: nodeId, patch: { name: 'x' } })).toBe(false)
    expect(await denied('sales', 'orgPeople.update', { id: randomUUID(), patch: {} })).toBe(true)
  })
  it('CXO edits the org chart but is only a reader of contacts and departments', async () => {
    expect(await denied('cxo', 'orgPeople.create', {})).toBe(false)
    expect(await denied('cxo', 'employees.update', { id: empId, patch: {} })).toBe(true)
    expect(await denied('cxo', 'hierarchy.updateNode', { id: nodeId, patch: { name: 'x' } })).toBe(true)
  })
  it('deleting contacts or departments is IT-only; a merge counts as a delete', async () => {
    expect(await denied('sales', 'employees.delete', { id: empId })).toBe(true)
    expect(await denied('it', 'employees.delete', { id: empId })).toBe(false)
    expect(await denied('sales', 'employees.merge', {})).toBe(true)
    expect(await denied('sales', 'hierarchy.deleteNode', { id: nodeId })).toBe(true)
    expect(await denied('it', 'hierarchy.deleteNode', { id: nodeId })).toBe(false)
  })
  it('re-posting a contact (employees.transfers.transfer) needs BOTH contacts and departments (cross-module)', async () => {
    expect(await denied('sales', 'employees.transfers.transfer', {})).toBe(false)
    expect(await denied('it', 'employees.transfers.transfer', {})).toBe(true)
  })
})

describe('hierarchy: one router, three domains', () => {
  it('createNode / updateNode are judged on the node domain', async () => {
    expect(await denied('it', 'hierarchy.createNode', { domain: 'geo' })).toBe(false)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'geo' })).toBe(true)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org' })).toBe(false)
    expect(await denied('it', 'hierarchy.updateNode', { id: geoId, patch: {} })).toBe(false)
    expect(await denied('sales', 'hierarchy.updateNode', { id: geoId, patch: {} })).toBe(true)
  })
  it('refuses an unknown domain or a missing node rather than guessing', async () => {
    expect(await denied('cxo', 'hierarchy.createNode', { domain: 'moon' })).toBe(true)
    expect(await denied('cxo', 'hierarchy.deleteNode', { id: randomUUID() })).toBe(true)
  })
  it('reads resolve by domain: a no-role user can read geography but not departments', async () => {
    expect(await denied('nobody', 'hierarchy.listStates')).toBe(false)
    expect(await denied('nobody', 'hierarchy.getNode', { id: geoId })).toBe(false)
    expect(await denied('nobody', 'hierarchy.getNode', { id: nodeId })).toBe(true)
    expect(await denied('nobody', 'hierarchy.listDepartments')).toBe(true)
    expect(await denied('delivery', 'hierarchy.listOrgRoots', { stateCode: 24 })).toBe(false)
  })
})

describe('meetings and the Sales roster (own scope)', () => {
  it('only Sales and read-roles see meetings; Legal, IT and Finance do not', async () => {
    expect(await denied('sales', 'employees.timeline.listAll')).toBe(false)
    for (const label of ['legal', 'it', 'finance']) expect(await denied(label, 'employees.timeline.listAll')).toBe(true)
  })
  it('Sales edits a meeting it created or attends or whose contact it owns, not someone else\'s', async () => {
    const mine = (await pool.query(
      `INSERT INTO timeline_events (employee_id, type, title, date, created_by) VALUES ($1,'meeting','m','2026-01-01',$2) RETURNING id`, [empId, rbacEmail('sales')],
    )).rows[0].id
    const theirs = (await pool.query(
      `INSERT INTO timeline_events (employee_id, type, title, date, created_by) VALUES ($1,'meeting','m','2026-01-01','rbac-rival@amnex.com') RETURNING id`, [empId],
    )).rows[0].id
    expect(await denied('sales', 'employees.timeline.update', { id: mine, patch: { title: 'x' } })).toBe(false)
    expect(await denied('sales', 'employees.timeline.update', { id: theirs, patch: { title: 'x' } })).toBe(true)
    expect(await denied('sales', 'employees.timeline.delete', { id: theirs })).toBe(true)
    await assignOwner('contact', empId, salesId)
    expect(await denied('sales', 'employees.timeline.update', { id: theirs, patch: { title: 'x' } })).toBe(false) // now owns the contact
  })
  it('Sales edits only its own roster profile fields; CXO edits the roster', async () => {
    expect(await denied('sales', 'sales.update', { id: salesId, patch: { mobile: '1', photoUrl: 'u' } })).toBe(false)
    expect(await denied('sales', 'sales.update', { id: salesId, patch: { officialEmail: 'x@amnex.com' } })).toBe(true)
    expect(await denied('sales', 'sales.update', { id: rivalId, patch: { mobile: '1' } })).toBe(true)
    expect(await denied('cxo', 'sales.update', { id: rivalId, patch: { officialEmail: 'x@amnex.com' } })).toBe(false)
    expect(await denied('sales', 'sales.setStatus', { id: salesId, status: 'inactive' })).toBe(true)
  })
  it('roster names are readable by anyone who can read rows, but personal data is redacted for roles without Sales Team read (gap A4)', async () => {
    expect(await denied('legal', 'sales.listPersons')).toBe(false)
    const person = { id: salesId, name: 'A', officialEmail: 'a@amnex.com', personalEmail: 'p@x', mobile: '9', notes: 'n', photoUrl: null, status: 'active' }
    expect(redactSalesRoster([person], await facts('legal'))).toEqual([expect.objectContaining({ name: 'A', officialEmail: 'a@amnex.com', personalEmail: '', mobile: '', notes: '' })])
    expect(redactSalesRoster([person], await facts('cxo'))).toEqual([person])
  })
})

describe('search and audit masks', () => {
  it('knows a module for every search category (a new category must be classified)', () => {
    for (const c of SEARCH_CATEGORIES) expect(Object.keys(SEARCH_CATEGORY_MODULES), c.key).toContain(c.key)
  })
  it('drops results from modules the caller cannot read, and hides an unknown category', async () => {
    const results = [
      { category: 'employee', id: '1' }, { category: 'meeting', id: '2' }, { category: 'salesPerson', id: '3' }, { category: 'mystery', id: '4' },
    ]
    // Legal reads People & Contacts but is None on Meetings and the Sales Team, and 'mystery' is not a known category
    const legal = filterSearchResults(results, await facts('legal')) as { category: string }[]
    expect(legal.map((r) => r.category)).toEqual(['employee'])
    const cxo = filterSearchResults(results, await facts('cxo')) as { category: string }[]
    expect(cxo.map((r) => r.category).sort()).toEqual(['employee', 'meeting', 'salesPerson'])
  })
  it('search requires being able to read at least something; relationship analytics is Operational analytics', async () => {
    expect(await denied('nobody', 'search.search', { query: 'x' })).toBe(false) // Geography baseline counts
    expect(await denied('sales', 'search.relationshipAnalytics')).toBe(false)
    expect(await denied('nobody', 'search.relationshipAnalytics')).toBe(true)
  })
  it('blanks old/new values of restricted SKU fields in audit entries', async () => {
    const entries = [{ entityType: 'sku', field: 'hardwareCost', oldValue: '1', newValue: '2' }, { entityType: 'sku', field: 'listPrice', oldValue: '1', newValue: '2' }]
    const masked = maskAuditList(entries, await facts('it')) as any[]
    expect(masked[0]).toMatchObject({ oldValue: '', newValue: '', masked: true })
    expect(masked[1]).toMatchObject({ oldValue: '1', newValue: '2' })
    expect(maskAuditList(entries, await facts('finance'))).toEqual(entries)
  })
  it('the global audit feed is for CXO and IT; a scoped query follows the entity module', async () => {
    expect(await denied('cxo', 'auditLogs.list', {})).toBe(false)
    expect(await denied('sales', 'auditLogs.list', {})).toBe(true)
    expect(await denied('sales', 'auditLogs.list', { entityType: 'contact' })).toBe(false)
    expect(await denied('legal', 'auditLogs.list', { entityType: 'sku' })).toBe(true)
    expect(await denied('legal', 'auditLogs.list', { entityType: 'widget' })).toBe(true) // unknown entity types need the global feed
  })
})

describe('System Admin (spec §3.4)', () => {
  beforeEach(() => makeSystemAdmin('root'))

  it('administers contacts, departments, geography, the Sales Team, the org chart, customers and the audit feed', async () => {
    expect(await denied('root', 'employees.merge', {})).toBe(false)
    expect(await denied('root', 'employees.delete', { id: empId })).toBe(false)
    expect(await denied('root', 'employees.transfers.transfer', {})).toBe(false)
    expect(await denied('root', 'employees.timeline.add', {})).toBe(false)
    expect(await denied('root', 'hierarchy.createNode', { domain: 'geo' })).toBe(false)
    expect(await denied('root', 'hierarchy.deleteNode', { id: nodeId })).toBe(false)
    expect(await denied('root', 'sales.update', { id: rivalId, patch: { officialEmail: 'x@amnex.com' } })).toBe(false)
    expect(await denied('root', 'sales.setStatus', { id: rivalId, status: 'inactive' })).toBe(false)
    expect(await denied('root', 'sales.create', {})).toBe(false)
    expect(await denied('root', 'orgPeople.create', {})).toBe(false)
    expect(await denied('root', 'orgPeople.delete', { id: randomUUID() })).toBe(false)
    expect(await denied('root', 'customers.delete', { id: randomUUID() })).toBe(false)
    expect(await denied('root', 'auditLogs.list', {})).toBe(false)
    expect(await denied('root', 'search.relationshipAnalytics')).toBe(false)
  })
  it('sees unredacted roster data, unmasked SKU audit values and every search category', async () => {
    const root = await facts('root')
    const person = { id: salesId, name: 'A', officialEmail: 'a@amnex.com', personalEmail: 'p@x', mobile: '9', notes: 'n', photoUrl: null, status: 'active' }
    expect(redactSalesRoster([person], root)).toEqual([person])
    const entries = [{ entityType: 'sku', field: 'hardwareCost', oldValue: '1', newValue: '2' }]
    expect(maskAuditList(entries, root)).toEqual(entries)
    const results = [{ category: 'employee', id: '1' }, { category: 'meeting', id: '2' }, { category: 'salesPerson', id: '3' }]
    expect((filterSearchResults(results, root) as unknown[]).length).toBe(3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/accountMapping.test.ts`
Expected: FAIL — `Failed to resolve import "./accountMapping.js"`.

- [ ] **Step 3: Implement**

`apps/api/src/auth/rbac/registry/masks.ts`:

```ts
import {
  accessFor, maskAuditEntry, redactSalesPerson, type PolicyModuleKey, type UserFacts,
} from '@goms/domain'
import { ROW_MODULES } from './helpers.js'
import type { Check, Requirement } from './types.js'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const canRead = (user: UserFacts, module: PolicyModuleKey) => accessFor(user, module).level !== 'N'

/** Search category → the modules that make it visible (SEARCH_CATEGORIES keys in packages/domain/src/search.ts). */
export const SEARCH_CATEGORY_MODULES: Record<string, PolicyModuleKey[]> = {
  department: ['am.departments'], office: ['am.departments'], employee: ['am.contacts'], meeting: ['am.meetings'],
  geography: ['am.geography'], work: ROW_MODULES, salesPerson: ['team.sales'],
}

/** Removes search results (and related-record groups) whose category the caller cannot read. An unknown category is hidden. */
export function filterSearchResults(data: unknown, user: UserFacts): unknown {
  const visible = (category: unknown) => {
    const modules = typeof category === 'string' ? SEARCH_CATEGORY_MODULES[category] : undefined
    return !!modules && modules.some((m) => canRead(user, m))
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter((i) => !(isRecord(i) && 'category' in i) || visible(i.category)).map(walk)
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    return value
  }
  return walk(data)
}

/** Roster rows for roles that can read opportunity rows but not the Sales Team module: names stay, personal data goes (gap A4). */
export function redactSalesRoster(data: unknown, user: UserFacts): unknown {
  if (canRead(user, 'team.sales')) return data
  if (Array.isArray(data)) return data.map((p) => (isRecord(p) ? redactSalesPerson(p) : p))
  return isRecord(data) ? redactSalesPerson(data) : data
}

export function maskAuditList(data: unknown, user: UserFacts): unknown {
  return Array.isArray(data) ? data.map((e) => (isRecord(e) ? maskAuditEntry(e as any, user.roles) : e)) : data
}

/** Which modules make an audit entry of this entity type readable. */
const AUDIT_ENTITY_MODULES: Record<string, PolicyModuleKey[]> = {
  bid: ROW_MODULES, opportunity: ROW_MODULES, bidCorrigendum: ROW_MODULES, bidCustomFieldValue: ROW_MODULES, bidSavedView: ROW_MODULES,
  bidCustomField: ['bid.columns'], contact: ['am.contacts'], orgNode: ['am.departments'],
  sku: ['com.skus'], boq: ['com.boqs'], boqLineItem: ['com.boqs'], feature: ['com.masters'],
}

/** A scoped audit query follows the entity's module; the global feed (no entity type, or an unknown one) needs `admin.audit`. */
export const auditReadRequirement: Requirement = (raw): Check => {
  const modules = typeof raw?.entityType === 'string' ? AUDIT_ENTITY_MODULES[raw.entityType] : undefined
  return modules ? { module: modules[0], action: 'read', anyOf: modules } : { module: 'admin.audit', action: 'read' }
}
```

`apps/api/src/auth/rbac/registry/accountMapping.ts`:

```ts
import { salesPersonPatchAtom, type PolicyModuleKey } from '@goms/domain'
import { DenyCall } from '../denial.js'
import { domainOfNode, rowForSalesPerson, rowForTimelineEvent } from '../rows.js'
import { patchAtoms } from './builders.js'
import { ROW_MODULES, create, read, readAny, remove, write } from './helpers.js'
import { auditReadRequirement, filterSearchResults, maskAuditList, redactSalesRoster } from './masks.js'
import type { PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

/** hierarchy_nodes.domain → the module that governs it. */
function moduleForDomain(domain: unknown): PolicyModuleKey {
  if (domain === 'geo') return 'am.geography'
  if (domain === 'org') return 'am.departments'
  if (domain === 'sales') return 'team.sales'
  throw new DenyCall('Unknown hierarchy domain.')
}
const nodeAction = (action: 'read' | 'create' | 'update' | 'delete', pick: (raw: any) => unknown): Requirement =>
  async (raw) => ({ module: moduleForDomain(await domainOfNode(pick(raw))), action })

const meetingWrite = (action: 'update' | 'delete'): Requirement => async (raw) => ({
  module: 'am.meetings', action, row: (await rowForTimelineEvent(raw?.id)) ?? undefined,
})

const salesProfileWrite: Requirement = async (raw) => ({
  module: 'team.sales', action: 'update', atoms: patchAtoms(raw?.patch, salesPersonPatchAtom),
  row: (await rowForSalesPerson(raw?.id)) ?? undefined,
})

/** Row screens need salesperson names even where the Sales Team module itself is None (gap A4). */
const rosterRead = readAny('team.sales', ...ROW_MODULES, 'am.contacts')

export const accountMappingPolicy: Record<string, PolicyEntry> = {
  // ---- People & Contacts
  ...same([
    'employees.listUnder', 'employees.listDirect', 'employees.listByState', 'employees.listAll', 'employees.listDepartments',
    'employees.get', 'employees.directReports', 'employees.reportingChain', 'employees.listMergeAudit', 'employees.transfers.listForEmployee',
  ], read('am.contacts')),
  'employees.create': { requirements: [create('am.contacts')] },
  'employees.import': { requirements: [create('am.contacts')] },
  ...same(['employees.update', 'employees.setManager', 'employees.addCharge', 'employees.removeCharge'], write('am.contacts')),
  'employees.delete': { requirements: [remove('am.contacts')] },
  'employees.merge': { requirements: [write('am.contacts'), remove('am.contacts')] },
  'employees.transfers.transfer': { requirements: [write('am.contacts'), write('am.departments')] },

  // ---- Meetings
  ...same(['employees.timeline.listAll', 'employees.timeline.listForEmployee'], read('am.meetings')),
  'employees.timeline.add': { requirements: [create('am.meetings')] },
  ...same(['employees.timeline.update', 'employees.timeline.setAttended'], meetingWrite('update')),
  'employees.timeline.delete': { requirements: [meetingWrite('delete')] },

  // ---- hierarchy: geography / customer departments / (sales) by node domain
  ...same(['hierarchy.listStates', 'hierarchy.getState', 'hierarchy.geoRoot'], read('am.geography')),
  ...same(['hierarchy.listOrgRoots', 'hierarchy.listDepartments', 'hierarchy.listPostingNodes'], read('am.departments')),
  'hierarchy.getNode': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.listChildren': { requirements: [nodeAction('read', (r) => r?.parentId)] },
  'hierarchy.breadcrumb': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.childCount': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.childCounts': { requirements: [nodeAction('read', (r) => r?.parentId)] },
  'hierarchy.moveTargets': { requirements: [nodeAction('read', (r) => r?.nodeId)] },
  'hierarchy.createNode': { requirements: [(raw) => ({ module: moduleForDomain(raw?.domain), action: 'create' })] },
  'hierarchy.duplicateNode': { requirements: [nodeAction('create', (r) => r?.id)] },
  'hierarchy.importChildren': { requirements: [nodeAction('create', (r) => r?.parentId)] },
  ...same(['hierarchy.updateNode', 'hierarchy.setNodeStatus'], nodeAction('update', (r) => r?.id)),
  'hierarchy.moveNode': { requirements: [nodeAction('update', (r) => r?.id)] },
  'hierarchy.reorderNode': { requirements: [nodeAction('update', (r) => r?.id)] },
  'hierarchy.deleteNode': { requirements: [nodeAction('delete', (r) => r?.id)] },

  // ---- Customers (API only)
  ...same(['customers.list', 'customers.get'], read('am.customers')),
  'customers.create': { requirements: [create('am.customers')] },
  'customers.update': { requirements: [write('am.customers')] },
  'customers.delete': { requirements: [remove('am.customers')] },

  // ---- Sales Team
  ...Object.fromEntries(['sales.listPersons', 'sales.getPerson', 'sales.currentPostings'].map((p) => [p, { requirements: [rosterRead], mask: redactSalesRoster }])),
  'sales.listPostings': { requirements: [rosterRead] },
  'sales.create': { requirements: [create('team.sales')] },
  'sales.update': { requirements: [salesProfileWrite] },
  ...same(['sales.setStatus', 'sales.transfer', 'sales.updatePostingDates', 'sales.updatePostingManager'], write('team.sales', ['sales.roster'])),
  'sales.delete': { requirements: [remove('team.sales')] },

  // ---- Company Org Structure and the team rosters mirrored from it
  ...same(['orgPeople.list', 'deliveryTeams.list'], read('team.org')),
  ...same(['orgPeople.create', 'deliveryTeams.create'], create('team.org')),
  ...same(['orgPeople.update', 'deliveryTeams.update', 'deliveryTeams.setStatus'], write('team.org')),
  ...same(['orgPeople.delete', 'deliveryTeams.delete'], remove('team.org')),

  // ---- search: visible per category; relationship analytics is Operational analytics (gap A5)
  ...Object.fromEntries(['search.search', 'search.relatedRecords'].map((p) => [p, {
    requirements: [readAny('am.contacts', 'am.departments', 'am.geography', 'am.meetings', 'team.sales', ...ROW_MODULES)],
    mask: filterSearchResults,
  }])),
  'search.relationshipAnalytics': { requirements: [read('an.operational')] },

  // ---- audit logs
  'auditLogs.list': { requirements: [auditReadRequirement], mask: maskAuditList },
}
```

Edit `registry/index.ts`:

```ts
import { accountMappingPolicy } from './accountMapping.js'
import { opportunityPolicy } from './opportunity.js'
import type { PolicyEntry } from './types.js'

export const PROCEDURE_POLICY: Record<string, PolicyEntry> = { ...opportunityPolicy, ...accountMappingPolicy }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry`
Expected: PASS for both registry test files. `npx tsc -p tsconfig.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): register Account Mapping, Teams, search and audit procedures with masks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Registry — Commercial procedures and SKU read masking (33)

**Files:**
- Create: `apps/api/src/auth/rbac/registry/commercial.ts`
- Modify: `apps/api/src/auth/rbac/registry/masks.ts` (add `maskSkuResponse`)
- Modify: `apps/api/src/auth/rbac/registry/index.ts`
- Create: `apps/api/src/auth/rbac/registry/commercial.test.ts`

**Interfaces:**
- Produces: `commercialPolicy` (masters 8, skus 5, bom 5, boq 14, `commercial.auditLogs.list` 1 = 33); `maskSkuResponse(data, user)`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/registry/commercial.test.ts`:

```ts
import { SKU_COST_FIELDS } from '@goms/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { pool } from '../../../db.js'
import { contextForEmail } from '../../../testHelpers/authTestHelpers.js'
import { cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { commercialPolicy } from './commercial.js'

const facts = (label: string) => loadUserFacts(rbacEmail(label))
const denied = async (label: string, path: string, raw?: unknown) => (await decide(path, raw, await facts(label))).denial !== null

beforeEach(async () => {
  await cleanupRbacFixtures()
  for (const role of ['presales', 'finance', 'cxo', 'sales', 'bid', 'legal', 'delivery', 'it'] as const) await setRole(role, role)
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE
  await cleanupRbacFixtures()
})

describe('coverage', () => {
  it('registers 33 commercial procedures', () => { expect(Object.keys(commercialPolicy)).toHaveLength(33) })
})

describe('ownership of commercial data (decision 3)', () => {
  it('Pre-sales owns reference masters, SKUs and BOQs', async () => {
    expect(await denied('presales', 'commercial.masters.create', { key: 'verticals', input: {} })).toBe(false)
    expect(await denied('presales', 'commercial.skus.create', {})).toBe(false)
    expect(await denied('presales', 'commercial.boq.create', {})).toBe(false)
    expect(await denied('presales', 'commercial.boq.addLineItem', {})).toBe(false)
  })
  it('Finance controls tax classes and currencies — and only those masters', async () => {
    expect(await denied('finance', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(false)
    expect(await denied('finance', 'commercial.masters.setActive', { key: 'currencies', id: 'x', active: false })).toBe(false)
    expect(await denied('finance', 'commercial.masters.update', { key: 'verticals', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'verticals', id: 'x', patch: {} })).toBe(false)
  })
  it('CXO owns the Approval Matrix; Finance and Pre-sales only read it', async () => {
    expect(await denied('cxo', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(false)
    expect(await denied('finance', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(true)
    expect(await denied('finance', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(false)
    expect(await denied('presales', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(false)
    expect(await denied('sales', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(true)
  })
  it('Finance edits SKU cost / floor / tax fields and nothing else; Pre-sales cannot edit those after creation', async () => {
    expect(await denied('finance', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, floorPrice: 2, taxClassId: 'y' } })).toBe(false)
    expect(await denied('finance', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, listPrice: 5 } })).toBe(true)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { listPrice: 5, name: 'n' } })).toBe(false)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1 } })).toBe(true)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { internalPrice: 1 } })).toBe(true)
  })
  it('a role cannot edit a field it cannot read', async () => {
    expect(await denied('sales', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1 } })).toBe(true)
  })
  it('BOQ approve / reject is CXO-only; Pre-sales edits lines; Finance only reads', async () => {
    expect(await denied('cxo', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(false)
    expect(await denied('presales', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(true)
    expect(await denied('presales', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'submitted', changeReason: 'ok' })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'submitted', changeReason: 'ok' })).toBe(true)
    expect(await denied('cxo', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved' } })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.updateLineItem', { id: 'x', patch: { quantity: 3 } })).toBe(true)
    expect(await denied('presales', 'commercial.boq.updateLineItem', { id: 'x', patch: { quantity: 3 } })).toBe(false)
    expect(await denied('presales', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved' } })).toBe(true)
    expect(await denied('finance', 'commercial.boq.get', { id: 'x' })).toBe(false)
    expect(await denied('finance', 'commercial.boq.update', { id: 'x', patch: {} })).toBe(true)
  })
  it('reading BOQs implies read of SKUs and reference masters (gap A2), but not the approval matrix', async () => {
    expect(await denied('bid', 'commercial.skus.list')).toBe(false)
    expect(await denied('bid', 'commercial.masters.list', { key: 'currencies' })).toBe(false)
    expect(await denied('bid', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(true)
    expect(await denied('legal', 'commercial.skus.list')).toBe(true)
    expect(await denied('delivery', 'commercial.boq.list')).toBe(true)
  })
  it('only Pre-sales (and System Admin) delete commercial records', async () => {
    expect(await denied('presales', 'commercial.boq.delete', { id: 'x' })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.delete', { id: 'x' })).toBe(true)
  })
})

describe('System Admin (spec §3.4)', () => {
  beforeEach(() => makeSystemAdmin('root'))

  it('administers every commercial area: masters (incl. Finance-controlled and the approval matrix), SKUs, BOQs', async () => {
    expect(await denied('root', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.update', { key: 'currencies', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.delete', { key: 'verticals', id: 'x' })).toBe(false)
    expect(await denied('root', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, floorPrice: 2, internalPrice: 3, taxClassId: 'y', listPrice: 5 } })).toBe(false)
    expect(await denied('root', 'commercial.skus.delete', { id: 'x' })).toBe(false)
    expect(await denied('root', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(false)
    expect(await denied('root', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved', quantity: 3 } })).toBe(false)
    expect(await denied('root', 'commercial.boq.delete', { id: 'x' })).toBe(false)
  })
  it('still refuses a SKU patch key with no atom (not a bypass for malformed input)', async () => {
    expect(await denied('root', 'commercial.boq.updateLineItem', { id: 'x', patch: 'nonsense' })).toBe(true)
  })
})

describe('server-side read masking — sentinel golden test', () => {
  const COST = [7001, 7002, 7003, 7004, 7005, 7006, 7007, 7008]
  const FLOOR = { floorPrice: 7101, minimumAllowedPrice: 7102, internalPrice: 7103 }
  let skuId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    const off = appRouter.createCaller({}) // RBAC off: build the fixture
    const m = (key: string, input: any) => off.commercial.masters.create({ key: key as any, input })
    const vertical = await m('verticals', { code: 'GOV', name: 'Government', description: '' })
    const product = await m('products', { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id })
    const module_ = await m('modules', { code: 'ACCT', name: 'Accounts', description: '', productId: product.id })
    const feature = await m('features', { code: 'F1', name: 'F1', description: '', moduleId: module_.id, status: 'new' })
    const category = await m('skuCategories', { code: 'STD', name: 'Standard', description: '' })
    const uom = await m('unitsOfMeasure', { code: 'LIC', name: 'License', description: '' })
    const currency = await m('currencies', { code: 'INR', name: 'Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true })
    const taxClass = await m('taxClasses', { code: 'GST18', name: 'GST', description: '', ratePct: 18 })
    const billingType = await m('billingTypes', { code: 'OT', name: 'One-Time', description: '' })
    await m('productEditions', { code: 'STD', name: 'Standard', description: '' }) // skus.create resolves "the" standard edition by this code
    const sku = await off.commercial.skus.create({
      name: 'Sentinel', categoryId: category.id, featureId: feature.id, uomId: uom.id, currencyId: currency.id, taxClassId: taxClass.id,
      billingTypeId: billingType.id, activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: COST[0], implementationCostPerMM: COST[1], integrationCost: COST[2], thirdPartyCost: COST[3],
      hardwareCost: COST[4], cloudCost: COST[5], supportCost: COST[6], trainingCost: COST[7],
      ...FLOOR, partnerPrice: 90, governmentPrice: 91, enterprisePrice: 92, corporatePrice: 93, listPrice: 100,
    })
    skuId = sku.id
  })

  const SENTINELS = [...COST, ...Object.values(FLOOR)].map(String)
  const leaks = (value: unknown) => SENTINELS.filter((s) => JSON.stringify(value).includes(s))
  const as = (label: string) => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    return appRouter.createCaller(contextForEmail(rbacEmail(label)))
  }

  // Sales reads SKUs directly; Bid reads them through the BOQ → SKU implied read (gap A2). IT and Legal cannot call these at all.
  it.each(['sales', 'bid'])('%s never receives a cost or floor-price value from the SKU procedures', async (label) => {
    const caller = as(label)
    const list = await caller.commercial.skus.list()
    const one = await caller.commercial.skus.get({ id: skuId })
    expect(leaks(list)).toEqual([])
    expect(leaks(one)).toEqual([])
    expect((one as any).hardwareCost).toBeNull()
    expect((one as any).floorPrice).toBeNull()
    expect((one as any).listPrice).toBe(100)
    expect((one as any).maskedFields).toEqual(expect.arrayContaining([...SKU_COST_FIELDS, 'floorPrice', 'minimumAllowedPrice', 'internalPrice']))
  })

  it.each(['presales', 'finance', 'cxo'])('%s sees real cost and floor-price values', async (label) => {
    const one = await as(label).commercial.skus.get({ id: skuId })
    expect((one as any).hardwareCost).toBe(COST[4])
    expect((one as any).floorPrice).toBe(FLOOR.floorPrice)
    expect((one as any).maskedFields).toEqual([])
  })

  it('a System Admin sees real cost and floor-price values too', async () => {
    makeSystemAdmin('root')
    const one = await as('root').commercial.skus.get({ id: skuId })
    expect((one as any).hardwareCost).toBe(COST[4])
    expect((one as any).floorPrice).toBe(FLOOR.floorPrice)
    expect((one as any).maskedFields).toEqual([])
  })

  it('the audit log of a SKU cost change does not leak old/new values to a masked role', async () => {
    await as('finance').commercial.skus.update({ id: skuId, patch: { hardwareCost: 7777 }, changeReason: 'repricing' })
    const seen = await as('sales').commercial.auditLogs.list({ entityType: 'sku', entityId: skuId })
    expect(JSON.stringify(seen)).not.toContain('7777')
    expect(JSON.stringify(seen)).not.toContain(String(COST[4]))
    const realView = await as('finance').commercial.auditLogs.list({ entityType: 'sku', entityId: skuId })
    expect(JSON.stringify(realView)).toContain('7777')
  })

  it('nothing else a masked role can call returns a sentinel (BOM, masters, BOQ lists)', async () => {
    const caller = as('bid')
    expect(leaks(await caller.commercial.bom.listAll())).toEqual([])
    expect(leaks(await caller.commercial.boq.list())).toEqual([])
    expect(leaks(await caller.commercial.boq.listAllLineItems())).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/commercial.test.ts`
Expected: FAIL — `Failed to resolve import "./commercial.js"`.

- [ ] **Step 3: Implement**

Append to `apps/api/src/auth/rbac/registry/masks.ts`:

```ts
import { maskSkuRow } from '@goms/domain'

/** Hides restricted SKU fields in any SKU-shaped response (a row, or an array of rows). */
export function maskSkuResponse(data: unknown, user: UserFacts): unknown {
  if (Array.isArray(data)) return data.map((row) => (isRecord(row) ? maskSkuRow(row, user.roles) : row))
  return isRecord(data) ? maskSkuRow(data, user.roles) : data
}
```

(Add `maskSkuRow` to the existing `@goms/domain` import at the top instead of a second import line.)

`apps/api/src/auth/rbac/registry/commercial.ts`:

```ts
import { lineItemPatchAtom, masterKeyAtom, skuPatchAtom, type PolicyModuleKey } from '@goms/domain'
import { patchAtoms } from './builders.js'
import { create, read, remove, write } from './helpers.js'
import { auditReadRequirement, maskAuditList, maskSkuResponse } from './masks.js'
import type { PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

/** The approval matrix is its own module; every other master is a reference master. */
const masterModule = (key: unknown): PolicyModuleKey => (key === 'approvalMatrix' ? 'com.approvalMatrix' : 'com.masters')

const masterRead: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'read' })
const masterCreate: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'create' })
const masterDelete: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'delete' })
const masterWrite: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'update', atoms: [masterKeyAtom(String(raw?.key))] })

const skuUpdate: Requirement = (raw) => ({ module: 'com.skus', action: 'update', atoms: patchAtoms(raw?.patch, skuPatchAtom) })
const lineItemUpdate: Requirement = (raw) => ({ module: 'com.boqs', action: 'update', atoms: patchAtoms(raw?.patch, lineItemPatchAtom) })
/** Approve / reject is its own (exclusive) atom; every other status move is an ordinary BOQ edit. */
const boqStatus: Requirement = (raw) => ({
  module: 'com.boqs', action: 'update',
  atoms: [raw?.nextStatus === 'approved' || raw?.nextStatus === 'rejected' ? 'boq.approve' : 'boq.lines'],
})

export const commercialPolicy: Record<string, PolicyEntry> = {
  // ---- masters (+ the approval matrix)
  ...same(['commercial.masters.list', 'commercial.masters.get'], masterRead),
  'commercial.masters.listEditionFeatures': { requirements: [read('com.masters')] },
  'commercial.masters.create': { requirements: [masterCreate] },
  ...same(['commercial.masters.update', 'commercial.masters.setActive'], masterWrite),
  'commercial.masters.delete': { requirements: [masterDelete] },
  'commercial.masters.setEditionFeatures': { requirements: [write('com.masters', ['master.other'])] },

  // ---- SKU catalog: every SKU-shaped response is masked for roles that cannot read cost / floor price
  'commercial.skus.list': { requirements: [read('com.skus')], mask: maskSkuResponse },
  'commercial.skus.get': { requirements: [read('com.skus')], mask: maskSkuResponse },
  'commercial.skus.create': { requirements: [create('com.skus')], mask: maskSkuResponse },
  'commercial.skus.update': { requirements: [skuUpdate], mask: maskSkuResponse },
  'commercial.skus.delete': { requirements: [remove('com.skus')] },
  ...same(['commercial.bom.listForSku', 'commercial.bom.listAll'], read('com.skus')),
  'commercial.bom.create': { requirements: [create('com.skus')] },
  'commercial.bom.update': { requirements: [write('com.skus', ['sku.other'])] },
  'commercial.bom.delete': { requirements: [remove('com.skus')] },

  // ---- BOQs & proposals
  ...same(['commercial.boq.list', 'commercial.boq.get', 'commercial.boq.listLineItems', 'commercial.boq.listAllLineItems'], read('com.boqs')),
  ...same(['commercial.boq.create', 'commercial.boq.revise', 'commercial.boq.duplicate'], create('com.boqs')),
  ...same(['commercial.boq.update', 'commercial.boq.addLineItem', 'commercial.boq.removeLineItem', 'commercial.boq.reorderLineItems'], write('com.boqs')),
  'commercial.boq.updateLineItem': { requirements: [lineItemUpdate] },
  'commercial.boq.updateStatus': { requirements: [boqStatus] },
  'commercial.boq.delete': { requirements: [remove('com.boqs')] },

  'commercial.auditLogs.list': { requirements: [auditReadRequirement], mask: maskAuditList },
}
```

Edit `registry/index.ts` to add `...commercialPolicy`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/commercial.test.ts`
Expected: PASS. **If the golden test finds a leak** (a sentinel in a response you did not expect to carry SKU data), that procedure also embeds SKU data — add `mask: maskSkuResponse` (or a purpose-built mask) to its entry and re-run; do not weaken the test. Then `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): register commercial procedures; mask SKU cost and floor price server-side" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Registry completeness, cross-module rule and end-to-end enforcement

**Files:**
- Create: `apps/api/src/auth/rbac/registry/admin.ts`
- Modify: `apps/api/src/auth/rbac/registry/index.ts`
- Create: `apps/api/src/auth/rbac/registry/completeness.test.ts`
- Create: `apps/api/src/auth/rbac/enforcement.e2e.test.ts`

**Interfaces:**
- Produces: `adminPolicy` (the 7 `adminImport.*` as `kind: 'outside'`, `health.check` as `kind: 'public'`).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/rbac/registry/completeness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { PROCEDURE_POLICY } from './index.js'

const paths = Object.keys((appRouter as any)._def.procedures) as string[]

describe('PROCEDURE_POLICY completeness', () => {
  it('registers every procedure of the real appRouter — a new procedure without a policy fails this test', () => {
    expect(paths.filter((p) => !PROCEDURE_POLICY[p])).toEqual([])
  })
  it('has no entry for a procedure that no longer exists', () => {
    const known = new Set(paths)
    expect(Object.keys(PROCEDURE_POLICY).filter((p) => !known.has(p))).toEqual([])
  })
  it('exempts only the intended procedures', () => {
    const exempt = Object.entries(PROCEDURE_POLICY).filter(([, e]) => e.kind).map(([p, e]) => `${e.kind}:${p}`).sort()
    expect(exempt).toEqual([
      'outside:adminImport.commitGeographyLoad', 'outside:adminImport.history', 'outside:adminImport.listDomains',
      'outside:adminImport.previewGeographyLoad', 'outside:adminImport.session.commit', 'outside:adminImport.session.history',
      'outside:adminImport.session.validate', 'public:health.check',
    ])
  })
  it('gives every non-exempt entry at least one requirement', () => {
    for (const [path, entry] of Object.entries(PROCEDURE_POLICY)) {
      if (!entry.kind) expect(entry.requirements.length, path).toBeGreaterThan(0)
    }
  })
})

describe('cross-module procedures declare every module they touch (spec §9)', () => {
  it.each([
    'bids.update', 'bids.create', 'employees.transfers.transfer', 'employees.merge',
    'bidMilestones.create', 'bidMilestones.update', 'bidMilestones.delete', 'bidCorrigenda.reviewChange',
  ])('%s has more than one requirement', (path) => {
    expect(PROCEDURE_POLICY[path].requirements.length).toBeGreaterThan(1)
  })
})
```

`apps/api/src/auth/rbac/enforcement.e2e.test.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addNode, addSalesPerson, cleanupRbacFixtures, makeBid, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
const refused = async (p: Promise<unknown>) => { try { await p; return false } catch (e) { return e instanceof TRPCError && e.cause instanceof RbacDenial } }

beforeEach(async () => {
  await cleanupRbacFixtures()
  await addSalesPerson('sales')
  for (const role of ['bid', 'legal', 'it'] as const) await setRole(role, role)
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE
  vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('the real router, RBAC_MODE=enforce', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })

  it('lets a role read and refuses a user with no role', async () => {
    await expect(as('sales').bids.listForGrid()).resolves.toBeDefined()
    expect(await refused(as('nobody').bids.listForGrid())).toBe(true)
  })
  it('refuses a write outside the role and lets one inside it through to the handler', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    expect(await refused(as('legal').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } }))).toBe(true)
    await expect(as('bid').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
  })
  it('refuses a cross-module write that only one of the two modules would allow', async () => {
    const department = await addNode('org', 'dept')
    expect(await refused(as('it').employees.transfers.transfer({ employeeId: department, toNodeId: department, effectiveDate: '2026-01-01' } as any))).toBe(true)
  })
})

describe('RBAC_MODE=shadow', () => {
  it('lets the call through and logs what enforce would have refused', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { opportunityId } = await makeBid({ withBid: false })
    await expect(as('legal').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
    expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes('rbac.would_deny') && l.includes('opportunities.update'))).toBe(true)
  })
})

describe('RBAC_MODE=off (the deployed default)', () => {
  it('changes nothing: the same call a role would be refused succeeds', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    await expect(appRouter.createCaller({}).opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/registry/completeness.test.ts src/auth/rbac/enforcement.e2e.test.ts`
Expected: FAIL — procedures from `adminImport.*` / `health.check` missing from the registry (and, at this point in the plan, `access.*` / `auth.me` do not exist yet).

- [ ] **Step 3: Implement**

`apps/api/src/auth/rbac/registry/admin.ts`:

```ts
import type { PolicyEntry } from './types.js'

const outside: PolicyEntry = { requirements: [], kind: 'outside' }

/** Admin Data Import keeps its own allow-list + ADMIN_IMPORT_ENABLED flag (spec §4, "Outside RBAC"). */
export const adminPolicy: Record<string, PolicyEntry> = {
  ...Object.fromEntries([
    'adminImport.commitGeographyLoad', 'adminImport.history', 'adminImport.listDomains', 'adminImport.previewGeographyLoad',
    'adminImport.session.commit', 'adminImport.session.history', 'adminImport.session.validate',
  ].map((p) => [p, outside])),
  /** Liveness probe: public, returns no data. */
  'health.check': { requirements: [], kind: 'public' },
}
```

Edit `registry/index.ts`:

```ts
import { accountMappingPolicy } from './accountMapping.js'
import { adminPolicy } from './admin.js'
import { commercialPolicy } from './commercial.js'
import { opportunityPolicy } from './opportunity.js'
import type { PolicyEntry } from './types.js'

export const PROCEDURE_POLICY: Record<string, PolicyEntry> = {
  ...opportunityPolicy, ...accountMappingPolicy, ...commercialPolicy, ...adminPolicy,
}
```

In `apps/api/src/routers/health.ts` and `adminImport.ts` nothing changes: both stay on their existing tiers (`publicProcedure`, `adminImportProcedure`), which have no RBAC gate.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac`
Expected: PASS (every RBAC test so far). Then the **whole API suite** to prove `RBAC_MODE` unset changes nothing: `cd apps/api && npx vitest run` — Expected: PASS with the same pass count as before this plan plus the new RBAC tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): complete the procedure registry and prove enforcement end to end" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Record the creator, and show only the sheets a role can read

**Files:**
- Modify: `apps/api/src/routers/opportunities.ts` (`insertOpportunity` options + `opportunities.create`)
- Modify: `apps/api/src/routers/bids.ts` (`bids.create` passes the creator)
- Modify: `apps/api/src/routers/follow-ups.ts` (`create`)
- Modify: `apps/api/src/routers/employees.ts` (`timeline.add`)
- Create: `apps/api/src/auth/rbac/registry/rowVisibility.ts`
- Modify: `apps/api/src/auth/rbac/registry/opportunity.ts` (mask on `bids.listForGrid`)
- Modify: `apps/api/src/testHelpers/rbacFixtures.ts` (`trackOpportunity`, stage-change cleanup)
- Create: `apps/api/src/auth/rbac/createdBy.test.ts`, `apps/api/src/auth/rbac/registry/rowVisibility.test.ts`

**Interfaces:**
- Consumes: Task 4 `created_by` columns; Task 7 `sheetModule`.
- Produces: `insertOpportunity(client, input, options: { deferCode?: boolean; createdBy?: string | null })`; `filterRowsBySheet<T>(data: T, canReadModule: (m: RowModule) => boolean): T`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/testHelpers/rbacFixtures.ts`:

```ts
/** Registers an opportunity created through the router so cleanup removes it (and its stage changes). */
export function trackOpportunity(id: string): void { made.opportunities.push(id) }
```

and in `cleanupRbacFixtures()`, inside the `if (ids.length)` block, **before** the opportunities delete:

```ts
    await pool.query('DELETE FROM opportunity_stage_changes WHERE opportunity_id = ANY($1::uuid[])', [made.opportunities])
```

`apps/api/src/auth/rbac/createdBy.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { addEmployee, addNode, cleanupRbacFixtures, trackOpportunity } from '../../testHelpers/rbacFixtures.js'

beforeEach(cleanupRbacFixtures)
afterEach(cleanupRbacFixtures)

const as = (email: string) => appRouter.createCaller({ user: { email } } as any) // RBAC off: ctx.user is passed straight through

describe('created_by (gap A1)', () => {
  it('opportunities.create records the creator, lower-cased', async () => {
    const department = await addNode('org', 'dept')
    const opp = await as('RBAC-Maker@Amnex.com').opportunities.create({ departmentId: department, opportunityName: 'RBAC creator' })
    trackOpportunity(opp.id)
    expect((await pool.query('SELECT created_by FROM opportunities WHERE id=$1', [opp.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
  it('stays null when nobody is signed in (auth off)', async () => {
    const department = await addNode('org', 'dept')
    const opp = await appRouter.createCaller({}).opportunities.create({ departmentId: department, opportunityName: 'RBAC anon' })
    trackOpportunity(opp.id)
    expect((await pool.query('SELECT created_by FROM opportunities WHERE id=$1', [opp.id])).rows[0].created_by).toBeNull()
  })
  it('followUps.create records the creator', async () => {
    const created = await as('rbac-maker@amnex.com').followUps.create({ entityType: 'contact', entityId: randomUUID(), dueDate: '2030-01-01' })
    expect((await pool.query('SELECT created_by FROM follow_ups WHERE id=$1', [created.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
  it('employees.timeline.add records the creator', async () => {
    const employeeId = await addEmployee(await addNode('org', 'dept'))
    const event = await as('RBAC-Maker@amnex.com').employees.timeline.add({ employeeId, type: 'meeting', title: 'RBAC meeting', date: '2026-01-01' })
    expect((await pool.query('SELECT created_by FROM timeline_events WHERE id=$1', [event.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
})
```

`apps/api/src/auth/rbac/registry/rowVisibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROCEDURE_POLICY } from './index.js'
import { filterRowsBySheet } from './rowVisibility.js'

const rows = [{ id: 1, sheet: 'bidTracker' }, { id: 2, sheet: 'pipeline-funnel' }, { id: 3, sheet: 'campaign' }, { id: 4 }]

describe('filterRowsBySheet — the Master Grid shows the union of the sheets a role can read', () => {
  it('keeps everything when every sheet module is readable', () => {
    expect(filterRowsBySheet(rows, () => true)).toEqual(rows)
  })
  it('drops rows whose sheet module is not readable', () => {
    expect(filterRowsBySheet(rows, (m) => m !== 'opp.pipeline').map((r: any) => r.id)).toEqual([1, 3, 4])
  })
  it('treats a row with no sheet as Bid Tracker', () => {
    expect(filterRowsBySheet(rows, (m) => m === 'opp.bidTracker').map((r: any) => r.id)).toEqual([1, 4])
  })
  it('passes non-arrays through untouched', () => {
    expect(filterRowsBySheet({ a: 1 }, () => false)).toEqual({ a: 1 })
  })
})

describe('registration', () => {
  it('the grid query is masked by sheet visibility', () => {
    expect(PROCEDURE_POLICY['bids.listForGrid'].mask).toBeTypeOf('function')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/auth/rbac/createdBy.test.ts src/auth/rbac/registry/rowVisibility.test.ts`
Expected: FAIL — `created_by` is null in all four creator tests, and `./rowVisibility.js` is missing.

- [ ] **Step 3: Implement**

`apps/api/src/routers/opportunities.ts` — in `insertOpportunity` change the options type, the column list, the placeholder list and the values:

```ts
  options: { deferCode?: boolean; createdBy?: string | null } = {},
```

```ts
       opportunity_type, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
```

```ts
      input.legalPersonId ?? null, input.bidTeamMemberId ?? null, input.opportunityType ?? '',
      options.createdBy ? options.createdBy.trim().toLowerCase() : null,
    ],
```

and in `create`:

```ts
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const opp = await insertOpportunity(client, input, { createdBy: ctx.user?.email })
```

`apps/api/src/routers/bids.ts` — in `create`, the call that inserts the new opportunity becomes:

```ts
          opportunityId = (await insertOpportunity(client, { ...input.newOpportunity, departmentId: null }, { deferCode: true, createdBy: ctx.user?.email })).id
```

`apps/api/src/routers/follow-ups.ts` `create` — take `ctx` and store the creator:

```ts
    .mutation(async ({ input, ctx }) => {
      const result = await pool.query(
        `INSERT INTO follow_ups (entity_type, entity_id, assignee_id, due_date, status, note, created_by)
         VALUES ($1,$2,$3,$4,'open',$5,$6) RETURNING *`,
        [input.entityType, input.entityId, input.assigneeId ?? null, input.dueDate, input.note ?? '', ctx.user?.email?.trim().toLowerCase() ?? null],
      )
```

`apps/api/src/routers/employees.ts` `timeline.add` — same:

```ts
    .mutation(async ({ input, ctx }) => {
      const result = await pool.query(
        `INSERT INTO timeline_events (employee_id, type, title, custom_label, date, time, note, source, attendees, agenda, outcome, next_steps, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10,$11,$12) RETURNING *`,
        [
          input.employeeId, input.type, input.title,
          input.type === 'custom' ? (input.customLabel?.trim() || null) : null,
          input.date, input.time || null, input.note ?? '',
          input.attendees ? JSON.stringify(input.attendees) : null,
          input.agenda ?? null, input.outcome ?? null, input.nextSteps ?? null,
          ctx.user?.email?.trim().toLowerCase() ?? null,
        ],
      )
```

`apps/api/src/auth/rbac/registry/rowVisibility.ts`:

```ts
import { accessFor, type UserFacts } from '@goms/domain'
import { sheetModule, type RowModule } from '../rows.js'

/** The Master Grid is derived: a role sees the union of the rows on the sheets it can read. (Every role has at least
 *  Read on all three sheet modules today, so this is a no-op until the matrix changes — but it is the enforcement
 *  point the spec's "rows visible = union of 1–3" rule needs.) */
export function filterRowsBySheet<T>(data: T, canReadModule: (module: RowModule) => boolean): T {
  if (!Array.isArray(data)) return data
  return data.filter((row) => !(typeof row === 'object' && row !== null) || canReadModule(sheetModule((row as any).sheet))) as T
}

export const maskGridRows = (data: unknown, user: UserFacts): unknown =>
  filterRowsBySheet(data, (module) => accessFor(user, module).level !== 'N')
```

In `registry/opportunity.ts` import `maskGridRows` and give the grid query its mask. Replace `'bids.listForGrid'` in the first `same([...], readRows)` list by removing it there and adding below it:

```ts
  'bids.listForGrid': { requirements: [readRows], mask: maskGridRows },
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && npx vitest run src/auth/rbac src/routers/opportunities.test.ts src/routers/follow-ups.test.ts src/routers/employees.test.ts src/routers/bids.test.ts`
Expected: PASS — new tests plus the unchanged existing router suites. `npx tsc -p tsconfig.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): record the creator on opportunities, follow-ups and meetings; filter grid rows by readable sheet" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Gate the 17 formerly-public queries

**Files:**
- Modify: `apps/api/src/routers/hierarchy.ts` (12 queries), `apps/api/src/routers/commercial.ts` (5 queries)
- Create: `apps/api/src/auth/rbac/publicReads.test.ts`

**Interfaces:**
- Consumes: Task 6 `rbacReadProcedure`; the registry entries for these 17 (already registered in Tasks 9 and 10).
- The 17: `hierarchy.{listStates, getState, getNode, listChildren, listOrgRoots, listDepartments, listPostingNodes, breadcrumb, childCount, geoRoot, childCounts, moveTargets}` and `commercial.masters.{list, get, listEditionFeatures}`, `commercial.bom.{listForSku, listAll}`. (`health.check` is the 18th and stays public.)

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/publicReads.test.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addNode, addSalesPerson, cleanupRbacFixtures, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'

let orgNode: string, geoNode: string
const FORMERLY_PUBLIC: [string, unknown][] = [
  ['hierarchy.listStates', undefined], ['hierarchy.getState', { code: 24 }], ['hierarchy.getNode', { id: '' }],
  ['hierarchy.listChildren', { parentId: '' }], ['hierarchy.listOrgRoots', { stateCode: 24 }], ['hierarchy.listDepartments', undefined],
  ['hierarchy.listPostingNodes', { stateCode: 24 }], ['hierarchy.breadcrumb', { id: '' }], ['hierarchy.childCount', { id: '' }],
  ['hierarchy.geoRoot', undefined], ['hierarchy.childCounts', { parentId: '' }], ['hierarchy.moveTargets', { nodeId: '' }],
  ['commercial.masters.list', { key: 'verticals' }], ['commercial.masters.get', { key: 'verticals', id: '00000000-0000-0000-0000-000000000000' }],
  ['commercial.masters.listEditionFeatures', { editionId: '00000000-0000-0000-0000-000000000000' }],
  ['commercial.bom.listForSku', { parentSkuId: '00000000-0000-0000-0000-000000000000' }], ['commercial.bom.listAll', undefined],
]
const call = (caller: any, path: string, input: unknown) => path.split('.').reduce((o, k) => o[k], caller)(input)
const withNodeIds = (path: string, input: any) => {
  if (!input || !('id' in input || 'parentId' in input || 'nodeId' in input)) return input
  const key = Object.keys(input)[0]
  return { [key]: orgNode }
}

beforeEach(async () => {
  await cleanupRbacFixtures()
  orgNode = await addNode('org', 'dept'); geoNode = await addNode('geo', 'state')
  await addSalesPerson('sales')
  await setRole('presales', 'presales')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('RBAC_MODE=off: the 17 stay exactly as public as they are today', () => {
  it.each(FORMERLY_PUBLIC)('%s answers an unauthenticated caller', async (path, input) => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true' // auth is on in prod; RBAC is what is off
    const err = await call(appRouter.createCaller({}), path, withNodeIds(path, input)).then(() => null, (e: unknown) => e)
    expect(err instanceof TRPCError && (err.code === 'UNAUTHORIZED' || err.cause instanceof RbacDenial)).toBe(false)
  })
  it('health.check is public in every mode', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    await expect(appRouter.createCaller({}).health.check()).resolves.toBeDefined()
  })
})

describe('RBAC_MODE=shadow: behavior unchanged, would-be denials logged', () => {
  it('lets a signed-out caller through and logs it', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(appRouter.createCaller({}).hierarchy.listStates()).resolves.toBeDefined()
    expect(log.mock.calls.some((c) => String(c[0]).includes('hierarchy.listStates') && String(c[0]).includes('unauthenticated'))).toBe(true)
  })
})

describe('RBAC_MODE=enforce', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })

  it.each(FORMERLY_PUBLIC)('%s: a signed-out caller gets UNAUTHORIZED — never an RBAC denial (Review Focus 4)', async (path, input) => {
    const err = await call(appRouter.createCaller({}), path, withNodeIds(path, input)).then(() => null, (e: unknown) => e) as TRPCError
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('a no-role user keeps Geography and loses departments and commercial masters', async () => {
    const nobody = appRouter.createCaller(contextForEmail(rbacEmail('nobody')))
    await expect(nobody.hierarchy.listStates()).resolves.toBeDefined()
    await expect(nobody.hierarchy.getNode({ id: geoNode })).resolves.toBeDefined()
    await expect(nobody.hierarchy.getNode({ id: orgNode })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(nobody.hierarchy.listDepartments()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(nobody.commercial.masters.list({ key: 'verticals' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('a role reads what its module allows: Pre-sales sees the approval matrix, Sales does not', async () => {
    const pre = appRouter.createCaller(contextForEmail(rbacEmail('presales')))
    const sales = appRouter.createCaller(contextForEmail(rbacEmail('sales')))
    await expect(pre.commercial.masters.list({ key: 'approvalMatrix' })).resolves.toBeDefined()
    await expect(sales.commercial.masters.list({ key: 'approvalMatrix' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(sales.commercial.masters.list({ key: 'verticals' })).resolves.toBeDefined()
    await expect(sales.hierarchy.getNode({ id: orgNode })).resolves.toBeDefined()
  })
  it('a non-Amnex account is refused as before, not as an RBAC denial', async () => {
    const err = await appRouter.createCaller(contextForEmail('someone@gmail.com')).hierarchy.listStates().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/publicReads.test.ts`
Expected: FAIL — in `enforce` the signed-out calls succeed (the 17 are still `publicProcedure`, so no gate runs).

- [ ] **Step 3: Swap the tier**

```bash
cd apps/api/src/routers
# the 12 hierarchy queries (and only those) are publicProcedure today
sed -i -E 's/^(\s*)(listStates|getState|getNode|listChildren|listOrgRoots|listDepartments|listPostingNodes|breadcrumb|childCount|geoRoot|childCounts|moveTargets): publicProcedure/\1\2: rbacReadProcedure/' hierarchy.ts
# the 5 commercial ones: masters list/get/listEditionFeatures, bom listForSku/listAll
sed -i -E 's/^(\s*)(list|get|listEditionFeatures|listForSku|listAll): publicProcedure/\1\2: rbacReadProcedure/' commercial.ts
grep -c "publicProcedure" hierarchy.ts commercial.ts   # imports remain: expect 1 and 1
```

Then fix each file's import line so `publicProcedure` is replaced by `rbacReadProcedure` (e.g. `import { protectedProcedure, protectedReadProcedure, publicProcedure, router } from '../trpc.js'` → `import { protectedProcedure, protectedReadProcedure, rbacReadProcedure, router } from '../trpc.js'`). Verify nothing public is left in these two routers: `grep -n "publicProcedure" hierarchy.ts commercial.ts` — Expected: no output.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac/publicReads.test.ts src/routers/hierarchy.test.ts src/routers/commercial.test.ts src/trpc.test.ts`
Expected: PASS — including the existing hierarchy and commercial suites, which call these queries with RBAC off. Then the whole API suite: `cd apps/api && npx vitest run` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(rbac): route the 17 formerly-public queries through rbacReadProcedure" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `auth.me`, the access API and the "seen users" readiness data

**Files:**
- Create: `apps/api/migrations/1791000000000_rbac-seen-users.sql`
- Modify: `apps/api/src/auth/rbac/userFacts.ts` (extract `combineRoles`)
- Modify: `apps/api/src/trpc.ts` (`accessProcedure`)
- Create: `apps/api/src/routers/auth.ts`, `apps/api/src/routers/access.ts`
- Modify: `apps/api/src/index.ts` (mount `auth`, `access`)
- Modify: `apps/api/src/auth/rbac/registry/admin.ts` (policies for `auth.me`, `access.*`)
- Create: `apps/api/src/auth/rbac/access.test.ts`

**Interfaces:**
- Consumes: Task 5 `loadUserFacts`, `clearUserFactsCache`; Task 1 `DERIVED_ROLE_DEPARTMENTS`, `SALES_ROLE_STATUSES`, `ROLES`, `FUNCTIONAL_ROLES`; Task 5 fixture `makeSystemAdmin`.
- Produces:
  - `combineRoles(derived: Iterable<Role>, overrides: {role: Role; effect: 'grant'|'revoke'}[], adminAllowListed: boolean): Role[]` (in `userFacts.ts`)
  - `auth.me` → `MyAccess = { mode: RbacMode; email: string | null; roles: Role[]; facts: { salesPersonId: string | null; teamMemberIds: UserFacts['teamMemberIds'] } | null }`
  - `access.readiness` → `ReadinessRow[]` (`{ key; kind: 'org'|'sales'|'seen'|'admin'; name; email; derivedRoles; overrides: {id;role;effect;reason}[]; effectiveRoles; systemAdmin: boolean; warnings: ('no-email'|'no-role'|'duplicate-email')[]; lastSeenAt: string | null }`)
  - `access.listOverrides`, `access.setOverride({email, role, effect, reason})`, `access.removeOverride({id})`
  - `accessProcedure` (trpc.ts): with `RBAC_MODE=off` it requires membership of `ADMIN_ALLOWED_EMAILS`; otherwise the registry's `admin.access` requirement applies.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/rbac/access.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addOrgPerson, addSalesPerson, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { combineRoles, loadUserFacts } from './userFacts.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))

beforeEach(async () => { await cleanupRbacFixtures(); await pool.query(`DELETE FROM rbac_seen_users WHERE email LIKE 'rbac-%'`) })
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  await pool.query(`DELETE FROM rbac_seen_users WHERE email LIKE 'rbac-%'`)
  await cleanupRbacFixtures()
})

describe('combineRoles', () => {
  it('derived ∪ grants − revokes, then System Admin for allow-listed accounts, in ROLES order', () => {
    expect(combineRoles(['legal'], [{ role: 'cxo', effect: 'grant' }, { role: 'legal', effect: 'revoke' }], false)).toEqual(['cxo'])
    expect(combineRoles([], [{ role: 'it', effect: 'revoke' }], true)).toEqual(['system_admin'])
    expect(combineRoles(['legal'], [], true)).toEqual(['legal', 'system_admin'])
    expect(combineRoles(['presales', 'sales'], [], false)).toEqual(['sales', 'presales'])
  })
})

describe('access.* with RBAC off: only ADMIN_ALLOWED_EMAILS may use it', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('admin') })

  it('lets an allow-listed admin manage overrides, and a role override applies at once', async () => {
    await as('admin').access.setOverride({ email: ' RBAC-Boss@Amnex.com ', role: 'cxo', effect: 'grant', reason: 'CEO' })
    const stored = await as('admin').access.listOverrides()
    expect(stored).toEqual([expect.objectContaining({ email: 'rbac-boss@amnex.com', role: 'cxo', effect: 'grant', reason: 'CEO' })])
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['cxo']) // cache cleared by the write
  })
  it('refuses everyone else with an ordinary FORBIDDEN, even a user who would hold IT', async () => {
    await setRole('somebody', 'it')
    const err = await as('somebody').access.listOverrides().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('validates input: unknown role, empty reason, malformed email', async () => {
    const admin = as('admin')
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'admin' as any, effect: 'grant', reason: 'r' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'cxo', effect: 'grant', reason: '  ' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: 'not-an-email', role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toThrow()
  })
  it('re-setting the same (email, role) updates it instead of failing, and remove deletes it', async () => {
    const admin = as('admin')
    await admin.access.setOverride({ email: rbacEmail('p'), role: 'delivery', effect: 'grant', reason: 'one' })
    await admin.access.setOverride({ email: rbacEmail('p'), role: 'delivery', effect: 'revoke', reason: 'two' })
    const [row] = await admin.access.listOverrides()
    expect(row).toMatchObject({ effect: 'revoke', reason: 'two' })
    await admin.access.removeOverride({ id: row.id })
    expect(await admin.access.listOverrides()).toEqual([])
  })
  it('never lets System Admin be granted or revoked: not as a role, and not on an allow-listed account (Review Focus 6)', async () => {
    const admin = as('admin')
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'system_admin' as any, effect: 'grant', reason: 'r' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: rbacEmail('admin'), role: 'it', effect: 'revoke', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(admin.access.setOverride({ email: ` ${rbacEmail('ADMIN')} `, role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await setRole('admin', 'delivery') // an override row that predates the allow-list entry
    const [row] = await admin.access.listOverrides()
    await expect(admin.access.removeOverride({ id: row.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await loadUserFacts(rbacEmail('admin'))).roles).toEqual(['delivery', 'system_admin'])
  })
})

describe('access.* once RBAC is on: IT manages it, other roles cannot', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })
  it('IT and System Admin can; Sales cannot, and CXO may only read', async () => {
    await setRole('it', 'it'); await setRole('cxo', 'cxo'); await addSalesPerson('sales'); makeSystemAdmin('root')
    await expect(as('it').access.listOverrides()).resolves.toEqual([])
    await expect(as('root').access.listOverrides()).resolves.toEqual([])
    await expect(as('root').access.setOverride({ email: rbacEmail('z'), role: 'delivery', effect: 'grant', reason: 'r' })).resolves.toBeDefined()
    await expect(as('it').access.setOverride({ email: rbacEmail('x'), role: 'finance', effect: 'grant', reason: 'r' })).resolves.toBeDefined()
    const refused = await as('sales').access.listOverrides().catch((e) => e)
    expect(refused.cause).toBeInstanceOf(RbacDenial)
    await expect(as('cxo').access.listOverrides()).resolves.toBeDefined()
    const cxoWrite = await as('cxo').access.setOverride({ email: rbacEmail('y'), role: 'finance', effect: 'grant', reason: 'r' }).catch((e) => e)
    expect(cxoWrite.cause).toBeInstanceOf(RbacDenial)
  })
})

describe('access.readiness', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('admin') })

  it('lists org people and the Sales roster with derived and effective roles and warns about missing emails', async () => {
    await addOrgPerson('lawyer', ['Legal'])
    await addOrgPerson('ghost', ['Pre-Sales'], { email: '' })
    await addSalesPerson('seller')
    await setRole('lawyer', 'cxo')
    const rows = await as('admin').access.readiness()
    const lawyer = rows.find((r) => r.name === 'RBAC lawyer')!
    expect(lawyer).toMatchObject({ kind: 'org', email: rbacEmail('lawyer'), derivedRoles: ['legal'], effectiveRoles: ['legal', 'cxo'], warnings: [] })
    expect(lawyer.overrides).toEqual([expect.objectContaining({ role: 'cxo', effect: 'grant' })])
    expect(rows.find((r) => r.name === 'RBAC ghost')!.warnings).toContain('no-email')
    expect(rows.find((r) => r.name === 'RBAC seller')).toMatchObject({ kind: 'sales', derivedRoles: ['sales'], effectiveRoles: ['sales'] })
  })
  it('flags a person with no role at all', async () => {
    await addOrgPerson('nobody', ['Business Units'])
    const row = (await as('admin').access.readiness()).find((r) => r.name === 'RBAC nobody')!
    expect(row.effectiveRoles).toEqual([])
    expect(row.warnings).toContain('no-role')
  })
  it('flags two people sharing one email', async () => {
    await addOrgPerson('twin1', ['Legal'], { email: rbacEmail('twin') })
    await addOrgPerson('twin2', ['Bid Management'], { email: rbacEmail('twin') })
    const rows = (await as('admin').access.readiness()).filter((r) => r.name.startsWith('RBAC twin'))
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.warnings).toContain('duplicate-email')
  })
  it('shows System Admin accounts as protected rows, even when they are in neither the org chart nor the roster', async () => {
    makeSystemAdmin('founder')
    const rows = await as('admin').access.readiness()
    expect(rows.find((r) => r.email === rbacEmail('founder'))).toMatchObject({
      kind: 'admin', systemAdmin: true, effectiveRoles: ['system_admin'], derivedRoles: [], warnings: [],
    })
    expect(rows.find((r) => r.email === rbacEmail('admin'))).toMatchObject({ systemAdmin: true })
  })
  it('marks an org person who is also allow-listed as a System Admin without listing them twice', async () => {
    await addOrgPerson('both', ['Legal'])
    makeSystemAdmin('both')
    const rows = (await as('admin').access.readiness()).filter((r) => r.email === rbacEmail('both'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'org', systemAdmin: true, derivedRoles: ['legal'], effectiveRoles: ['legal', 'system_admin'] })
  })
  it('includes users who signed in and resolved to no role (from auth.me), with when they were last seen', async () => {
    process.env.RBAC_MODE = 'shadow'
    await as('stranger').auth.me()
    const row = (await as('admin').access.readiness()).find((r) => r.email === rbacEmail('stranger'))!
    expect(row).toMatchObject({ kind: 'seen', effectiveRoles: [] })
    expect(row.warnings).toContain('no-role')
    expect(row.lastSeenAt).not.toBeNull()
  })
})

describe('auth.me', () => {
  it('with RBAC off reports mode off and no facts', async () => {
    await expect(appRouter.createCaller({}).auth.me()).resolves.toEqual({ mode: 'off', email: null, roles: [], facts: null })
  })
  it('with RBAC on returns the caller\'s roles and roster facts', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    const salesId = await addSalesPerson('s')
    await setRole('s', 'bid')
    await expect(as('s').auth.me()).resolves.toEqual({
      mode: 'enforce', email: rbacEmail('s'), roles: ['sales', 'bid'],
      facts: { salesPersonId: salesId, teamMemberIds: { presales: [], legal: [], bid: [] } },
    })
  })
  it('reports System Admin for an allow-listed account', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    makeSystemAdmin('root')
    await expect(as('root').auth.me()).resolves.toMatchObject({ mode: 'enforce', email: rbacEmail('root'), roles: ['system_admin'] })
  })
  it('rejects a signed-out caller with UNAUTHORIZED once RBAC is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    await expect(appRouter.createCaller({}).auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/auth/rbac/access.test.ts`
Expected: FAIL — `combineRoles` is not exported, `rbac_seen_users` does not exist, `access` / `auth` routers are missing.

- [ ] **Step 3: Implement**

`apps/api/migrations/1791000000000_rbac-seen-users.sql`:

```sql
-- Up Migration

-- Who has signed in while RBAC was on (shadow / enforce), and with how many roles — feeds the access-readiness view
-- ("users who authenticated but resolved to zero roles", RBAC spec §3.3). Written by auth.me.
CREATE TABLE rbac_seen_users (
  email        TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  role_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS rbac_seen_users;
```

Apply locally: `cd apps/api && npm run migrate -- up`.

In `apps/api/src/auth/rbac/userFacts.ts`, extract the role arithmetic (behavior unchanged — the Task 5 tests guard it) and use it inside `loadUserFacts`:

```ts
/** derived ∪ override grants − override revokes, plus System Admin for allow-listed accounts, in ROLES order (spec §3.1, §3.4). */
export function combineRoles(
  derived: Iterable<Role>, overrides: { role: Role; effect: 'grant' | 'revoke' }[], adminAllowListed: boolean,
): Role[] {
  const roles = new Set<Role>(derived)
  for (const { role, effect } of overrides) {
    if (effect === 'grant') roles.add(role)
    else roles.delete(role)
  }
  if (adminAllowListed) roles.add('system_admin')
  return ROLES.filter((r) => roles.has(r))
}
```

and inside `loadUserFacts` replace the override loop and the break-glass line with

```ts
    const overrides = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email = $1`, [email])
    finalRoles = combineRoles(roles, overrides.rows, isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS))
```

(declare `let finalRoles: Role[] = []` beside `roles`, and build `facts` with `roles: finalRoles`).

In `apps/api/src/trpc.ts`, after `adminProcedure`:

```ts
/** For the access API (`access.*`). Overrides created while RBAC is `off` become live the moment it is enforced, so
 *  this is gated regardless of RBAC_MODE: in `off` mode only ADMIN_ALLOWED_EMAILS members may use it; in
 *  shadow/enforce the registry's `admin.access` requirement applies (IT, or System Admin). */
export const accessProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (rbacMode() === 'off' && authEnforced()) {
    if (!ctx.user || !isAllowListed(ctx.user.email, process.env.ADMIN_ALLOWED_EMAILS)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not authorized to manage access.' })
    }
  }
  return next()
})
```

`apps/api/src/routers/auth.ts`:

```ts
import type { RbacMode, Role, UserFacts } from '@goms/domain'
import { isAmnexAccount, verifyFirebaseToken } from '../auth/identity.js'
import { rbacMode } from '../auth/rbac/mode.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { pool } from '../db.js'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'

export interface MyAccess {
  mode: RbacMode
  email: string | null
  roles: Role[]
  facts: { salesPersonId: string | null; teamMemberIds: UserFacts['teamMemberIds'] } | null
}

export const authRouter = router({
  /** The caller's effective roles and roster facts, which the UI feeds to the shared evaluators. With RBAC off it
   *  reports nothing — the UI then treats everything as allowed, exactly like today. */
  me: publicProcedure.query(async ({ ctx }): Promise<MyAccess> => {
    const mode = rbacMode()
    if (mode === 'off') return { mode, email: ctx.user?.email ?? null, roles: [], facts: null }
    const verified = ctx.user ?? (await verifyFirebaseToken(ctx.authHeader))
    if (!isAmnexAccount(verified.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    const facts = await loadUserFacts(verified.email)
    await pool.query(
      `INSERT INTO rbac_seen_users (email, role_count, last_seen_at) VALUES ($1, $2, now())
       ON CONFLICT (email) DO UPDATE SET role_count = EXCLUDED.role_count, last_seen_at = now()`,
      [facts.email, facts.roles.length],
    )
    return {
      mode, email: facts.email, roles: [...facts.roles],
      facts: { salesPersonId: facts.salesPersonId, teamMemberIds: facts.teamMemberIds },
    }
  }),
})
```

`apps/api/src/routers/access.ts`:

```ts
import { DERIVED_ROLE_DEPARTMENTS, FUNCTIONAL_ROLES, SALES_ROLE_STATUSES, type Role } from '@goms/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { combineRoles, clearUserFactsCache, normalizeEmail } from '../auth/rbac/userFacts.js'
import { isAllowListed, parseAllowList } from '../auth/identity.js'
import { pool } from '../db.js'
import { accessProcedure, router } from '../trpc.js'

const roleSchema = z.enum(FUNCTIONAL_ROLES) // System Admin is never an override (spec §3.4)
const SYSTEM_ADMIN_MANAGED = 'System Admin accounts are managed through the protected admin allow-list.'
const isSystemAdmin = (email: string): boolean => isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS)
const emailSchema = z.string().trim().toLowerCase().email().max(254)

export interface ReadinessRow {
  key: string
  kind: 'org' | 'sales' | 'seen' | 'admin'
  name: string
  email: string
  derivedRoles: Role[]
  overrides: { id: string; role: Role; effect: 'grant' | 'revoke'; reason: string }[]
  effectiveRoles: Role[]
  /** An account on the protected admin allow-list: unrestricted, and not editable here (spec §3.4). */
  systemAdmin: boolean
  warnings: ('no-email' | 'no-role' | 'duplicate-email')[]
  lastSeenAt: string | null
}

const toOverride = (r: any) => ({
  id: r.id as string, email: r.email as string, role: r.role as Role, effect: r.effect as 'grant' | 'revoke',
  reason: r.reason as string, createdBy: r.created_by as string, createdAt: new Date(r.created_at).toISOString(),
})

export const accessRouter = router({
  listOverrides: accessProcedure.query(async () =>
    (await pool.query('SELECT * FROM user_role_overrides ORDER BY email, role')).rows.map(toOverride),
  ),

  setOverride: accessProcedure
    .input(z.object({ email: emailSchema, role: roleSchema, effect: z.enum(['grant', 'revoke']), reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      if (isSystemAdmin(input.email)) throw new TRPCError({ code: 'BAD_REQUEST', message: SYSTEM_ADMIN_MANAGED })
      const { rows } = await pool.query(
        `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email, role) DO UPDATE SET effect = EXCLUDED.effect, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
         RETURNING *`,
        [input.email, input.role, input.effect, input.reason, normalizeEmail(ctx.user?.email ?? 'unknown')],
      )
      clearUserFactsCache()
      return toOverride(rows[0])
    }),

  removeOverride: accessProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const target = (await pool.query('SELECT email FROM user_role_overrides WHERE id=$1', [input.id])).rows[0]
    if (target && isSystemAdmin(target.email)) throw new TRPCError({ code: 'BAD_REQUEST', message: SYSTEM_ADMIN_MANAGED })
    await pool.query('DELETE FROM user_role_overrides WHERE id=$1', [input.id])
    clearUserFactsCache()
  }),

  /** Per person: derived roles, overrides, effective roles, and what needs fixing before RBAC can be enforced. */
  readiness: accessProcedure.query(async (): Promise<ReadinessRow[]> => {
    const [org, sales, overrides, seen] = await Promise.all([
      pool.query(`SELECT id, name, email, departments, status FROM org_people ORDER BY name`),
      pool.query(`SELECT id, name, official_email, status FROM sales_persons ORDER BY name`),
      pool.query(`SELECT * FROM user_role_overrides`),
      pool.query(`SELECT email, role_count, last_seen_at FROM rbac_seen_users`),
    ])
    const adminList = process.env.ADMIN_ALLOWED_EMAILS
    const overridesOf = (email: string) => overrides.rows.filter((o) => o.email === email)
    const seenAt = (email: string) => {
      const s = seen.rows.find((r) => r.email === email)
      return s ? new Date(s.last_seen_at).toISOString() : null
    }
    const rows: ReadinessRow[] = []
    const make = (kind: ReadinessRow['kind'], key: string, name: string, rawEmail: string, derived: Role[]): ReadinessRow => {
      const email = normalizeEmail(rawEmail)
      const own = email ? overridesOf(email) : []
      const effective = email ? combineRoles(derived, own, isAllowListed(email, adminList)) : []
      return {
        key, kind, name, email,
        derivedRoles: email ? derived : [],
        overrides: own.map((o) => ({ id: o.id, role: o.role, effect: o.effect, reason: o.reason })),
        effectiveRoles: effective,
        systemAdmin: !!email && isAllowListed(email, adminList),
        warnings: [...(email ? [] : ['no-email' as const]), ...(effective.length === 0 ? ['no-role' as const] : [])],
        lastSeenAt: email ? seenAt(email) : null,
      }
    }

    for (const p of org.rows) {
      const derived = p.status === 'active'
        ? (Object.entries(DERIVED_ROLE_DEPARTMENTS).filter(([, d]) => (p.departments as string[]).includes(d)).map(([r]) => r as Role))
        : []
      rows.push(make('org', `org:${p.id}`, p.name, p.email ?? '', derived))
    }
    for (const s of sales.rows) {
      rows.push(make('sales', `sales:${s.id}`, s.name, s.official_email ?? '', (SALES_ROLE_STATUSES as readonly string[]).includes(s.status) ? ['sales'] : []))
    }
    const known = new Set(rows.map((r) => r.email).filter(Boolean))
    for (const s of seen.rows) {
      if (!known.has(s.email)) rows.push(make('seen', `seen:${s.email}`, s.email, s.email, []))
    }

    // System Admin accounts are always listed, even when they are in neither the org chart nor the roster (protected rows).
    const listed = new Set(rows.map((r) => r.email).filter(Boolean))
    for (const email of parseAllowList(adminList)) {
      if (!listed.has(email)) rows.push(make('admin', `admin:${email}`, email, email, []))
    }

    const counts = new Map<string, number>()
    for (const r of rows) if (r.email) counts.set(r.email, (counts.get(r.email) ?? 0) + (r.kind === 'seen' ? 0 : 1))
    for (const r of rows) if (r.email && (counts.get(r.email) ?? 0) > 1) r.warnings.push('duplicate-email')
    return rows
  }),
})
```

Edit `apps/api/src/index.ts`: add `import { authRouter } from './routers/auth.js'`, `import { accessRouter } from './routers/access.js'` and mount `auth: authRouter, access: accessRouter,` in `appRouter`.

Edit `registry/admin.ts` — add to `adminPolicy`:

```ts
import { create, read, remove, write } from './helpers.js'
// …
  /** The caller's own identity: authenticates itself (see routers/auth.ts). */
  'auth.me': { requirements: [], kind: 'self' },
  'access.listOverrides': { requirements: [read('admin.access')] },
  'access.readiness': { requirements: [read('admin.access')] },
  'access.setOverride': { requirements: [write('admin.access')] },
  'access.removeOverride': { requirements: [remove('admin.access')] },
```

and update the exempt list in `registry/completeness.test.ts` to include `'self:auth.me'` (sorted: after `public:health.check`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/auth/rbac && npx vitest run`
Expected: PASS — all RBAC tests and the whole API suite. `npx tsc -p tsconfig.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(rbac): auth.me, the access API with readiness data, and seen-users tracking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
## Phase D — Frontend

The UI is advisory; the server is the authority. With `RBAC_MODE=off` (or the in-memory local repository) `auth.me` reports nothing and the UI treats everything as allowed, exactly as today. Frontend unit tests are `*.test.ts` (root `npm test`); component tests are `*.test.tsx` (`npm run test:component`).

### Task 15: Permissions context, `auth.me` plumbing, and RBAC denials that do not open the sign-in dialog

**Files:**
- Modify: `src/data/repository.ts` (add `getMyAccess` to the `Repository` interface)
- Modify: `src/data/in-memory/repository.ts` (interface at ~288, implementation, and the supported-method list at ~3015), `src/data/remote/repository.ts` (add `getMyAccess = () => this.client.auth.me.query()`)
- Modify: `src/data/remote/authPromptLink.ts` (skip RBAC denials)
- Modify: `src/lib/api.ts` (add `useMyAccess`)
- Create: `src/lib/permissions.tsx`, `src/lib/permissions.test.tsx`, `src/data/remote/authPromptLink.rbac.test.ts`
- Modify: `src/app/AppLayout.tsx` (mount `PermissionsProvider`)

**Interfaces:**
- Consumes: `@goms/domain` evaluators (Tasks 1–3); API `auth.me` (Task 14).
- Produces: `MyAccess` type (re-exported from the API type), `useMyAccess()`, `PermissionsProvider`, `usePermissions(): { enforced: boolean; roles: Role[]; level(module): Level; can(module, action: 'read'|'create'|'delete'): boolean; canEdit(module, atom: string, row?: ScopeFacts): boolean; canReadAtom(atom: MaskedAtom): boolean }`, `<Can module action? atom? row?>…</Can>`.

- [ ] **Step 1: Write the failing tests**

`src/data/remote/authPromptLink.rbac.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { observable } from '@trpc/server/observable'

vi.mock('@/lib/authPrompt', () => ({ notifyAuthRequired: vi.fn() }))
import { notifyAuthRequired } from '@/lib/authPrompt'
import { authPromptLink } from './authPromptLink'

function run(error: unknown) {
  const link = authPromptLink({} as any)
  const next = () => observable((o) => { o.error(error as any) })
  return new Promise<void>((resolve) => link({ op: {} as any, next } as any).subscribe({ error: () => resolve() }))
}

describe('authPromptLink', () => {
  it('still opens the sign-in dialog for a genuine FORBIDDEN / UNAUTHORIZED', async () => {
    await run({ data: { code: 'FORBIDDEN' } })
    expect(notifyAuthRequired).toHaveBeenCalledWith('forbidden')
    await run({ data: { code: 'UNAUTHORIZED' } })
    expect(notifyAuthRequired).toHaveBeenCalledWith('unauthorized')
  })
  it('does NOT open it for an RBAC denial (data.rbacDenied)', async () => {
    vi.mocked(notifyAuthRequired).mockClear()
    await run({ data: { code: 'FORBIDDEN', rbacDenied: true } })
    expect(notifyAuthRequired).not.toHaveBeenCalled()
  })
})
```

`src/lib/permissions.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { PermissionsProvider, usePermissions } from './permissions'

const wrap = (access: any) => ({ children }: { children: ReactNode }) => <PermissionsProvider access={access}>{children}</PermissionsProvider>
const facts = { salesPersonId: 'sp1', teamMemberIds: { presales: [], legal: [], bid: [] } }

describe('usePermissions', () => {
  it('allows everything when RBAC is off or unknown (today\'s behavior)', () => {
    for (const access of [undefined, { mode: 'off', email: null, roles: [], facts: null }]) {
      const { result } = renderHook(() => usePermissions(), { wrapper: wrap(access) })
      expect(result.current.enforced).toBe(false)
      expect(result.current.level('com.skus')).toBe('W')
      expect(result.current.can('com.skus', 'delete')).toBe(true)
      expect(result.current.canEdit('opp.bidTracker', 'bid.stage')).toBe(true)
      expect(result.current.canReadAtom('sku.costs')).toBe(true)
    }
  })
  it('evaluates the shared policy for a Sales user, row by row', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 's@amnex.com', roles: ['sales'], facts }) })
    const own = { salesOwnerIds: ['sp1'], createdBy: null, assigned: { presales: null, legal: null, bid: null } }
    const other = { ...own, salesOwnerIds: ['sp9'] }
    expect(result.current.canEdit('opp.pipeline', 'opp.value', own)).toBe(true)
    expect(result.current.canEdit('opp.pipeline', 'opp.value', other)).toBe(false)
    expect(result.current.canEdit('opp.bidTracker', 'bid.stage', own)).toBe(false)
    expect(result.current.level('com.approvalMatrix')).toBe('N')
    expect(result.current.canReadAtom('sku.costs')).toBe(false)
  })
  it('treats a System Admin as unrestricted: W everywhere, every atom editable except the frozen Solution Lead, masked fields readable', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 'root@amnex.com', roles: ['system_admin'], facts }) })
    const anyRow = { salesOwnerIds: [], createdBy: null, assigned: { presales: null, legal: null, bid: null } }
    expect(result.current.level('com.skus')).toBe('W')
    expect(result.current.level('admin.access')).toBe('W')
    expect(result.current.can('com.skus', 'delete')).toBe(true)
    expect(result.current.canEdit('com.skus', 'sku.costs')).toBe(true)
    expect(result.current.canEdit('opp.bidTracker', 'bid.stage', anyRow)).toBe(true)
    expect(result.current.canEdit('am.ownership', 'ownership.solutionLead', anyRow)).toBe(false)
    expect(result.current.canReadAtom('sku.costs')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/remote/authPromptLink.rbac.test.ts` and `npx vitest run --config vitest.component.config.ts src/lib/permissions.test.tsx`
Expected: FAIL — the link opens the dialog for the RBAC denial; `./permissions` is missing.

- [ ] **Step 3: Implement**

`src/data/remote/authPromptLink.ts` — in `error(err)`:

```ts
          const data = (err as { data?: { code?: string; rbacDenied?: boolean } } | null)?.data
          // An RBAC denial means "signed in, but not allowed" — the sign-in dialog would be wrong and misleading.
          if (!data?.rbacDenied && (data?.code === 'UNAUTHORIZED' || data?.code === 'FORBIDDEN')) {
            notifyAuthRequired(data.code === 'FORBIDDEN' ? 'forbidden' : 'unauthorized')
          }
```

`src/data/repository.ts` — add to the `Repository` interface `getMyAccess(): Promise<MyAccess>` with `import type { MyAccess } from '../../apps/api/src/routers/auth'`; in-memory repository: `async getMyAccess(): Promise<MyAccess> { return { mode: 'off', email: null, roles: [], facts: null } }` (and add `'getMyAccess'` to its supported-method list near line 3015); remote repository: `getMyAccess = (): Promise<MyAccess> => this.client.auth.me.query()`.

`src/lib/api.ts`:

```ts
export const useMyAccess = () =>
  useQuery({ queryKey: ['myAccess'], queryFn: () => repository.getMyAccess(), staleTime: 60_000, retry: false })
```

`src/lib/permissions.tsx`:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  accessFor, allows, canReadAtom as domainCanReadAtom, type Level, type MaskedAtom, type PolicyModuleKey, type ScopeFacts, type UserFacts,
} from '@goms/domain'
import type { MyAccess } from '../../apps/api/src/routers/auth'
import { useMyAccess } from './api'

export interface Permissions {
  /** False when RBAC is off (or not yet known): everything is shown, the server is still the authority. */
  enforced: boolean
  roles: UserFacts['roles']
  level(module: PolicyModuleKey): Level
  can(module: PolicyModuleKey, action: 'read' | 'create' | 'delete', row?: ScopeFacts): boolean
  canEdit(module: PolicyModuleKey, atom: string, row?: ScopeFacts): boolean
  canReadAtom(atom: MaskedAtom): boolean
}

const OPEN: Permissions = {
  enforced: false, roles: [], level: () => 'W', can: () => true, canEdit: () => true, canReadAtom: () => true,
}
const Ctx = createContext<Permissions>(OPEN)

function build(access: MyAccess | undefined): Permissions {
  if (!access || access.mode === 'off' || !access.facts) return OPEN
  const user: UserFacts = { email: access.email ?? '', roles: access.roles, ...access.facts }
  return {
    enforced: true,
    roles: user.roles,
    level: (m) => accessFor(user, m).level,
    can: (m, action, row) => {
      const a = accessFor(user, m, row)
      return action === 'read' ? a.level !== 'N' : action === 'create' ? a.create : a.delete
    },
    canEdit: (m, atom, row) => allows(accessFor(user, m, row), atom),
    canReadAtom: (atom) => domainCanReadAtom(user.roles, atom),
  }
}

/** Props `access` lets tests inject; in the app the provider reads `auth.me` itself. */
export function PermissionsProvider({ children, access }: { children: ReactNode; access?: MyAccess }) {
  const { data } = useMyAccess()
  const value = useMemo(() => build(access ?? data), [access, data])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePermissions = (): Permissions => useContext(Ctx)

/** Renders children only when the action is allowed (or when `fallback` is given, renders that instead). */
export function Can({
  module, action = 'update', atom, row, fallback = null, children,
}: {
  module: PolicyModuleKey; action?: 'read' | 'create' | 'update' | 'delete'; atom?: string; row?: ScopeFacts
  fallback?: ReactNode; children: ReactNode
}) {
  const p = usePermissions()
  const ok = action === 'update' ? (atom ? p.canEdit(module, atom, row) : p.level(module) === 'W') : p.can(module, action, row)
  return <>{ok ? children : fallback}</>
}
```

Fix the test's provider usage: `PermissionsProvider` calls `useMyAccess()`, so the permissions test wraps it in a `QueryClientProvider` (`new QueryClient({ defaultOptions: { queries: { retry: false } } })`) — add that wrapper in `wrap()`. In `src/app/AppLayout.tsx` wrap the shell's returned tree in `<PermissionsProvider>…</PermissionsProvider>` (it sits inside the existing `QueryClientProvider` in `main.tsx`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/data/remote/authPromptLink.rbac.test.ts && npx vitest run --config vitest.component.config.ts src/lib/permissions.test.tsx src/app/AppLayout.test.tsx`
Expected: PASS. Then `npx tsc -b` → no type errors.

- [ ] **Step 5: Commit**

```bash
git add src apps/api/src
git commit -m "feat(rbac): permissions context from auth.me; RBAC denials no longer open the sign-in dialog" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Navigation and route gating, "No access" and "No role" screens

**Files:**
- Create: `src/components/NoAccess.tsx`, `src/components/NoAccess.test.tsx`
- Modify: `src/components/AccountMappingRail.tsx`, `src/components/SecondaryNav.tsx`, `src/components/MobileNavDrawer.tsx`, `src/modules/bid-tracker/OpportunityWorkspace.tsx` (tab bar), `src/modules/commercial-calculator/CommercialCalculatorWorkspace.tsx` (section list), `src/app/routes/TeamsWorkspace.tsx` (tabs), `src/app/routes/Insights.tsx` (tabs)
- Modify: `src/app/router.tsx` (wrap route elements with `<RequireAccess>`)

**Interfaces:**
- Consumes: `usePermissions`, `<Can>`.
- Produces: `<RequireAccess module anyOf?>` — renders children, or `<NoAccess>` (or `<NoRole>` when the user has zero roles), `ROUTE_MODULES: Record<string, PolicyModuleKey[]>` mapping each route prefix to the modules whose read opens it.

Route → modules (any one at `R`+ opens the route): `/map`, `/state/:code` → `am.geography`; `/directory` → `am.contacts`, `am.departments`; `/analytics` → `an.operational`; `/meetings` → `am.meetings`; `/sales` → `team.sales`; `/teams` → `team.org`, `team.sales`; `/commercial-calculator` → `com.boqs`, `com.skus`, `com.masters`; `/bid-tracker` (+ `/pipeline`, `/campaign`, `/master`, `/dashboard`) → `opp.bidTracker`, `opp.pipeline`, `opp.campaign`; `/admin/access` → `admin.access`. Home (`/`) always renders. Within modules: Bid Tracker tabs follow their sheet (Pipeline → `opp.pipeline`, Campaign → `opp.campaign`, Master → any sheet, Dashboard → `an.operational`); Commercial Calculator's Approval Matrix item → `com.approvalMatrix`, Audit item → `admin.audit`; Insights' two tabs → `an.operational`, and the "Pipeline value by salesperson" panel in `SalesTeamInsights.tsx` is wrapped in `<Can module="an.financial" action="read">` (UI-only, gap A5).

- [ ] **Step 1: Write the failing test**

`src/components/NoAccess.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'
import { RequireAccess } from './NoAccess'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const renderAs = (roles: any[]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PermissionsProvider access={{ mode: 'enforce', email: 'u@amnex.com', roles, facts }}>
        <MemoryRouter><RequireAccess anyOf={['com.skus']}><div>Catalog</div></RequireAccess></MemoryRouter>
      </PermissionsProvider>
    </QueryClientProvider>,
  )

describe('RequireAccess', () => {
  it('renders the page for a role that can read the module', () => {
    renderAs(['presales'])
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })
  it('shows "No access" for a role that cannot', () => {
    renderAs(['legal'])
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument()
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument()
  })
  it('shows the "No role assigned" screen for a user with no roles', () => {
    renderAs([])
    expect(screen.getByText(/no role assigned/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.component.config.ts src/components/NoAccess.test.tsx`
Expected: FAIL — `./NoAccess` missing.

- [ ] **Step 3: Implement**

`src/components/NoAccess.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { PolicyModuleKey } from '@goms/domain'
import { usePermissions } from '@/lib/permissions'

export function NoAccess() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">You don't have access to this page</h1>
        <p className="mt-1 text-sm text-muted">Your role doesn't include it. Ask IT if you think that's a mistake.</p>
      </div>
    </div>
  )
}

export function NoRole() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">No role assigned</h1>
        <p className="mt-1 text-sm text-muted">You're signed in, but no GOMS role is set up for your account yet. Contact IT to be given access.</p>
      </div>
    </div>
  )
}

/** Opens a route only for a user who can read at least one of `anyOf`. Always open when RBAC is off. */
export function RequireAccess({ anyOf, children }: { anyOf: PolicyModuleKey[]; children: ReactNode }) {
  const p = usePermissions()
  if (!p.enforced) return <>{children}</>
  if (p.roles.length === 0) return <NoRole />
  return anyOf.some((m) => p.level(m) !== 'N') ? <>{children}</> : <NoAccess />
}
```

In `src/app/router.tsx` wrap each protected route's `element` — e.g. `{ path: '/directory', element: <RequireAccess anyOf={['am.contacts', 'am.departments']}><Directory /></RequireAccess> }` — following the route → modules table above (Home, `*` and the existing `/admin/data-import/*` routes are left alone; Data Import stays outside RBAC). In each nav component, hide an entry unless `usePermissions().level(...) !== 'N'` for one of its modules (when `!enforced` everything shows). For the sheet tabs in `OpportunityWorkspace.tsx`, filter `OPPORTUNITY_TABS` with a `TAB_MODULES` map (`'bid-tracker' → ['opp.bidTracker']`, `pipeline → ['opp.pipeline']`, `campaign → ['opp.campaign']`, `master → ROW_MODULES`, `dashboard → ['an.operational']`) and redirect a direct hit on a hidden tab to the first visible one.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --config vitest.component.config.ts src/components src/app src/modules/bid-tracker/OpportunityWorkspace.test.tsx`
Expected: PASS — new tests and the unchanged existing nav/router/workspace suites (they run with RBAC off, so nothing is hidden). `npx tsc -b` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(rbac): gate navigation and routes; add No access and No role screens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Master Grid and sheet rows — permission-driven cell editing

**Files:**
- Modify: `src/modules/bid-tracker/components/MasterGrid.tsx` (`effectiveMeta`, ~lines 236–258)
- Modify: `src/modules/bid-tracker/gridColumns.ts` (add `atomOf`)
- Create: `src/modules/bid-tracker/gridPermissions.ts`, `src/modules/bid-tracker/gridPermissions.test.ts`

**Interfaces:**
- Consumes: `Permissions.canEdit`, the `BidGridRow` fields (`sheet`, `ownerEmail`, `solutionLeadEmail`, `geoSalesPersonId`, `buSalesPersonId`, `preSalesPersonId`, `legalPersonId`, `bidTeamMemberId`, `createdBy` if present).
- Produces: `COLUMN_ATOM: Record<columnId, atom | null>` (null = no write path / frozen), `rowScopeFacts(row, myEmail, mySalesPersonId): ScopeFacts`, `canEditCell(perms, row, columnId, me): boolean`. A cell is editable **iff the grid is unlocked and `canEditCell`** (the grid's own lock stays as an accident guard). The per-column `unlockable` browser switch for read-only columns is replaced by this.

Column → atom map (from `gridColumns.ts`): `opportunityName, opportunityType → opp.identity`; `tenderLink → opp.identity`; `gemTenderId → opp.tenderId`; `departmentName → opp.client`; `city, vertical → opp.client`; `geoSalesPersonId, buSalesPersonId → opp.teamSales`; `preSalesPersonId, legalPersonId, bidTeamMemberId → opp.teamDelivery`; `ownerEmail → ownership.bidEntity`; `solutionLeadEmail → ownership.solutionLead` (frozen: nobody); `stageKey → bid.stage`; `decision → bid.decision`; `nextActionNote, nextActionAssigneeEmail, nextActionDueDate → bid.nextAction`; `dataConfidence → bid.verify`; custom columns (`custom:*`) → `bid.custom`; everything else `null`.

- [ ] **Step 1: Write the failing test**

`src/modules/bid-tracker/gridPermissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Permissions } from '@/lib/permissions'
import { accessFor, allows, type Role, type UserFacts } from '@goms/domain'
import { COLUMN_ATOM, canEditCell, rowScopeFacts } from './gridPermissions'
import { STANDARD_COLUMNS } from './gridColumns'

const perms = (roles: Role[], salesPersonId: string | null = null, ids = { presales: [] as string[], legal: [] as string[], bid: [] as string[] }): Permissions => {
  const user: UserFacts = { email: 'me@amnex.com', roles, salesPersonId, teamMemberIds: ids }
  return {
    enforced: true, roles, level: (m) => accessFor(user, m).level, can: () => true, canReadAtom: () => true,
    canEdit: (m, atom, row) => allows(accessFor(user, m, row), atom),
  }
}
const row = (extra: Record<string, unknown> = {}) => ({ sheet: 'bidTracker', ownerEmail: null, solutionLeadEmail: null, geoSalesPersonId: null, buSalesPersonId: null, preSalesPersonId: null, legalPersonId: null, bidTeamMemberId: null, ...extra }) as any
const me = { email: 'me@amnex.com', salesPersonId: 'sp1' }

describe('column → atom map', () => {
  it('covers every standard column that has a write path, and none that does not', () => {
    for (const c of STANDARD_COLUMNS) {
      if (c.editable) expect(COLUMN_ATOM[c.id], c.id).toBeTruthy()
    }
  })
})

describe('canEditCell', () => {
  it('is always true when RBAC is not enforced', () => {
    expect(canEditCell({ enforced: false } as Permissions, row(), 'stageKey', me)).toBe(true)
  })
  it('Sales (S1) edits client/value-type cells on an own Bid Tracker row, not stage or decision', () => {
    const p = perms(['sales'], 'sp1')
    const own = row({ geoSalesPersonId: 'sp1' })
    expect(canEditCell(p, own, 'city', me)).toBe(true)
    expect(canEditCell(p, own, 'stageKey', me)).toBe(false)
    expect(canEditCell(p, own, 'decision', me)).toBe(false)
    expect(canEditCell(p, row({ geoSalesPersonId: 'sp9' }), 'city', me)).toBe(false)
  })
  it('Solution Lead is read-only for everyone, even a W role and System Admin', () => {
    expect(canEditCell(perms(['bid']), row(), 'solutionLeadEmail', me)).toBe(false)
    expect(canEditCell(perms(['system_admin']), row(), 'solutionLeadEmail', me)).toBe(false)
  })
  it('System Admin edits every other cell, on any sheet and any row', () => {
    const p = perms(['system_admin'])
    for (const col of ['stageKey', 'decision', 'gemTenderId', 'opportunityName', 'custom:region', 'ownerEmail', 'dataConfidence']) {
      expect(canEditCell(p, row(), col, me), col).toBe(true)
    }
    expect(canEditCell(p, row({ sheet: 'campaign', geoSalesPersonId: 'sp9' }), 'stageKey', me)).toBe(true)
  })
  it('CXO may edit only the decision cell', () => {
    const p = perms(['cxo'])
    expect(canEditCell(p, row(), 'decision', me)).toBe(true)
    expect(canEditCell(p, row(), 'stageKey', me)).toBe(false)
  })
  it('a custom column needs bid.custom on the row', () => {
    expect(canEditCell(perms(['legal'], null, { presales: [], legal: ['l1'], bid: [] }), row({ legalPersonId: 'l1' }), 'custom:region', me)).toBe(true)
    expect(canEditCell(perms(['legal']), row({ legalPersonId: 'l1' }), 'custom:region', me)).toBe(false)
  })
  it('judges a Pipeline row on the Pipeline module', () => {
    const p = perms(['sales'], 'sp1')
    expect(canEditCell(p, row({ sheet: 'pipeline-funnel', geoSalesPersonId: 'sp1' }), 'stageKey', me)).toBe(true) // W·own on Pipeline
  })
  it('builds scope facts from the row, lower-casing the owner match', () => {
    expect(rowScopeFacts(row({ ownerEmail: 'ME@amnex.com', geoSalesPersonId: 'sp2' }), 'me@amnex.com', 'sp1').salesOwnerIds).toEqual(expect.arrayContaining(['sp1', 'sp2']))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/bid-tracker/gridPermissions.test.ts`
Expected: FAIL — `./gridPermissions` missing.

- [ ] **Step 3: Implement**

`src/modules/bid-tracker/gridPermissions.ts`:

```ts
import { sheetModule } from './sheetModule'
import type { Permissions } from '@/lib/permissions'
import type { ScopeFacts } from '@goms/domain'
import type { BidGridRow } from '@/lib/types'

export const COLUMN_ATOM: Record<string, string | null> = {
  opportunityName: 'opp.identity', opportunityType: 'opp.identity', tenderLink: 'opp.identity', gemTenderId: 'opp.tenderId',
  departmentName: 'opp.client', city: 'opp.client', vertical: 'opp.client',
  geoSalesPersonId: 'opp.teamSales', buSalesPersonId: 'opp.teamSales',
  preSalesPersonId: 'opp.teamDelivery', legalPersonId: 'opp.teamDelivery', bidTeamMemberId: 'opp.teamDelivery',
  ownerEmail: 'ownership.bidEntity', solutionLeadEmail: 'ownership.solutionLead',
  stageKey: 'bid.stage', decision: 'bid.decision',
  nextActionNote: 'bid.nextAction', nextActionAssigneeEmail: 'bid.nextAction', nextActionDueDate: 'bid.nextAction',
  dataConfidence: 'bid.verify',
}
export const atomOf = (columnId: string): string | null => (columnId.startsWith('custom:') ? 'bid.custom' : COLUMN_ATOM[columnId] ?? null)

/** Mirrors the server's row facts from what a grid row already carries (the server stays authoritative). */
export function rowScopeFacts(row: BidGridRow, myEmail: string, mySalesPersonId: string | null): ScopeFacts {
  const email = myEmail.toLowerCase()
  const ids = new Set<string>()
  if (mySalesPersonId && (row.ownerEmail?.toLowerCase() === email || row.solutionLeadEmail?.toLowerCase() === email)) ids.add(mySalesPersonId)
  for (const id of [row.geoSalesPersonId, row.buSalesPersonId]) if (id) ids.add(id)
  return {
    salesOwnerIds: [...ids],
    createdBy: (row as any).createdBy ?? null,
    assigned: { presales: row.preSalesPersonId ?? null, legal: row.legalPersonId ?? null, bid: row.bidTeamMemberId ?? null },
  }
}

export function canEditCell(perms: Permissions, row: BidGridRow, columnId: string, me: { email: string; salesPersonId: string | null }): boolean {
  if (!perms.enforced) return true
  const atom = atomOf(columnId)
  if (!atom) return false
  return perms.canEdit(sheetModule(row.sheet), atom, rowScopeFacts(row, me.email, me.salesPersonId))
}
```

(Create `src/modules/bid-tracker/sheetModule.ts` exporting `sheetModule(sheet)` — the same sheet→module table as the API (`bidTracker → opp.bidTracker`, `pipeline-* → opp.pipeline`, `campaign → opp.campaign`, default `opp.bidTracker`) — or move `SHEET_MODULE`/`sheetModule` into `@goms/domain` and import it from both sides; the move is preferable and is a three-line change to `rows.ts`.)

In `MasterGrid.tsx` replace the interim lock block (lines ~236–258) so permission decides editability and the per-column switch no longer opens read-only columns:

```tsx
  const perms = usePermissions()
  const { data: access } = useMyAccess()
  const me = { email: access?.email ?? '', salesPersonId: access?.facts?.salesPersonId ?? null }
  // The grid-wide lock (above) stays as an accident guard. A cell is editable when unlocked, the column has a write
  // path, the user's role allows that field on THIS row, and the user has not locked the column themselves.
  const effectiveMeta = (meta: GridColumnMeta): GridColumnMeta =>
    columnLocks.locked.includes(meta.id) ? { ...meta, editable: undefined } : meta
  const cellEditable = (row: BidGridRow, meta: GridColumnMeta) => !!effectiveMeta(meta).editable && canEditCell(perms, row, meta.id, me)
```

and where a cell asks whether it is editable, pass `cellEditable(row, meta)` (the existing `editable` checks at the `EditableCell` call sites). Keep `loadColumnLocks/saveColumnLocks` for the user's own "lock this column" convenience; remove only the `unlocked`/`unlockable` branch.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/bid-tracker && npx vitest run --config vitest.component.config.ts src/modules/bid-tracker`
Expected: PASS — new tests and the existing grid suites (RBAC off ⇒ unchanged). If an existing test relied on the `unlockable` switch (Tender ID / State), update it to assert the new rule: those cells open only when `canEditCell` allows (`opp.tenderId` is W-only).

- [ ] **Step 5: Commit**

```bash
git add src packages/domain
git commit -m "feat(rbac): grid cell editing driven by role, field and row scope" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Commercial — masked values render as "Restricted"; margin hidden without cost

**Files:**
- Modify: `packages/domain/src/commercial.ts` (cost/floor fields become `number | null` on `CommercialSku`), `src/modules/commercial-calculator/types.ts`
- Modify: `src/modules/commercial-calculator/components/SkuFormDialog.tsx`, `SellingPriceSection.tsx`, `BoqWorkspaceHeader.tsx`, `src/modules/commercial-calculator/pages/SkuCatalog.tsx`, `repository-logic.ts` (margin helpers)
- Create: `src/modules/commercial-calculator/restricted.ts`, `restricted.test.ts`

**Interfaces:**
- Produces: `isRestricted(value: number | null | undefined): value is null`, `formatRestricted(value, format): string` (`'Restricted'` for `null`), `canComputeMargin(skus: {maskedFields?: string[]}[]): boolean`.

- [ ] **Step 1: Write the failing test**

`src/modules/commercial-calculator/restricted.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canComputeMargin, formatRestricted, isRestricted } from './restricted'

describe('restricted values', () => {
  it('null means hidden, 0 is a real zero', () => {
    expect(isRestricted(null)).toBe(true)
    expect(isRestricted(0)).toBe(false)
    expect(formatRestricted(null, (n) => `₹${n}`)).toBe('Restricted')
    expect(formatRestricted(0, (n) => `₹${n}`)).toBe('₹0')
  })
  it('margin needs every involved SKU\'s cost to be visible', () => {
    expect(canComputeMargin([{ maskedFields: [] }, {}])).toBe(true)
    expect(canComputeMargin([{ maskedFields: [] }, { maskedFields: ['hardwareCost'] }])).toBe(false)
    expect(canComputeMargin([])).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/commercial-calculator/restricted.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/modules/commercial-calculator/restricted.ts`:

```ts
export const isRestricted = (value: number | null | undefined): value is null => value === null
export const formatRestricted = (value: number | null | undefined, format: (n: number) => string): string =>
  value === null || value === undefined ? 'Restricted' : format(value)
/** Margin and "Below Cost" are computed from SKU cost fields in the browser; if any involved SKU hides its cost they cannot be. */
export const canComputeMargin = (skus: { maskedFields?: string[] }[]): boolean => skus.every((s) => !s.maskedFields?.length)
```

Then, in order: (1) change the 8 `SKU_COST_FIELDS` and the 3 floor fields on `CommercialSku` to `number | null` and add `maskedFields?: string[]`, letting the compiler list every consumer (`npx tsc -b`); (2) in `repository-logic.ts` margin helpers (`skuTotalUnitCost`, `marginPctForSellingPrice`, `sellingPriceForMargin`) treat a `null` cost as "cannot compute" — they are only called when `canComputeMargin(...)`; (3) `BoqWorkspaceHeader` and `SellingPriceSection` hide the margin figure, the "Below Cost" flag and the "set by margin" input when `!canComputeMargin(skusInBoq)` (and show "Restricted" in their place); (4) `SkuCatalog` / `SkuFormDialog` render restricted cost and floor-price cells as `formatRestricted(...)` and disable those inputs when `!usePermissions().canEdit('com.skus', atomFor(field))` (use `skuPatchAtom` from `@goms/domain`); (5) the SKU form must not send a masked field in an update patch (omit keys whose current value is `null` and the user cannot edit).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b && npx vitest run src/modules/commercial-calculator && npx vitest run --config vitest.component.config.ts src/modules/commercial-calculator`
Expected: PASS — including the existing commercial suites (RBAC off ⇒ no `maskedFields`, all values numeric).

- [ ] **Step 5: Commit**

```bash
git add packages/domain src
git commit -m "feat(rbac): render masked SKU fields as Restricted and hide margin without cost" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Button-level gating across the remaining screens

**Files:** the screens below; each gets `usePermissions()` / `<Can>` around its create / edit / delete triggers. No new logic — the server already refuses; this removes dead buttons.
- Create: `src/lib/gatingInventory.test.ts` (guards that every mutation hook is accounted for)

**Gating table** (control → permission; locate each trigger by the mutation hook named in the third column):

| Screen (file) | Control | Permission | Hook to find it |
|---|---|---|---|
| `components/GlobalFab.tsx` | menu entries `Import Records`, `Create Unit/Office/Division/Branch/Department` → `am.departments` create; `Create Person`, `Add Activity` → `am.contacts` / `am.meetings` create | filter `MENU` by `can()` | `MENU` array |
| `features/employees/EmployeeFormDialog.tsx`, `EmployeeDetails.tsx`, `VisitingCard.tsx`, `ChargeDialog.tsx`, `MarkDuplicateDialog.tsx`, `MergeEmployeesDialog.tsx`, `TransferDialog.tsx` | edit / add / merge (delete-class) / transfer | `am.contacts` write; merge needs `delete`; transfer needs `am.contacts` **and** `am.departments` write | `useEmployeeMutations` |
| `features/employees/TimelineEventDialog.tsx` | add / edit / delete a meeting | `am.meetings` create / update·own / delete·own | `useEmployeeMutations().timeline*` |
| `features/nodes/NodeFormDialog.tsx`, `MoveDialog.tsx`, `ConfirmDialog.tsx`, `features/details/NodeDetails.tsx`, `features/canvas/*` | create / edit / move / delete node | by node domain: `am.departments` or `am.geography` | `useNodeMutations` |
| `features/nodes/WorksEditor.tsx` | add / edit / delete a work (opportunity) | `opp.bidTracker` create / `bid.*` atoms | `useOpportunityMutations`, `useBidMutations` |
| `features/sales/SalesPersonFormDialog.tsx`, `SalesPersonDetails.tsx`, `TransferSalesPersonDialog.tsx`, `EditPostingDatesDialog.tsx`, `salesEditLock.tsx` | add / edit / transfer / remove | `team.sales` (Sales: own profile fields only); the Sales edit lock stays as an accident guard, offered only when the role may edit | `useSalesPersonMutations` |
| `features/sales/AssignOwnerDialog.tsx`, `TransferBookOfBusinessDialog.tsx` | reassign owner / transfer book | `am.ownership` update (Sales on own entities); Solution Lead option removed (frozen) | `useOwnershipMutations` |
| `app/routes/TeamsWorkspace.tsx`, `features/org/OrgEmployees.tsx` | roster / org-chart edit | `team.org` | `useDeliveryTeamMemberMutations`, `useOrgPersonMutations` |
| `modules/bid-tracker/BidDetailWorkspace.tsx`, `pages/OverviewTab.tsx`, `MilestonesTab.tsx`, `ProtectedValuesTab.tsx`, `CommercialAndFilesTab.tsx`, `components/CorrigendumReviewDialog.tsx`, `CreateBidDialog.tsx`, `CreateCorrigendumDialog.tsx`, `ManageColumnsPanel.tsx`, `AddCustomColumnDialog.tsx`, `CreateSavedViewDialog.tsx` | archive / delete / verify, next action, milestones, freeze, upload, review, create, manage columns, global views | per the Task 8 registry (module + atom) | `useBidMutations`, `useBidMilestoneMutations`, `useProtectedValueMutations`, `useDocumentMutations`, `useBidCorrigendaMutations`, `useBidCustomFieldMutations`, `useBidSavedViewMutations` |
| `modules/commercial-calculator/components/MasterCrudScreen.tsx`, `pages/SkuCatalog.tsx`, `SkuBomEditor.tsx`, `CreateBoq.tsx`, `ProposalDetail.tsx`, `HierarchyView.tsx` | masters (by key: tax/currencies → Finance, approval matrix → CXO), SKUs, BOQs, approve/reject (CXO) | Task 10 registry | `useMasterMutations`, `useSkuMutations`, `useBoqMutations`, `useBoqLineItemMutations` |

- [ ] **Step 1: Write the failing inventory test**

`src/lib/gatingInventory.test.ts` fails when a screen that calls a mutation hook is not listed above (so a future screen cannot ship ungated by accident):

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GATED = new Set([
  'app/routes/TeamsWorkspace.tsx', 'features/canvas/CanvasBranch.tsx', 'features/canvas/HierarchyCanvas.tsx',
  'features/details/EmployeeDetails.tsx', 'features/details/NodeDetails.tsx', 'features/details/SalesPersonDetails.tsx',
  'features/employees/ChargeDialog.tsx', 'features/employees/EmployeeFormDialog.tsx', 'features/employees/MarkDuplicateDialog.tsx',
  'features/employees/MergeEmployeesDialog.tsx', 'features/employees/SelectEmployeeDialog.tsx', 'features/employees/TimelineEventDialog.tsx',
  'features/employees/TransferDialog.tsx', 'features/employees/VisitingCard.tsx', 'features/import/ImportDialog.tsx',
  'features/nodes/ConfirmDialog.tsx', 'features/nodes/MoveDialog.tsx', 'features/nodes/NodeFormDialog.tsx', 'features/nodes/WorksEditor.tsx',
  'features/org/OrgEmployees.tsx', 'features/sales/AssignOwnerDialog.tsx', 'features/sales/EditPostingDatesDialog.tsx',
  'features/sales/SalesPersonFormDialog.tsx', 'features/sales/TransferBookOfBusinessDialog.tsx', 'features/sales/TransferSalesPersonDialog.tsx',
  'modules/bid-tracker/BidDetailWorkspace.tsx', 'modules/bid-tracker/GridSheet.tsx',
  'modules/bid-tracker/components/AddCustomColumnDialog.tsx', 'modules/bid-tracker/components/CorrigendumReviewDialog.tsx',
  'modules/bid-tracker/components/CreateBidDialog.tsx', 'modules/bid-tracker/components/CreateCorrigendumDialog.tsx',
  'modules/bid-tracker/components/CreateSavedViewDialog.tsx', 'modules/bid-tracker/components/ManageColumnsPanel.tsx',
  'modules/bid-tracker/components/MasterGrid.tsx', 'modules/bid-tracker/pages/CommercialAndFilesTab.tsx',
  'modules/bid-tracker/pages/MilestonesTab.tsx', 'modules/bid-tracker/pages/OverviewTab.tsx', 'modules/bid-tracker/pages/ProtectedValuesTab.tsx',
  'modules/commercial-calculator/components/MasterCrudScreen.tsx', 'modules/commercial-calculator/components/SkuBomEditor.tsx',
  'modules/commercial-calculator/pages/CreateBoq.tsx', 'modules/commercial-calculator/pages/HierarchyView.tsx',
  'modules/commercial-calculator/pages/ProposalDetail.tsx', 'modules/commercial-calculator/pages/SkuCatalog.tsx',
])

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* tsx(p)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) yield p
  }
}

describe('gating inventory', () => {
  it('every screen that calls a *Mutations hook is in the gated list and actually uses permissions', () => {
    const root = join(__dirname, '..')
    const missing: string[] = []
    const ungated: string[] = []
    for (const file of tsx(root)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, '/')
      const src = readFileSync(file, 'utf8')
      if (!/use[A-Za-z]+Mutations?\(/.test(src)) continue
      if (!GATED.has(rel)) missing.push(rel)
      else if (!/usePermissions|<Can\b|canEditCell/.test(src)) ungated.push(rel)
    }
    expect(missing).toEqual([])
    expect(ungated).toEqual([]) // fails until each listed screen consults permissions
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/gatingInventory.test.ts`
Expected: FAIL — every listed screen is `ungated`.

- [ ] **Step 3: Implement**

Apply the table. Pattern for a trigger button: `<Can module="team.sales" action="create"><Button onClick={openAdd}>Add a sales person</Button></Can>`; for a menu array: `MENU.filter((item) => p.can(moduleFor(item), 'create'))` in `GlobalFab.tsx`; for a field-specific control: `disabled={!p.canEdit('opp.bidTracker', 'opp.value', rowFacts)}` with the tooltip "Your role can't edit this". Where a screen edits a row, build `rowFacts` with `rowScopeFacts` from Task 17 (move it to `src/lib/rowScope.ts` if more than the grid uses it). Remove the Solution Lead choice from `AssignOwnerDialog`'s role selector. Do not touch Admin Data Import. Work through the table one screen at a time, running that screen's existing test file after each (RBAC off ⇒ unchanged).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/gatingInventory.test.ts && npm test && npm run test:component`
Expected: PASS — the inventory test and both full local suites.

- [ ] **Step 5: Commit** (one commit per two or three screens is fine; the last one lands the inventory test)

```bash
git add src
git commit -m "feat(rbac): hide create/edit/delete controls a role cannot use" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Role & Access Management screen

**Files:**
- Create: `src/modules/admin-access/AccessManagement.tsx`, `AccessManagement.test.tsx`, `api.ts`
- Modify: `src/app/router.tsx` (route `/admin/access`), `src/components/AccountMappingRail.tsx` (entry for roles with `admin.access` ≥ R)
- Modify: `src/data/repository.ts`, `in-memory/repository.ts`, `remote/repository.ts` (`listRoleOverrides`, `setRoleOverride`, `removeRoleOverride`, `getAccessReadiness`)

**Interfaces:**
- Consumes: `access.readiness`, `access.listOverrides`, `access.setOverride`, `access.removeOverride` (Task 14), `usePermissions`.
- Produces: a screen with (1) a readiness table (name, email, derived roles, overrides, effective roles, warning chips `No email` / `No role` / `Duplicate email`, last seen), filter "Needs attention", (2) an override form (email, role, grant/revoke, reason) and per-row remove, editable only when `can('admin.access','create')` (CXO sees it read-only). Rows with `systemAdmin: true` show a **System Admin (protected)** chip and no remove or override control, and the Role dropdown never offers System Admin (it lists `FUNCTIONAL_ROLES`).

- [ ] **Step 1: Write the failing component test**

`src/modules/admin-access/AccessManagement.test.tsx` (mock `repository`, as the other module tests do):

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'

const readiness = [
  { key: 'org:1', kind: 'org', name: 'Denish', email: 'denish@amnex.com', derivedRoles: ['legal'], overrides: [], effectiveRoles: ['legal'], warnings: [], lastSeenAt: null },
  { key: 'org:2', kind: 'org', name: 'Nirav Shah', email: '', derivedRoles: [], overrides: [], effectiveRoles: [], warnings: ['no-email', 'no-role'], lastSeenAt: null },
]
vi.mock('@/data/repository', () => ({
  repository: {
    getAccessReadiness: vi.fn().mockResolvedValue(readiness),
    listRoleOverrides: vi.fn().mockResolvedValue([]),
    setRoleOverride: vi.fn().mockResolvedValue({}),
    removeRoleOverride: vi.fn().mockResolvedValue(undefined),
    getMyAccess: vi.fn(),
  },
}))
import { repository } from '@/data/repository'
import { AccessManagement } from './AccessManagement'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const renderAs = (roles: any[]) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={{ mode: 'enforce', email: 'it@amnex.com', roles, facts }}><AccessManagement /></PermissionsProvider>
    </QueryClientProvider>,
  )

describe('AccessManagement', () => {
  it('lists people with their effective roles and flags what needs attention', async () => {
    renderAs(['it'])
    expect(await screen.findByText('Denish')).toBeInTheDocument()
    const row = screen.getByText('Nirav Shah').closest('tr')!
    expect(within(row).getByText(/no email/i)).toBeInTheDocument()
    expect(within(row).getByText(/no role/i)).toBeInTheDocument()
  })
  it('lets IT grant a role with a reason', async () => {
    renderAs(['it'])
    await screen.findByText('Denish')
    await userEvent.type(screen.getByLabelText('Email'), 'nirav@amnex.com')
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'cxo')
    await userEvent.type(screen.getByLabelText('Reason'), 'CEO')
    await userEvent.click(screen.getByRole('button', { name: /save override/i }))
    expect(repository.setRoleOverride).toHaveBeenCalledWith({ email: 'nirav@amnex.com', role: 'cxo', effect: 'grant', reason: 'CEO' })
  })
  it('is read-only for CXO', async () => {
    renderAs(['cxo'])
    await screen.findByText('Denish')
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
  })
  it('shows System Admin accounts as protected, with no way to remove or override them', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValueOnce([
      { key: 'admin:root', kind: 'admin', name: 'root@amnex.com', email: 'root@amnex.com', derivedRoles: [], overrides: [], effectiveRoles: ['system_admin'], systemAdmin: true, warnings: [], lastSeenAt: null },
    ] as any)
    renderAs(['it'])
    const row = (await screen.findByText('root@amnex.com', { selector: 'td' })).closest('tr')!
    expect(within(row).getByText(/system admin \(protected\)/i)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
  it('does not offer System Admin as a role to grant', async () => {
    renderAs(['it'])
    await screen.findByText('Denish')
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('CXO')
    expect(options).not.toContain('System Admin')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.component.config.ts src/modules/admin-access/AccessManagement.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Add the four repository methods (remote: `this.client.access.readiness.query()`, `listOverrides.query()`, `setOverride.mutate(input)`, `removeOverride.mutate({ id })`; in-memory: return `[]` / no-op). `src/modules/admin-access/api.ts` wraps them in `useAccessReadiness`, `useRoleOverrides`, `useRoleOverrideMutations` (invalidate `['accessReadiness']` and `['roleOverrides']` on success). `AccessManagement.tsx` renders the readiness table (`<table>` with the same classes as `ActionQueuePage`), a "Needs attention" toggle filtering rows with warnings, and — wrapped in `<Can module="admin.access" action="create">` — a form with labelled inputs **Email**, **Role** (`<select>` over `FUNCTIONAL_ROLES` with `ROLE_LABELS` — never System Admin), **Effect** (grant/revoke) and **Reason**, and a **Save override** button calling `setRoleOverride({ email, role, effect, reason })`; each override chip has a remove button inside `<Can module="admin.access" action="delete">`. A row with `systemAdmin: true` renders a **System Admin (protected)** chip and no override or remove control. Add the route `/admin/access` wrapped in `<RequireAccess anyOf={['admin.access']}>`, and a rail entry visible when `p.level('admin.access') !== 'N'`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --config vitest.component.config.ts src/modules/admin-access && npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(rbac): Role & Access Management screen with readiness view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Phase E — Rollout (no deploy happens in this plan)

### Task 21: Infra flag, shadow runbook and final verification

**Files:**
- Modify: `infra/dev/cloudrun.tf`, `infra/prod/cloudrun.tf` (add `RBAC_MODE = "off"` env var, with the same explanatory-comment style as the neighbouring auth flags)
- Create: `docs/superpowers/analysis/2026-10-rbac-rollout-runbook.md`

- [ ] **Step 1: Add the flag, defaulting to off, in both environments**

Next to `READ_AUTH_ENFORCEMENT_ENABLED` in each `cloudrun.tf` add:

```hcl
      # RBAC (docs/superpowers/specs/2026-10-06-rbac-design.md). "off" is an exact no-op; "shadow" logs would-be
      # denials ({"event":"rbac.would_deny"}) without blocking; "enforce" applies them. Only meaningful while
      # AUTH_ENFORCEMENT_ENABLED is "true". Flip per environment, dev first; the prod flip needs its own approval.
      env {
        name  = "RBAC_MODE"
        value = "off"
      }
```

Run `terraform fmt -check infra/dev infra/prod` (Expected: no diff). Do **not** `terraform apply` as part of this plan.

- [ ] **Step 2: Write the runbook**

`docs/superpowers/analysis/2026-10-rbac-rollout-runbook.md` must contain, concretely: (0) **prerequisite** — `ADMIN_ALLOWED_EMAILS` must list both System Admin accounts in the target environment (goms-dev lists one account and goms-prod none today); this is a Cloud Run configuration change that needs explicit approval and Shubham's exact address, and it is **not** applied by this plan; System Admin accounts need no overrides or org emails and appear as protected rows in the readiness view; (1) deploy sequence — migrations (`1790800000000`, `1790900000000`, `1791000000000`) via the `goms-migrate` job, API + hosting with `RBAC_MODE=off` (a no-op release); (2) backfill — fill `org_people.email` for every person, then create overrides in **Role & Access Management** for the CEO, CFO and CE&TO (CXO), every Finance / IT / Delivery user, and any Sales person missing a roster row, until the readiness view shows no `No email` / `No role` rows for people who should have access; (3) `RBAC_MODE=shadow` on goms-dev, and the Cloud Logging filter `jsonPayload.event="rbac.would_deny"` (group by `jsonPayload.email`, `jsonPayload.path`) to review denials for a few working days; (4) fix gaps (overrides, emails, matrix changes via code review), repeat; (5) `enforce` on goms-dev, click-through each role; (6) the same path for prod, **only after the user explicitly approves the prod flip**; (7) rollback = set `RBAC_MODE=off` (env-only revision change); (8) note the user-visible change at enforce: signed-out Home/Map show the sign-in prompt instead of loading.

- [ ] **Step 3: Full local verification**

Run, in order, and record the output in the PR description:

```bash
npm run build --workspace @goms/domain
npx tsc -b
npm test
npm run test:component
cd apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run
```

Expected: all green, with `RBAC_MODE` unset (i.e. `off`) throughout — the suites that existed before this plan pass unchanged, which is the proof that deploying this code with the flag off changes nothing.

- [ ] **Step 4: Prove each mode on a local server**

Start the API locally (`cd apps/api && npm run dev`) with `AUTH_ENFORCEMENT_ENABLED=true`, then with `RBAC_MODE=shadow` and `RBAC_MODE=enforce`, and confirm with a signed-in browser session as a Sales user and an IT user: (a) shadow logs denials and blocks nothing, (b) enforce blocks a Sales user's stage edit with a normal "You don't have permission…" message and **no** sign-in dialog, (c) a signed-out visitor gets the sign-in prompt on Home, (d) an account listed in the locally-set `ADMIN_ALLOWED_EMAILS` shows `system_admin` in `auth.me`, can edit a SKU cost and see it unmasked, and cannot be granted or stripped of the role from Role & Access Management. Use the headless Playwright approach already used for grid bugs for (b)/(c) if a manual click-through is not convenient.

- [ ] **Step 5: Commit**

```bash
git add infra docs
git commit -m "chore(rbac): RBAC_MODE flag (off) in dev and prod config, plus the rollout runbook" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (against the spec)

**Spec coverage**

| Spec | Task |
|---|---|
| §3 roles, derivation, overrides, break-glass, caching, no-role baseline | 1, 3, 4, 5, 14 |
| §4 26 modules; Master Grid derived; Directory split; Data Import outside | 1, 8–11, 17 |
| §5 level / scope / create / delete, merge, fail closed | 1, 3, 6, 11 |
| §6 field atoms, partial sets, Finance-controlled fields, Solution Lead frozen | 2, 3, 8, 10, 17 |
| §7 read masking incl. derived values, audit logs, writes | 2, 10, 18 |
| §8 the 18 public queries | 9, 10, 13 |
| §9 registry, multi-requirement rule, scopes, `created_by` | 6–9, 11, 12 |
| §10 matrix | 1 (data), 8–10 (behavior) |
| §11 `RBAC_MODE`, shadow log, migrations, sequence | 4, 6, 14, 21 |
| §12 frontend + testing | 15–20; tests in every task |
| Spec corrections 1 and 2 (Solution Lead; multi-requirement) | 3, 8, 11, 17, 19 |
| §3.4 System Admin (allow-list-only, unrestricted, protected, not an override) | 1–5, 8–10, 14, 15, 17, 20, 21 |
| A6 (Sales derives from `active`/`onLeave` only) | 1, 5, 14 |

**Placeholder scan:** the only deliberately non-literal instructions are mechanical and bounded: Task 19's per-screen gating follows an explicit table and is enforced by a failing-then-passing inventory test; Task 18 step 3 lists the exact five edits and lets `tsc` enumerate consumers. Task 7's `lib/*` moves are verbatim relocations with the existing suites as the guard.

**Type consistency checked:** `Check` / `Requirement` / `PolicyEntry` (Task 6) are used unchanged in Tasks 8–11, 14; `UserFacts` / `ScopeFacts` / `Access` (Tasks 1, 3) are used by the API loaders (Tasks 5, 7) and the UI (Tasks 15, 17); `MyAccess` (Task 14) is what Task 15 consumes; `accessFor` / `allows` signatures are identical on server and UI; atom names in `FIELD_SETS` (Task 1) match the maps in `atoms.ts` (Task 2) and the registry (Tasks 8–10, `ownership.solutionLead`, `boq.approve`, `bid.nextAction`, `doc.upload`, `corrigendum.review`).

**Known consequences to expect while executing (informational, already approved):** moving a row between Bid Tracker and Pipeline needs write on both sheets, which no single role holds (only a user holding both Sales and Bid roles can); Legal can reject but not accept a data-rewriting corrigendum change; Legal, Delivery and Finance see salesperson names but not personal data; the grid's Solution Lead cell becomes read-only for everyone under RBAC while `RBAC_MODE=off` leaves today's behavior untouched.
