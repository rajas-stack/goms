# Role-Based Access Control (RBAC) Design

**Status:** Draft for review — no implementation started.
**Date:** 2026-10-06
**Basis:** a read-only inventory of all 178 tRPC procedures (`apps/api/src/routers`), the frontend routes and modules, the domain entities (`packages/domain`), the ownership/assignment logic, the org-chart seed (`1790700000000_org-people.sql`), and `infra/{dev,prod}/cloudrun.tf`. Decisions from the 2026-10-06 brainstorm are folded in; assumptions I made beyond those decisions are listed in §14 for confirmation.

## 1. Goal and scope

Add server-enforced, role-based authorization on top of the existing identity layer (verified `@amnex.com` Google login). Eight roles: **Sales, Pre-sales, Bid, Legal, CXO, Delivery, IT, Finance**. Four permission levels: **None, Read, Partial (explicit field-level edit), Write**. Record scope, Create and Delete are separate dimensions. Field-level **read visibility** is separate from field-level **editability** (SKU cost/floor-price masking).

In scope: the policy model, role derivation + overrides, server enforcement on every procedure, read masking, gating the 18 currently-public queries, the permission API the UI consumes, rollout behind a flag.
Out of scope (§13): row-level *read* scoping, a DB-editable matrix, RBAC for Admin Data Import, auto-deriving Delivery.

## 2. What the inventory established

- **Authorization today is identity-only.** `protectedProcedure` / `protectedReadProcedure` check "verified `@amnex.com`"; `adminProcedure` / `adminImportProcedure` use env allow-lists ([trpc.ts](../../../apps/api/src/trpc.ts)). No role exists in the API, DB or frontend.
- **Every edit funnels through a small set of write paths.** The Master Grid has none of its own: each cell routes to `opportunities.update`, `bids.update`, `bidCustomFields.setValue`, `ownership.assign/end`, `followUps.create/setStatus`, or `bids.markVerified` ([gridColumns.ts](../../../src/modules/bid-tracker/gridColumns.ts) `editable` kinds). Enforcing on those procedures *is* the Master Grid permission.
- **Pipeline and Campaign are sheets, not entities.** Each bid lives in exactly one sheet (`bids.sheet`; `OWNED_SHEETS` in `packages/domain/src/bids.ts`). They share all procedures with Bid Tracker, so the split is a *sheet filter* on the same permission check. Moving a row (`bids.update {sheet}`) needs write on both source and destination sheet.
- **The Opportunity record is written from two surfaces** (the grid and Account Mapping's work dialogs). Permission therefore attaches to the **field**, not the screen.
- **Free-text `entityType`** on documents, follow-ups, protected values and audit logs: their permission must resolve through the entity they belong to.
- **`hierarchy` serves three domains** (`geo`, `org`, `sales`) from one router; its mutations and reads carry the domain as data.
- **Role slots already exist on opportunities:** `geoSalesPersonId`, `buSalesPersonId` (→ `sales_persons`), `preSalesPersonId`, `legalPersonId`, `bidTeamMemberId` (→ `delivery_team_members`). There is **no Delivery slot and no Delivery team** — `delivery_team_members.team` is `preSales | legal | bid` only, and the code's "delivery teams" means those three.
- **Org data cannot drive role derivation as it stands:** all 50 `org_people` rows and all roster emails are blank in the seed. Finance has 1 person (Denish), Technology 1 (Anish), Sales 1 (JP); the real Sales roster is `sales_persons` (outside `org_people`).
- **Margin is computed client-side** from SKU cost fields (`marginPctForSellingPrice` etc.); there is no server margin. Masking cost fields therefore also removes margin for roles that cannot see cost.
- **Existing interim controls:** a per-browser column unlock in the grid and a session "Sales edit lock" — both commented as "until role-based access decides who may".

## 3. Roles and role derivation

### 3.1 Effective roles

`effectiveRoles(email) = (derived ∪ overrideGrants) − overrideRevokes`. A user may hold several roles; **CXO is additive** and never removes functional roles (e.g. the CFO keeps Legal and gains CXO).

### 3.2 Derivation rules (only these)

| Role | Derived from |
|---|---|
| Pre-sales | `org_people.status='active'` AND `'Pre-Sales' = ANY(departments)` AND `lower(email)` = login |
| Bid | same, department `Bid Management` |
| Legal | same, department `Legal` |
| CXO | same, department `Leadership` (+ overrides; the CEO, CFO and CE&TO are **explicit grants**, they are not in Leadership) |
| Sales | `sales_persons.status <> 'inactive'` AND `lower(official_email)` = login (`sales_persons` is outside `org_people`) |
| Finance | **override-only** |
| IT | **override-only** |
| Delivery | **override-only** — explicitly *not* derived from Business Units |

No other label (Business Units, Technology, Finance, Chairman's Office…) is mapped to a role. A person with no email derives no roles. Finance and IT are override-only because the org chart holds one person each and no code maps those departments; this is flagged in §14.

### 3.3 Overrides

New table `user_role_overrides`:

```
id uuid pk, email text not null (stored lower-cased),
role text not null check (role in ('sales','presales','bid','legal','cxo','delivery','it','finance')),
effect text not null check (effect in ('grant','revoke')),
reason text not null, created_by text not null, created_at timestamptz default now(),
unique (email, role)
```

Managed in **Role & Access Management** (IT writes). The screen also provides an **access-readiness view**: per person, derived roles, "no email" warnings, and users who authenticated but resolved to zero roles.

**Bootstrap / break-glass:** emails in the existing `ADMIN_ALLOWED_EMAILS` env var implicitly hold IT and can manage overrides; they cannot be revoked through the UI. This prevents lock-out and needs no seed data (the CEO/CFO/CE&TO emails are not in the repo, so those three CXO grants are created in the UI after deploy).

**Gating the access API itself:** `access.*` (overrides, readiness view) is always gated, regardless of `RBAC_MODE`, because overrides created while RBAC is `off` become live the moment it is enforced. In `off` mode it is gated by the existing `adminProcedure` allow-list (`ADMIN_ALLOWED_EMAILS`) only; in `shadow`/`enforce` it is gated by `admin.access` (IT) or that allow-list.

**Caching:** effective roles are resolved per request with a short in-process TTL (60 s) per email. Override/org/roster writes take effect within one TTL on every Cloud Run instance. Acceptable for a role change; stated so it is not a surprise.

**No-role users:** an authenticated `@amnex.com` user with zero roles gets the **baseline**: Geography read only (§8) plus `auth.me`, and the UI shows "No role assigned — contact IT". Everything else is None.

## 4. Modules (26)

Permission is set per (role, module). A procedure normally has **one** authorization requirement — a single (module, field-atom) — recorded in the registry in §9. A procedure that touches more than one module declares **multiple requirements and every one of them must pass**; it is never authorized against only one of the modules it touches.

| # | Key | Module | Governs |
|---|---|---|---|
| 1 | `opp.bidTracker` | Bid Tracker rows | `bids.*`, `opportunities.update` on rows where `sheet='bidTracker'` |
| 2 | `opp.pipeline` | Pipeline rows (Funnel/Backup/Commits) | same, `sheet` in `pipeline-*` |
| 3 | `opp.campaign` | Campaign rows | same, `sheet='campaign'` |
| 4 | `opp.master` | **Master Grid** | *derived — no independent permission or authorization path* |
| 5 | `bid.milestones` | Milestones & dates | `bidMilestones.*` (submission-deadline milestone also writes `opportunities.submission_date`) |
| 6 | `bid.corrigenda` | Corrigenda | `bidCorrigenda.create`, `reviewChange` (accepting rewrites tender link / a milestone) |
| 7 | `bid.documents` | Tender documents | `documents.*`, `documentCitations.*` (entityType `bid`) |
| 8 | `bid.protected` | Protected values | `protectedValues.freeze/unfreeze` |
| 9 | `bid.columns` | Grid columns (schema) | `bidCustomFields` definitions: create/update/reorder/archive/unarchive/delete (values are governed by row field `bid.custom`) |
| 10 | `am.contacts` | **People & Contacts** | `employees.*` (contacts, charges, merge, import) |
| 11 | `am.departments` | **Customer Departments & Offices** | `hierarchy` mutations where `domain='org'` |
| 12 | `am.geography` | Geography | `hierarchy` mutations where `domain='geo'` |
| 13 | `am.customers` | Customers | `customers.*` (API only; no screen) |
| 14 | `am.meetings` | Meetings | `employees.timeline.*` (`add`, `update`, `setAttended`, `delete`) |
| 15 | `am.followUps` | Follow-ups & Action Queue | `followUps.*` for non-bid entities; Action Queue is a read view over bid next-actions |
| 16 | `am.ownership` | Ownership assignments | `ownership.assign/end/transferBookOfBusiness` |
| 17 | `team.sales` | Sales Team roster & postings | `sales.*` |
| 18 | `team.org` | **Company Org Structure** & team rosters | `orgPeople.*`, `deliveryTeams.*` |
| 19 | `com.masters` | Commercial reference masters | `commercial.masters.*` (except `approvalMatrix`), `setEditionFeatures` |
| 20 | `com.approvalMatrix` | Approval Matrix | `commercial.masters.*` where `key='approvalMatrix'` |
| 21 | `com.skus` | SKU catalog & BOM | `commercial.skus.*`, `commercial.bom.*` |
| 22 | `com.boqs` | BOQs & proposals | `commercial.boqs.*` |
| 23 | `an.operational` | Operational analytics | Opportunity Dashboard, Relationship Analytics, Sales Team Insights counts, Commercial Dashboard status counts |
| 24 | `an.financial` | Commercial / financial analytics | Sales Team Insights "Pipeline value by salesperson" |
| 25 | `admin.access` | Role & Access Management | `access.*` (new) |
| 26 | `admin.audit` | Audit Logs (global feed) | `auditLogs.list`, `commercial.auditLogs.list` |

**Outside RBAC:** Admin Data Import keeps its own allow-list (`ADMIN_IMPORT_ALLOWED_EMAILS`) and `ADMIN_IMPORT_ENABLED` flag, unchanged — the 2026-09-04 auth decision doc (§3) requires that granting one admin surface never implicitly grants another.

**Directory split (decision 5):** People & Contacts (`am.contacts`, the `employees` router), Customer Departments & Offices (`am.departments`, the org-domain node tree) and Company Org Structure (`team.org`, `org_people` and roster mirroring) are three independent modules. Employee/contact write permission grants nothing on departments or the org chart. Operations that cross modules (e.g. `employees.transfer` re-posts a contact to a department node) require the permission of **each** module they touch.

## 5. Permission model

A grant is `(role, module) → { level, scope, fieldSets, create, delete }`.

- **level** — `N` none, `R` read, `P` partial, `W` write. `P` and `W` imply `R`.
- **scope** (applies to writes only) — `all`, `own`, `asg`. Rows outside the scope fall back to **Read**. There is no row-level read scoping in v1 (§13).
- **fieldSets** (for `P`) — named sets of field atoms (§6). `W` means every atom.
- **create / delete** — independent booleans. Invalid without level ≥ R (validated at policy load). A **create** is authorized by the `create` grant alone; the create payload is validated by the procedure's own schema and is not narrowed by `P` sets (otherwise a Create Bid by a `P` role could never supply its required fields).
- **Merge across roles** (decision "max permission, union fields/scopes"): for a given row, take every grant whose scope contains the row; effective level = max; if any applicable grant is `W` → all atoms, else the union of the applicable `P` sets; `create`/`delete` = OR. Rows outside every write scope get `R` if any grant has level ≥ R.
- **Fail closed:** a procedure with no registry entry, or a patch key with no atom, is denied. A test enforces registry completeness (§12).

## 6. Field-level model

### 6.1 Editable field atoms (Opportunity & Bid rows)

Derived from `opportunities.patchShape`, `bids.update`'s patch, and the grid's column groups.

| Atom | Fields / actions |
|---|---|
| `opp.identity` | `opportunityName`, `opportunityType`, `referenceNo`, `assignmentName`, bid `tenderLink` |
| `opp.tenderId` | `gemTenderId` (protected-value-aware; Bid only) |
| `opp.client` | `departmentId` (re-points `stateCode`), `city`, `vertical` |
| `opp.value` | `valueAmount`, `valueUnit`, `currency`, `budgetKnown`, `quantity`, `component` |
| `opp.emd` | `emdAmount`, `emdUnit` |
| `opp.dates` | `publishDate`, `submissionDate`, `closedOn` |
| `opp.stage` | opportunity `stageKey` |
| `opp.teamSales` | `geoSalesPersonId`, `buSalesPersonId`, `salesPersonEmail` |
| `opp.teamDelivery` | `preSalesPersonId`, `legalPersonId`, `bidTeamMemberId` |
| `bid.stage` | bid `stageKey` |
| `bid.decision` | `decision` (Go / No-Go) |
| `bid.move` | `sheet` (move between sheets) |
| `bid.verify` | `bids.markVerified` |
| `bid.archive` | `archive` / `unarchive` |
| `bid.nextAction` | bid-typed follow-up: note, owner, due date |
| `bid.custom` | custom-column values (`bidCustomFields.setValue`) |

`opportunityCode` stays locked for everyone (existing rule). Grid fields that are read-only for derivation reasons (State, Next Milestone, Attention…) have no atom.

### 6.2 Named partial sets

| Set | Atoms | Used by |
|---|---|---|
| `S1` | `opp.client`, `opp.value`, `opp.emd`, `opp.teamSales`, `bid.nextAction`, `bid.custom` | Sales on Bid Tracker rows (own) |
| `P1` | `bid.nextAction`, `bid.custom` | Pre-sales on Bid Tracker & Pipeline rows (assigned) |
| `L1` | `bid.nextAction`, `bid.custom` | Legal on Bid Tracker rows (assigned) |
| `X1` | `bid.decision` | CXO on Bid Tracker rows (evidence: `BID_STAGE_REQUIREMENTS.qualification` = "Record executive Go / No-Go sign-off") |
| `L2` | `corrigendum.review` (accept/reject a change) | Legal on Corrigenda |
| `DOC1` | `doc.upload` | Pre-sales, Legal on Tender documents (assigned) |
| `B1` | `ownership.bidEntity` (assign/end the bid-level **owner**, `role='owner'` where `entityType='bid'`) | Bid on Ownership |
| `S2` | `sales.ownProfile` (photo, mobile, personal email of the user's own roster row) | Sales on Sales Team |
| `F1` | `sku.costs`, `sku.floor`, `sku.tax` | Finance on SKU catalog |
| `F2` | masters `taxClasses`, `currencies` | Finance on reference masters |
| `X2` | `boq.approve` (BOQ/line approve & reject) | CXO on BOQs |

`bid.stage`, `bid.verify`, `bid.archive`, `bid.move`, `opp.tenderId`, `opp.dates`, `opp.stage` are never in a `P` set; only `W` roles hold them.

**Solution Lead is read-only in v1, for every role.** There is no history-safe write mechanism: replacing a Solution Lead is two separate calls (end the incumbent, then assign the successor), and `ownership.assign` only auto-closes the previous holder for `role='owner'`. It therefore has no atom and is in no `P` set; under RBAC, `ownership.assign` and `ownership.end` on `role='solutionLead'` are denied to every role, including those holding `W` on #16. Solution Lead stays readable wherever its owning row is readable.

`DOC1`, `L2`, `X2` and `B1` contain **action atoms** (`doc.upload`, `corrigendum.review`, `boq.approve`, `ownership.bidEntity`) rather than data fields: `P` with an action atom means "may perform only these actions". Where such an action is a **create under a parent row** (a document on a bid), the grant's scope (`asg`) is evaluated against the parent row, and the `create` column of §10 supplies the create grant.

### 6.3 Finance-controlled commercial fields

`sku.costs` (the 8 `SKU_COST_FIELDS`), `sku.floor` (§7), `sku.tax` (`taxClassId`) and the `taxClasses` / `currencies` masters are **Finance-controlled**: Finance edits them; Pre-sales can read them (cost-visible role) but cannot edit them after creation. (Creation payload is not narrowed, §5.) The existing `SKU_SENSITIVE_FIELDS` reason-on-edit rule is **kept and additive** — a Finance edit still needs a `changeReason`.

## 7. Read-masking model

Field-level read visibility is a separate axis from editability.

| Restricted atom | Fields | Visible to |
|---|---|---|
| `sku.costs` | `baseSoftwareCost`, `implementationCostPerMM`, `integrationCost`, `thirdPartyCost`, `hardwareCost`, `cloudCost`, `supportCost`, `trainingCost` | Pre-sales, Finance, CXO |
| `sku.floor` | `floorPrice`, `minimumAllowedPrice`, `internalPrice` | Pre-sales, Finance, CXO |

All other SKU price fields (`partnerPrice`, `governmentPrice`, `enterprisePrice`, `corporatePrice`, `listPrice`, `maximumDiscountPercent`) are visible to any role with `com.skus` ≥ R.

**Enforcement is server-side, in the response path** of every procedure that returns SKU data (`commercial.skus.list/get/create/update`, and any procedure that embeds a SKU row). Masked fields are returned as `null` with a `maskedFields: string[]` list — never `0`, which would silently produce wrong totals. Domain types change those fields to `number | null`.

**Leak channels covered by the same mask:**
- **Derived values:** margin %, "Below Cost", cost roll-ups and selling-price-by-margin are computed client-side from cost fields. For a role without `sku.costs`, the UI hides them (they cannot be computed); nothing derived from cost is ever persisted or returned by the server.
- **Audit logs:** `commercial.auditLogs.list` / `auditLogs.list` entries for SKU cost/floor fields have `oldValue`/`newValue` masked for roles without the atom.
- **Writes:** a role cannot patch a field it cannot read.
- **Export** is client-side CSV of API responses, so it inherits the mask.

A golden test seeds sentinel cost values and asserts none reach a masked role through any procedure or audit log (§12).

## 8. Gating the 18 currently-public queries

The inventory finds exactly 18 `publicProcedure` queries. `READ_AUTH_ENFORCEMENT_ENABLED` is already `"true"` in dev and prod, so these 18 are the **only** calls a signed-out user can make today — they power the signed-out Home and Map.

| Procedure(s) | Count | Resulting read gate |
|---|---|---|
| `health.check` | 1 | **Stays public** (liveness probe; returns no data) |
| `hierarchy.listStates`, `getState`, `geoRoot` | 3 | `am.geography` ≥ R. Baseline users keep this. `listStates` also returns per-state aggregate counts (departments, offices, employees); these stay visible with Geography read — an accepted, aggregate-only exposure |
| `hierarchy.listOrgRoots`, `listDepartments`, `listPostingNodes` | 3 | `am.departments` ≥ R |
| `hierarchy.getNode`, `listChildren`, `breadcrumb`, `childCount`, `childCounts`, `moveTargets` | 6 | **Resolved by the target node's `domain`**: `geo` → `am.geography`; `org` → `am.departments`; `sales` → `team.sales` |
| `commercial.masters.list`, `get`, `listEditionFeatures` | 3 | `com.masters` ≥ R; if `key='approvalMatrix'` → `com.approvalMatrix` ≥ R |
| `commercial.bom.listForSku`, `listAll` | 2 | `com.skus` ≥ R (BOM carries structure, not cost) |

**No silent change.** The new tier `rbacReadProcedure(resolver)` behaves as follows by `RBAC_MODE` (§11): **off** — identical to today's `publicProcedure`, no auth, no change; **shadow** — same behavior, logs the would-be decision; **enforce** — requires a verified `@amnex.com` login plus the resolved read permission. A plain swap to `protectedReadProcedure` is *not* used because it would enforce immediately in prod.

**Behavior change at enforce (stated up front):** signed-out Home/Map stop working — the existing `AuthPromptDialog` flow appears instead (to be verified end-to-end, including on Android). Dependent reads: Commercial screens consume reference masters and, for edit flows, the approval-matrix bands. A role with `com.boqs` ≥ R gets implicit read on the reference masters those screens call; read on `approvalMatrix` is held by roles that price or review (Pre-sales, Finance, CXO). Each Commercial screen is exercised per role in tests to prove no unintended `FORBIDDEN` (§12).

## 9. Enforcement architecture

- **Policy as code in `@goms/domain`** (`rbac/policy.ts`): the matrix, atoms, sets and masks as typed constants — one source for server and UI, reviewed in PRs. A DB-editable matrix is rejected (YAGNI; role *membership* is what changes, via overrides).
- **Pure evaluators in `@goms/domain`**: `mergeGrants`, `canEdit(perms, rowFacts, atom)`, scope resolvers over supplied facts — shared by server (authoritative) and UI (hints).
- **API** (`apps/api/src/auth/rbac/`): `roles.ts` (effective-role resolution + TTL cache), `facts.ts` (loads a user's identity facts), `guard.ts` (middleware factory), `mask.ts`, and the procedure registry.
- **Registry:** `PROCEDURE_POLICY['router.proc'] = { requirements: Requirement[] }`, where `Requirement = { module | resolver, action: 'read'|'create'|'update'|'delete', atoms(input)?, scope?: entity resolver }`. Patch-based procedures map patch keys → atoms; others declare a fixed atom. Most procedures have exactly one requirement. A procedure that touches several modules lists one requirement per module and **all must pass** (logical AND, order-independent; the denial names the first failing module); an operation is never authorized against a single module when it also writes another. The inventory's cross-module procedures include: `bids.update` with `sheet` (source and destination sheet modules), `bids.create` when it creates a department (sheet module + `am.departments`), `employees.transfer` (`am.contacts` + `am.departments`), `bidMilestones.*` on the submission-deadline milestone (`bid.milestones` + the row's `opp.dates`), and `bidCorrigenda.reviewChange` when an accepted change rewrites the tender link or a milestone (`bid.corrigenda` + the affected field's module).
- **Middleware order:** existing gates first (emergency read-only → authentication → `@amnex.com`), then RBAC. Denials throw `FORBIDDEN` naming what was refused ("You can't edit Tender ID"). A multi-field patch is all-or-nothing.
- **Facts for scope** (resolved once per request): the user's `sales_persons.id` (via `official_email`); the user's `delivery_team_members.id` set (via `org_person_id` → `org_people.email`, else `delivery_team_members.email`); effective roles.

### 9.1 Record scopes (precise)

| Scope | Definition |
|---|---|
| `own` — bid / opportunity | the user's sales person is the **effective owner** (same `buildOwnerMap` inheritance used for the grid's *Bid Owner* column, so RBAC "own" = the "My Bids" meaning), OR an active `delegate` / `solutionLead` on the entity, OR `geoSalesPersonId` / `buSalesPersonId` on the opportunity |
| `own` — contact / org node | effective owner via the ownership chain |
| `own` — meeting / follow-up | `created_by` = user (new column, below), else (legacy rows) the user's sales person is an attendee / assignee, else owns the contact |
| `own` — Sales Team roster | the user's own `sales_persons` row |
| `asg` — bid / opportunity | `preSalesPersonId` / `legalPersonId` / `bidTeamMemberId` ∈ the user's team-member id set (slot must match the role: Pre-sales→`preSalesPersonId`, Legal→`legalPersonId`, Bid→`bidTeamMemberId`) |

**Delivery has no assignment slot**, so Delivery can hold no `own`/`asg` grants; its grants are read-only in v1.

Migration adds nullable `created_by text` to `timeline_events` and `follow_ups` (set from `ctx.user.email` on create). Legacy rows resolve through the fallbacks above.

## 10. Final matrix

Columns: **S** Sales, **Pr** Pre-sales, **B** Bid, **L** Legal, **X** CXO, **D** Delivery, **I** IT, **F** Finance. `·own`/`·asg` = write scope (other rows are read-only). `[Sx]` = partial set (§6.2). Create/Delete list the roles holding that grant.

| # | Module | S | Pr | B | L | X | D | I | F | Create | Delete |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bid Tracker rows | P·own [S1] | P·asg [P1] | W | P·asg [L1] | P [X1] | R | R | R | S, B | B |
| 2 | Pipeline rows | W·own | P·asg [P1] | R | R | R | R | R | R | S | B |
| 3 | Campaign rows | W·own | R | R | R | R | R | R | R | S | B |
| 4 | **Master Grid** | *derived: rows visible = union of 1–3; a cell is editable iff the module governing its field allows it* | | | | | | | | — | — |
| 5 | Milestones & dates | R | R | W | R | R | R | R | R | B | B |
| 6 | Corrigenda | R | R | W | P [L2] | R | R | R | R | B | B |
| 7 | Tender documents | R | P·asg [DOC1] | W | P·asg [DOC1] | R | R | N | R | B, Pr, L | B |
| 8 | Protected values | R | R | W | R | R | R | R | R | B | B |
| 9 | Grid columns (schema) | R | R | W | R | R | R | W | R | B, I | B, I |
| 10 | People & Contacts | W | R | R | R | R | R | R | R | S | I |
| 11 | Customer Departments & Offices | W | R | R | R | R | R | R | R | S | I |
| 12 | Geography | R | R | R | R | R | R | W | R | I | I |
| 13 | Customers (API only) | N | N | N | N | N | N | R | N | — | — |
| 14 | Meetings | W·own | R | R | N | R | R | N | N | S | S·own |
| 15 | Follow-ups & Action Queue | W·own | R | R | R | R | R | N | N | S | S·own |
| 16 | Ownership assignments | W·own | R | P [B1] | N | W | N | R | N | S, B, X | S, B, X |
| 17 | Sales Team roster | P·own [S2] | R | R | N | W | N | R | N | X, I | X, I |
| 18 | Company Org Structure | R | R | R | R | W | R | R | R | X | X |
| 19 | Commercial reference masters | R | W | R | N | R | N | N | P [F2] | Pr | Pr |
| 20 | Approval Matrix | N | R | N | N | W | N | N | R | X | X |
| 21 | SKU catalog & BOM | R† | W | N | N | R | N | N | P [F1] | Pr | Pr |
| 22 | BOQs & proposals | R† | W | R† | N | P [X2] | N | N | R | Pr | Pr |
| 23 | Operational analytics | R | R | R | R | R | R | R | R | — | — |
| 24 | Financial analytics | N | N | N | N | R | N | N | R | — | — |
| 25 | Role & Access Management | N | N | N | N | R | N | W | N | I | I |
| 26 | Audit Logs (global feed) | N | N | N | N | R | N | R | N | — | — |

† Read with **cost and floor-price fields masked** (§7). On #19, Pre-sales holds `W` except the two Finance-controlled masters (`taxClasses`, `currencies`), which are read-only for it. On #21, Pre-sales `W` excludes `F1` atoms after creation (§6.3). Reading #22 implies the reference-master reads in §8.

**Notes**
- Rows 1–3: Bid's `W` on #1 is all rows; on #2/#3 it is read-only. Moving a row between sheets needs `bid.move` (W only) on both sheets.
- #14 and #15: bid-typed next-actions are **not** governed by #15; they are the `bid.nextAction` atom on rows 1–3. #15 governs contact and other non-bid follow-ups. The Action Queue is a read view readable by anyone with any of rows 1–3 ≥ R.
- An audit entry is readable if the role can read the entity's module; #26 is the ability to read the *global* feed.
- Delivery (D) grants are the lowest-confidence column (explicit-override-only role with no data slot).
- Baseline (no role): everything None except Geography Read.

## 11. Rollout and the enforcement flag

The existing flags cannot gate this literally: `AUTH_ENFORCEMENT_ENABLED` and `READ_AUTH_ENFORCEMENT_ENABLED` are already `"true"` in **both** dev and prod ([infra/dev/cloudrun.tf](../../../infra/dev/cloudrun.tf), [infra/prod/cloudrun.tf](../../../infra/prod/cloudrun.tf)), so keying RBAC to them would enforce on deploy. RBAC gets its own flag with the same discipline: **`RBAC_MODE` = `off` (default) | `shadow` | `enforce`**, evaluated only when `AUTH_ENFORCEMENT_ENABLED` is true.

- **off:** exact no-op; the 18 public queries stay public; `auth.me` reports "everything allowed". Deploying this code is a deliberate no-op release.
- **shadow:** all checks run; denials are **logged, not applied** (structured JSON `{event:"rbac.would_deny", email, module, action, atom}` via `console.log` — the API has no Fastify logger, so stdout is the only channel Cloud Logging captures). Used to find missing emails, missing overrides and mis-mapped roles before anyone is blocked.
- **enforce:** denials applied.
- `EMERGENCY_READ_ONLY` stays independent and unchanged. Reverting is flipping `RBAC_MODE` back to `off` via the same Cloud Run env change used for the other flags.

**Sequence:** deploy with `off` (goms-dev) → backfill org emails and create overrides (the Role & Access screen works in `off`) → `shadow` on dev, review denials → `enforce` on dev → prod follows the same path. Per the standing constraint, **the prod flip needs its own explicit approval**, separate from approving the code.

**Migrations:** `user_role_overrides`; `created_by` on `timeline_events` and `follow_ups`. All safe with `off`.

## 12. Frontend and testing

**Frontend**
- New `auth.me` query returns effective roles, the compiled per-module permissions (level, scopes, atoms, create/delete), masked atoms, and the user's identity facts (own `sales_persons.id`, team-member ids).
- `usePermissions()` + shared pure evaluators drive: nav and route visibility (None hides the module; direct URL shows "No access"), per-row/per-cell editability in the grid (a cell is editable iff the grid is unlocked **and** permitted), dialogs and buttons, and masked-field rendering ("Restricted").
- The grid's per-browser column unlock for read-only columns (`unlockable`) is replaced by permission-driven editability. The grid's global lock/unlock toggle and the Sales edit lock remain as *accident guards*; permissions decide whether the toggle is offered.
- The UI is advisory only; the server is the authority.

**Testing**
- **Policy validity:** every module × role cell defined; `P` has sets; create/delete imply ≥ R; sets reference real atoms.
- **Registry completeness:** a test fails if any router procedure lacks a `PROCEDURE_POLICY` entry (same pattern as the grid's guarded editable matrix).
- **Merge/scope:** unit tests for max/union, scope resolvers, the Delivery no-scope rule.
- **Per-role integration:** the real tRPC caller, one allow and one deny per module per role, including patch-key denial and sheet moves.
- **Masking golden test:** sentinel cost values never reach a masked role via any SKU-returning procedure or either audit-log procedure.
- **Public-query tests:** `off` → unauthenticated succeeds; `enforce` → unauthenticated rejected, per-role reads match §8.
- **Commercial dependent-read test:** each Commercial screen exercised per role with no unintended `FORBIDDEN`.
- **Frontend component tests** for gated UI and masked rendering. Local unit + component suites run before any deploy; click-through E2E remains post-deploy.

## 13. Non-goals

Row-level read scoping; a DB-editable matrix; per-user custom permissions beyond role overrides; RBAC for Admin Data Import; auto-deriving Delivery, Finance or IT; a Delivery assignment slot on opportunities; field-level read masking beyond SKU cost/floor; masking Sales roster personal data; Finance edit on opportunity EMD/value; SSO group sync.

## 14. Assumptions to confirm

1. **Directory split** is three modules (People & Contacts / Customer Departments & Offices / Company Org Structure). "Departments" = the customer org-node tree; "the org chart" = `org_people`.
2. **Finance and IT are override-only** (no department derivation), because decision 7 forbids inferring beyond the stated mappings and the org chart holds one person each.
3. **`internalPrice` and `minimumAllowedPrice` are masked with `floorPrice`.** You named "cost/floor-price"; these two are the closest siblings.
4. **Finance-controlled means Finance edits** cost, floor, tax class and the tax/currency masters; Pre-sales reads but does not edit them after creation.
5. **CXO can read cost and floor price** (as Approval Matrix owner); Sales, Bid, Legal, Delivery, IT cannot.
6. **CXO gets the Go/No-Go decision field** (`X1`), based on `BID_STAGE_REQUIREMENTS` calling for "executive Go / No-Go sign-off".
7. **BOQ approve/reject is CXO-only** (`X2`); Finance reviews and reads.
8. **Bid may assign/end the bid-level owner** (`B1`); other ownership writes are Sales(own)/CXO. **Solution Lead is read-only for every role in v1** (see §6.2).
9. **No-role users** get Geography read only plus a "no role assigned" screen.
10. **`RBAC_MODE` is a new flag** (§11) rather than reusing flags already on in prod.
11. **Data Import stays under its own allow-list**, outside RBAC.
12. **Delivery is read-only in v1** (no slot to scope writes to).
13. **Delete in #10/#11 is IT-only** (merge counts as delete); Sales can create and edit.
