# Bid Tracker Module Design

**Status:** Draft for review — no implementation started.
**Author context:** Produced via architecture brainstorming session, 2026-09-28, grounded in a five-way read-only audit of the current GOMS codebase (Opportunities/ownership, Account Mapping/Sales Team, Commercial Calculator, admin-import/audit/grid infra, app shell/routing) plus direct inspection of `commercial.ts`'s BOQ revise/duplicate code and the live Terraform (`infra/dev`, `infra/prod`) and GitLab CI deploy pipeline.
**Screenshots**: the reference screenshots supplied for this design are visual/product references only. Every identifier, name, date, and value shown in them (e.g. "BID-2026-0043", "Michael Chang", "₹6.20 Cr") is illustrative. None of it is seeded into the application by this spec or its implementation.

## 1. Goal and scope

Bid Tracker is a new, third top-level GOMS module — alongside Account Mapping and Commercial Calculator — that centralizes tracking a government/commercial bid from opportunity identification through submission and follow-up: a sortable, filterable Master Grid; a tabbed bid detail workspace (Overview/Milestones/Commercial & Files/Protected Values); an Action Queue; and an Activity History.

It is explicitly **not** a rewrite of Opportunities, Sales Team, Account Mapping, or Commercial Calculator. Every one of those keeps working exactly as it does today. Bid Tracker adds a new, linked layer on top.

## 2. Product requirements

- A user can see every active bid in one dense, sortable, horizontally-scrollable grid, grouped by Identity / Client / Dates / Documents / Ownership / Decision / System, with configurable column visibility and named, shareable saved views (personal or global).
- A user can open a bid into a tabbed workspace: Overview (next action, assignee, earliest milestone, submission closing, ownership, stage, decision), Milestones (pre-bid conference, query deadlines, submission deadline, corrigendum-linked dates), Commercial & Files (estimated cost, EMD/tender fee, source documents with page-level citations), and Protected Values (freeze/unfreeze specific facts).
- When a corrigendum changes a previously-recorded fact, the system shows current-vs-proposed value pairs and requires an explicit accept or reject per field — it never silently overwrites a value, and never overwrites a frozen (protected) value at all without an explicit unfreeze first.
- An Action Queue surfaces what needs attention across every bid: next action, owner, due date, and an attention flag (Due Soon / Overdue / Corrigendum Pending / On Track).
- An Activity History shows who changed what and when, across field edits, corrigendum reviews, approvals, ownership changes, milestone changes, uploads, and protected-value freeze/unfreeze events.
- Department/client, geography, contacts, sales ownership, and commercial value/EMD are **read from the existing GOMS entities that already model them** — Bid Tracker never creates a second, competing record for something that already exists.

## 3. The central decision: Bid is a linked entity, not an Opportunity extension

**Resolved and authoritative.** A new `bids` table is a **1:1** extension of `opportunities` (`bids.opportunity_id UUID NOT NULL UNIQUE REFERENCES opportunities(id)`), not new columns bolted onto `opportunities`, and not an independent root entity.

Why: `opportunities` is already actively read and written by `WorksEditor.tsx`, `SalesWorkspace.tsx`, and global search's `work` category, none of which need or want milestones, corrigenda, protected-value freezes, or Bid Tracker's own stage machine. Extending `opportunities` directly would bloat a table three other UIs already write to freely, and would mix "frozen" semantics into a table with no concept of it today. A fully independent Bid entity (opportunity optional) was rejected because every bid the screenshots describe already has a department, tender ID, dates, and value that `opportunities` already models correctly — duplicating those fields for every bid would violate the explicit "don't duplicate what already exists" requirement for no real benefit.

Opportunity : Bid is 1:1 — one bid per opportunity, enforced by the `UNIQUE` constraint on `bids.opportunity_id`. An opportunity that never becomes a tracked bid simply has no `bids` row; not every opportunity needs one.

## 4. Data model

### 4.1 New tables

```sql
-- One row per year, atomic sequence allocation (mirrors commercial_boq_number_sequences).
CREATE TABLE bid_number_sequences (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  bid_code        TEXT NOT NULL UNIQUE,             -- "BID-2026-0043", via bid_number_sequences
  stage_key       TEXT NOT NULL DEFAULT 'solutioning', -- open registry, see §4.4 — NOT opportunities.stage_key
  decision        TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','go','no_go')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  data_confidence TEXT NOT NULL DEFAULT 'verified' CHECK (data_confidence IN ('verified','needs_review')),
  tender_link     TEXT,                              -- external tender-portal URL; not modeled on Opportunity today
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bids_opportunity_id_idx ON bids (opportunity_id);
CREATE INDEX bids_stage_key_idx ON bids (stage_key);

-- Milestones: pre-bid conference, query deadlines, submission deadline, corrigendum-linked date slots.
CREATE TABLE bid_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id         UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,       -- open registry: 'preBidConference' | 'queryDeadline' | 'submissionDeadline' | 'corrigendumDate' | ...
  key            TEXT NOT NULL,       -- PERMANENT, non-colliding — e.g. "submissionDeadline", "cor_2_a" — stable across edits
  label          TEXT NOT NULL,
  due_at         TIMESTAMPTZ,
  venue          TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','superseded')),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','corrigendum')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, key)
);
CREATE INDEX bid_milestones_bid_id_idx ON bid_milestones (bid_id);

-- Corrigenda: one row per detected amendment document/batch.
CREATE TABLE bid_corrigenda (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id             UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  corrigendum_number INTEGER NOT NULL,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, corrigendum_number)
);
-- status ('pending_review' | 'reviewed') is DERIVED at read time (§11), not a stored column.

CREATE TABLE bid_corrigendum_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrigendum_id UUID NOT NULL REFERENCES bid_corrigenda(id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,        -- matches a bid_milestones.key or a bids/opportunities column name
  current_value  TEXT NOT NULL DEFAULT '',
  proposed_value TEXT NOT NULL DEFAULT '',
  decision       TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decided_at     TIMESTAMPTZ,
  decided_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bid_corrigendum_changes_corrigendum_id_idx ON bid_corrigendum_changes (corrigendum_id);

-- Protected values: generic, polymorphic — not bid-specific, so any future entity can adopt it.
CREATE TABLE protected_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  field_key   TEXT NOT NULL,
  frozen      BOOLEAN NOT NULL DEFAULT false,
  frozen_at   TIMESTAMPTZ,
  frozen_by   TEXT,
  UNIQUE (entity_type, entity_id, field_key)
);
CREATE INDEX protected_values_entity_idx ON protected_values (entity_type, entity_id);

-- Documents + citations: genuinely new — no file/blob infra exists anywhere in GOMS today.
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,          -- GCS object key, see §14
  version      TEXT NOT NULL DEFAULT 'v1.0',
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, filename, version)
);
CREATE INDEX documents_entity_idx ON documents (entity_type, entity_id);

CREATE TABLE document_citations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_label  TEXT NOT NULL,           -- "Pg 3"
  quote_text  TEXT NOT NULL DEFAULT '',
  field_ref   TEXT,                    -- optional — which bid/opportunity field this citation supports
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_citations_document_id_idx ON document_citations (document_id);

-- Saved views: All Bids / My Bids / Solutioning / Due Soon / etc. are all just rows here.
CREATE TABLE bid_saved_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('personal','global')),
  owner_email      TEXT,               -- required when scope='personal', ignored for 'global'
  filter_rules     JSONB NOT NULL DEFAULT '[]',
  sort             JSONB NOT NULL DEFAULT '[]',
  visible_columns  JSONB NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_view_has_owner CHECK (scope <> 'personal' OR owner_email IS NOT NULL)
);
```

### 4.2 Additive changes to existing tables

```sql
-- commercial_boqs: the one missing FK the audit found. Nullable, NOT unique — see §4.3 for why.
ALTER TABLE commercial_boqs ADD COLUMN opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX commercial_boqs_opportunity_id_idx ON commercial_boqs (opportunity_id);
```

No other existing table gains a column. `opportunities.submission_date` and `opportunities.stage_key` are not altered — their *write path* is constrained in application code once a bid exists (§4.5, §4.6), not their schema.

### 4.3 Opportunity → BOQ is 1:N, verified by reading the code, not assumed

Read directly: `commercial.ts:1324-1401`. `boq.revise` inserts a new row carrying the *same* `boq_number` forward (a version chain via `parent_boq_id`) — multiple physical rows, one logical BOQ document. `boq.duplicate` inserts a row with a **new, independent** `boq_number` that copies the source's `opportunity_name` unchanged — a pre-existing rough edge (that copy will fail `assertOpportunityNameAvailable` the next time either row is directly edited) that this spec does **not** fix, since it predates Bid Tracker and touching it is out of scope.

Consequence: one opportunity can legitimately have more than one independent `boq_number` lineage (e.g., a duplicate-based fresh start, or genuinely alternate commercial proposals), so `commercial_boqs.opportunity_id` must be a plain nullable FK, not `UNIQUE`. `revise` and `duplicate`'s hand-written `INSERT` column lists both need `opportunity_id` added to their copied-forward columns (a real code change to `commercial.ts`, not just a migration — flagged explicitly in §19).

Bid Tracker's Commercial & Files tab resolves "the" BOQ for a bid as: the latest revision (`MAX(boq_version)` within its `boq_number` group) of the most-recently-`updated_at` BOQ document linked to that opportunity. If more than one independent `boq_number` is linked, the tab shows that one plus a "+N other proposals" link — never a silent, ambiguous pick.

### 4.4 Bid stage vs. Opportunity stage — two separate machines, narrow one-way sync

`opportunities.stage_key` remains exactly what it is today: the CRM/pipeline outcome (`pipeline → qualified → submitted → won/lost/dropped`), driven by `PIPELINE_STAGE_MAP` and logged in `opportunity_stage_changes`. **Unchanged.**

`bids.stage_key` is a new, separate, open-string registry describing the bid-preparation workflow, added to `packages/domain/src/bids.ts` alongside `PIPELINE_STAGES`' existing pattern:

```ts
export const BID_STAGES = [
  { key: 'solutioning', label: 'Solutioning', order: 0 },
  { key: 'qualification', label: 'Qualification', order: 1 },
  { key: 'preBidQueries', label: 'Pre-bid Queries', order: 2 },
  { key: 'commercialProposal', label: 'Commercial Proposal', order: 3 },
  { key: 'submitted', label: 'Submitted', order: 4 },
  { key: 'goApproved', label: 'Go Approved', order: 5, closed: true },
  { key: 'dropped', label: 'Dropped', order: 6, closed: true },
] as const
```

Sync is **Bid → Opportunity only**, and only at two points, both applied through the *existing* `opportunities.update` procedure (so it keeps logging into `opportunity_stage_changes` — Bid Tracker does not maintain a parallel stage-history log):

1. `bids.stage_key` transitions to `'submitted'` → `opportunities.update({ stageKey: 'submitted' })`, only if the opportunity isn't already further along.
2. `bids.decision` becomes final (`'go'` while at/after `'submitted'` → opportunity `'won'`; `'no_go'` → opportunity `'dropped'`), only if the opportunity isn't already closed.

`decision` and `stage_key` are deliberately two separate fields (matching the Overview tab's separate "Stage" and "Decision" display), but a `decision` change also auto-derives the matching terminal `stage_key` in the same `bids.update` call — `'go'` sets `stage_key='goApproved'`, `'no_go'` sets `stage_key='dropped'` — so the two never visibly disagree (e.g. `decision='go'` while `stage_key` still reads `'qualification'`). This mirrors how `opportunities.update` already auto-derives `closed_on` whenever `stageKey` becomes closed.

No reverse sync. Once a `bids` row exists for an opportunity, `WorksEditor.tsx`'s stage control for that opportunity becomes **read-only**, with a note pointing at Bid Tracker — one writer per fact, the same principle applied to submission deadlines below.

### 4.5 `submissionDeadline` — single writable source

Two pre-existing representations collide here: `opportunities.submission_date` (plain TEXT, unvalidated, today's only source) and the new `bid_milestones` row (`key='submissionDeadline'`, structured `TIMESTAMPTZ`, freezable, corrigendum-linkable). Resolution:

- **Before** a bid exists for an opportunity: `opportunities.submission_date` is the sole source, directly editable via `WorksEditor.tsx` exactly as today. Nothing changes for opportunities that never enter Bid Tracker.
- **Once** a `bids` row exists: `bid_milestones` (`key='submissionDeadline'`) becomes the *only* writable source. Every write to it (manual edit or corrigendum-accept) runs inside the same transaction as an `opportunities.submission_date` update, keeping the mirror in sync for the legacy UI/search that reads it directly. `opportunities.update` rejects a `submissionDate` patch (`BAD_REQUEST`, message pointing at Bid Tracker) whenever a `bids` row exists for that opportunity — checked via a single `EXISTS` lookup at the top of the procedure.

### 4.6 Ownership: Bid Owner and Solution Lead reuse the existing generalized system, unchanged

No new ownership schema. `packages/domain/src/ownership.ts`'s `OWNABLE_ENTITIES` registry gets a 4th entry:

```ts
bid: {
  resolution: 'exact',
  parent: (bid) => ({ entityType: 'opportunity', entityId: bid.opportunityId }),
}
```

This is exactly the shape `contact` (inherits from `orgNodeId`) and `opportunity` (inherits from `departmentId`) already use — `effectiveOwner()`'s existing direct → same-type-ancestor → cross-type-fallback → none algorithm needs zero new logic. No direct `ownership_assignments` row for a bid → its owner is inherited from the linked opportunity's current owner (`source: 'inherited'`). Assigning a direct owner to the bid creates a row that overrides inheritance from then on (`source: 'direct'`) — re-assigning the opportunity's owner later will **not** retroactively move a bid that already has its own direct assignment.

"Solution Lead" is a second, concurrent role on the same entity — not a sequential owner→delegate handoff. `ownership_assignments.role` is already an open string (comment: `'owner'|'delegate'` today, `'collaborator'` planned) with a partial unique index enforcing "at most one open `owner`." Add a second partial unique index, `ownership_assignments_one_open_solution_lead`, of identical shape but `WHERE role='solutionLead'`, so a bid can carry an owner and a solution lead concurrently without touching the existing owner/delegate invariant.

### 4.7 Non-destructive deletion policy

`bids.opportunity_id` is `ON DELETE RESTRICT` — deleting an opportunity or a department subtree that has *any* bid (even an archived one) fails with a friendly error, never a silent cascade wipe of Bid Tracker history. `bids.status` (`'active'|'archived'`) is the normal "delete" a user performs from the UI: it hides the bid from default Master Grid views while preserving every milestone, corrigendum, protected-value freeze, document, and audit-log row intact and queryable. A true hard delete stays available only when the bid has zero accepted corrigendum changes and zero frozen protected values — otherwise archive is the only option offered.

Because RESTRICT applies regardless of archived state, `opportunities.delete` and `hierarchy.deleteNode` — which already translate other RESTRICT violations (`transfers.to_org_node_id`, `commercial_boqs.department_id`) into a friendly `CONFLICT` — get the same treatment added for `bids`.

## 5. Entity relationship summary

```
hierarchy_nodes (department, domain='org')
   ▲  department_id (RESTRICT)
opportunities ───────────────1:1(UNIQUE)───────────────▶ bids ◀──────────┐
   │  gemTenderId, submissionDate*, valueAmount, emdAmount                │
   │  *submissionDate becomes a mirror once a bid exists (§4.5)           │
   │                                                                       │
   │ 1:N (nullable, not unique — §4.3)                                    │ 1:N (CASCADE)
   ▼                                                                       │
commercial_boqs (grandTotal)                                    bid_milestones
                                                                  bid_corrigenda ──1:N(CASCADE)──▶ bid_corrigendum_changes
ownership_assignments (entity_type='bid', polymorphic) ◀── inherits from opportunity (§4.6)
follow_ups (entity_type='bid', polymorphic, existing table, reused as-is)
protected_values (entity_type='bid', polymorphic, generic — new)
documents (entity_type='bid'|'bidCorrigendum', polymorphic — new) ──1:N(CASCADE)──▶ document_citations
audit log rows (entity_type='bid'|..., existing generic table — §10)
bid_saved_views (independent — no FK to bids)
```

## 6. Backend API contracts

New routers under `apps/api/src/routers/`, all standard `protectedProcedure`/`protectedReadProcedure` (no special admin gate, unlike admin-import):

| Router | Procedures |
|---|---|
| `bids` | `listForGrid` (joined opportunities+bids+ownership+latest-milestone view, filter/sort params matching a saved view's `filter_rules`/`sort`), `get({id})`, `create({opportunityId})` (allocates `bid_code` via `bid_number_sequences`, **and**, in the same transaction, seeds a `bid_milestones` row with `key='submissionDeadline'` from the opportunity's current `submissionDate` — parsed to a `TIMESTAMPTZ` if it's a well-formed date, else left `NULL` — since `opportunities.update` will refuse further `submissionDate` writes the instant this bid row exists, per §4.5, and there must be somewhere for that fact to live going forward), `update({id, patch})` (a `decision` change auto-derives `stage_key` per §4.4), `archive({id})`, `unarchive({id})`, `delete({id})` (guarded per §4.7), `actionQueue.list()` (open `follow_ups` for `entityType='bid'`, joined with bid/opportunity summary columns and a computed attention flag) |
| `bidMilestones` | `listForBid({bidId})`, `create`, `update`, `delete` — `update`/`create` on `key='submissionDeadline'` writes `opportunities.submission_date` in the same transaction (§4.5) |
| `bidCorrigenda` | `listForBid({bidId})`, `create({bidId, corrigendumNumber, sourceDocumentId?, changes: [{fieldKey, currentValue, proposedValue}]})`, `reviewChange({changeId, decision, reason?})` — rejects if `fieldKey` is frozen (§11), applies the accepted value to the target milestone/field transactionally, writes an audit-log row |
| `protectedValues` | `listFor({entityType, entityId})`, `freeze({entityType, entityId, fieldKey})`, `unfreeze({entityType, entityId, fieldKey, reason})` — reason required and non-empty on unfreeze only (§11) |
| `documents` | `requestUploadUrl({entityType, entityId, filename, contentType, sizeBytes})`, `confirmUpload({uploadId, ...})`, `listFor({entityType, entityId})`, `delete({id})`, `citations.create/list/delete` (§14) |
| `bidSavedViews` | `list()` (server-side filters to `scope='global' OR ownerEmail=ctx.user.email`), `get({id})`, `create`, `update`, `delete` — every global-view mutation writes an audit-log row (§16) |
| `auditLogs` (new top-level) | `list({entityType?, entityId?})` — thin wrapper over the same shared function `commercial.auditLogs.list` already calls (§10) |

Existing routers, small additive changes:

- `opportunities.ts`: `update` rejects a `submissionDate` patch when a `bids` row exists (§4.5); `delete` translates the new `bids` RESTRICT violation into a friendly `CONFLICT`, alongside its existing cascade-delete logic.
- `hierarchy.ts`: `deleteNode` gains `bids` to its existing list of RESTRICT-violation-to-CONFLICT translations (alongside `transfers`, `commercial_boqs`).
- `commercial.ts`: `boq.revise` and `boq.duplicate` copy `opportunity_id` forward in their `INSERT` column lists (§4.3); `create`/`update` gain a `patch.opportunityId` field (nullable) for linking an existing BOQ to an opportunity after the fact.

## 7. Frontend architecture and navigation

New module `src/modules/bid-tracker/`, mirroring `src/modules/commercial-calculator/`'s shape (`Workspace.tsx` tab shell + `pages/` + `components/` + colocated business-logic modules). Registered as the app's **third top-level module** — the same 5-file change already used for Commercial Calculator:

1. `src/app/router.tsx` — `/bid-tracker`, `/bid-tracker/:section`, `/bid-tracker/bid/:bidId`.
2. `src/components/AccountMappingRail.tsx` — third nav button.
3. `src/components/MobileNavDrawer.tsx` — matching mobile entry.
4. `src/components/TopBar.tsx` — a `isBidTracker` branch (module label, and a decision on whether to show the global search/Import/Export affordances or hide them like Commercial Calculator does — recommend **keep them visible**, since Bid Tracker's own Import/Export/Search are core requirements, not a self-contained tool like Commercial Calculator).
5. `src/app/AppLayout.tsx` — add `&& !pathname.startsWith('/bid-tracker')` to `navExpanded`.

`BidTrackerWorkspace.tsx` tabs: Master Grid / Milestones & Dates / Action Queue / Activity History (`SECTIONS` array, same pattern as `CommercialCalculatorWorkspace.tsx`). A bid's detail route (`/bid-tracker/bid/:bidId`) renders its own four tabs (Overview/Milestones/Commercial & Files/Protected Values) using `ui/Tabs.tsx` — the first genuinely tabbed detail page in the app (confirmed via audit: `SalesPersonDetails.tsx` explicitly documents this pattern as "planned, not yet built").

All new components import from `src/components/ui/*` (Button, Badge, Dialog, Tabs, Field, Combobox, Menu, Toast, Tooltip) — the app's bespoke Tailwind/framer-motion kit, confirmed to have **no Radix/shadcn** anywhere in the repo. No new UI-kit dependency.

## 8. Master Grid

New dependency: `@tanstack/react-table` (headless/unstyled — fits the bespoke-Tailwind convention with zero styling baggage), paired with the already-installed `@tanstack/react-virtual` for row virtualization (no other "grid" in the app has sorting, resizing, or column visibility today — every existing `<table>` is static).

Column groups (matching the screenshots and `bids.listForGrid`'s joined shape): Identity (Opportunity ID, Opportunity/Mission, Bid ID, Tender ID, Tender Link), Client (Department/Client, State and City, Sector), Ownership (Bid Owner, Sales Lead/Solution Lead), Decision (Bid Stage, Next Action, Action Owner, Action Due, Attention Flag, Decision), Dates (Next Milestone, Days Remaining, Submission Deadline), Documents (Tender Files count, Latest Corrigendum status), System (Last Updated/Updated By, Data Confidence, Manage actions).

Column visibility state is `@tanstack/react-table`'s built-in `columnVisibility`, persisted into the *active* saved view's `visible_columns` JSONB on change (debounced), not a separate preferences table. Row selection uses `@tanstack/react-table`'s built-in row-selection state; bulk row actions (archive, reassign owner) operate on the selection.

## 9. Saved views

`bid_saved_views` backs both the pill-tab row (All Bids, My Bids, Solutioning, Due Soon, Overdue, Go Approved, Smart Transport Bids, High Value Deals > 20 Cr — every one of these is a row here, none hard-coded) and the "Create Saved View" dialog (Name, Scope: Personal/Global). `filter_rules` is an ordered array of `{ field, operator, value }` triples (matching the "Active Filter Rules — WHERE Stage is Solutioning" UI); the frontend's filter-rule builder is new work — no existing filter-persistence pattern exists anywhere in the repo to extend (confirmed: grepped for `savedView`/`customFilter` repo-wide, zero matches).

**Permissions (§16 below has the full detail):** personal views are visible/editable only by their `owner_email`; global views are visible to everyone, and any authenticated user may create/edit/delete one — GOMS has no role/permission system anywhere today to gate that further, so restricting global-view governance to specific roles is out of scope unless requested as separate follow-on work. Every global-view mutation is written to the audit log.

## 10. Detail workspace (Overview tab)

Reads, does not own, most of its data: `bids` + joined `opportunities` (tender ID, dates, value/EMD) + `ownership.resolveOwner` (bid owner, solution lead) + `bidMilestones.listForBid` (earliest next milestone) + `bids.actionQueue`-style next-action lookup (the earliest open `follow_ups` row for this bid). "Next Stage Requirements" (the "Recommended inputs needed: Executive Go/No-Go sign-off" banner) is **derived, not persisted** — a static lookup keyed by `bids.stage_key`:

```ts
// packages/domain/src/bids.ts
export const BID_STAGE_REQUIREMENTS: Record<BidStageKey, string[]> = {
  qualification: ['Executive Go / No-Go sign-off'],
  solutioning: ['Technical solution finalized', 'Pre-bid queries submitted'],
  // ...
}
```

Zero schema, zero per-bid data entry — purely a display-time lookup.

## 11. Milestones

`bid_milestones` rows render as the Milestones tab (pre-bid conference: date/venue/notes) and the standalone Milestones & Dates grid view (all bids' milestones in one sortable table — Milestone, Days Remaining, Submission Deadline, Tender Files, Latest Corrigendum, Last Updated/Updated By, Data Confidence, Manage). "Days Remaining" is computed at query/render time from `due_at`, never stored (avoids staleness).

The stable `key` column is what lets a corrigendum amend "this exact date slot" across multiple amendments — e.g. `cor_2_a`/`cor_2_b` from the reference screenshots are two independently-tracked corrigendum-linked date slots on the same bid, addressable by key across however many corrigenda touch them over time.

## 12. Corrigenda: current-vs-proposed, explicit accept/reject

`bid_corrigenda` + `bid_corrigendum_changes` mirror the **shape** (current value / proposed value / explicit per-row decision), not the table, of the admin-import engine's `ImportFieldDiff`/`ImportRowResult` pattern already shipping in `SessionImportWizard.tsx` — same "never silently overwrite, always show current vs. proposed, require an explicit decision per field" semantics, scoped here to one bid/corrigendum document rather than a bulk spreadsheet. The review dialog ("Review Corrigendum Changes" — per-field current/proposed value pair, a checkbox to accept, a "Keep Existing Values" reset, "Save N Changes") and the import wizard's diff table share one presentational component, `FieldDiffReviewTable`, rather than duplicating that UI.

`bid_corrigenda.status` shown in the grid ("Reviewed" / "Needs Approval" / blank) is **fully derived at read time**: `pending_review` when any of its `bid_corrigendum_changes` rows has `decision='pending'`, `reviewed` once every row has a non-pending decision, blank if no corrigendum row exists yet for the bid. No manual "mark reviewed" step — resolving the last pending change is what flips it.

Accepting a change writes the `proposed_value` to the target `bid_milestones` row (or `bids`/`opportunities` column, per `field_key`) **inside the same transaction** as marking the change `accepted` and writing an audit-log row — and first checks `protected_values`: if the target field is frozen, the accept is rejected outright (`BAD_REQUEST`, "field is protected — unfreeze it first"). Unfreezing and accepting stay two separate, separately-audited actions; there is no implicit override path.

## 13. Protected Values

Freeze/unfreeze authorization, reasons, and audit behavior (all specific, per the earlier resolution round):

- **Freeze**: any authenticated user; no reason required (it's the protective action).
- **Unfreeze**: any authenticated user; a non-empty `reason` is **required** (mirrors `commercial.ts`'s existing `changeReason` gate on sensitive SKU/BOQ field changes) — enforced with a `.refine()` at the Zod schema level, not just a UI hint.
- Both actions write an audit-log row (`action: 'freeze'|'unfreeze'`, `field: fieldKey`, `changedBy: ctx.user.email`, `reason`).
- Corrigendum interaction: see §12 — a frozen field blocks corrigendum-change acceptance outright, never silently.
- Direct field edits (via `bids.update`/`bidMilestones.update`/`opportunities.update`) run the same `assertFieldsNotProtected(entityType, entityId, patchKeys)` guard as the corrigendum-accept path and the admin-import commit pipeline — **one shared function, three call sites**, so "never silently overwritten by imports or team edits" is enforced identically everywhere, not reimplemented three times with room to drift.

## 14. Documents (source documents & citations)

Genuinely new infrastructure — the audit confirmed zero file/blob storage exists anywhere in GOMS today (the only precedent, base64-in-JSONB for employee photos/visiting cards, is explicitly flagged in-code as an unfinished stopgap). This design **reuses the already-provisioned `${project_id}-attachments` GCS bucket** (`infra/{dev,prod}/storage.tf`, created for that same eventual employee-attachment use case per the GCP backend architecture spec) rather than provisioning a new bucket — the `goms-api-runtime` service account already holds `roles/storage.objectAdmin` on it in both environments, so no new IAM grant is needed either.

- **Object naming**: `bid-tracker/{entityType}/{entityId}/{documentId}/{sanitizedFilename}` — the `documentId` UUID in the path guarantees no collision even for identical filenames/versions.
- **Size limit**: 50 MB per file — generous for scanned tender PDFs, rejected client-side and server-side.
- **Allowed content types**: `application/pdf`, `image/jpeg`, `image/png`, `.docx`, `.xlsx` — everything else (including any executable/script MIME type) is rejected by `documents.requestUploadUrl`.
- **Signed URL expiry**: upload URL 10 minutes; view/download URL 15 minutes, minted fresh per request — never stored or cached long-term.
- **Permissions**: the bucket is already fully private (`uniform_bucket_level_access = true`, `public_access_prevention = "enforced"`, confirmed in both `infra/dev/storage.tf` and `infra/prod/storage.tf`); access is exclusively via short-lived signed URLs the backend mints.
- **Version uniqueness**: `UNIQUE(entity_type, entity_id, filename, version)` — re-uploading the same filename without bumping `version` is rejected (`BAD_REQUEST`).
- **Failed-upload cleanup**: uploads land first at `bid-tracker/_pending/{uploadId}/{filename}`; `confirmUpload` copies the object to its canonical path and only then inserts the `documents` row; a new GCS Object Lifecycle rule (additive Terraform change to both `infra/dev/storage.tf` and `infra/prod/storage.tf`) purges anything left under `_pending/` after 24 hours — no app-level cron needed.
- **Orphan cleanup**: out of scope for real-time reconciliation this phase. `documents.delete` removes the DB row (cascading `document_citations`) transactionally, then best-effort deletes the GCS object (failure logged, not retried, not blocking) — an accepted, low-cost gap for an internal tool, explicitly not a background sweep job in this phase.
- **Deletion behavior**: deleting a document does not touch any protected-value freeze or corrigendum reference to it — those hold their own copied text (`document_citations.quote_text`, `bid_corrigendum_changes.current_value`/`proposed_value`), not a live pointer, so history stays readable even after the source file is removed.

## 15. Action Queue and follow-ups

No new schema for "next action." The existing polymorphic `follow_ups` table (`entity_type`, `entity_id`, `assignee_id`, `due_date`, `status`, `note`) is reused as-is with `entityType='bid'`. The Action Queue view is a joined read (`bids.actionQueue.list`): every open `follow_ups` row for `entityType='bid'`, joined with `bids`/`opportunities` summary columns (Bid Owner, Solution Lead, Bid Stage) for display, ordered by `due_date`. The **Attention Flag** (Due Soon / Overdue / On Track / Corrigendum Pending) is computed at query time, never stored: `Overdue` if `due_date < today`, `Due Soon` if within a configurable threshold (recommend 3 days, matching the screenshots' "1d left"/"5d left" framing), `Corrigendum Pending` if the bid has any `bid_corrigenda` with derived `status='pending_review'` (takes precedence over the date-based flags), else `On Track`.

## 16. Activity History and audit logging

**Preserving existing `commercial.auditLogs` consumers, exactly.** Extract the existing `writeAuditLog` writer and the list query out of `apps/api/src/routers/commercial.ts` into a new shared module, `apps/api/src/lib/auditLog.ts`, with the identical function signatures. `commercial.auditLogs.list` keeps its exact existing route path, input shape, and output shape — `AuditLog.tsx` in `commercial-calculator` needs zero changes. A new, separate top-level `auditLogs.list` procedure (§6) calls the same shared function for Bid Tracker's entity types (`bid`, `bidMilestone`, `bidCorrigendum`, `bidSavedView`). This is purely additive: no rename of `commercial_audit_logs` (a live production table — renaming it for cosmetic consistency isn't worth the migration risk), no removal, no behavior change to the procedure that already exists.

Every write path that should appear in Activity History uses this one shared writer: bid field edits, milestone changes, corrigendum accept/reject, ownership changes (already logged via `ownership_assignments`' own history, read separately), protected-value freeze/unfreeze, document uploads/deletes, and saved-view global-scope mutations.

## 17. Import/export

New domain adapters (`bids`, `bidMilestones`) plugged into the existing `session/adapters.ts` `ADAPTERS` registry, reusing `apps/api/src/import/engine.ts`'s `classifyRows`/`findFuzzyCandidates`/diff computation and the full existing pipeline: validate in a rolled-back transaction → staged current-vs-proposed diff review (`SessionImportWizard.tsx`, shared `FieldDiffReviewTable` per §12) → explicit whole-row exclude-with-reason → gated re-validate → real commit, with one `admin_import_runs` row per domain per session exactly as every other import domain today. A bulk import commit that touches a bid sets `data_confidence='needs_review'` if any row in that commit was fuzzy-matched or flagged needs-review (§ below). `ExportDialog.tsx` gains a "Bids" dataset checkbox, reusing the existing CSV export path.

**Data Confidence — persisted, not derived, with explicit transitions:**

| Event | `data_confidence` becomes |
|---|---|
| Bid created via manual entry (Bid Tracker UI) | `verified` |
| Bid created/updated via an admin-import commit with any fuzzy-matched/needs-review row | `needs_review` |
| New corrigendum detected with any pending change | `needs_review` (regardless of current value) |
| Explicit "Mark Verified" action, human-clicked | `verified` — only enabled once no corrigendum changes remain pending for that bid |

This is distinct from `bid_corrigenda.status` (§12), which is a per-corrigendum, fully-derived value — the screenshots show both in separate grid columns ("Data Confidence" vs. "Latest Corrigendum"), and this spec keeps them as two separate fields rather than conflating them.

## 18. Global search integration

Extend the existing `work` category in `packages/domain/src/search.ts` (already indexes `opportunityName`, `gemTenderId`, `vertical`, `component[]`, owning sales person) to also match `bids.bidCode` and `bids.tenderLink` where a bid exists for the opportunity, and to change its `path()` to point at `/bid-tracker/bid/:bidId` instead of the department node view once a bid exists (falling back to the current department-node path for opportunities with no bid). No new search category, no new indexing infrastructure — `loadSearchData()`'s existing `SELECT * FROM opportunities` gains one `LEFT JOIN bids`.

## 19. Permissions and auth

Bid Tracker uses the exact same `protectedProcedure`/`protectedReadProcedure` gates as the rest of GOMS (`opportunities`, `ownership`, `hierarchy`), governed by the same `AUTH_ENFORCEMENT_ENABLED` feature flag already wired through `apps/api` — no special admin-allow-list gate like admin-import's Firebase sign-in, since Bid Tracker is a normal internal-team module, not a restricted-access data-loading tool. GOMS has no granular role/permission system anywhere today beyond that flat authenticated/not-authenticated model and the admin-import allow-list, which is why §9's global-saved-view governance and §13's freeze/unfreeze authorization are both deliberately flat (any authenticated user), audited rather than role-gated.

## 20. Migration plan

New migration files (following the existing `<unix-timestamp-ms>_<slug>.sql` convention, applied in this order, all additive — no `ALTER` that changes or drops an existing column anywhere):

1. `bid_number_sequences` + `bids`
2. `bid_milestones`
3. `documents` + `document_citations`
4. `bid_corrigenda` + `bid_corrigendum_changes`
5. `protected_values`
6. `bid_saved_views`
7. `commercial_boqs.opportunity_id` (ALTER, nullable FK add only)
8. `ownership_assignments_one_open_solution_lead` (partial unique index add only)

`documents` (3) must precede `bid_corrigenda` (4): `bid_corrigenda.source_document_id` is a `REFERENCES documents(id)`, and Postgres will reject the `CREATE TABLE` otherwise — an ordering bug caught during this spec's self-review, not left for implementation to discover. Each migration ships with its down-migration dropping exactly what it created, matching every existing migration in `apps/api/migrations/`. None of these migrations touch `opportunities`, `hierarchy_nodes`, `sales_persons`, `employees`, or `customers` — every new table is additive, and the two ALTERs (7, 8) are pure column/index additions with no data transformation.

## 21. Deployment & migration dependencies

Grounded in the live Terraform (`infra/dev`, `infra/prod`) and `.gitlab-ci.yml`, not generic cloud advice:

### 21.1 GCS bucket/IAM provisioning

**No new bucket, no new IAM grant.** `${project_id}-attachments` already exists in both `infra/dev/storage.tf` and `infra/prod/storage.tf` (private, uniform bucket-level access, `public_access_prevention = "enforced"`), and `google_storage_bucket_iam_member.runtime_bucket_access` already grants `goms-api-runtime` (both environments' Cloud Run runtime service account) `roles/storage.objectAdmin` on it. The only Terraform change needed is **additive**: a `google_storage_bucket_lifecycle_rule`-equivalent lifecycle configuration on both `storage.tf` files, scoped to the `bid-tracker/_pending/` prefix, deleting objects older than 24 hours (§14). This is a low-risk, narrowly-scoped diff to a resource that already exists — not new infrastructure provisioning.

### 21.2 Migration ordering

New migrations (§20) are appended after the existing 15 in `apps/api/migrations/`, applied via the same `goms-migrate` Cloud Run Job already used for every prior migration (kept in lockstep with the `goms-api` image tag on every `deploy-dev` run, per the existing CI step `gcloud run jobs update goms-migrate --image=...`). CI's `test` stage already runs `npm --workspace apps/api run migrate up` against a throwaway Postgres before any deploy — the new migrations are exercised there first, same as every existing one. Because every new migration is additive (§20), migration order relative to the *existing* 15 doesn't matter; order *within* the new set matters only where a later migration's FK target must already exist (7 and 8 must run after 1, since they reference `bids`/target the `bids` entity type — already guaranteed by plain top-to-bottom file-timestamp ordering).

### 21.3 Backend/frontend deployment ordering

Backend first, always: the `goms-migrate` job must complete successfully against the target environment before the new `goms-api` revision (carrying the new routers) receives traffic, and before the frontend build (carrying the new `/bid-tracker` routes and any `VITE_BID_TRACKER_ENABLED`-gated code) is deployed — this is the same ordering `deploy-dev` already enforces today (migrate job image updated, then `gcloud run deploy`, then frontend build+`firebase deploy`, all in one CI job body). No change to this ordering discipline is needed; Bid Tracker just adds more work inside the same steps.

Recommend a new frontend build flag, `VITE_BID_TRACKER_ENABLED`, following the exact precedent of `VITE_ADMIN_IMPORT_ENABLED` (a build-time flag gating a route/nav entry, set per-environment in the `deploy-dev` CI job body and — when ready — in whatever mechanism drives the `goms-prod` build). This allows the backend + schema to ship and be validated in `goms-dev` while the nav entry stays dark in `goms-prod` until explicitly flipped, independent of any code deploy.

### 21.4 Production rollout verification

Before flipping `VITE_BID_TRACKER_ENABLED` on for `goms-prod`: (1) confirm the `goms-migrate` job ran cleanly against `goms-prod`'s Cloud SQL (matching the existing "smoke-tested clean" verification discipline used for every prior prod promotion — checking `gcloud run jobs executions describe` / logs, not just assuming success); (2) run the same smoke-test pattern used for the auth-architecture promotion — hit `bids.listForGrid`, `documents.requestUploadUrl`→`confirmUpload` round-trip, and one corrigendum accept/reject cycle against `goms-prod` directly (via `curl`/a script, not through the not-yet-flagged-on UI); (3) confirm the bucket lifecycle rule is live (`gcloud storage buckets describe --format='value(lifecycle)'`) before any real document upload happens, so `_pending/` cleanup is active from the first real upload, not retrofitted after orphans accumulate.

### 21.5 Rollback considerations

- **Frontend**: instant — flip `VITE_BID_TRACKER_ENABLED` off and rebuild/redeploy the static bundle (or, if the flag is read at runtime rather than build time, no redeploy at all). The nav entry and routes disappear; no data is touched.
- **Backend**: the new routers are additive endpoints on the existing `goms-api` service — rolling back the Cloud Run revision to the prior image tag (the same "no rebuild between dev and prod, promote the exact tested tag" discipline already used) removes them without touching the database.
- **Schema**: because every migration in §20 is additive, rollback does **not** require reverse-migrating in the failure case that matters most (a bad deploy caught quickly) — the new tables simply go unused if the frontend/backend roll back. A genuine down-migration (dropping the new tables) is only needed if the schema itself turns out wrong after real data has been written to it, and should be treated as a deliberate, reviewed action, not an automatic rollback step.
- **GCS lifecycle rule**: reverting the Terraform diff removes the rule; it has no effect on any object already outside `_pending/` (i.e., already-confirmed documents are never touched by it).

## 22. Test strategy

Colocated Vitest + Testing Library, matching every existing module (`.test.ts`/`.test.tsx` beside the file it tests). API router tests as real-Postgres integration tests via `appRouter.createCaller({})`, matching the existing convention in `apps/api/src/routers/*.test.ts` — not mocked.

Specific scenarios to cover beyond ordinary CRUD, chosen because they're where this design's cross-cutting rules live and a unit test alone wouldn't catch a regression:

- `opportunities.update` rejects a `submissionDate` patch once a `bids` row exists; accepts it when none exists (§4.5).
- `opportunities.delete` / `hierarchy.deleteNode` return a friendly `CONFLICT` when a `bids` row (active or archived) still references the target (§4.7), and succeed once none does.
- Bid stage sync fires exactly at the two defined transition points and nowhere else (§4.4) — including a case where the opportunity is already further along and sync should be a no-op.
- `bid_corrigenda.status` is correctly derived at read time from its changes' decisions (§12), including the "last pending change resolved" transition.
- A corrigendum-change accept on a frozen field is rejected with a clear error, and succeeds immediately after an explicit unfreeze (§13).
- `commercial.boq.revise`/`.duplicate` carry `opportunity_id` forward correctly (§4.3) — a regression here would silently break the Commercial & Files tab's BOQ linkage.
- `documents.confirmUpload` correctly moves the object from `_pending/` to its canonical path and rejects a duplicate `(entityType, entityId, filename, version)`.
- `bidSavedViews.list` correctly scopes to `global OR ownerEmail=self` and never leaks another user's personal view.

## 23. Acceptance criteria

- A user can create a bid from an existing opportunity, see it in the Master Grid with correct department/state/tender-ID/value/EMD pulled from that opportunity (not re-entered), and open its detail workspace.
- A user can freeze the submission deadline, then attempt (via a simulated corrigendum) to change it, and the system refuses until the field is explicitly unfrozen with a reason.
- A user can create a personal saved view and a global saved view; the personal view is invisible to a different user, the global view is visible to everyone and its edits are attributable in the audit log.
- Deleting an opportunity or department that has an active bid fails with a clear message instead of a raw FK error; archiving the bid first allows the deletion to proceed (once no other blocker remains).
- A tender file uploaded through the Commercial & Files tab is retrievable via a signed URL, rejected if it exceeds 50 MB or is an unlisted content type, and does not appear anywhere if the upload is never confirmed (verified against the `_pending/` prefix).
- The existing `commercial-calculator` Activity History page (`AuditLog.tsx`) continues to function with zero code changes required in that module.

## 24. Risks and explicit non-goals

**Risks / accepted trade-offs:**

| Risk | Accepted because | Mitigation |
|---|---|---|
| `commercial_boqs.duplicate`'s pre-existing `opportunity_name` copy bug is not fixed | Out of scope — predates this design, fixing it is unrelated surgery on a working module | Noted explicitly (§4.3) so it isn't rediscovered as a Bid Tracker bug later |
| No real-time orphan reconciliation for GCS objects vs. `documents` rows | Low-cost for an internal tool at this scale; building a sweep job is unjustified scope for phase 1 | `_pending/` lifecycle rule handles the common case (abandoned uploads); rare true orphans are an accepted, logged gap |
| Global saved views and protected-value freeze/unfreeze are flat-permission (any authenticated user), not role-gated | GOMS has no role/permission system anywhere today | Every mutation to a shared/protected fact is written to the audit log, so misuse is traceable even though it isn't preventable at this phase |
| "EMD/Tender Fee" stays one combined field on Opportunity | The screenshots show one combined label; splitting it is unrequested scope | If EMD and tender fee genuinely need independent tracking later, that's one new column — flagged, not built speculatively |

**Explicit non-goals:**

- Not touching the `customers` table — confirmed disconnected from everything (no FK anywhere in the schema); this design does not revive or link it.
- Not renaming `commercial_audit_logs` to a more generic name — reused as-is via a shared extracted function, not restructured.
- Not building a role/permission system — flagged wherever this design's flat-permission choices depend on that absence (§9, §13, §19).
- Not building real-time GCS orphan reconciliation, nor a background sweep job of any kind, this phase.
- Not seeding any demo/sample bid, milestone, corrigendum, or document data — every identifier in the reference screenshots is illustrative only.
- Not implementing, migrating, deploying, or pushing anything as part of this spec — this document is the design to review before an implementation plan is written.

---

**Next step:** review this design. Once approved, an implementation plan will be written via the `writing-plans` skill, covering exact task breakdown and build order.
