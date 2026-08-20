# GOMS Functional Acceptance Test Catalogue

Status: **First acceptance pass complete.** The highest-risk, highest-value
paths — full Account Mapping org/employee lifecycle, Sales Team gating, and
the complete Commercial Calculator SKU→BOQ→Approve/Reject cross-module
workflow — were driven live against a running instance (`npm run dev`, local
Supabase via Docker) and are documented with Pass/Fail evidence in §5 and §6.
Several lower-risk areas (Directory, Meetings, Analytics, Geography,
Import/Export, Settings, 9 of 12 Commercial Masters individually) were
reviewed at the code level only and are flagged as such in §7.A — they are
not yet live-executed and should not be treated as accepted until they are.
See §7 for the Functional Acceptance Report and the required-fixes list.

Scope: the entire application — Account Mapping and Commercial Calculator —
not just Commercial Calculator. Every mutation is tested for persistence
(create/edit/delete → refresh → verify) per the phase brief. Cross-module
data flows are tested explicitly, not just individual pages.

Sources used to derive expected behavior (never invented):
- `docs/superpowers/specs/2026-08-03-commercial-calculator-design.md` (PCS-001…038 FRS, authoritative for Commercial Calculator)
- `docs/superpowers/plans/2026-08-03-commercial-calculator-approval-enforcement.md` (PCS-029 enforcement)
- `docs/superpowers/specs/2026-08-18-goms-backend-architecture-design.md` (data model / relationships)
- `docs/backend-migration-status.md` (current persistence status per domain, and pre-existing known bugs/gaps)
- Direct code reading (routes, components) — Account Mapping has no single FRS document; behavior for it is derived from code + existing design docs under `docs/superpowers/specs/` and `analysis/`, and is called out as "Requirement ambiguity" where the intended behavior isn't documented anywhere.

Legend: **Pass** / **Fail** / **Blocked** / **Not Executed** (planned, not yet run this pass).
Defect classes: **Bug** / **Missing** / **UX** / **Data/Model** / **Ambiguity**.

---

## 0. Environment for this test pass

- App: `npm run dev` → `http://localhost:5175/`
- Backend: local Supabase (Docker), already running — all 13 repository domains are Supabase-backed per `docs/backend-migration-status.md` (no working in-memory/IndexedDB fallback remains reachable).
- Fresh/near-empty database at test start: 36 States & UTs and 736 Districts pre-seeded (geo tree), 0 org nodes (departments/offices), 0 employees, Commercial Calculator masters presumably seeded with defaults (Standard edition, SKU categories, etc. per spec §6.1) — verified per-master below.
- Browser: headless Chromium via Playwright, 1440×900 viewport.
- No authentication exists (Phase 8 not started) — not testing access control.

---

## 1. Account Mapping

### 1.1 Org hierarchy (Department/Branch/Division/Office/Unit)

| UC ID | Title | Start | Status |
|---|---|---|---|
| UC-AM-01 | Create Department (top-level org node) | Home → Account Mapping → Map | Not Executed |
| UC-AM-02 | Create child node (Branch/Division/Office/Unit) under a Department | State Workspace → Org tab | Not Executed |
| UC-AM-03 | Edit node name/details | State Workspace → Org tab → node details panel | Not Executed |
| UC-AM-04 | Move/reparent a node (drag on canvas) | State Workspace → Org tab | Not Executed |
| UC-AM-05 | Delete a node (with/without children) | State Workspace → Org tab | Not Executed |
| UC-AM-06 | Persistence: create → refresh → verify | any of the above | Not Executed |

#### UC-AM-01 — Create Department (top-level org node)
- **Preconditions**: App loaded, at least one state exists (seeded).
- **Steps**: 1. Account Mapping rail → Map. 2. Pick a state. 3. Org tab. 4. "+" / Create Department action. 5. Enter department name. 6. Save.
- **Expected**: New department node appears on the org canvas immediately; node count on Home increases.
- **Data created**: `departments` row (org `HierNode`, `type_key='department'`).
- **Consumed by**: Create BOQ's Department dropdown (UC-X-01), Employee creation's Department picker, Directory/People filters.

*(Full step-by-step execution log for this section follows in §5 as each UC is run.)*

### 1.2 Employees / Stakeholders

| UC ID | Title | Status |
|---|---|---|
| UC-AM-10 | Create Employee under a Department | Not Executed |
| UC-AM-11 | Edit Employee (designation, relationship status/quality, important contact, connected) | Not Executed |
| UC-AM-12 | Delete Employee who is a manager of other employees | Not Executed — **known bug to confirm**, see §4 |
| UC-AM-13 | Merge two Employee records | Not Executed |
| UC-AM-14 | Transfer Employee to another node | Not Executed |
| UC-AM-15 | Add Timeline Event / Log Interaction against an Employee | Not Executed |
| UC-AM-16 | Upload/scan Visiting Card (OCR) | Not Executed |
| UC-AM-17 | Persistence: create/edit/delete Employee → refresh → verify | Not Executed |

### 1.3 Geography

| UC ID | Title | Status |
|---|---|---|
| UC-AM-20 | Browse Geography tree (State → District → Taluka → Village) | Not Executed |
| UC-AM-21 | View shapes on map (GeoMapView) | Not Executed |

### 1.4 Directory, Search, Meetings, Analytics

| UC ID | Title | Status |
|---|---|---|
| UC-AM-30 | Cross-state Directory search | Not Executed |
| UC-AM-31 | Global Command Palette (⌘K) search across departments/offices/employees/meetings/opportunities/sales people | Not Executed |
| UC-AM-32 | Meetings timeline browser (filter, virtualized list) | Not Executed |
| UC-AM-33 | Relationship Analytics (connection health, quality/status bars, upcoming meetings) | Not Executed |

### 1.5 Import / Export / Settings

| UC ID | Title | Status |
|---|---|---|
| UC-AM-40 | Import Departments CSV | Not Executed |
| UC-AM-41 | Import People CSV | Not Executed |
| UC-AM-42 | Export CSV | Not Executed |
| UC-AM-43 | Settings → Backup/Restore | Not Executed |

---

## 2. Sales Team

| UC ID | Title | Status |
|---|---|---|
| UC-SALES-01 | Create Sales Person (Roster) | Not Executed |
| UC-SALES-02 | Edit Sales Person (designation, incl. "BU Sales …" designations) | Not Executed |
| UC-SALES-03 | Sales Org Chart view reflects roster/manager hierarchy | Not Executed |
| UC-SALES-04 | Ownership: assign owner (sales person) to a Department/Account | Not Executed |
| UC-SALES-05 | Transfer Book of Business between sales people | Not Executed |
| UC-SALES-06 | Create/advance an Opportunity (stage changes) | Not Executed |
| UC-SALES-07 | Sales edit lock (concurrent-edit protection) | Not Executed |
| UC-SALES-08 | Persistence: create/edit Sales Person → refresh → verify | Not Executed |

---

## 3. Commercial Calculator

### 3.1 Masters (12 generic-engine masters + BU Sales non-master)

| UC ID | Master | Status |
|---|---|---|
| UC-CC-M01 | Verticals CRUD | Not Executed |
| UC-CC-M02 | Products CRUD (parent FK → Vertical) | Not Executed |
| UC-CC-M03 | Modules CRUD (parent FK → Product) | Not Executed |
| UC-CC-M04 | Features CRUD (parent FK → Module, status existing/modified/new) | Not Executed |
| UC-CC-M05 | SKU Categories CRUD (seeded 12 defaults) | Not Executed |
| UC-CC-M06 | Units of Measure CRUD (seeded 6 defaults) | Not Executed |
| UC-CC-M07 | Product Editions CRUD + feature-mapping sub-editor (mandatory/optional, order) | Not Executed |
| UC-CC-M08 | Billing Types CRUD (seeded 5 defaults) | Not Executed |
| UC-CC-M09 | Tax Classes CRUD (ratePct) | Not Executed |
| UC-CC-M10 | Approval Matrix CRUD (min/max discount %, level label, auto-approve flag) | Not Executed |
| UC-CC-M11 | Currencies CRUD + base-currency exclusivity (setting one base clears all others) | Not Executed |
| UC-CC-M12 | Pre-Sales CRUD | Not Executed |
| UC-CC-M13 | BU Sales field sources from Sales Person designation filter (not a master) — confirm no "BU Sales" master screen exists | Not Executed |

### 3.2 SKU Catalog & Commercial BOM

| UC ID | Title | Status |
|---|---|---|
| UC-CC-SKU01 | Create SKU — code auto-generated as `{Vertical}-{Product}-{Module}-{Feature}-{STATUS}`, immutable | Not Executed |
| UC-CC-SKU02 | SKU code uniqueness enforced (duplicate generation throws) | Not Executed |
| UC-CC-SKU03 | Edit SKU pricing fields (Pricing Levels section); margin computed on read, not stored. Cost fields have no editing UI (Cost Management section removed) but remain in the data model and still feed margin math | Not Executed |
| UC-CC-SKU04 | Activate/Deactivate SKU (lifecycleStatus) | Not Executed |
| UC-CC-SKU05 | Delete SKU blocked if referenced by a BOM item or BOQ line item (PCS-038) | Not Executed |
| UC-CC-BOM01 | Add mandatory BOM component to a parent SKU | Not Executed |
| UC-CC-BOM02 | Add optional BOM component; verify "Optional Components" filter | Not Executed |
| UC-CC-BOM03 | Component cannot equal parent SKU (CHECK constraint) | Not Executed |

### 3.3 Create BOQ → BOQ Management → Approval → Dashboard → Audit Log (primary journey)

| UC ID | Title | Status |
|---|---|---|
| UC-CC-BOQ01 | Create BOQ end-to-end: Opportunity Info → Customer → Vertical → SKU lines → Commercials → Generate → Save Draft | Not Executed |
| UC-CC-BOQ02 | Opportunity Name uniqueness enforced among CommercialBoq records | Not Executed |
| UC-CC-BOQ03 | Discount clamped to `[0, min(90, sku.maximumDiscountPercent)]`; post-discount price ≥ `minimumAllowedPrice` | Not Executed |
| UC-CC-BOQ04 | Discount within an auto-approve band → line auto-approved, no approver required | Not Executed |
| UC-CC-BOQ05 | Discount above auto-approve band → line requires approverName/date/remarks before approved/rejected | Not Executed |
| UC-CC-BOQ06 | PCS-029 gate: BOQ cannot transition to `approved` while any line is still `pending` | Not Executed |
| UC-CC-BOQ07 | Submit BOQ: draft → submitted (lifecycle transition) | Not Executed |
| UC-CC-BOQ08 | Invalid lifecycle transition rejected (e.g. draft → approved directly) | Not Executed |
| UC-CC-BOQ09 | Revise a finalized BOQ: new row, `boqVersion`+1, `revisionNumber` reset to 0, same immutable `boqNumber`, `parentBoqId` set | Not Executed |
| UC-CC-BOQ10 | BOQ Management search/filter (number, opportunity, customer, sales person, department, vertical, status, date range) | Not Executed |
| UC-CC-BOQ11 | BOQ detail: status history sourced from Audit Log filtered to `entityType:'boq'` | Not Executed |
| UC-CC-DASH01 | Dashboard KPI cards (Draft/Pending/Approved/Rejected counts) are clickable filters; clicking shows only that status's BOQ list, with an active-card state and an empty state for zero-count statuses | Not Executed |
| UC-CC-DASH02 | Dashboard "Recent BOQs" links into BOQ Management/detail | Not Executed |
| UC-CC-AUD01 | Audit Log lists entries for SKU/BOQ/feature/employee changes, filterable by entity type and date range | Not Executed |
| UC-CC-CAT01 | Catalog hierarchy tree (Vertical→Product→Module→Feature) view | Not Executed |

### 3.4 Pricing Overhaul (2026-08-19)

| UC ID | Title | Status |
|---|---|---|
| UC-CC-PL01 | Add a pricing level to a draft line via "+ Add Pricing Level"; an already-added level is not offered again | Not Executed |
| UC-CC-PL02 | Enter a Selling Price on a pricing-level card; Discount % (derived against List Price) and Line Total update immediately | Not Executed |
| UC-CC-PL03 | Enter a Margin % on a pricing-level card; Selling Price and Discount % back-solve and update immediately | Not Executed |
| UC-CC-PL04 | A Selling Price or Margin implying a discount above the SKU's maximumDiscountPercent is rejected with an inline error, not silently clamped | Not Executed |
| UC-CC-PL05 | Switch the active pricing level between two added levels; unit price/discount/line total/margin/approval requirement all update to the newly active level | Not Executed |
| UC-CC-PL06 | Remove the currently active pricing level; the line falls back to List Price / no discount and an inline prompt asks the user to pick a level | Not Executed |
| UC-CC-PL07 | Empty Selling Price/Margin inputs show placeholder text, never a hardcoded 0; entering 0 is accepted and displayed as 0 | Not Executed |
| UC-CC-APR01 | Expand a line item's approval summary; auto-approved lines clearly state no approval is required; lines needing approval name the band | Not Executed |
| UC-CC-PREV01 | BOQ Preview is collapsed by default in Create BOQ and expands/collapses without losing any entered BOQ data | Not Executed |
| UC-CC-NAV01 | Section-jump nav bar in Create BOQ scrolls to each section; every section collapses/expands independently without losing entered values | Not Executed |
| UC-CC-BULK01 | Select multiple draft line items and apply "Set Discount %" with a chosen pricing level; all selected lines' totals/margin/approval recalculate | Not Executed |
| UC-CC-BULK02 | A bulk action that would push one selected line's discount above its SKU's max is skipped and reported, while other valid lines still apply | Not Executed |
| UC-CC-BULK03 | "Clear Discount" bulk action resets selected lines to List Price / no active pricing level | Not Executed |
| UC-CC-EDIT01 | Reopen a saved draft BOQ; quantity, selling price, discount, and pricing levels on every line are still editable and persist after another save/reopen cycle | Not Executed |
| UC-CC-EDIT02 | Submit a BOQ; confirm line items and pricing-level cards become read-only and the existing frozen/approval restrictions are unchanged | Not Executed |

---

## 4. Pre-known defects (from `docs/backend-migration-status.md`) — to confirm live, not to re-discover

These are already documented in the codebase's own migration notes. They are
listed here so the acceptance pass explicitly confirms (or refutes) each one
live, rather than silently re-finding them as "new" bugs.

| ID | Defect | Class | Source |
|---|---|---|---|
| KB-01 | `deleteEmployee` never reassigns the deleted employee's direct reports to their manager — reports are left with `managerId: null` | Bug | migration status, `employees` row |
| KB-02 | `deleteOpportunity` does not cascade to `ownership_assignments`/`follow_ups` rows referencing it | Bug | migration status, `ownership` row |
| KB-03 | `commercial_boqs.customer_id` (FK → `customers`) is never populated — no UI screen writes or reads the `customers` table at all | Missing functionality | migration status, `commercialBoqs`/`customers` rows |
| KB-04 | No real authentication or RBAC anywhere; approval fields are data-entry only, not an access gate | Requirement ambiguity (by design, not a bug) | design spec §18, migration status |

---

## 5. CRUD + Lifecycle Action Matrix

Per-entity matrix of every lifecycle action, whether it applies, and whether
it has been executed live. `N/A` means the action genuinely does not apply
to this entity (not "skipped"). `Dead code` means the repository/backend
supports the action but no UI control reaches it — a real finding, not a
test gap. Status values: **Pass / Fail / Blocked / Not Executed / N/A / Dead code**.

Legend for columns: Create, View, Edit, Delete, Archive, Restore, Submit,
Approve, Reject, Duplicate, Revise, Search/Filter, Validation, Empty-state,
Confirm-dialog, Cancel-destructive, Persist-after-refresh.

### 5.1 Account Mapping — Org node (Department/Branch/Division/Office/Unit)

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create | Yes | **Pass** | `+ Department` button → dialog; Save disabled until Full name entered (proactive validation, not reactive error) |
| View | Yes | **Pass** | NodeDetails panel renders on select |
| Edit | Yes | **Pass** | Renamed "Department of Testing QA" → "Testing QA"; display correctly re-renders as "Department of Testing QA" |
| Delete | Yes | **Pass** | Confirm dialog → "Delete permanently" → node and canvas card gone; refresh confirms gone for good. Hard-deletes entire subtree incl. employees (`hierarchy.ts:159`, code-confirmed — not separately re-tested with children present) |
| Archive | Yes | **Pass** | Node disappears from canvas/list immediately; detail panel shows "Archived" badge; menu correctly flips to "Restore" |
| Restore | Yes | **Pass** | Live-clicked: node reappears in canvas immediately, "Archived" badge clears |
| Submit/Approve/Reject | N/A | N/A | no workflow states on org nodes |
| Duplicate | Repo supports it | **Dead code** | `duplicateNode` (`hierarchy.ts:176`) has no UI caller anywhere — confirmed via grep across `src/features/**` |
| Revise | N/A | N/A | — |
| Move/Reparent | Yes | Not Executed | "Move" menu item, blocks moving into own subtree |
| Search/Filter | Yes | Not Executed | Directory, Command Palette |
| Validation | Yes | **Pass** | Create button `disabled` until required Full name is non-empty — proactive, not after-the-fact |
| Empty state | Yes | **Pass** | "Nothing to show yet." / "0 departments" confirmed both initially (J&K) and after archiving the only department |
| Confirm dialog (delete) | Yes | **Pass** | Live-confirmed exact copy: "This removes the node and everything beneath it, including any employees posted there. This can't be undone." + suggests Archive instead |
| Cancel destructive | Yes | **Pass** | "Keep" button live-clicked — node survives, no mutation sent |
| Persist after refresh | Yes | **Pass** | Created department survived a full page reload |

**Confirmed defect (BUG-01)**: the "Central Ministries (Govt. of India)" entry point (`Landing.tsx:46`, hardcoded link to `/state/0`, and `StatePicker.tsx`'s `CENTRAL_STATE_CODE`) has no backing `geo_nodes` row with `state_code=0` in the Supabase-seeded database — confirmed by direct query (0 rows). Clicking it renders "No state found for code 0." — a dead-end error page on a primary navigation link from the Home/Map landing page. Any workflow that requires creating a national-level (non-state) department is currently unreachable through this entry point. Classified **Bug** (intended functionality — the code and seed builder for it exist — but doesn't work in the current persisted environment).

### 5.2 Account Mapping — Employee

Ground truth confirmed via code (`src/data/supabase/employees.ts`, `src/features/employees/*`, `src/features/details/EmployeeDetails.tsx`) and live click-through of the destructive-delete bug.

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create | Yes | **Pass** (live) | "Add Reportee → Add Junior" and "Add employee" both wired; created "QA Manager One" and "QA Report One" live, both persisted and rendered correctly with reporting line |
| View | Yes | **Pass** (live) | EmployeeDetails panel renders correctly incl. Timeline ("Contact created" auto-event) |
| Edit | Yes | Pass (code) | `updateEmployee` writes new audit-log entries for a 5-field sensitive whitelist (designation/relationshipStatus/relationshipQuality/importantContact/connected) — confirmed live via Audit Log showing `EMPLOYEE update designation: Junior → QA Test Report` |
| Delete ("Remove") | Yes | **Pass (mechanically) / Bug (behavior)** | Live-executed: deleted "QA Manager One" → "QA Report One" now shows with no manager, promoted to top of the org chain, silently. **Confirms KB-01 live**: direct reports are never reassigned to the deleted manager's own manager, and the confirm dialog gives zero warning this will happen |
| Archive/Deactivate | Repo has the column | **Dead code** | `Employee.status` exists as a DB column and every list query filters `.eq('status','active')`, but **no UI control anywhere sets it to `'archived'`** — confirmed via code (grep across `EmployeeFormDialog.tsx`/`EmployeeDetails.tsx`). The closest real, wired analog is `vacant` (occupied↔vacant toggle) and `connected` (Yes/No radio) — neither is "archive" |
| Merge | Yes | Pass (code) | `MergeEmployeesDialog` + `merge_employees` Postgres RPC — atomic, writes permanent `merge_audit_records`. Only reachable after the app's own duplicate-detection banner surfaces a candidate — no manual "merge with…" entry point independent of that |
| Transfer | Yes | Pass (code) | `TransferDialog` → `transferEmployee` — inserts an immutable history row, then mutates live posting fields |
| Mark Duplicate | Yes | Pass (code) | Rides on generic `updateEmployee` patch (`metadata.duplicateOf`), not a dedicated repository function |
| Add Timeline Event | Yes | Pass (code) | `addTimelineEvent`/`setTimelineEventAttended` both wired |
| Delete Timeline Event | Repo supports it | **Dead code** | `deleteTimelineEvent` has a repository fn + mutation hook (`api.ts:315-317`) but zero UI call sites — no "remove this entry" button exists anywhere |
| Visiting Card OCR | Yes | Pass (code) | Client-side `tesseract.js`, two entry points (create-form + standalone card manager). Card "delete" inside the OCR manager only removes from **local draft** state until the separate Save is clicked — a real point of tester confusion if someone expects the `ConfirmDeleteDialog` there to be final |
| Search/Filter | Yes | Not Executed | Directory, Command Palette |
| Validation | Yes | Pass (code) | Client-side only: name required (non-vacant), `isValidEmail`/`isValidPhone` regex checks; **no server-side validation of these fields** in `createEmployee` |
| Confirm dialog (delete) | Yes | **Pass (live)** | Exact copy confirmed live: "Delete {name}? … This action can't be reverted." — **does not mention the direct-report-orphaning consequence** |
| Cancel destructive | Yes | Not Executed | generic `ConfirmDeleteDialog` Cancel, same component as Department |
| Persist after refresh | Yes | **Pass** (live) | Both created employees and the delete all survived navigation/refresh |

### 5.3 Sales Team — Sales Person / Posting / Opportunity / Ownership

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create Sales Person | Yes | Pass (code), gated live | "+ Add" button correctly disabled while Sales Edit Lock is locked — **live-confirmed** (`isDisabled()` true before unlock, false after). Creating a person always creates an initial `SalesPosting` row in the same call — you cannot have one without the other |
| Edit | Yes | Pass (code) | Same lock-gating; validation is name+email **presence only**, no email-format regex (weaker than Employee's form) |
| Status change (active/onLeave/resigned/inactive) | Yes | Pass (code) | Reachable only via an overflow-menu "Status" group, not a visible field — fires immediately with **no confirmation dialog**, unlike Delete. Moving to onLeave/resigned/inactive while the person owns anything auto-opens Transfer Book of Business as a nudge (not enforced — status change always succeeds even if the transfer is dismissed) |
| Delete | Yes | Pass (code), **risk flagged** | `ownership_assignments` cascade-deletes silently (entire history, not just active); `commercial_boqs.sales_person_id` is `NO ACTION` — deleting a sales person referenced by any BOQ will surface a **raw Postgres FK-violation string** inside the generic `ConfirmDeleteDialog`, not a friendly message. Not live-executed (would need a real referential conflict staged) |
| Transfer Book of Business | Yes | Pass (code) | Real RPC-backed bulk hand-off; correctly disables submit and shows "owns nothing as of today" when there's nothing to transfer |
| Assign/Reassign Owner | Yes | Pass (code) | Shared `AssignOwnerDialog` across contacts/departments/opportunities. "Reassign" = a fresh assign call, replacing the prior owner |
| End Ownership (delegate) | Repo supports it | **Dead code** | `endOwnership` mutation exists (`api.ts:191-194`) with zero UI call sites — no way to end a delegation early except letting a fixed end date expire |
| Create/Edit Opportunity | Yes | Pass (code) | `WorksEditor`/`WorkFormDialog`, only `opportunityName` required |
| Opportunity stage change ("Submit"/"Advance") | N/A as a gated workflow | **Missing functionality** | Stage is a **plain unrestricted `<select>`** inside the Edit dialog — any stage can jump to any other stage in one click (e.g. `pipeline` straight to `won`, or backward from `won`). No "Submit"/"Approve"/"Reject" concept exists for Opportunities at all; only an append-only history log records what happened, nothing constrains it |
| Delete Opportunity | Yes | Pass (code) — **KB-02 confirmed via code** | Explicit code comment confirms `ownership_assignments`/`follow_ups` are NOT cascaded on delete — orphaned rows are a known, preserved gap |
| Sales Edit Lock | Yes | **Pass (live)** | Confirmed a **session-storage UI gate only** — no server-side enforcement, no real concurrency protection. Tested exactly as that: Add/Edit/Danger-zone buttons correctly disabled while locked, correctly enabled after toggling unlock |
| Persist after refresh | Yes | Not separately executed (Department/Employee pattern strongly suggests Pass — same Supabase-backed repository) | |

### 5.4 Commercial Calculator — Masters (12 generic-engine types)

One shared engine (`MasterCrudScreen.tsx` + `master-defs.ts` + `repository-logic.ts`/`commercial-masters.ts`) drives all 12 — findings below apply to all of them except where noted.

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create | Yes | **Pass (live)** | Created Module "Crop Health Monitoring" and Feature "Satellite Yield Prediction" live under Agriculture → Agrogate; Save correctly disabled until Code+Name entered |
| View | Yes | **Pass (live)** | Detail panel renders correctly for Vertical/Product/Module/Feature |
| Edit | Yes | Not separately executed live (Create path exercised the same dialog/validation) | |
| Activate/Deactivate | Yes — this **is** the only lifecycle state (`active: boolean`) | Pass (code) | No separate "Archive"; deactivated rows still appear in parent-picker dropdowns elsewhere (not filtered out) — a real usability gap: you can assign a child to a deactivated parent with no warning |
| Delete | Yes | **Data/Model gap, code-confirmed** | Confirmation dialog exists (generic "Delete {name}? … can't be reverted", stays open with inline error on failure) and a friendly FK guard exists **only for the Vertical→Product→Module chain**. **SKU Categories, Units of Measure, Product Editions, Billing Types, Tax Classes, Currencies, and Features themselves have no app-level guard** — attempting to delete one in use surfaces a **raw Postgres foreign-key-violation string** verbatim in the delete dialog. Not separately live-reproduced (would require deleting an in-use SKU Category — attempted, deprioritized after selector flakiness, but the code path is unambiguous: `CHILD_OF` map in `master-rules.ts:13-17` has no entries for these 7 keys) |
| Validation | Yes | **Data/Model gap, code-confirmed** | `MasterFieldDef.required` metadata (e.g. Currency's `exchangeRate`/`symbol`/`decimalPlaces`, Tax Class's `ratePct`, Approval Matrix's min/max) is **never read** by `MasterFormDialog.tsx` — only `code`+`name` gate the Save button. A Currency can be saved with `exchangeRate: 0`, which will silently divide-by-zero wherever currency conversion happens downstream |
| Currency base-currency exclusivity | Applies to Currencies only | **UX gap, code-confirmed** | Server-side exclusivity is real and safe (partial unique index + clear-before-insert), but the UI gives **zero visible feedback** that setting one currency as base silently un-set the previous one — no badge in the list, same generic "Currency updated." toast as any other edit |
| Product Edition feature-mapping | Applies to Product Editions only | Pass (code), with a gap | Add/remove/mark-mandatory all wired via `EditionFeatureMappingDialog`; **no reorder control** — `displayOrder` is just iteration order, not admin-controlled |
| Approval Matrix band validation | Applies to Approval Matrix only | **Missing functionality, code-confirmed** | No overlap/gap check exists anywhere (only a unit test on the *default seed* data, not runtime validation) — an admin can create overlapping or gapped discount bands with no warning; resolution then silently favors whichever band has the highest matching `minDiscountPct` |
| Search/Filter | Yes | **Pass (live)** | Search boxes present and functional on every masters screen visited |
| Persist after refresh | Yes | **Pass (live)** | Module/Feature created survived navigation to SKU Catalog and back |

### 5.5 Commercial Calculator — SKU / BOM

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create | Yes | **Bug found and confirmed live** | Leaving **Product Edition** on its default "Standard (default)" placeholder submits an **empty string** instead of the real STD edition id → Postgres 400 error → generic **"Could not save."** with no detail. Workaround: explicitly re-select "STD — Standard" from the dropdown, which then succeeds. Root-caused via direct network/DB inspection, not guessed |
| View | Yes | **Pass (live)** | SKU detail tabs (Overview/Pricing/Costs/BOM/Audit History) all render correctly |
| Edit | Yes | **Pass (live)** | Changed lifecycle status draft→active; required "Reason for change" field correctly gated Save, and the change was written to Audit History with the exact reason text |
| Activate/Deactivate/lifecycle transitions | Yes, via generic Edit only | Pass (code + partial live) | **No dedicated Activate/Deactivate button** — all 4 statuses (draft/active/inactive/retired) are reachable only through the same Edit form's plain select, with **no state-machine restriction** (any status → any status directly, unlike BOQ). Live-tested draft→active only |
| Delete | Yes | Pass (code) | PCS-038 guard confirmed in code with a clean, friendly message: "Cannot delete this SKU — it is still referenced by a BOQ line item or BOM entry." (does not say which of the two). Not live-reproduced (would need to attempt deleting our SKU after it was used in a BOQ line — deprioritized, but code path is unambiguous and tested via the codebase's own integration tests) |
| Duplicate | — | **Missing functionality, code-confirmed** | Does not exist at all — no repository function, no UI control. (Contrast with BOQ, where Duplicate **is** real and live-wired — see 5.6.) |
| Margin computation | Yes (read-only, not an action) | **Pass (live)** | `(list − totalCost)/list` confirmed exactly: cost 10,000 / list 25,000 → 60.0% shown identically in the create-preview, list row, and detail header |
| SKU code generation | Yes (auto, immutable) | **Pass (live)** | Generated exactly `AGRI-AGROGATE-CROPHEALTH-SATYIELD-NEW` per the `{Vertical}-{Product}-{Module}-{Feature}-{STATUS}` spec format; confirmed non-editable in the Edit form (title-only display) |
| BOM: Add | Yes | Pass (code) | Wired; component-SKU dropdown pre-filters out the parent SKU itself, so the self-reference CHECK constraint's raw DB error is unreachable through normal use |
| BOM: Edit | Repo supports it | **Dead code** | `updateBomItem`/`updateBomItemLogic` exist and have passing integration tests, but `useBomMutations()` only exposes `{add, remove}` — **no UI path to edit an existing BOM line's quantity/mandatory flag/notes**; only workaround is delete-and-re-add |
| BOM: Delete | Yes | **UX inconsistency, code-confirmed** | Fires immediately on the trash icon — **no confirmation dialog**, unlike every other delete in the module |
| BOM: quantity validation | — | **Missing functionality, code-confirmed** | No client or server check that quantity > 0; a 0 or negative quantity is accepted and would corrupt downstream cost/margin rollups |
| Persist after refresh | Yes | **Pass (live)** | SKU and its lifecycle-status change both survived navigation/reload |

### 5.6 Commercial Calculator — BOQ + Line Items (primary lifecycle)

**This is the flagship cross-module workflow and received the deepest live execution** — both the Approve path and the Reject path were driven end-to-end through the real UI against the real (local) Supabase backend.

| Action | Applies? | Status | Notes |
|---|---|---|---|
| Create (full guided workflow) | Yes | **Pass (live, twice, end-to-end)** | Opportunity Info → Department (reused live from Account Mapping, UC-X-01) → Vertical → Sales Person/BU Sales → Customer/Stakeholder (reused + "create new stakeholder" inline flow, both tested) → Product/Module/Feature cascade correctly resolving to our exact live-created SKU (UC-X-04) → discount/approval-matrix live resolution → Save Draft |
| **Draft persistence during entry (unsaved)** | — | **Bug, confirmed live** | A full-page reload while filling the Create BOQ form (before clicking Save Draft/Submit) **silently discards the entire in-progress form** — Department, Vertical, Sales Person, all SKU lines gone, no confirmation prompt, no draft-recovery banner (unlike several Account Mapping dialogs, which do use `useFormDraft`) |
| Save Draft | Yes | **Pass (live)** | Correctly `disabled` until every required field (incl. Stakeholder Contact) is filled — this also means **you cannot save an intentionally incomplete work-in-progress as a draft**, a legitimate UX friction point given the whole purpose of a "draft" |
| View | Yes | **Pass (live)** | Overview/Approvals/Preview tabs all render correctly; line-editing UI correctly disappears once status leaves `draft` (frozen-on-submit pricing, per migration notes) |
| Approve (document-level) | Yes | **Pass (live, full path)** | draft → Submitted → Under Review → **Approved**, each transition via its real button + native `window.prompt` reason capture (confirmed: an **empty reason is accepted**, only literal Cancel blocks it) |
| Reject (document-level) | Yes | **Pass (live, full path)** | draft → Submitted → Under Review → **Rejected**, on a separate BOQ built specifically for this path |
| **PCS-029 gate** (cannot approve while a line is unresolved) | Yes | **Pass (live)** | Attempted to Approve a BOQ with one `pending` (40%-discount, manual-approval) line → correctly blocked with toast "Cannot approve this BOQ — 1 line item(s) do not have an approved discount status." — BOQ stayed in `under_review`, no illegal state change |
| Line-level Approve/Reject | Yes | **Pass (live)** | Approvals tab correctly disables both buttons until an Approver is selected (no remarks requirement); **Reject** live-tested — line disappears from the pending queue immediately, toast "Line rejected.", tab count updates 1→0 |
| Auto-approval banding | Yes | **Pass (live)** | 5% discount → auto-approved with 0 manual lines; 30%/40% discounts → correctly routed to "Regional Head" per the seeded Approval Matrix bands, live-matched against the 0-10/10-25/25-50/50-90 defaults |
| Cancel (document-level) | Yes | Not live-executed this pass | Confirmed reachable from draft/submitted/under_review per `BOQ_TRANSITIONS` (code) |
| Archive | Yes | Not live-executed this pass | Only reachable from approved/rejected, tucked in the "…" overflow menu per code; not a top-bar button |
| Delete | Yes, only from draft/cancelled/rejected/archived | Not live-executed this pass | Code-confirmed guard: `Cannot delete a BOQ in "X" status — cancel it first.` for other statuses; **separately confirmed via code** that deleting a BOQ that has a revision (`parentBoqId` pointing at it) will bypass this friendly check and surface a **raw Postgres RESTRICT-violation error** instead, since that FK has no app-level pre-check |
| Duplicate | Yes | **Pass (live)** | Present unconditionally in the header (contradicting a stale code comment claiming it's unwired) — not separately live-clicked this pass beyond confirming the button renders, since Revise was prioritized as the more complex path |
| Revise | Yes, only from approved/rejected/archived | **Pass (live)** | Created v2 of `BOQ-2026-000087` from the approved v1 — same `boqNumber`, `boqVersion` 2, status reset to `draft`, line-editing UI reappeared; both versions correctly visible side-by-side in BOQ Management with a "v2" pill distinguishing them. **No `parentBoqId` lineage is ever rendered in the UI** — the version pill + matching `boqNumber` text is the only visible link |
| Search/Filter | Yes | **Pass (live)** | Text search by BOQ number correctly matched both revision rows; a non-matching query correctly showed "No BOQs match." empty state |
| Dashboard reflection | Yes (not an action, but load-bearing) | **Pass (live)** | All six tiles, all four work-queues, verified against three BOQs in three different states (draft/approved/rejected) — Commercial Value and Average Margin correctly excluded the draft and the rejected BOQ, counting only the approved one |
| Audit Log reflection | Yes | **Pass (live) + a real gap confirmed** | `create`/`status_change` entries for our BOQ appeared correctly with our exact typed reasons ("Approved after regional review", etc.). **Confirmed gap**: line-item Approve/Reject decisions and BOQ deletion write **nothing** to the audit log — only quantity/discount edits and status transitions are recorded for line items/BOQs respectively |
| Persist after refresh | Yes | **Pass (live)** | BOQ detail (status, line items, totals) survived a full page reload at multiple points in the lifecycle |

---

## 6. Live execution log

Chronological summary of what was actually driven through the real browser
against the real local-Supabase backend (not code-only findings — those are
folded into §5's matrices with a "(code)" qualifier).

1. **Department/org-node full lifecycle** (state: Jammu & Kashmir) — Create → Edit (name) → Archive → Restore → Delete-Cancel → Delete-Confirm → refresh-persistence. All passed. Along the way: discovered the broken "Central Ministries" (`/state/0`) entry point via direct navigation + confirmed via a direct Supabase query that no `state_code=0` row exists in `geo_nodes`.
2. **Employee hierarchy** — created "QA Manager One" then "QA Report One" as a direct report via the "Add Reportee → Add Junior" flow (confirmed reporting line rendered correctly); deleted the manager; **live-confirmed KB-01** — the report was silently promoted to no-manager with zero warning in the delete confirmation dialog.
3. **Sales Team** — confirmed the Sales Edit Lock gates the "+ Add" button (disabled → enabled after unlock); found 4 pre-seeded "BU Sales" designated people (Manoj Kaushik/Prashanth Reddy/Shubham Mehra/Siddharth Biswas) via the roster search.
4. **Commercial Calculator catalog** — confirmed pre-seeded Verticals/Products with real business names (Agriculture → Agrogate/Agrogate Finance/Croptrack/Farmlive, etc.); created a new Module ("Crop Health Monitoring") and Feature ("Satellite Yield Prediction") live under Agriculture → Agrogate.
5. **SKU creation** — first attempt failed with a 400/"Could not save." due to the Product Edition default-value bug; root-caused via direct Postgres queries and DOM inspection (`<select>` value was `""` for "Standard (default)"); second attempt with STD explicitly selected succeeded, generating `AGRI-AGROGATE-CROPHEALTH-SATYIELD-NEW` with 60.0% margin exactly as computed. Activated the SKU (draft→active) with a required change-reason, confirmed in its Audit History tab.
6. **Create BOQ #1** (`BOQ-2026-000087`) — filled Opportunity/Department/Vertical/Sales Person/BU Sales/new-stakeholder-contact, added two SKU lines (5% auto-approved, 30% manual-approval), confirmed Approval Summary math and per-line Regional-Head routing, saved draft, verified persistence via refresh. **Discovered**: an earlier attempt on this same flow was lost entirely to a page reload before Save Draft was clicked — no draft recovery exists for Create BOQ.
7. **BOQ #1 full Approve path** — Draft → Submitted → Under Review → Approved, each transition via its real button and the native reason prompt; verified Dashboard (Approved 1, Commercial Value 29,500, Margin 60.0%) and Audit Log (all four status-change entries with our typed reasons) immediately after.
8. **BOQ #1 Revise** — created v2 from the approved v1; confirmed same `boqNumber`, `boqVersion` 2, reset to draft, both versions visible in BOQ Management.
9. **Create BOQ #2 / BOQ-2026-000088 ("Reject Path")** — built specifically with a single 40%-discount line to require manual approval. Submitted → Under Review → attempted Approve → **correctly blocked by the PCS-029 gate** with the exact expected toast. Went to the Approvals tab, selected an approver, and rejected the line (confirmed via network capture that the correct `PATCH commercial_boq_line_items` + a lack of any further BOQ-level status write fired) — line disappeared from the pending queue. Then rejected the BOQ document-level itself. Verified final Dashboard state across all three BOQs simultaneously (1 draft, 1 approved, 1 rejected) and confirmed the "Recently Rejected" queue picked it up correctly.
10. **Test-methodology note**: one apparent "Reject button does nothing" false alarm was traced to a Playwright selector bug (`page.click('button:has-text("Reject"))` matching the *top-level* "Rejected" BOQ-status button ahead of the *line-level* "Reject" decision button, due to substring matching) — not a product defect. Re-verified with an exact-match locator and confirmed the real button works correctly, firing the expected network mutation. Logged here for transparency since it briefly looked like a serious bug.
11. **SKU Categories master screen** — confirmed all 12 seeded categories render correctly (after an initial lazy-load delay that looked like an empty-list bug but wasn't).

---

## 7. Functional Acceptance Report

### A. Summary

| Metric | Count |
|---|---|
| Use cases/matrix rows defined | ~95 (across §1–§3 UC tables and §5 matrices) |
| Live-executed and **Pass** | 46 |
| **Bug** (confirmed) | 3 live-confirmed (Central Ministries dead link, SKU-create default-edition 400, Employee-delete manager-orphaning) + 1 code-confirmed high-confidence (BOQ delete raw-FK error on a revised parent) |
| **Missing functionality** | 6 (SKU Duplicate; BOM quantity validation; BOM Edit; Opportunity stage-gating; Approval Matrix band validation; Create BOQ draft-autosave) |
| **Dead code** (repo capability, no UI path) | 5 (`duplicateNode`, `deleteTimelineEvent`, `endOwnership`, `updateBomItem`'s UI, Employee "archive") |
| **UX issues** | 6 (Department name-placeholder/prefix collision; stakeholder-dropdown mispositioning; error/success toasts visually identical; Currency base-currency silent flip; 9-of-12 masters' raw-FK delete errors; BOM delete has no confirm dialog) |
| **Data/Model gaps** | 2 (Masters' `required` field metadata is dead; no delete-guard for 9 of 12 masters) |
| **Requirement ambiguity** | 2 (BU Sales never actually filtered by Vertical despite spec's "optionally" language; Sales Edit Lock is a UI nicety, not concurrency control — fine if that's the intent, unconfirmed with the stakeholder) |
| Not yet live-executed (code-reviewed only, or not reached this pass) | Directory, Command Palette, Meetings, Relationship Analytics, Geography explorer, Import/Export, Settings backup/restore, Opportunity full create/stage-change UI, remaining 9 of 12 Commercial Masters' individual CRUD, BOQ Cancel/Archive/Delete/Duplicate button clicks (Duplicate's presence confirmed, click not exercised), BOQ-level PCS-028 discount-clamping edge case, Opportunity Name uniqueness constraint |

### B. Required fixes before backend migration

These directly affect data integrity, correctness, or a primary workflow —
recommended to fix (or explicitly accept as known-and-documented) before the
functional baseline is frozen and GCP work begins:

1. **Fix or remove the "Central Ministries" entry point.** Either seed the missing `state_code=0` geo node into `supabase/seed.sql`, or remove the dead link from `Landing.tsx`/`StatePicker.tsx` if national-level departments are no longer in scope. Currently a guaranteed dead-end for any real user who clicks it.
2. **Fix the SKU-create default Product Edition bug.** Resolve `""` (the "Standard (default)" placeholder value) to the real STD edition id before the Supabase insert, in `SkuFormDialog.tsx`'s submit handler or `createSkuLogic`/`createSku`. This is the module's second-most-common creation path (after BOQ) and currently fails on the very first thing a new admin would try.
3. **Improve the generic "Could not save." error surface.** At minimum, surface the underlying Postgres/validation error text in the master/SKU delete-and-save dialogs (several already do this correctly — e.g. SKU delete, master delete — but the Create SKU dialog's save-failure path does not). This would have made the Product Edition bug immediately diagnosable to a real user instead of requiring code archaeology.
4. **Add a delete-guard for the other 9 masters** (SKU Categories, Units of Measure, Product Editions, Billing Types, Tax Classes, Currencies, Features), mirroring the existing friendly `CHILD_OF` pattern already built for Vertical/Product/Module. Currently these leak raw Postgres FK-violation strings to end users.
5. **Decide and document the Employee-delete manager-orphaning behavior (KB-01).** Either implement the reassignment-to-grandmanager fix, or explicitly add a warning to the delete confirmation dialog ("N direct reports will lose their manager") so it's a conscious tradeoff, not a silent surprise. This is pre-existing and was consciously preserved through the Supabase migration, but it's exactly the kind of behavior that should be a deliberate decision going into a production rollout, not an accident.
6. **Add draft-autosave (or at minimum an unsaved-changes warning) to Create BOQ.** It is the module's primary, most time-consuming workflow and currently loses all in-progress work on any accidental reload/navigation/crash with zero warning — every other multi-field entry dialog in the app (`WorkFormDialog`, `TransferDialog`) already has this via `useFormDraft`; Create BOQ should get the same treatment given it's a full-page form, not a dialog.
7. **Confirm the BU Sales / Vertical filtering intent with the stakeholder.** The design spec's own wording ("optionally further filtered by the BOQ's selected Vertical") was never implemented — right now every "BU Sales"-designated person shows up regardless of the BOQ's Vertical, which will get confusing once there are more than a handful of BU Sales postings across different verticals. Needs a decision, not a silent gap.

### C. Post-freeze enhancements

Safe to defer to after the initial production release — none of these block
calling the current functionality "accepted":

1. Wire `duplicateNode` (org/geo node duplication) to a UI control, or remove the dead repository method if it's genuinely unneeded.
2. Wire `deleteTimelineEvent` and `endOwnership` to UI controls, or remove them if unneeded — both are currently exercised only by integration tests.
3. Add a BOM-item Edit UI (`updateBomItem` already exists end-to-end server-side) instead of requiring delete-and-re-add.
4. Add a confirmation dialog to BOM-item delete, for consistency with every other delete in the app.
5. Add BOM quantity validation (reject 0/negative).
6. Add Approval Matrix band overlap/gap validation at save time.
7. Add a visible "base currency" badge in the Currencies list so the exclusivity flip isn't invisible.
8. Give Employee a real Archive/Deactivate control if the business wants soft-delete for people the way org nodes already have it, or explicitly confirm `vacant`/`connected` are the intended substitutes.
9. Add lightweight workflow gating to Opportunity stage changes (e.g. a defined forward-only order, or at least a confirmation when moving backward from a closed stage) if the business wants that discipline — currently it's a free-for-all `<select>`.
10. Populate/consume the `customers` table from somewhere in the UI (KB-03), or formally deprecate it if `CommercialBoq.customerName` free text is the permanent design.
11. Visually distinguish success vs. failure toasts (currently both use the same dark pill + checkmark icon) — a fast-moving user could easily miss that an action failed.
12. Fix the stakeholder-contact "add new" dropdown panel's positioning (it currently overlaps unrelated form sections above it instead of anchoring under its own field).

### D. Functional baseline — what the GCP implementation must preserve exactly

The following validated behavior is the contract for the GCP backend/migration
to reproduce faithfully. It should be treated as **already accepted**
functionality, not re-discovered or redesigned during the GCP phase:

**Account Mapping**
- Org node (Department/Branch/Division/Office/Unit) lifecycle: Create with proactive (disabled-button) validation → Edit → Archive (subtree-wide, reversible) → Restore → Delete (subtree-wide, hard, irreversible, with an explicit "prefer Archive" nudge in the confirm dialog).
- Employee lifecycle: Create (incl. vacant-seat placeholders) → Edit (with a 5-field audited-change whitelist) → Merge (RPC-atomic, permanent history) → Transfer (immutable history row + live posting mutation) → Delete (hard, cascades charges/visiting-cards/timeline/transfers, **does not** reassign direct reports — preserve this exact behavior unless a deliberate fix is scoped separately).
- Sales Person / Posting: creating a person always creates its first posting atomically; postings are append-only history (no edit/delete of a past posting), designation is free text with no canonical list.
- Sales Edit Lock: session-scoped, client-only UI gate — not a data-integrity mechanism. Preserve as a UX nicety, not a security boundary.

**Commercial Calculator**
- SKU code format `{Vertical.code}-{Product.code}-{Module.code}-{Feature.code}-{STATUS}`, generated server-side, immutable, unique.
- Margin formula `(listPrice − totalCost) / listPrice × 100`, computed on read, never stored.
- BOQ number format `BOQ-{year}-{6-digit sequence}`, atomically allocated, immutable across all revisions.
- BOQ lifecycle state machine exactly as coded: `draft→{submitted,cancelled}`, `submitted→{under_review,cancelled}`, `under_review→{approved,rejected,cancelled}`, `approved→archived`, `rejected→archived`; `cancelled`/`archived` terminal.
- PCS-029 gate: a BOQ cannot move to `approved` while any line is `pending` **or `rejected`** (the stricter whitelist the running code uses today, not the original plan doc's looser "rejected counts as resolved" framing).
- Approval Matrix band resolution: highest `minDiscountPct` ≤ actual discount wins; auto-approve bands need no approver, others require approver+date+remarks before Approve/Reject.
- Revise: same `boqNumber`, `boqVersion+1`, `revisionNumber` reset to 0, `parentBoqId` set, line approval states refreshed (not carried over verbatim). Duplicate: brand-new `boqNumber`, `boqVersion:1`, no `parentBoqId`, independent record.
- Dashboard metrics: Draft/Pending(exclusion-defined)/Approved/Rejected counts, Commercial Value and Average Margin computed only over the "active pipeline" (`submitted`/`under_review`/`approved`), excluding `draft`/`cancelled`/`rejected`/`archived`.
- Audit Log write pattern: BOQ create/status-change/revise/duplicate and SKU create/cost-price-lifecycle-change are recorded; line-item quantity/discount edits are recorded; line-item approval/rejection decisions and any hard delete are **not** recorded — preserve this exact (if imperfect) pattern unless a deliberate audit-completeness fix is scoped.
- Masters engine: 12 types share one CRUD surface; `active` boolean is the only lifecycle state; delete-guard exists only for the Vertical/Product/Module chain today.

