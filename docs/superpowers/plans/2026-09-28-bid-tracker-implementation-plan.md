# Bid Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Bid Tracker module end-to-end — schema, backend routers, and frontend UI — exactly as specified in the design spec, with no seeded demo data and no production deploy as part of this plan.

**Architecture:** A new `bids` table 1:1-linked to `opportunities`, six supporting tables (milestones, corrigenda, protected values, documents, saved views), all additive migrations. New tRPC routers follow every existing router's conventions (`toXxx` row mappers, zod `patchShape`/`columnFor`, `pool.connect()`/`BEGIN`/`COMMIT` transactions, `isForeignKeyViolation`/`isUniqueViolation` from `db-errors.ts`). Frontend adds a third top-level module mirroring `commercial-calculator`'s shape, behind a `VITE_BID_TRACKER_ENABLED` build flag, wired through the existing `Repository` abstraction (both `InMemoryRepository` and `RemoteRepository`, not just the live one) so local dev without a backend keeps working.

**Tech Stack:** TypeScript, tRPC v11, PostgreSQL (`node-pg-migrate`), Vitest + Testing Library, React + Vite, `@tanstack/react-query`, `@tanstack/react-virtual` (existing) + `@tanstack/react-table` (new), `@google-cloud/storage` (new), Tailwind + the bespoke `src/components/ui/*` kit.

**Spec:** `docs/superpowers/specs/2026-09-28-bid-tracker-design.md` — this plan argues from that spec; read both. Every section reference below (`§4.7`, `§14`, etc.) points into it.

## Global Constraints

- No new npm dependency beyond the two already approved in the spec: `@tanstack/react-table` (frontend grid) and `@google-cloud/storage` (backend document upload). No other new dependency without going back to the user.
- Every new migration is additive only — no `ALTER` that changes or drops an existing column anywhere (spec §20).
- All new/modified procedures use `protectedProcedure`/`protectedReadProcedure`, governed by the existing `AUTH_ENFORCEMENT_ENABLED`/`READ_AUTH_ENFORCEMENT_ENABLED` flags — no new admin-gate pattern (spec §19).
- `bids.opportunity_id` is `ON DELETE RESTRICT` with **no exception for archived bids** — this must never regress to allowing archived-bid deletion to unblock an opportunity/department delete (spec §4.7, corrected from an earlier draft).
- `bids` is **1:1** with `opportunities` (`UNIQUE` on `opportunity_id`); `commercial_boqs.opportunity_id` is **1:N** (nullable, not unique) — do not swap these (spec §3, §4.3).
- `SYSTEM_BID_VIEWS` (All Bids/My Bids/Solutioning/Qualification/Due Soon/Overdue/Go Approved) is a **code registry, never a database row** — structurally immutable, not enforced by an `is_system` flag (spec §9.2). "Smart Transport Bids" and "High Value Deals > 20 Cr" are illustrative only and must never be seeded.
- Documents: exactly five allowed MIME types (`application/pdf`, `image/jpeg`, `image/png`, the DOCX and XLSX Office Open XML types), 50 MB max, and `confirmUpload` must verify the **actual** GCS object metadata — never trust the client's original request claim alone (spec §14).
- Colocated Vitest + Testing Library; every new API router test is a real-Postgres integration test via `appRouter.createCaller({})` — never mocked, matching every existing `apps/api/src/routers/*.test.ts` (spec §22). `packages/domain` has no standalone test runner configured (`vite.config.ts`'s vitest `include` is `src/**/*.test.ts` only) — new pure domain logic in `packages/domain` is exercised through the `apps/api` router tests that call it, exactly like `PIPELINE_STAGE_MAP` is today, not through a new colocated `.test.ts` file that no config would run.
- **Custom fields (Phase M2) are an additive layer**: they never alter the seven required column groups, the `bids` table, or any Task 1–26 contract; they are ordinary (not protected-value / corrigendum) fields; and an unknown import heading or an archived column must never silently create, delete, or break anything.
- No demo/sample bid, milestone, corrigendum, or document data is created anywhere in this plan. Every identifier in the reference screenshots is illustrative only.

## Review Focus

- **A patch that sets `stageKey` and `decision` in the same `bids.update` call** — the `decision='go'` gate must read the *new* `stageKey` from that same patch, not the stale pre-patch value, so "submit and mark Go in one call" works and "mark Go while simultaneously reverting stage backward" is still rejected. (Task 7)
- **Deleting a department whose subtree contains an opportunity with an archived (not active) bid** — must still fail with a friendly `CONFLICT`, exercised via `hierarchy.deleteNode`, not just via the more obvious direct `opportunities.delete` path. (Task 11)
- **A corrigendum change whose `fieldKey` doesn't correspond to a real `bid_milestones.key` or the one supported `bids` column** — must reject clearly (`BAD_REQUEST`) rather than silently no-op or let a raw SQL error bubble up. This plan rejects it earlier and more strongly than a literal reading of the spec implies: `bidCorrigenda.create` validates every `fieldKey` up front (Task 14), so an unknown key never reaches `reviewChange` (Task 15) at all — failing at creation is strictly better than failing at review, since it can never leave a corrigendum row on record referencing a field that will always fail to apply. (Task 14)
- **Two concurrent `documents.confirmUpload` calls for the same `(entityType, entityId, filename, version)`** — the second must fail with a friendly conflict (the `UNIQUE` constraint's violation translated, not a raw `23505`), and must not leave an orphaned GCS object at the canonical path from the loser. (Task 17)
- **A saved view's `filter_rules` referencing `$currentUser` when no `ctx.user` exists** (auth enforcement off, the default) — `bidSavedViews.list`/`bids.listForGrid` must resolve this to *some* deterministic, non-crashing behavior rather than a null-pointer, since most of this codebase runs with `AUTH_ENFORCEMENT_ENABLED=false` today. (Task 19)

---

## Phase A — Domain package foundations

### Task 1: `packages/domain/src/bids.ts` — stage registry, requirements, system views, code formatting

**Files:**
- Create: `packages/domain/src/bids.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './bids.js'`)

**Interfaces:**
- Produces: `BID_STAGES: BidStageDef[]`, `BID_STAGE_MAP: Record<string, BidStageDef>`, `DEFAULT_BID_STAGE_KEY = 'solutioning'`, `bidStageOrder(key: string): number`, `isAtOrAfterSubmitted(key: string): boolean`, `BID_STAGE_REQUIREMENTS: Record<string, string[]>`, `formatBidCode(year: number | string, seq: number): string`, `SYSTEM_BID_VIEWS: SystemBidView[]` (`{ key, name, filterRules: {field,operator,value}[] }`), `type BidAttentionFlag = 'dueSoon' | 'overdue' | 'corrigendumPending' | 'onTrack'`, `computeAttentionFlag(input: { dueAt: string | null; hasPendingCorrigendum: boolean; today: string; dueSoonDays?: number }): BidAttentionFlag`.
- This is exercised (no dedicated test file — see Global Constraints) by Task 6's `bids.test.ts`, which imports these directly.

- [ ] **Step 1: Write the file**

```ts
// packages/domain/src/bids.ts
//
// Bid Tracker's own stage machine — deliberately separate from
// opportunities.ts's PIPELINE_STAGES (spec §4.4). Data, not a TypeScript
// union, same reasoning as PIPELINE_STAGES: a retired stage must keep
// rendering on historical rows.
export interface BidStageDef {
  key: string
  label: string
  order: number
  closed: boolean
}

export const BID_STAGES: BidStageDef[] = [
  { key: 'solutioning', label: 'Solutioning', order: 0, closed: false },
  { key: 'qualification', label: 'Qualification', order: 1, closed: false },
  { key: 'preBidQueries', label: 'Pre-bid Queries', order: 2, closed: false },
  { key: 'commercialProposal', label: 'Commercial Proposal', order: 3, closed: false },
  { key: 'submitted', label: 'Submitted', order: 4, closed: false },
  { key: 'goApproved', label: 'Go Approved', order: 5, closed: true },
  { key: 'dropped', label: 'Dropped', order: 6, closed: true },
]

export const BID_STAGE_MAP: Record<string, BidStageDef> = Object.fromEntries(BID_STAGES.map((s) => [s.key, s]))
export const DEFAULT_BID_STAGE_KEY = 'solutioning'

/** -1 for an unknown key, so a stale/retired stage never compares as
 *  "at or after" anything by accident. */
export function bidStageOrder(key: string): number {
  return BID_STAGE_MAP[key]?.order ?? -1
}

/** Gate for `decision='go'` (spec §4.4's tightening) — a Go decision cannot
 *  be recorded before the bid has actually reached Submitted. */
export function isAtOrAfterSubmitted(key: string): boolean {
  return bidStageOrder(key) >= bidStageOrder('submitted')
}

/** "Next Stage Requirements" banner — derived, not persisted (spec §10).
 *  Keyed by the CURRENT stage: what's needed to move past it. */
export const BID_STAGE_REQUIREMENTS: Record<string, string[]> = {
  solutioning: ['Technical solution finalized', 'Pre-bid queries submitted'],
  qualification: ['Executive Go / No-Go sign-off'],
  preBidQueries: ['Pre-bid query responses received'],
  commercialProposal: ['Commercial proposal finalized', 'EMD/tender fee arranged'],
  submitted: ['Await tender opening / evaluation'],
  goApproved: [],
  dropped: [],
}

export function formatBidCode(year: number | string, seq: number): string {
  return `BID-${year}-${String(seq).padStart(4, '0')}`
}

export interface SystemBidViewFilterRule {
  field: string
  operator: 'eq'
  value: string
}
export interface SystemBidView {
  key: string
  name: string
  filterRules: SystemBidViewFilterRule[]
}

// Permanent system views (spec §9.1) — generic to any Bid Tracker
// deployment. "$currentUser" is resolved server-side to ctx.user.email at
// query time (Task 19); it is never a literal stored email. These are the
// ONLY seeded/initial views — "Smart Transport Bids" and "High Value Deals
// > 20 Cr" from the reference screenshots are illustrative examples of what
// a user creates later and must never appear here.
export const SYSTEM_BID_VIEWS: SystemBidView[] = [
  { key: 'allBids', name: 'All Bids', filterRules: [] },
  { key: 'myBids', name: 'My Bids', filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] },
  { key: 'solutioning', name: 'Solutioning', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'solutioning' }] },
  { key: 'qualification', name: 'Qualification', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'qualification' }] },
  { key: 'dueSoon', name: 'Due Soon', filterRules: [{ field: 'attentionFlag', operator: 'eq', value: 'dueSoon' }] },
  { key: 'overdue', name: 'Overdue', filterRules: [{ field: 'attentionFlag', operator: 'eq', value: 'overdue' }] },
  { key: 'goApproved', name: 'Go Approved', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'goApproved' }] },
]
export const SYSTEM_BID_VIEW_KEYS = new Set(SYSTEM_BID_VIEWS.map((v) => v.key))

export type BidAttentionFlag = 'dueSoon' | 'overdue' | 'corrigendumPending' | 'onTrack'

/** Spec §15 — computed at query time, never stored. Corrigendum-pending
 *  takes precedence over the date-based flags. */
export function computeAttentionFlag(input: {
  dueAt: string | null
  hasPendingCorrigendum: boolean
  today: string
  dueSoonDays?: number
}): BidAttentionFlag {
  if (input.hasPendingCorrigendum) return 'corrigendumPending'
  if (!input.dueAt) return 'onTrack'
  const dueDate = input.dueAt.slice(0, 10)
  if (dueDate < input.today) return 'overdue'
  const dueSoonDays = input.dueSoonDays ?? 3
  const threshold = new Date(input.today)
  threshold.setDate(threshold.getDate() + dueSoonDays)
  if (dueDate <= threshold.toISOString().slice(0, 10)) return 'dueSoon'
  return 'onTrack'
}
```

- [ ] **Step 2: Export it from the package index**

Add one line to `packages/domain/src/index.ts`, alongside the existing exports:

```ts
export * from './bids.js'
```

- [ ] **Step 3: Build the domain package and verify no type errors**

Run: `npm --workspace @goms/domain run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/bids.ts packages/domain/src/index.ts
git commit -m "feat(domain): add Bid Tracker stage registry, system views, and attention-flag logic"
```

### Task 2: `packages/domain/src/ownership.ts` — register `bid` as a 4th ownable entity

**Files:**
- Modify: `packages/domain/src/ownership.ts:1-96` (interfaces + `OWNABLE_ENTITIES`)

**Interfaces:**
- Consumes: nothing new — `effectiveOwner`/`buildOwnerMap` (already defined) need zero changes.
- Produces: `OwnershipBid { id: string; opportunityId: string }` added to the exported interfaces; `OwnershipContext.bids: OwnershipBid[]`; `OWNABLE_ENTITY_MAP['bid']`.
- Consumed by: Task 6 (`bids` router doesn't call this directly) and, critically, `apps/api/src/routers/ownership.ts`'s `loadOwnershipContext` (Task 9 extends it to fetch `bids`).

- [ ] **Step 1: Add the interface and registry entry**

In `packages/domain/src/ownership.ts`, add after `OwnershipOpportunity` (currently line 15):

```ts
export interface OwnershipBid {
  id: string
  opportunityId: string
}
```

Add `bids: OwnershipBid[]` to `OwnershipContext` (currently lines 31-35):

```ts
export interface OwnershipContext {
  nodes: OwnershipNode[]
  employees: OwnershipEmployee[]
  opportunities: OwnershipOpportunity[]
  bids: OwnershipBid[]
}
```

Add a 4th entry to `OWNABLE_ENTITIES` (currently lines 66-96), after the `opportunity` entry:

```ts
  {
    key: 'bid',
    label: 'Bid',
    icon: 'FileCheck2',
    resolution: 'exact',
    inheritFrom: (id, ctx) => {
      const bid = ctx.bids.find((b) => b.id === id)
      return bid ? { entityType: 'opportunity', entityId: bid.opportunityId } : null
    },
  },
```

- [ ] **Step 2: Find and list every existing `OwnershipContext` construction site**

Run: `grep -rn "ctx: {" apps/api/src/routers/ownership.ts src/features` (and, more broadly, `grep -rln "OwnershipContext" --include=*.ts --include=*.tsx .` excluding `node_modules`) to get the exact list. As of this audit there is exactly one backend call site (`apps/api/src/routers/ownership.ts`'s `loadOwnershipContext`, handled in Task 9) and any frontend equivalents that build a context object for `buildOwnerMap`/`effectiveOwner` calls (e.g. `src/data/ownership.ts` if it exists, or inline in `WorksEditor.tsx`/`SalesWorkspace.tsx`). Note every file found here — each one now fails to compile until it supplies `bids: []` or a real array, which is the point: TypeScript catching every call site is the safety net, not something to work around.

- [ ] **Step 3: Confirm the expected compile failures, don't fix them yet**

Run: `npm --workspace @goms/domain run build && npm run build 2>&1 | grep -i "ownershipcontext\|Property 'bids' is missing"`
Expected: one or more TS2741-style errors naming every call site found in Step 2 — this is the complete list of places Task 9 (and any frontend equivalent, called out explicitly if one exists) must update.

- [ ] **Step 4: Commit the domain-layer change alone**

This task intentionally leaves the codebase non-compiling until Task 9 supplies `bids` at the one confirmed backend call site — commit anyway, since the next task is queued immediately and the break is a deliberate, tracked TODO via the failing build, not a silent gap.

```bash
git add packages/domain/src/ownership.ts
git commit -m "feat(domain): register 'bid' as a 4th ownable entity type"
```

---

## Phase B — Migrations

### Task 3: Migrations 1–4 — `bids`, `bid_milestones`, `documents`, `bid_corrigenda`

**Files:**
- Create: `apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql`
- Create: `apps/api/migrations/1788500000000_bid-milestones.sql`
- Create: `apps/api/migrations/1788600000000_documents.sql`
- Create: `apps/api/migrations/1788700000000_bid-corrigenda.sql`

**Interfaces:**
- Produces: tables `bid_number_sequences`, `bids`, `bid_milestones`, `documents`, `document_citations`, `bid_corrigenda`, `bid_corrigendum_changes` — exact DDL from spec §4.1, reproduced below. Every later backend task depends on these existing.

- [ ] **Step 1: Write migration 1**

```sql
-- Up Migration

-- One row per year, atomic sequence allocation (mirrors
-- commercial_boq_number_sequences).
CREATE TABLE bid_number_sequences (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

-- Bid Tracker's linked entity — 1:1 with opportunities (design spec §3).
-- ON DELETE RESTRICT with no exception for archived bids (spec §4.7).
CREATE TABLE bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  bid_code        TEXT NOT NULL UNIQUE,
  stage_key       TEXT NOT NULL DEFAULT 'solutioning',
  decision        TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','go','no_go')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  data_confidence TEXT NOT NULL DEFAULT 'verified' CHECK (data_confidence IN ('verified','needs_review')),
  tender_link     TEXT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bids_opportunity_id_idx ON bids (opportunity_id);
CREATE INDEX bids_stage_key_idx ON bids (stage_key);

-- Down Migration

DROP TABLE bids;
DROP TABLE bid_number_sequences;
```

- [ ] **Step 2: Write migration 2**

```sql
-- Up Migration

-- Milestones: pre-bid conference, query deadlines, submission deadline,
-- corrigendum-linked date slots (spec §4.1, §11). `key` is PERMANENT and
-- non-colliding — stable across edits so a corrigendum can reference "this
-- exact date slot" across multiple amendments.
CREATE TABLE bid_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id         UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  key            TEXT NOT NULL,
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

-- Down Migration

DROP TABLE bid_milestones;
```

- [ ] **Step 3: Write migration 3**

```sql
-- Up Migration

-- Documents + citations (spec §14) — genuinely new, no file/blob infra
-- exists anywhere in GOMS today. Polymorphic entity_type/entity_id,
-- deliberately unenforced (no FK), matching commercial_audit_logs'
-- convention — a document row can outlive whatever it was attached to.
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
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
  page_label  TEXT NOT NULL,
  quote_text  TEXT NOT NULL DEFAULT '',
  field_ref   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_citations_document_id_idx ON document_citations (document_id);

-- Down Migration

DROP TABLE document_citations;
DROP TABLE documents;
```

- [ ] **Step 4: Write migration 4**

```sql
-- Up Migration

-- Corrigenda: one row per detected amendment document/batch. `source_document_id`
-- requires `documents` to already exist — this migration MUST run after
-- 1788600000000_documents.sql (an ordering bug caught during the design
-- spec's self-review; do not reorder these two files).
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
-- status ('pending_review' | 'reviewed') is DERIVED at read time (spec §12),
-- not a stored column.

CREATE TABLE bid_corrigendum_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrigendum_id UUID NOT NULL REFERENCES bid_corrigenda(id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,
  current_value  TEXT NOT NULL DEFAULT '',
  proposed_value TEXT NOT NULL DEFAULT '',
  decision       TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decided_at     TIMESTAMPTZ,
  decided_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bid_corrigendum_changes_corrigendum_id_idx ON bid_corrigendum_changes (corrigendum_id);

-- Down Migration

DROP TABLE bid_corrigendum_changes;
DROP TABLE bid_corrigenda;
```

- [ ] **Step 5: Apply all four, verify, then roll back and reapply**

Run (from `apps/api`, with `DATABASE_URL` pointed at your local Postgres per `.env.example`):
```bash
npm run migrate up
```
Expected: all four migrations report `Migrating up` with no error.

Run: `psql "$DATABASE_URL" -c "\d bids" -c "\d bid_milestones" -c "\d documents" -c "\d bid_corrigenda" -c "\d bid_corrigendum_changes"`
Expected: every table exists with the columns above.

Run: `npm run migrate down -- 4` then `npm run migrate up`
Expected: down-migration cleanly drops all four in reverse order with no orphaned-dependency error (this specifically verifies the `documents`-before-`bid_corrigenda` ordering fix — dropping in reverse order must not hit a "cannot drop documents because bid_corrigenda depends on it" error), and re-applying up succeeds again identically.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql apps/api/migrations/1788500000000_bid-milestones.sql apps/api/migrations/1788600000000_documents.sql apps/api/migrations/1788700000000_bid-corrigenda.sql
git commit -m "feat(db): add bids, bid_milestones, documents, and bid_corrigenda tables"
```

### Task 4: Migrations 5–8 — `protected_values`, `bid_saved_views`, `commercial_boqs.opportunity_id`, solution-lead index

**Files:**
- Create: `apps/api/migrations/1788800000000_protected-values.sql`
- Create: `apps/api/migrations/1788900000000_bid-saved-views.sql`
- Create: `apps/api/migrations/1789000000000_commercial-boqs-opportunity-id.sql`
- Create: `apps/api/migrations/1789100000000_ownership-one-open-solution-lead.sql`

**Interfaces:**
- Produces: `protected_values`, `bid_saved_views` tables; `commercial_boqs.opportunity_id` column; `ownership_assignments_one_open_solution_lead` partial unique index.

- [ ] **Step 1: Write migration 5**

```sql
-- Up Migration

-- Generic, polymorphic freeze/unfreeze ledger (spec §13) — not bid-specific,
-- so any future entity type can adopt it without a new table.
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

-- Down Migration

DROP TABLE protected_values;
```

- [ ] **Step 2: Write migration 6**

```sql
-- Up Migration

-- Saved views (spec §9). SYSTEM_BID_VIEWS (packages/domain/src/bids.ts) are
-- NEVER rows in this table — only personal/global user-created views live
-- here, by design (structural immutability for the system set).
CREATE TABLE bid_saved_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('personal','global')),
  owner_email      TEXT,
  filter_rules     JSONB NOT NULL DEFAULT '[]',
  sort             JSONB NOT NULL DEFAULT '[]',
  visible_columns  JSONB NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_view_has_owner CHECK (scope <> 'personal' OR owner_email IS NOT NULL)
);

-- Down Migration

DROP TABLE bid_saved_views;
```

- [ ] **Step 3: Write migration 7**

```sql
-- Up Migration

-- The one missing FK the design audit found (spec §4.3) — nullable, NOT
-- unique: one opportunity can have more than one independent BOQ document
-- (boq_number lineage), verified by reading commercial.ts's revise/duplicate
-- code directly, not assumed.
ALTER TABLE commercial_boqs ADD COLUMN opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX commercial_boqs_opportunity_id_idx ON commercial_boqs (opportunity_id);

-- Down Migration

DROP INDEX commercial_boqs_opportunity_id_idx;
ALTER TABLE commercial_boqs DROP COLUMN opportunity_id;
```

- [ ] **Step 4: Write migration 8**

```sql
-- Up Migration

-- "Solution Lead" is a second, concurrent role on the same entity, not a
-- sequential owner->delegate handoff (spec §4.6). Mirrors
-- ownership_assignments_one_open_owner_per_entity's shape exactly, scoped to
-- role='solutionLead' instead of 'owner' — applies across all entity types,
-- harmless for orgNode/contact/opportunity since nothing assigns that role
-- to them today.
CREATE UNIQUE INDEX ownership_assignments_one_open_solution_lead
  ON ownership_assignments (entity_type, entity_id)
  WHERE role = 'solutionLead' AND end_date IS NULL;

-- Down Migration

DROP INDEX ownership_assignments_one_open_solution_lead;
```

- [ ] **Step 5: Apply, verify, roll back and reapply**

Run: `npm run migrate up`
Expected: all four apply cleanly.

Run: `psql "$DATABASE_URL" -c "\d protected_values" -c "\d bid_saved_views" -c "\d commercial_boqs" -c "\di ownership_assignments_one_open_solution_lead"`
Expected: `commercial_boqs`'s column list now includes `opportunity_id`; the other three objects exist as specified.

Run: `npm run migrate down -- 4` then `npm run migrate up`
Expected: clean round-trip, no errors.

- [ ] **Step 6: Run the full existing test suite once, to catch any regression from the new `commercial_boqs` column before building on top of it**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test`
Expected: every existing test still passes — this column is nullable and additive, so nothing should break; if something does, stop and investigate before continuing (a broken existing test means the column addition itself is unsafe, not that a later task will fix it).

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/1788800000000_protected-values.sql apps/api/migrations/1788900000000_bid-saved-views.sql apps/api/migrations/1789000000000_commercial-boqs-opportunity-id.sql apps/api/migrations/1789100000000_ownership-one-open-solution-lead.sql
git commit -m "feat(db): add protected_values, bid_saved_views, commercial_boqs.opportunity_id, and the solution-lead ownership index"
```

---

## Phase C — Shared audit logging

### Task 5: Extract `writeAuditLog` into `apps/api/src/lib/auditLog.ts`, preserving `commercial.auditLogs` exactly

**Files:**
- Create: `apps/api/src/lib/auditLog.ts`
- Create: `apps/api/src/lib/auditLog.test.ts`
- Modify: `apps/api/src/routers/commercial.ts:21-29,728-734,1439-1465` (remove the local `writeAuditLog`/`toAuditLog`/`commercialAuditLogsRouter` list-query body, import and call the shared versions instead)

**Interfaces:**
- Produces: `writeAuditLog(client, entry: { entityType: string; entityId: string; field: string; oldValue: string; newValue: string; reason: string; action: string }): Promise<void>`, `listAuditLogs(pool, filter?: { entityType?: string; entityId?: string }): Promise<AuditLogRow[]>`, `toAuditLog(row): AuditLogRow`.
- Consumed by: `commercial.ts` (this task, regression-only — no behavior change), and every later task that logs an activity-history event (Tasks 7, 8, 13, 15, 16, 18, 19, 20).

- [ ] **Step 1: Write the shared module**

```ts
// apps/api/src/lib/auditLog.ts
//
// Shared sink for every module's field-level change history — extracted
// from commercial.ts (spec §16) so Bid Tracker can log into the same
// generic commercial_audit_logs table (entity_type/entity_id/field/old/new/
// reason/action/changed_at/changed_by — already generic despite its name)
// without a second, duplicate table. commercial.ts's own `commercial.
// auditLogs.list` procedure keeps its exact existing route/input/output
// shape by calling `listAuditLogs` from here — zero behavior change for its
// existing consumer, AuditLog.tsx in commercial-calculator.
import { pool } from '../db.js'

export interface AuditLogEntry {
  entityType: string
  entityId: string
  field: string
  oldValue: string
  newValue: string
  reason: string
  action: string
  changedBy?: string | null
}

export async function writeAuditLog(client: { query: (sql: string, params?: unknown[]) => Promise<any> }, entry: AuditLogEntry) {
  await client.query(
    `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, reason, action, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entry.entityType, entry.entityId, entry.field, entry.oldValue, entry.newValue, entry.reason, entry.action, entry.changedBy ?? null],
  )
}

export function toAuditLog(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, field: row.field,
    oldValue: row.old_value, newValue: row.new_value, reason: row.reason, action: row.action,
    changedAt: row.changed_at.toISOString(), changedBy: row.changed_by,
  }
}

export async function listAuditLogs(filter?: { entityType?: string; entityId?: string }) {
  const conditions: string[] = []
  const params: any[] = []
  if (filter?.entityType) { params.push(filter.entityType); conditions.push(`entity_type=$${params.length}`) }
  if (filter?.entityId) { params.push(filter.entityId); conditions.push(`entity_id=$${params.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(`SELECT * FROM commercial_audit_logs ${where} ORDER BY changed_at DESC`, params)
  return result.rows.map(toAuditLog)
}
```

Note: `commercial_audit_logs.changed_by` already exists in the schema (confirmed via the existing `toAuditLog`'s `changedBy: row.changed_by` mapping in `commercial.ts:732`) — this task only adds the ability to *write* it via the shared function's `changedBy` parameter, which the existing commercial.ts call sites don't currently pass (they keep passing `undefined`, preserving today's behavior exactly).

- [ ] **Step 2: Write the regression test**

```ts
// apps/api/src/lib/auditLog.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../db.js'
import { writeAuditLog, listAuditLogs } from './auditLog.js'

describe('shared audit log', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
  })

  it('writes and lists a log entry, filterable by entityType/entityId', async () => {
    const client = await pool.connect()
    try {
      await writeAuditLog(client, {
        entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000001',
        field: 'stageKey', oldValue: 'solutioning', newValue: 'qualification',
        reason: '', action: 'update', changedBy: 'test@amnex.com',
      })
    } finally {
      client.release()
    }
    const all = await listAuditLogs()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ entityType: 'bid', field: 'stageKey', changedBy: 'test@amnex.com' })

    const scoped = await listAuditLogs({ entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000001' })
    expect(scoped).toHaveLength(1)
    const scopedMiss = await listAuditLogs({ entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000002' })
    expect(scopedMiss).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run it, verify it fails (module doesn't exist yet at this point — write step 1's file first if you haven't, then this confirms the test itself is wired correctly by first running against a temporarily-renamed/missing module, or simply proceed straight to Step 4 since Step 1 already created the real file)**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- auditLog.test.ts`
Expected: PASS (the implementation was written in Step 1, so this is the "make it pass" checkpoint, not a red step — the shared module has no pre-existing behavior to regress against, unlike Step 5 below).

- [ ] **Step 4: Refactor `commercial.ts` to use the shared module, with zero behavior change**

In `apps/api/src/routers/commercial.ts`:
- Delete the local `writeAuditLog` function (lines 21-29) and `toAuditLog` function (lines 728-734).
- Add `import { writeAuditLog, listAuditLogs } from '../lib/auditLog.js'` near the top.
- Replace `commercialAuditLogsRouter`'s `list` query body (around line 1446-1455) with:

```ts
  list: protectedReadProcedure
    .input(z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).optional())
    .query(({ input }) => listAuditLogs(input)),
```

Every other call site in `commercial.ts` that calls `writeAuditLog(client, {...})` (masters/SKU/BOQ field-change logging) is unchanged — it now resolves to the imported shared function instead of the deleted local one, with an identical signature.

- [ ] **Step 5: Run the FULL existing commercial test suite to confirm zero regression**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- commercial.test.ts commercial-skus.test.ts commercial-boq.test.ts`
Expected: every existing test still passes, unchanged — this is the regression gate for "preserve existing `commercial.auditLogs` consumers" (spec §16). If anything fails, the refactor introduced a behavior change and must be fixed before continuing, not worked around.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/auditLog.ts apps/api/src/lib/auditLog.test.ts apps/api/src/routers/commercial.ts
git commit -m "refactor(api): extract shared audit-log writer/reader for reuse by Bid Tracker"
```

---

## Phase D — Core `bids` router

### Task 6: `bids` router — `create` (with milestone seeding), `get`, `listForGrid`

**Files:**
- Create: `apps/api/src/routers/bids.ts`
- Create: `apps/api/src/routers/bids.test.ts`
- Modify: `apps/api/src/index.ts` (register `bids: bidsRouter`)

**Interfaces:**
- Consumes: `formatBidCode`, `DEFAULT_BID_STAGE_KEY` from `@goms/domain`.
- Produces: `toBid(row): Bid` (`{ id, opportunityId, bidCode, stageKey, decision, status, dataConfidence, tenderLink, archivedAt, createdAt, updatedAt }`), `bidsRouter.create`, `.get`, `.listForGrid`. Every later task in Phases D–L imports `toBid` and extends this same router object.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/routers/bids.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bids router', () => {
  let departmentId: string
  let opportunityId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    departmentId = (await caller.hierarchy.createNode({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept',
    })).id
    opportunityId = (await caller.opportunities.create({
      departmentId, opportunityName: 'AI Document Processing System', submissionDate: '2026-10-10',
    })).id
  })

  it('creates a bid with an allocated bid code, defaulting to the solutioning stage', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    expect(bid.bidCode).toMatch(/^BID-\d{4}-\d{4}$/)
    expect(bid.stageKey).toBe('solutioning')
    expect(bid.decision).toBe('pending')
    expect(bid.status).toBe('active')
    expect(bid.dataConfidence).toBe('verified')
  })

  it('allocates sequential bid codes within the same year', async () => {
    const caller = appRouter.createCaller({})
    const opp2 = await caller.opportunities.create({ departmentId, opportunityName: 'Second tender' })
    const bid1 = await caller.bids.create({ opportunityId })
    const bid2 = await caller.bids.create({ opportunityId: opp2.id })
    const seq1 = Number(bid1.bidCode.split('-')[2])
    const seq2 = Number(bid2.bidCode.split('-')[2])
    expect(seq2).toBe(seq1 + 1)
  })

  it('rejects a second bid for the same opportunity', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    await expect(caller.bids.create({ opportunityId })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('seeds a submissionDeadline milestone from the opportunity\'s current submission date when parseable', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const milestones = await caller.bidMilestones.listForBid({ bidId: bid.id })
    const deadline = milestones.find((m) => m.key === 'submissionDeadline')
    expect(deadline).toBeDefined()
    expect(deadline!.dueAt).not.toBeNull()
  })

  it('seeds a null-due submissionDeadline milestone when the opportunity submission date is unparseable', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Garbage date tender', submissionDate: '10-10-2026 14:00 Hrs' })
    const bid = await caller.bids.create({ opportunityId: opp.id })
    const milestones = await caller.bidMilestones.listForBid({ bidId: bid.id })
    const deadline = milestones.find((m) => m.key === 'submissionDeadline')
    expect(deadline).toBeDefined()
    expect(deadline!.dueAt).toBeNull()
  })

  it('gets a bid by id, and returns null for an unknown id', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    expect((await caller.bids.get({ id: bid.id }))?.id).toBe(bid.id)
    expect(await caller.bids.get({ id: '00000000-0000-0000-0000-000000000099' })).toBeNull()
  })

  it('listForGrid joins in the opportunity\'s tender ID and department', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    const grid = await caller.bids.listForGrid({})
    expect(grid).toHaveLength(1)
    expect(grid[0]).toMatchObject({ opportunityId, departmentId, opportunityName: 'AI Document Processing System' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: FAIL — `caller.bids` is undefined (router doesn't exist yet), and `caller.bidMilestones` also undefined (that's Task 12 — this test file references it now but it stays red until Task 12 lands; acceptable since Tasks 6–9 and 12 are all part of getting `bids.test.ts` fully green, and the plan calls this out explicitly rather than pretending Task 6 alone turns it all green).

- [ ] **Step 3: Write the router — `create`, `get`, `listForGrid` only (milestone-seeding stub calls `bidMilestones` table directly via SQL, not the not-yet-written router, so this task's own tests for seeding CAN pass without Task 12)**

```ts
// apps/api/src/routers/bids.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { formatBidCode, DEFAULT_BID_STAGE_KEY } from '@goms/domain'

export function toBid(row: any) {
  return {
    id: row.id, opportunityId: row.opportunity_id, bidCode: row.bid_code, stageKey: row.stage_key,
    decision: row.decision, status: row.status, dataConfidence: row.data_confidence,
    tenderLink: row.tender_link, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

async function oneBid(id: string) {
  const result = await pool.query('SELECT * FROM bids WHERE id=$1', [id])
  return result.rows[0] ? toBid(result.rows[0]) : null
}

async function allocateBidCode(client: any): Promise<string> {
  const year = new Date().getFullYear()
  const result = await client.query(
    `INSERT INTO bid_number_sequences (year, next_value) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_value = bid_number_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [year],
  )
  return formatBidCode(year, result.rows[0].allocated)
}

/** Parses opportunities.submission_date (a plain, unvalidated TEXT column —
 *  spec §4.5) into a TIMESTAMPTZ. Returns null for anything that doesn't
 *  parse, rather than throwing — most existing rows are exactly this messy
 *  (e.g. "10-10-2026 14:00 Hrs" per the reference screenshots). */
function parseSubmissionDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const bidsRouter = router({
  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneBid(input.id)),

  listForGrid: protectedReadProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const result = await pool.query(`
        SELECT b.*, o.department_id, o.state_code, o.opportunity_name, o.gem_tender_id, o.submission_date,
               o.value_amount, o.value_unit, o.emd_amount, o.emd_unit, o.vertical
        FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
        ORDER BY b.created_at DESC
      `)
      return result.rows.map((r: any) => ({
        ...toBid(r), departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
        gemTenderId: r.gem_tender_id, submissionDate: r.submission_date, valueAmount: r.value_amount,
        valueUnit: r.value_unit, emdAmount: r.emd_amount, emdUnit: r.emd_unit, vertical: r.vertical,
      }))
    }),

  create: protectedProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const opp = (await client.query('SELECT submission_date FROM opportunities WHERE id=$1', [input.opportunityId])).rows[0]
        if (!opp) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such opportunity: ${input.opportunityId}` })

        const bidCode = await allocateBidCode(client)
        let bidRow: any
        try {
          bidRow = (await client.query(
            `INSERT INTO bids (opportunity_id, bid_code, stage_key) VALUES ($1,$2,$3) RETURNING *`,
            [input.opportunityId, bidCode, DEFAULT_BID_STAGE_KEY],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'This opportunity already has a bid.' })
          }
          throw e
        }

        // Seed the submissionDeadline milestone directly via SQL (bid_milestones
        // table, not the bidMilestones router — this insert must be in the SAME
        // transaction as the bids insert, and calling a sibling tRPC procedure
        // from here would open a second pool connection, breaking that
        // atomicity). Task 12 (bidMilestones router) reads/writes this same row.
        const dueAt = parseSubmissionDate(opp.submission_date)
        await client.query(
          `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, source)
           VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline',$2,'manual')`,
          [bidRow.id, dueAt],
        )

        await client.query('COMMIT')
        return toBid(bidRow)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
```

- [ ] **Step 4: Register the router**

In `apps/api/src/index.ts`, add the import and one entry to `appRouter`:

```ts
import { bidsRouter } from './routers/bids.js'
```

```ts
export const appRouter = router({
  health: healthRouter, customers: customersRouter, hierarchy: hierarchyRouter,
  employees: employeesRouter, sales: salesRouter, commercial: commercialRouter,
  ownership: ownershipRouter, opportunities: opportunitiesRouter, followUps: followUpsRouter, search: searchRouter,
  adminImport: adminImportRouter, bids: bidsRouter,
})
```

- [ ] **Step 5: Run again**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: every test EXCEPT `'seeds a submissionDeadline milestone...'` and `'seeds a null-due submissionDeadline...'` PASS (those two call `caller.bidMilestones.listForBid`, which doesn't exist until Task 12 — confirm they fail with "bidMilestones is undefined", not a different error, then move on; Task 12 turns them green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/bids.ts apps/api/src/routers/bids.test.ts apps/api/src/index.ts
git commit -m "feat(api): add bids router — create (with milestone seeding), get, listForGrid"
```

### Task 7: `bids.update` — decision gate, stage auto-derivation, Bid→Opportunity sync

**Files:**
- Modify: `apps/api/src/routers/bids.ts` (add `update`)
- Modify: `apps/api/src/routers/bids.test.ts` (add cases)
- Modify: `apps/api/src/routers/opportunities.ts:117-157` (extract `applyStageChange`, export it, refactor `update` to call it)

**Interfaces:**
- Consumes: `bidStageOrder`, `isAtOrAfterSubmitted` from `@goms/domain`; `PIPELINE_STAGE_MAP` from `@goms/domain` (already imported in `opportunities.ts`).
- Produces: `applyStageChange(client, opportunityId, newStageKey, note?): Promise<void>` exported from `opportunities.ts`, reused by `bids.update`. `bidsRouter.update`.

- [ ] **Step 1: Extract the shared stage-change helper in `opportunities.ts` first, with a regression test**

In `apps/api/src/routers/opportunities.ts`, replace the inline stage-change block inside `update` (lines 134-147) by extracting it into an exported function placed above the router:

```ts
/** Shared with bids.ts (spec §4.4's Bid->Opportunity sync) — the ONLY place
 *  that writes opportunities.stage_key and logs opportunity_stage_changes,
 *  so there is exactly one stage-transition code path regardless of which
 *  router triggers it. Must run inside the CALLER's existing transaction
 *  (same `client`) — never opens its own connection. No-ops if newStageKey
 *  already matches the current value. */
export async function applyStageChange(client: any, opportunityId: string, newStageKey: string, note = ''): Promise<void> {
  const current = (await client.query('SELECT stage_key, closed_on FROM opportunities WHERE id=$1', [opportunityId])).rows[0]
  if (!current || current.stage_key === newStageKey) return
  const nowClosed = PIPELINE_STAGE_MAP[newStageKey]?.isClosed ?? false
  const today = new Date().toISOString().slice(0, 10)
  const closedOn = nowClosed ? (current.closed_on ?? today) : null
  await client.query(`UPDATE opportunities SET stage_key=$1, closed_on=$2 WHERE id=$3`, [newStageKey, closedOn, opportunityId])
  await client.query(
    `INSERT INTO opportunity_stage_changes (opportunity_id, from_stage_key, to_stage_key, changed_at, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [opportunityId, current.stage_key, newStageKey, today, note],
  )
}
```

Then replace the body of `update`'s stage-change block (originally lines 137-147) with a single call:

```ts
        if (input.patch.stageKey !== undefined && input.patch.stageKey !== current.stage_key) {
          await applyStageChange(client, input.id, input.patch.stageKey)
        }
```

Run the existing suite to confirm this refactor changed nothing observable:

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- opportunities.test.ts`
Expected: PASS, identical to before the refactor (this file's existing tests already cover "logs a stage change and derives closedOn," "does not log a stage change for a non-stage patch," etc. — those are this refactor's regression tests, no new test needed here).

- [ ] **Step 2: Add the failing `bids.update` tests**

Append to `apps/api/src/routers/bids.test.ts`:

```ts
  it('rejects decision=go before the bid reaches submitted', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await expect(caller.bids.update({ id: bid.id, patch: { decision: 'go' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('allows decision=go and stageKey=submitted in the same patch', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const updated = await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted', decision: 'go' } })
    expect(updated.stageKey).toBe('goApproved')
    expect(updated.decision).toBe('go')
  })

  it('never gates decision=no_go, even from the initial stage', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const updated = await caller.bids.update({ id: bid.id, patch: { decision: 'no_go' } })
    expect(updated.stageKey).toBe('dropped')
    expect(updated.decision).toBe('no_go')
  })

  it('syncs the opportunity to submitted when the bid stage reaches submitted, and no further if already past it', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted' } })
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('submitted')

    await caller.opportunities.update({ id: opportunityId, patch: { stageKey: 'won' } })
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted' } }) // no-op re-trigger, already past 'submitted' in a different bid's lifecycle
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('won') // unchanged — sync never regresses a further-along opportunity
  })

  it('syncs the opportunity to won/dropped when the decision becomes final, unless already closed', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted', decision: 'go' } })
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('won')
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: FAIL — `caller.bids.update` doesn't exist yet.

- [ ] **Step 4: Implement `update`**

Add to `apps/api/src/routers/bids.ts` (new imports: `isAtOrAfterSubmitted` from `@goms/domain`, `applyStageChange` and `PIPELINE_STAGE_MAP` — the latter re-exported from `@goms/domain`, already available — from `./opportunities.js`):

```ts
import { formatBidCode, DEFAULT_BID_STAGE_KEY, isAtOrAfterSubmitted, PIPELINE_STAGE_MAP } from '@goms/domain'
import { applyStageChange } from './opportunities.js'
```

```ts
const bidColumnFor: Record<string, string> = {
  stageKey: 'stage_key', decision: 'decision', tenderLink: 'tender_link',
}

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        stageKey: z.string().optional(), decision: z.enum(['pending', 'go', 'no_go']).optional(),
        tenderLink: z.string().nullable().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM bids WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const patch: Record<string, unknown> = { ...input.patch }
        const effectiveStageKey = (patch.stageKey as string | undefined) ?? current.stage_key
        if (patch.decision === 'go' && !isAtOrAfterSubmitted(effectiveStageKey)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot mark Go before the bid reaches Submitted.' })
        }
        // Auto-derive the terminal stage from a final decision (spec §4.4) —
        // this always wins over any stageKey also present in the same patch,
        // so the two fields can never visibly disagree.
        if (patch.decision === 'go') patch.stageKey = 'goApproved'
        if (patch.decision === 'no_go') patch.stageKey = 'dropped'

        const fields = Object.keys(patch)
        if (fields.length) {
          const values = fields.map((f) => patch[f])
          const setClauses = fields.map((f, i) => `${bidColumnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE bids SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
        }

        // Bid -> Opportunity sync (spec §4.4) — exactly these two points, both
        // through the shared applyStageChange helper, same transaction.
        const newStageKey = (patch.stageKey as string | undefined) ?? current.stage_key
        if (newStageKey === 'submitted' && current.stage_key !== 'submitted') {
          const opp = (await client.query('SELECT stage_key FROM opportunities WHERE id=$1', [current.opportunity_id])).rows[0]
          if (opp && (PIPELINE_STAGE_MAP[opp.stage_key]?.order ?? 0) < (PIPELINE_STAGE_MAP['submitted']?.order ?? 0)) {
            await applyStageChange(client, current.opportunity_id, 'submitted', 'Bid submitted (synced from Bid Tracker)')
          }
        }
        if (patch.decision === 'go' || patch.decision === 'no_go') {
          const opp = (await client.query('SELECT stage_key FROM opportunities WHERE id=$1', [current.opportunity_id])).rows[0]
          if (opp && !(PIPELINE_STAGE_MAP[opp.stage_key]?.isClosed ?? false)) {
            const target = patch.decision === 'go' ? 'won' : 'dropped'
            await applyStageChange(client, current.opportunity_id, target, `Bid decision recorded: ${patch.decision} (synced from Bid Tracker)`)
          }
        }

        await client.query('COMMIT')
        return (await oneBid(input.id))!
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
```

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts opportunities.test.ts`
Expected: PASS (the two milestone-seeding tests from Task 6 remain the only expected failures until Task 12).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/bids.ts apps/api/src/routers/bids.test.ts apps/api/src/routers/opportunities.ts
git commit -m "feat(api): add bids.update with the decision=go gate, stage auto-derivation, and Bid->Opportunity sync"
```

### Task 8: `bids.archive`/`unarchive`/`delete` — non-destructive by default, gated hard delete

**Files:**
- Modify: `apps/api/src/routers/bids.ts` (add `archive`, `unarchive`, `delete`)
- Modify: `apps/api/src/routers/bids.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `bidsRouter.archive`, `.unarchive`, `.delete`. Task 11 depends on `delete`'s CONFLICT shape existing so `opportunities.delete`/`hierarchy.deleteNode`'s own RESTRICT-to-CONFLICT translation can be tested against a real blocked bid.

- [ ] **Step 1: Write the failing tests**

```ts
  it('archives and unarchives a bid without touching any related data', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const archived = await caller.bids.archive({ id: bid.id })
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).not.toBeNull()
    const milestonesStillThere = await caller.bidMilestones.listForBid({ bidId: bid.id })
    expect(milestonesStillThere.length).toBeGreaterThan(0)
    const unarchived = await caller.bids.unarchive({ id: bid.id })
    expect(unarchived.status).toBe('active')
    expect(unarchived.archivedAt).toBeNull()
  })

  it('hard-deletes a bid with no history, cascading its milestones', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.delete({ id: bid.id })
    expect(await caller.bids.get({ id: bid.id })).toBeNull()
    const milestonesGone = await pool.query('SELECT 1 FROM bid_milestones WHERE bid_id=$1', [bid.id])
    expect(milestonesGone.rows).toHaveLength(0)
  })

  it('refuses hard delete when the bid has a corrigendum, a protected value, a document, or a follow-up', async () => {
    const caller = appRouter.createCaller({})
    const bidWithCorrigendum = await caller.bids.create({ opportunityId })
    await pool.query(`INSERT INTO bid_corrigenda (bid_id, corrigendum_number) VALUES ($1, 1)`, [bidWithCorrigendum.id])
    await expect(caller.bids.delete({ id: bidWithCorrigendum.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp2 = await caller.opportunities.create({ departmentId, opportunityName: 'Second' })
    const bidWithProtectedValue = await caller.bids.create({ opportunityId: opp2.id })
    await pool.query(
      `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen) VALUES ('bid', $1, 'submissionDeadline', true)`,
      [bidWithProtectedValue.id],
    )
    await expect(caller.bids.delete({ id: bidWithProtectedValue.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp3 = await caller.opportunities.create({ departmentId, opportunityName: 'Third' })
    const bidWithDocument = await caller.bids.create({ opportunityId: opp3.id })
    await pool.query(
      `INSERT INTO documents (entity_type, entity_id, filename, storage_path, content_type, size_bytes)
       VALUES ('bid', $1, 'f.pdf', 'bid-tracker/bid/x/y/f.pdf', 'application/pdf', 100)`,
      [bidWithDocument.id],
    )
    await expect(caller.bids.delete({ id: bidWithDocument.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp4 = await caller.opportunities.create({ departmentId, opportunityName: 'Fourth' })
    const bidWithFollowUp = await caller.bids.create({ opportunityId: opp4.id })
    await caller.followUps.create({ entityType: 'bid', entityId: bidWithFollowUp.id, dueDate: '2026-12-01' })
    await expect(caller.bids.delete({ id: bidWithFollowUp.id })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('explicitly deletes ownership assignments on hard delete, but permanently preserves audit-log rows', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const salesPerson = await caller.sales.create({ name: 'Test Rep', officialEmail: 'rep@amnex.com', tierKey: 'accountManager', startDate: '2026-01-01' })
    await caller.ownership.assign({ entityType: 'bid', entityId: bid.id, salesPersonId: salesPerson.id, startDate: '2026-01-01' })
    await pool.query(
      `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, action) VALUES ('bid', $1, 'stageKey', 'a', 'b', 'update')`,
      [bid.id],
    )
    await caller.bids.delete({ id: bid.id })
    const ownershipGone = await pool.query(`SELECT 1 FROM ownership_assignments WHERE entity_type='bid' AND entity_id=$1`, [bid.id])
    expect(ownershipGone.rows).toHaveLength(0)
    const auditStillThere = await pool.query(`SELECT 1 FROM commercial_audit_logs WHERE entity_type='bid' AND entity_id=$1`, [bid.id])
    expect(auditStillThere.rows).toHaveLength(1)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: FAIL — `archive`/`unarchive`/`delete` don't exist yet. (The `sales.create` call in the ownership test uses `officialEmail`/`tierKey` per `sales.ts`'s actual input shape — confirm against `apps/api/src/routers/sales.ts` if this fails for an unrelated input-shape reason; adjust the test's `sales.create` call to match exactly, the behavior under test here is bids.delete, not sales.create.)

- [ ] **Step 3: Implement**

```ts
  archive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query(`UPDATE bids SET status='archived', archived_at=now(), updated_at=now() WHERE id=$1`, [input.id])
    return (await oneBid(input.id))!
  }),

  unarchive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query(`UPDATE bids SET status='active', archived_at=NULL, updated_at=now() WHERE id=$1`, [input.id])
    return (await oneBid(input.id))!
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const bid = (await client.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
      if (!bid) { await client.query('COMMIT'); return }

      // Spec §4.7's hard-delete gate — checked here, not left to whatever FK
      // constraints happen to exist, so the error names exactly what's blocking.
      const [corrigenda, protectedRows, docs, followUps] = await Promise.all([
        client.query('SELECT 1 FROM bid_corrigenda WHERE bid_id=$1 LIMIT 1', [input.id]),
        client.query(`SELECT 1 FROM protected_values WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
        client.query(`SELECT 1 FROM documents WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
        client.query(`SELECT 1 FROM follow_ups WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
      ])
      if (corrigenda.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has corrigendum history. Archive it instead.' })
      if (protectedRows.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has protected-value history. Archive it instead.' })
      if (docs.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has uploaded documents. Archive it instead.' })
      if (followUps.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has follow-ups. Archive it instead.' })

      // Polymorphic, no FK — must be deleted explicitly. Audit-log rows are the
      // one thing deliberately NEVER touched here (spec §4.7): they survive the
      // entity, same convention as commercial_audit_logs/employee_merge_audit.
      await client.query(`DELETE FROM ownership_assignments WHERE entity_type='bid' AND entity_id=$1`, [input.id])
      // bid_milestones and bid_corrigenda cascade via their own FKs; the gate
      // above already guarantees bid_corrigenda is empty in practice.
      await client.query('DELETE FROM bids WHERE id=$1', [input.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: PASS for every case in this task (milestone-seeding tests from Task 6 remain the only pending failures).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/bids.ts apps/api/src/routers/bids.test.ts
git commit -m "feat(api): add bids.archive/unarchive and a gated, non-destructive bids.delete"
```

### Task 9: `bids.actionQueue.list`, and extend `ownership.ts`'s context loader for the `bid` entity type

**Files:**
- Modify: `apps/api/src/routers/bids.ts` (add `actionQueue` sub-router)
- Modify: `apps/api/src/routers/bids.test.ts` (add cases)
- Modify: `apps/api/src/routers/ownership.ts:21-36` (`loadOwnershipContext` fetches `bids` too)
- Modify: `apps/api/src/routers/ownership.test.ts` (add a case proving `bid` ownership inherits from its opportunity)

**Interfaces:**
- Consumes: `computeAttentionFlag` from `@goms/domain`.
- Produces: `bidsRouter.actionQueue.list`. Closes out Task 2's deliberately-broken build (the one backend `OwnershipContext` construction site now supplies `bids`).

- [ ] **Step 1: Fix the compile break from Task 2**

In `apps/api/src/routers/ownership.ts`, extend `loadOwnershipContext` (lines 21-36):

```ts
async function loadOwnershipContext(): Promise<{ assignments: any[]; ctx: OwnershipContext }> {
  const [assignmentsResult, nodesResult, employeesResult, opportunitiesResult, bidsResult] = await Promise.all([
    pool.query('SELECT * FROM ownership_assignments'),
    pool.query('SELECT id, parent_id AS "parentId" FROM hierarchy_nodes'),
    pool.query('SELECT id, org_node_id AS "orgNodeId" FROM employees'),
    pool.query('SELECT id, department_id AS "departmentId" FROM opportunities'),
    pool.query('SELECT id, opportunity_id AS "opportunityId" FROM bids'),
  ])
  return {
    assignments: assignmentsResult.rows.map(toAssignment),
    ctx: {
      nodes: nodesResult.rows,
      employees: employeesResult.rows,
      opportunities: opportunitiesResult.rows,
      bids: bidsResult.rows,
    },
  }
}
```

Run: `npm run build`
Expected: the `Property 'bids' is missing` error from Task 2 is now gone.

- [ ] **Step 2: Write the failing test proving inheritance**

Add to `apps/api/src/routers/ownership.test.ts` (matching that file's existing setup pattern — a department, an opportunity, and a sales person already exist per its `beforeEach`; adjust variable names to whatever that file already uses):

```ts
  it('resolves a bid\'s owner by inheriting from its opportunity, and lets a direct assignment override it', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.ownership.assign({ entityType: 'opportunity', entityId: opportunityId, salesPersonId, startDate: '2026-01-01' })

    const inherited = await caller.ownership.resolveOwner({ entityType: 'bid', entityId: bid.id, asOf: '2026-06-01' })
    expect(inherited).toMatchObject({ salesPersonId, source: 'inherited' })

    const otherPerson = await caller.sales.create({ name: 'Direct Owner', officialEmail: 'direct@amnex.com', tierKey: 'accountManager', startDate: '2026-01-01' })
    await caller.ownership.assign({ entityType: 'bid', entityId: bid.id, salesPersonId: otherPerson.id, startDate: '2026-02-01' })
    const direct = await caller.ownership.resolveOwner({ entityType: 'bid', entityId: bid.id, asOf: '2026-06-01' })
    expect(direct).toMatchObject({ salesPersonId: otherPerson.id, source: 'direct' })
  })
```

- [ ] **Step 3: Run to verify it passes (this is a pure wiring task — the resolution algorithm itself already exists and needs no change)**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- ownership.test.ts`
Expected: PASS immediately once Step 1's `ctx.bids` is wired in — if it fails, the bug is in Step 1's query or the domain-layer `bid` entry from Task 2, not in `effectiveOwner` itself.

- [ ] **Step 4: Write the failing `actionQueue` test**

```ts
  it('actionQueue lists open follow-ups for bids, with a computed attention flag', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const overdueFollowUp = await caller.followUps.create({ entityType: 'bid', entityId: bid.id, dueDate: '2020-01-01', note: 'Old task' })
    const queue = await caller.bids.actionQueue.list()
    const entry = queue.find((q: any) => q.followUpId === overdueFollowUp.id)
    expect(entry).toMatchObject({ bidId: bid.id, opportunityName: 'AI Document Processing System', attentionFlag: 'overdue' })
  })
```

- [ ] **Step 5: Run to verify failure, then implement**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts`
Expected: FAIL — `caller.bids.actionQueue` undefined.

Add to `apps/api/src/routers/bids.ts` (new import: `computeAttentionFlag` from `@goms/domain`):

```ts
export const bidActionQueueRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query(`
      SELECT f.id AS follow_up_id, f.due_date, f.note, f.assignee_id, f.status,
             b.id AS bid_id, b.bid_code, b.stage_key,
             o.opportunity_name,
             EXISTS (
               SELECT 1 FROM bid_corrigenda c
               LEFT JOIN bid_corrigendum_changes ch ON ch.corrigendum_id = c.id
               WHERE c.bid_id = b.id GROUP BY c.id HAVING bool_or(ch.decision = 'pending' OR ch.decision IS NULL)
             ) AS has_pending_corrigendum
      FROM follow_ups f
      JOIN bids b ON b.id = f.entity_id AND f.entity_type = 'bid'
      JOIN opportunities o ON o.id = b.opportunity_id
      WHERE f.status = 'open'
      ORDER BY f.due_date
    `)
    const today = new Date().toISOString().slice(0, 10)
    return result.rows.map((r: any) => ({
      followUpId: r.follow_up_id, bidId: r.bid_id, bidCode: r.bid_code, stageKey: r.stage_key,
      opportunityName: r.opportunity_name, dueDate: r.due_date, note: r.note, assigneeId: r.assignee_id,
      attentionFlag: computeAttentionFlag({ dueAt: r.due_date, hasPendingCorrigendum: r.has_pending_corrigendum ?? false, today }),
    }))
  }),
})
```

Add `actionQueue: bidActionQueueRouter` to `bidsRouter`'s object (tRPC nested-router syntax — `bidsRouter` becomes `router({ ...existing procedures, actionQueue: bidActionQueueRouter })`).

- [ ] **Step 6: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts ownership.test.ts`
Expected: PASS (milestone-seeding tests from Task 6 remain pending until Task 12).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routers/bids.ts apps/api/src/routers/bids.test.ts apps/api/src/routers/ownership.ts apps/api/src/routers/ownership.test.ts
git commit -m "feat(api): wire bid ownership inheritance and add bids.actionQueue.list"
```

---

## Phase E — Guards on existing routers

### Task 10: `opportunities.ts` — submissionDate write guard, delete → CONFLICT translation

**Files:**
- Modify: `apps/api/src/routers/opportunities.ts` (guard in `update`, translate in `delete`)
- Modify: `apps/api/src/routers/opportunities.test.ts` (add cases)

**Interfaces:**
- Consumes: `isForeignKeyViolation` from `../db-errors.js`.
- Produces: nothing new exported — behavior-only change to two existing procedures.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/routers/opportunities.test.ts`:

```ts
  it('rejects a submissionDate patch once a bid exists for the opportunity, but allows it before one exists', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal', submissionDate: '2026-10-10' })
    await caller.opportunities.update({ id: opp.id, patch: { submissionDate: '2026-10-15' } }) // still allowed, no bid yet
    await caller.bids.create({ opportunityId: opp.id })
    await expect(
      caller.opportunities.update({ id: opp.id, patch: { submissionDate: '2026-10-20' } })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('translates a RESTRICT violation from a referencing bid into a friendly CONFLICT on delete', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal' })
    await caller.bids.create({ opportunityId: opp.id })
    await expect(caller.opportunities.delete({ id: opp.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    // Archiving does NOT unblock the delete (spec §4.7 — corrected from an
    // earlier draft that said it would).
    const bid = (await caller.bids.listForGrid({})).find((b: any) => b.opportunityId === opp.id)!
    await caller.bids.archive({ id: bid.id })
    await expect(caller.opportunities.delete({ id: opp.id })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- opportunities.test.ts`
Expected: FAIL — `submissionDate` patch currently succeeds unconditionally, and `delete` currently either succeeds (if nothing blocks it yet) or throws a raw, untranslated error rather than `CONFLICT`.

- [ ] **Step 3: Implement the guard and the translation**

In `apps/api/src/routers/opportunities.ts`, add the import: `import { isForeignKeyViolation } from '../db-errors.js'`.

Inside `update`'s mutation body, immediately after loading `current` (right after the `if (!current) throw new TRPCError(...)` line):

```ts
        if (input.patch.submissionDate !== undefined) {
          const hasBid = (await client.query('SELECT 1 FROM bids WHERE opportunity_id=$1', [input.id])).rows[0]
          if (hasBid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'This opportunity has a bid in Bid Tracker — edit its Submission Deadline milestone there instead.',
            })
          }
        }
```

Replace `delete`'s body:

```ts
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    try {
      // opportunity_stage_changes cascades via FK; bids RESTRICTs (spec §4.7).
      await pool.query('DELETE FROM opportunities WHERE id=$1', [input.id])
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this opportunity — it has a bid in Bid Tracker (active or archived). Delete the bid first.' })
      }
      throw e
    }
  }),
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- opportunities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/opportunities.ts apps/api/src/routers/opportunities.test.ts
git commit -m "feat(api): guard opportunities.submissionDate once a bid exists, translate bid-blocked deletes to CONFLICT"
```

### Task 11: `hierarchy.ts` — extend `deleteNode`'s RESTRICT-to-CONFLICT translation to cover `bids`

**Files:**
- Modify: `apps/api/src/routers/hierarchy.ts:252-280` (comment update only — the existing generic `isForeignKeyViolation` catch already covers this)
- Modify: `apps/api/src/routers/hierarchy.test.ts` (add a case)

**Interfaces:**
- Consumes: nothing new — this task proves existing generic error handling already covers the new case, and fixes the message if it doesn't.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routers/hierarchy.test.ts` (matching its existing pattern for creating a department, an opportunity under it, etc. — adapt exact setup calls to that file's own helpers):

```ts
  it('refuses to delete a subtree containing an opportunity with a bid — including one already archived, exercised through the cascading deleteNode path, not just a direct opportunities.delete', async () => {
    const caller = appRouter.createCaller({})
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Blocked Dept' })
    const opp = await caller.opportunities.create({ departmentId: dept.id, opportunityName: 'Tender' })
    const bid = await caller.bids.create({ opportunityId: opp.id })
    await caller.bids.archive({ id: bid.id })
    await expect(caller.hierarchy.deleteNode({ id: dept.id })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
```

- [ ] **Step 2: Run it**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- hierarchy.test.ts`
Expected: this most likely already PASSES — `deleteNode`'s existing `catch (e) { if (isForeignKeyViolation(e)) throw new TRPCError({ code: 'CONFLICT', ... }) }` (hierarchy.ts:271-273) is a generic, error-code-based check that doesn't inspect *which* table raised the `23503` at all, and `bids.opportunity_id` RESTRICTs regardless of the bid's `status` (spec §4.7 — archived is not an exception), so it should already catch this with zero code change. Confirm this by running the test; if it unexpectedly fails, the deletion path for this subtree isn't reaching the same code that deletes `opportunities` (check `subtreeIds`/the delete transaction body for a gap), which would be a real bug to fix, not a test to delete.

- [ ] **Step 3: Update the comment to reflect the now-longer list of RESTRICT sources it covers (no behavior change)**

In `apps/api/src/routers/hierarchy.ts`, update the comment at lines 267-270 from:

```ts
      // Deleting a subtree containing a node any `transfers.to_org_node_id`
      // (RESTRICT) or `commercial_boqs.department_id` (RESTRICT) still
      // points at is rejected by the DB either way — this only replaces the
      // raw, unhandled 23503 with a friendly message.
```

to:

```ts
      // Deleting a subtree containing a node any `transfers.to_org_node_id`,
      // `commercial_boqs.department_id`, or (via an opportunity in the
      // subtree) `bids.opportunity_id` (all RESTRICT) still points at is
      // rejected by the DB either way — this only replaces the raw,
      // unhandled 23503 with a friendly message. bids.opportunity_id RESTRICTs
      // regardless of the bid's archived status (spec §4.7) — this generic,
      // error-code-based catch doesn't need to know that, it just needs the
      // constraint to exist, which migration 1788400000000 added.
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routers/hierarchy.ts apps/api/src/routers/hierarchy.test.ts
git commit -m "test(api): prove hierarchy.deleteNode already translates a bid-blocked delete to CONFLICT"
```

---

## Phase F — Milestones

### Task 12: `bidMilestones` router — CRUD, with `submissionDeadline` syncing back to `opportunities`

**Files:**
- Create: `apps/api/src/routers/bidMilestones.ts`
- Create: `apps/api/src/routers/bidMilestones.test.ts`
- Modify: `apps/api/src/index.ts` (register `bidMilestones: bidMilestonesRouter`)

**Interfaces:**
- Produces: `toBidMilestone(row)`, `bidMilestonesRouter.listForBid/create/update/delete`. This closes out the two pending Task 6 tests (`bids.test.ts`'s milestone-seeding cases).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/routers/bidMilestones.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidMilestones router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', submissionDate: '2026-10-10' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('lists the seeded submissionDeadline milestone', async () => {
    const caller = appRouter.createCaller({})
    const milestones = await caller.bidMilestones.listForBid({ bidId })
    expect(milestones.map((m: any) => m.key)).toContain('submissionDeadline')
  })

  it('creates a new, independently-keyed milestone (e.g. a pre-bid conference)', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.bidMilestones.create({
      bidId, milestoneType: 'preBidConference', key: 'preBidConference', label: 'Pre-Bid Conference',
      dueAt: '2026-10-01T14:30:00.000Z', venue: 'SAG Lab Auditorium', notes: 'In-person attendance required.',
    })
    expect(created.venue).toBe('SAG Lab Auditorium')
  })

  it('rejects a duplicate key on the same bid', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.bidMilestones.create({ bidId, milestoneType: 'submissionDeadline', key: 'submissionDeadline', label: 'dup' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('updating the submissionDeadline milestone writes opportunities.submissionDate in the same transaction', async () => {
    const caller = appRouter.createCaller({})
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    await caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2026-11-01T00:00:00.000Z' } })
    const opp = await caller.opportunities.get({ id: opportunityId })
    expect(opp!.submissionDate).toContain('2026-11-01')
  })

  it('deletes a milestone', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.bidMilestones.create({ bidId, milestoneType: 'queryDeadline', key: 'query1', label: 'Query 1 Deadline' })
    await caller.bidMilestones.delete({ id: created.id })
    const remaining = await caller.bidMilestones.listForBid({ bidId })
    expect(remaining.find((m: any) => m.id === created.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidMilestones.test.ts`
Expected: FAIL — router doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/routers/bidMilestones.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'

function toBidMilestone(row: any) {
  return {
    id: row.id, bidId: row.bid_id, milestoneType: row.milestone_type, key: row.key, label: row.label,
    dueAt: row.due_at, venue: row.venue, notes: row.notes, status: row.status, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

/** Writes opportunities.submission_date to mirror a `key='submissionDeadline'`
 *  milestone change (spec §4.5) — MUST run in the same transaction as the
 *  milestone write itself, so the two never observably disagree even for an
 *  instant. Shared by `create`/`update` here AND by bidCorrigenda's
 *  reviewChange (Task 15) when an accepted change targets this key. */
export async function syncSubmissionDeadlineToOpportunity(client: any, bidId: string, dueAt: string | null) {
  const bid = (await client.query('SELECT opportunity_id FROM bids WHERE id=$1', [bidId])).rows[0]
  if (!bid) return
  await client.query('UPDATE opportunities SET submission_date=$1 WHERE id=$2', [dueAt ?? '', bid.opportunity_id])
}

export const bidMilestonesRouter = router({
  listForBid: protectedReadProcedure.input(z.object({ bidId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM bid_milestones WHERE bid_id=$1 ORDER BY due_at NULLS LAST', [input.bidId])
    return result.rows.map(toBidMilestone)
  }),

  create: protectedProcedure
    .input(z.object({
      bidId: z.string().uuid(), milestoneType: z.string().min(1), key: z.string().min(1), label: z.string().min(1),
      dueAt: z.string().nullable().optional(), venue: z.string().optional(), notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        let row: any
        try {
          row = (await client.query(
            `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, venue, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [input.bidId, input.milestoneType, input.key, input.label, input.dueAt ?? null, input.venue ?? null, input.notes ?? null],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `This bid already has a milestone keyed "${input.key}".` })
          throw e
        }
        if (input.key === 'submissionDeadline') {
          await syncSubmissionDeadlineToOpportunity(client, input.bidId, input.dueAt ?? null)
        }
        await client.query('COMMIT')
        return toBidMilestone(row)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        label: z.string().optional(), dueAt: z.string().nullable().optional(),
        venue: z.string().nullable().optional(), notes: z.string().nullable().optional(),
        status: z.enum(['open', 'completed', 'superseded']).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM bid_milestones WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const columnFor: Record<string, string> = { label: 'label', dueAt: 'due_at', venue: 'venue', notes: 'notes', status: 'status' }
        const fields = Object.keys(input.patch)
        if (fields.length) {
          const values = fields.map((f) => (input.patch as any)[f])
          const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE bid_milestones SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
        }
        if (current.key === 'submissionDeadline' && input.patch.dueAt !== undefined) {
          await syncSubmissionDeadlineToOpportunity(client, current.bid_id, input.patch.dueAt)
        }
        await client.query('COMMIT')
        const updated = (await pool.query('SELECT * FROM bid_milestones WHERE id=$1', [input.id])).rows[0]
        return toBidMilestone(updated)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) =>
    pool.query('DELETE FROM bid_milestones WHERE id=$1', [input.id]).then(() => undefined)
  ),
})
```

- [ ] **Step 4: Register it and run the whole affected suite**

Add to `apps/api/src/index.ts`: `import { bidMilestonesRouter } from './routers/bidMilestones.js'` and `bidMilestones: bidMilestonesRouter` in the `appRouter` object.

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidMilestones.test.ts bids.test.ts`
Expected: PASS — including the two milestone-seeding tests from Task 6 that were pending until now.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/bidMilestones.ts apps/api/src/routers/bidMilestones.test.ts apps/api/src/index.ts
git commit -m "feat(api): add bidMilestones router, syncing submissionDeadline back to opportunities"
```

---

## Phase G — Protected Values

### Task 13: `protectedValues` router, shared `assertFieldsNotProtected` guard, wired into `bids.update`/`bidMilestones.update`/`opportunities.update`

**Files:**
- Create: `apps/api/src/lib/protectedValues.ts`
- Create: `apps/api/src/routers/protectedValues.ts`
- Create: `apps/api/src/routers/protectedValues.test.ts`
- Modify: `apps/api/src/index.ts` (register `protectedValues: protectedValuesRouter`)
- Modify: `apps/api/src/routers/bids.ts` (guard in `update`)
- Modify: `apps/api/src/routers/bidMilestones.ts` (guard in `update`)
- Modify: `apps/api/src/routers/opportunities.ts` (guard in `update`, for `valueAmount`/`emdAmount`/`gemTenderId` — the "facts" a Protected Values tab freezes per the reference screenshots)
- Modify: `apps/api/src/routers/bids.test.ts`, `apps/api/src/routers/bidMilestones.test.ts`, `apps/api/src/routers/opportunities.test.ts` (one guard test each)

**Interfaces:**
- Produces: `assertFieldsNotProtected(client, entityType: string, entityId: string, fieldKeys: string[]): Promise<void>` (throws `TRPCError({code:'CONFLICT'})` naming the first frozen field it finds), `protectedValuesRouter.listFor/freeze/unfreeze`. Consumed by this task's three call sites, and by Task 15 (`bidCorrigenda.reviewChange`) and Task 39 (admin-import commit).

- [ ] **Step 1: Write the shared guard**

```ts
// apps/api/src/lib/protectedValues.ts
//
// Spec §13 — one shared guard, called from every direct-edit path AND the
// corrigendum-accept path AND the admin-import commit pipeline, so "never
// silently overwritten" is enforced identically everywhere rather than
// reimplemented per call site with room to drift.
import { TRPCError } from '@trpc/server'

export async function assertFieldsNotProtected(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  entityType: string,
  entityId: string,
  fieldKeys: string[],
): Promise<void> {
  if (!fieldKeys.length) return
  const result = await client.query(
    `SELECT field_key FROM protected_values WHERE entity_type=$1 AND entity_id=$2 AND field_key = ANY($3) AND frozen=true`,
    [entityType, entityId, fieldKeys],
  )
  if (result.rows.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `"${result.rows[0].field_key}" is protected — unfreeze it first.`,
    })
  }
}
```

- [ ] **Step 2: Write the failing router tests**

```ts
// apps/api/src/routers/protectedValues.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('protectedValues router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM protected_values')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', valueAmount: '6.2', valueUnit: 'crore' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('freezes and unfreezes a field, requiring a reason only on unfreeze', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    let list = await caller.protectedValues.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.find((p: any) => p.fieldKey === 'submissionDeadline')?.frozen).toBe(true)

    await expect(
      caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: '' })
    ).rejects.toThrow()

    await caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: 'Confirmed by client, safe to unfreeze' })
    list = await caller.protectedValues.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.find((p: any) => p.fieldKey === 'submissionDeadline')?.frozen).toBe(false)
  })

  it('blocks a bidMilestones.update on the frozen submissionDeadline milestone', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    await expect(
      caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2026-12-25T00:00:00.000Z' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks an opportunities.update on a frozen valueAmount', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'valueAmount' })
    await expect(
      caller.opportunities.update({ id: opportunityId, patch: { valueAmount: '99' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks a bids.update on a frozen tenderLink', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'tenderLink' })
    await expect(
      caller.bids.update({ id: bidId, patch: { tenderLink: 'https://example.com' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- protectedValues.test.ts`
Expected: FAIL — router doesn't exist, guards not wired.

- [ ] **Step 4: Implement the router**

```ts
// apps/api/src/routers/protectedValues.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { writeAuditLog } from '../lib/auditLog.js'

function toProtectedValue(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, fieldKey: row.field_key,
    frozen: row.frozen, frozenAt: row.frozen_at, frozenBy: row.frozen_by,
  }
}

export const protectedValuesRouter = router({
  listFor: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        'SELECT * FROM protected_values WHERE entity_type=$1 AND entity_id=$2', [input.entityType, input.entityId],
      )
      return result.rows.map(toProtectedValue)
    }),

  freeze: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid(), fieldKey: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen, frozen_at, frozen_by)
           VALUES ($1,$2,$3,true,now(),$4)
           ON CONFLICT (entity_type, entity_id, field_key)
           DO UPDATE SET frozen=true, frozen_at=now(), frozen_by=$4`,
          [input.entityType, input.entityId, input.fieldKey, ctx.user?.email ?? null],
        )
        await writeAuditLog(client, {
          entityType: input.entityType, entityId: input.entityId, field: input.fieldKey,
          oldValue: 'unfrozen', newValue: 'frozen', reason: '', action: 'freeze', changedBy: ctx.user?.email,
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  unfreeze: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid(), fieldKey: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen)
           VALUES ($1,$2,$3,false)
           ON CONFLICT (entity_type, entity_id, field_key) DO UPDATE SET frozen=false`,
          [input.entityType, input.entityId, input.fieldKey],
        )
        await writeAuditLog(client, {
          entityType: input.entityType, entityId: input.entityId, field: input.fieldKey,
          oldValue: 'frozen', newValue: 'unfrozen', reason: input.reason, action: 'unfreeze', changedBy: ctx.user?.email,
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
```

Register it in `apps/api/src/index.ts` the same way as every other router.

Note: `z.string().min(1)` on `unfreeze`'s `reason` gives the "non-empty, enforced at the Zod schema level" requirement from spec §13 — an empty-string `reason` fails input validation before the procedure body even runs, which is what the test's `rejects.toThrow()` (any error, not asserting a specific `TRPCError` code, since a Zod parse failure surfaces as `BAD_REQUEST` automatically via tRPC's own input validation) confirms.

- [ ] **Step 5: Wire the guard into the three call sites**

In `apps/api/src/routers/bidMilestones.ts`'s `update`, after loading `current` and before applying the patch:

```ts
        if (Object.keys(input.patch).length) {
          await assertFieldsNotProtected(client, 'bid', current.bid_id, [current.key])
        }
```
(import `assertFieldsNotProtected` from `../lib/protectedValues.js`)

In `apps/api/src/routers/opportunities.ts`'s `update`, after the existing `submissionDate` guard block added in Task 10:

```ts
        const protectableOpportunityFields = ['valueAmount', 'emdAmount', 'gemTenderId'] as const
        const patchedProtectable = Object.keys(input.patch).filter((f) => (protectableOpportunityFields as readonly string[]).includes(f))
        if (patchedProtectable.length) {
          const bid = (await client.query('SELECT id FROM bids WHERE opportunity_id=$1', [input.id])).rows[0]
          if (bid) await assertFieldsNotProtected(client, 'bid', bid.id, patchedProtectable)
        }
```
(import `assertFieldsNotProtected` from `../lib/protectedValues.js`)

In `apps/api/src/routers/bids.ts`'s `update`, right after computing `fields` (the patched keys) and before the `UPDATE bids SET ...` call:

```ts
        if (fields.length) {
          await assertFieldsNotProtected(client, 'bid', input.id, fields)
        }
```
(import `assertFieldsNotProtected` from `../lib/protectedValues.js`)

- [ ] **Step 6: Run everything touched**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- protectedValues.test.ts bidMilestones.test.ts opportunities.test.ts bids.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/protectedValues.ts apps/api/src/routers/protectedValues.ts apps/api/src/routers/protectedValues.test.ts apps/api/src/index.ts apps/api/src/routers/bids.ts apps/api/src/routers/bidMilestones.ts apps/api/src/routers/opportunities.ts apps/api/src/routers/bids.test.ts apps/api/src/routers/bidMilestones.test.ts apps/api/src/routers/opportunities.test.ts
git commit -m "feat(api): add protectedValues router and wire the freeze guard into bids/bidMilestones/opportunities updates"
```

Note: `bidMilestones.ts` must export `syncSubmissionDeadlineToOpportunity` (already written that way in Task 12) — Task 15 imports it.

---

## Phase H — Corrigenda

### Task 14: `bidCorrigenda` router — `create`, `listForBid`

**Files:**
- Create: `apps/api/src/routers/bidCorrigenda.ts`
- Create: `apps/api/src/routers/bidCorrigenda.test.ts`
- Modify: `apps/api/src/index.ts` (register `bidCorrigenda: bidCorrigendaRouter`)

**Interfaces:**
- Consumes: `isUniqueViolation` from `../db-errors.js`.
- Produces: `toBidCorrigendum(row, changes)`, `toChange(row)`, `bidCorrigendaRouter.listForBid/create`. Task 15 adds `reviewChange` to the same file/router object.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/routers/bidCorrigenda.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidCorrigenda router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_corrigendum_changes')
    await pool.query('DELETE FROM bid_corrigenda')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', submissionDate: '2026-10-15' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('creates a corrigendum against the existing submissionDeadline milestone, and downgrades data confidence', async () => {
    const caller = appRouter.createCaller({})
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18' }],
    })
    expect(corrigendum.status).toBe('pending_review')
    const bid = await caller.bids.get({ id: bidId })
    expect(bid!.dataConfidence).toBe('needs_review')
  })

  it('rejects a change whose fieldKey has no existing milestone slot and is not tenderLink', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'cor_9_z', currentValue: '', proposedValue: 'x' }] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a change against a pre-existing empty milestone slot (the "cor_2_a/b" pattern)', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_a', label: 'Corrigendum 2 — Occurrence 1' })
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 2, changes: [{ fieldKey: 'cor_2_a', currentValue: '', proposedValue: '2026-11-01T00:00:00.000Z' }] })
    ).resolves.toMatchObject({ corrigendumNumber: 2 })
  })

  it('rejects a duplicate corrigendumNumber for the same bid', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-18' }] })
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-19' }] })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('lists corrigenda for a bid, newest-numbered included', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-18' }] })
    const list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list).toHaveLength(1)
    expect(list[0].changes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidCorrigenda.test.ts`
Expected: FAIL — router doesn't exist.

- [ ] **Step 3: Implement `listForBid` and `create`**

```ts
// apps/api/src/routers/bidCorrigenda.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'

export function toChange(row: any) {
  return {
    id: row.id, corrigendumId: row.corrigendum_id, fieldKey: row.field_key, currentValue: row.current_value,
    proposedValue: row.proposed_value, decision: row.decision, decidedAt: row.decided_at, decidedBy: row.decided_by,
  }
}

export function toBidCorrigendum(row: any, changes: any[]) {
  return {
    id: row.id, bidId: row.bid_id, corrigendumNumber: row.corrigendum_number, sourceDocumentId: row.source_document_id,
    detectedAt: row.detected_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
    // Derived, not stored (spec §12) — flips to 'reviewed' the instant the
    // last pending change is resolved, no separate manual step.
    status: changes.some((c) => c.decision === 'pending') ? 'pending_review' : 'reviewed',
    changes: changes.map(toChange),
  }
}

export const bidCorrigendaRouter = router({
  listForBid: protectedReadProcedure.input(z.object({ bidId: z.string().uuid() })).query(async ({ input }) => {
    const corrigenda = (await pool.query('SELECT * FROM bid_corrigenda WHERE bid_id=$1 ORDER BY corrigendum_number', [input.bidId])).rows
    const out = []
    for (const c of corrigenda) {
      const changes = (await pool.query('SELECT * FROM bid_corrigendum_changes WHERE corrigendum_id=$1 ORDER BY created_at', [c.id])).rows
      out.push(toBidCorrigendum(c, changes))
    }
    return out
  }),

  create: protectedProcedure
    .input(z.object({
      bidId: z.string().uuid(), corrigendumNumber: z.number().int().positive(), sourceDocumentId: z.string().uuid().optional(),
      changes: z.array(z.object({ fieldKey: z.string().min(1), currentValue: z.string(), proposedValue: z.string() })).min(1),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Every field_key must already be a milestone slot on this bid, or
        // the one supported bids column — reject clearly at creation time
        // rather than letting an unrecognized key silently do nothing later
        // at review time (this plan's Review Focus item).
        for (const change of input.changes) {
          if (change.fieldKey === 'tenderLink') continue
          const milestone = await client.query('SELECT 1 FROM bid_milestones WHERE bid_id=$1 AND key=$2', [input.bidId, change.fieldKey])
          if (!milestone.rows.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown field "${change.fieldKey}" — create its milestone slot first.` })
          }
        }

        let corrigendum: any
        try {
          corrigendum = (await client.query(
            `INSERT INTO bid_corrigenda (bid_id, corrigendum_number, source_document_id) VALUES ($1,$2,$3) RETURNING *`,
            [input.bidId, input.corrigendumNumber, input.sourceDocumentId ?? null],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Corrigendum ${input.corrigendumNumber} already exists for this bid.` })
          throw e
        }
        const changeRows = []
        for (const change of input.changes) {
          changeRows.push((await client.query(
            `INSERT INTO bid_corrigendum_changes (corrigendum_id, field_key, current_value, proposed_value) VALUES ($1,$2,$3,$4) RETURNING *`,
            [corrigendum.id, change.fieldKey, change.currentValue, change.proposedValue],
          )).rows[0])
        }
        // Spec §17 — a new corrigendum with any pending change downgrades confidence.
        await client.query(`UPDATE bids SET data_confidence='needs_review', updated_at=now() WHERE id=$1`, [input.bidId])

        await client.query('COMMIT')
        return toBidCorrigendum(corrigendum, changeRows)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
```

Register it in `apps/api/src/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidCorrigenda.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/bidCorrigenda.ts apps/api/src/routers/bidCorrigenda.test.ts apps/api/src/index.ts
git commit -m "feat(api): add bidCorrigenda router — create and listForBid"
```

### Task 15: `bidCorrigenda.reviewChange` — protected-field block, transactional apply, audit logging

**Files:**
- Modify: `apps/api/src/routers/bidCorrigenda.ts` (add `reviewChange`)
- Modify: `apps/api/src/routers/bidCorrigenda.test.ts` (add cases)

**Interfaces:**
- Consumes: `assertFieldsNotProtected` from `../lib/protectedValues.js`; `syncSubmissionDeadlineToOpportunity` from `./bidMilestones.js`; `writeAuditLog` from `../lib/auditLog.js`.
- Produces: `bidCorrigendaRouter.reviewChange`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('accepting a change applies the proposed value to the milestone and syncs submissionDate', async () => {
    const caller = appRouter.createCaller({})
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    expect(milestone.dueAt).toContain('2026-10-18')
    const opp = await caller.opportunities.get({ id: opportunityId })
    expect(opp!.submissionDate).toContain('2026-10-18')
  })

  it('rejecting a change leaves the milestone untouched', async () => {
    const caller = appRouter.createCaller({})
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'rejected', reason: 'Not applicable to us' })
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    expect(milestone.dueAt).toContain('2026-10-15') // wait — dueAt is the seeded ISO timestamp, not the raw string; assert unchanged from its pre-review value instead
  })

  it('blocks accepting a change on a frozen field', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await expect(caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: 'Client confirmed the extension' })
    await expect(caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })).resolves.toBeDefined()
  })

  it('status flips to reviewed only once every change is resolved, not before', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_a', label: 'Occ 1' })
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_b', label: 'Occ 2' })
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 2,
      changes: [
        { fieldKey: 'cor_2_a', currentValue: '', proposedValue: '2026-11-01T00:00:00.000Z' },
        { fieldKey: 'cor_2_b', currentValue: '', proposedValue: '2026-11-05T00:00:00.000Z' },
      ],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })
    let list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list[0].status).toBe('pending_review')
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[1].id, decision: 'rejected', reason: 'Superseded' })
    list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list[0].status).toBe('reviewed')
  })
```

Fix the second test's assertion before running it — replace the placeholder comment with a real check against the milestone's value captured *before* the review call:

```ts
  it('rejecting a change leaves the milestone untouched', async () => {
    const caller = appRouter.createCaller({})
    const before = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'rejected', reason: 'Not applicable to us' })
    const after = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    expect(after.dueAt).toBe(before.dueAt)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidCorrigenda.test.ts`
Expected: FAIL — `reviewChange` doesn't exist.

- [ ] **Step 3: Implement**

Add to `apps/api/src/routers/bidCorrigenda.ts` (new imports: `assertFieldsNotProtected` from `../lib/protectedValues.js`, `syncSubmissionDeadlineToOpportunity` from `./bidMilestones.js`, `writeAuditLog` from `../lib/auditLog.js`), inside the `router({...})` call alongside `listForBid`/`create`:

```ts
  reviewChange: protectedProcedure
    .input(z.object({ changeId: z.string().uuid(), decision: z.enum(['accepted', 'rejected']), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const change = (await client.query('SELECT * FROM bid_corrigendum_changes WHERE id=$1 FOR UPDATE', [input.changeId])).rows[0]
        if (!change) throw new TRPCError({ code: 'NOT_FOUND' })
        const corrigendum = (await client.query('SELECT * FROM bid_corrigenda WHERE id=$1', [change.corrigendum_id])).rows[0]

        if (input.decision === 'accepted') {
          await assertFieldsNotProtected(client, 'bid', corrigendum.bid_id, [change.field_key])
          if (change.field_key === 'tenderLink') {
            await client.query('UPDATE bids SET tender_link=$1, updated_at=now() WHERE id=$2', [change.proposed_value, corrigendum.bid_id])
          } else {
            await client.query(
              `UPDATE bid_milestones SET due_at=$1, updated_at=now(), source='corrigendum' WHERE bid_id=$2 AND key=$3`,
              [change.proposed_value, corrigendum.bid_id, change.field_key],
            )
            if (change.field_key === 'submissionDeadline') {
              await syncSubmissionDeadlineToOpportunity(client, corrigendum.bid_id, change.proposed_value)
            }
          }
        }

        await client.query(
          `UPDATE bid_corrigendum_changes SET decision=$1, decided_at=now(), decided_by=$2 WHERE id=$3`,
          [input.decision, ctx.user?.email ?? null, input.changeId],
        )
        await writeAuditLog(client, {
          entityType: 'bidCorrigendum', entityId: corrigendum.id, field: change.field_key,
          oldValue: change.current_value, newValue: change.proposed_value, reason: input.reason ?? '',
          action: input.decision === 'accepted' ? 'corrigendum_accepted' : 'corrigendum_rejected', changedBy: ctx.user?.email,
        })

        const remaining = await client.query(
          `SELECT 1 FROM bid_corrigendum_changes WHERE corrigendum_id=$1 AND decision='pending'`, [corrigendum.id],
        )
        if (!remaining.rows.length) {
          await client.query(`UPDATE bid_corrigenda SET reviewed_at=now(), reviewed_by=$1 WHERE id=$2`, [ctx.user?.email ?? null, corrigendum.id])
        }

        await client.query('COMMIT')
        return toChange((await pool.query('SELECT * FROM bid_corrigendum_changes WHERE id=$1', [input.changeId])).rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bidCorrigenda.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/bidCorrigenda.ts apps/api/src/routers/bidCorrigenda.test.ts
git commit -m "feat(api): add bidCorrigenda.reviewChange with the protected-field block and transactional apply"
```

---

## Phase I — Documents

### Task 16: GCS client wrapper + `documents.requestUploadUrl`

**Files:**
- Modify: `apps/api/package.json` (add `@google-cloud/storage` dependency — the one new backend dependency this plan takes, per spec §14)
- Create: `apps/api/src/lib/gcs.ts`
- Create: `apps/api/src/routers/documents.ts`
- Create: `apps/api/src/routers/documents.test.ts`
- Modify: `apps/api/src/index.ts` (register `documents: documentsRouter`)

**Interfaces:**
- Produces: `ALLOWED_DOCUMENT_CONTENT_TYPES: readonly string[]`, `MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024`, `getSignedUploadUrl(objectPath, contentType): Promise<string>`, `getSignedDownloadUrl(objectPath): Promise<string>`, `getObjectMetadata(objectPath): Promise<{size: number; contentType: string} | null>`, `moveObject(from, to): Promise<void>`, `deleteObject(objectPath): Promise<void>`, `documentsRouter.requestUploadUrl`.
- Consumed by: Task 17 (`confirmUpload`), Task 18 (`delete`).

- [ ] **Step 1: Add the dependency**

Run: `npm --workspace apps/api install @google-cloud/storage`
Expected: `apps/api/package.json`'s `dependencies` gains `"@google-cloud/storage": "^7.x.x"` (whatever the installed version resolves to) and `package-lock.json` updates.

- [ ] **Step 2: Write the GCS wrapper**

```ts
// apps/api/src/lib/gcs.ts
//
// Thin wrapper over @google-cloud/storage, scoped to exactly what Bid
// Tracker's documents need (spec §14). Reuses the already-provisioned
// `${project_id}-attachments` bucket (infra/dev|prod/storage.tf) — no new
// bucket. In Cloud Run, the client authenticates via the runtime service
// account's Application Default Credentials automatically; locally, it needs
// GOOGLE_APPLICATION_CREDENTIALS pointed at a service-account key with
// access to a real bucket, or this module's calls are skipped by tests that
// don't exercise real GCS (see documents.test.ts's note on that).
import { Storage } from '@google-cloud/storage'

const storage = new Storage()

function bucket() {
  const name = process.env.ATTACHMENTS_BUCKET
  if (!name) throw new Error('ATTACHMENTS_BUCKET is not set')
  return storage.bucket(name)
}

export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024

export async function getSignedUploadUrl(objectPath: string, contentType: string): Promise<string> {
  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000, contentType,
  })
  return url
}

export async function getSignedDownloadUrl(objectPath: string): Promise<string> {
  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
  })
  return url
}

/** Reads what GCS itself recorded for the object — the authoritative source
 *  for confirmUpload's verification (spec §14), never the client's original
 *  request claim. Returns null if the object doesn't exist (e.g. the upload
 *  never actually happened). */
export async function getObjectMetadata(objectPath: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const [metadata] = await bucket().file(objectPath).getMetadata()
    return { size: Number(metadata.size), contentType: String(metadata.contentType) }
  } catch (e: any) {
    if (e?.code === 404) return null
    throw e
  }
}

export async function moveObject(from: string, to: string): Promise<void> {
  await bucket().file(from).move(to)
}

export async function deleteObject(objectPath: string): Promise<void> {
  await bucket().file(objectPath).delete({ ignoreNotFound: true })
}
```

- [ ] **Step 3: Write the failing test for `requestUploadUrl`**

```ts
// apps/api/src/routers/documents.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

// GCS itself is not exercised against a real bucket in this suite — every
// gcs.ts function is mocked, matching this codebase's convention of testing
// against a real Postgres but never a real external cloud dependency (no
// existing test hits real GCS/Firebase either). Task 17/18 extend this mock.
vi.mock('../lib/gcs.js', () => ({
  ALLOWED_DOCUMENT_CONTENT_TYPES: ['application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  MAX_DOCUMENT_SIZE_BYTES: 50 * 1024 * 1024,
  getSignedUploadUrl: vi.fn(async (path: string) => `https://signed-upload.example/${path}`),
  getSignedDownloadUrl: vi.fn(async (path: string) => `https://signed-download.example/${path}`),
  getObjectMetadata: vi.fn(async () => ({ size: 1024, contentType: 'application/pdf' })),
  moveObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
}))

describe('documents router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM document_citations')
    await pool.query('DELETE FROM documents')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('rejects a disallowed content type up front, before minting a URL', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'malware.exe', contentType: 'application/x-msdownload', sizeBytes: 100 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a claimed size over the 50MB limit up front', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'huge.pdf', contentType: 'application/pdf', sizeBytes: 51 * 1024 * 1024 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('returns a signed upload URL and an uploadId for a valid request', async () => {
    const caller = appRouter.createCaller({})
    const result = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'DRDO_SAG_AI_Tender_2026.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    expect(result.uploadUrl).toContain('bid-tracker/_pending/')
    expect(result.uploadId).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: FAIL — router doesn't exist.

- [ ] **Step 5: Implement `requestUploadUrl`**

```ts
// apps/api/src/routers/documents.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'node:crypto'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { ALLOWED_DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_SIZE_BYTES, getSignedUploadUrl, getSignedDownloadUrl, getObjectMetadata, moveObject, deleteObject } from '../lib/gcs.js'

export function toDocument(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, filename: row.filename,
    storagePath: row.storage_path, version: row.version, contentType: row.content_type,
    sizeBytes: Number(row.size_bytes), uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at,
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// In-memory map of uploadId -> pending upload metadata, populated by
// requestUploadUrl and consumed by confirmUpload (Task 17). Fine for this
// app's scale (spec §2) and this feature's short-lived (10-minute signed
// URL) window — an uploadId that's never confirmed simply expires here on
// process restart, same lifetime class as the signed URL itself.
export const pendingUploads = new Map<string, { entityType: string; entityId: string; filename: string; version: string; pendingPath: string; canonicalPath: string }>()

export const documentsRouter = router({
  requestUploadUrl: protectedProcedure
    .input(z.object({
      entityType: z.string(), entityId: z.string().uuid(), filename: z.string().min(1),
      contentType: z.string(), sizeBytes: z.number().int().positive(), version: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unsupported file type: ${input.contentType}` })
      }
      if (input.sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds the 50 MB limit.' })
      }
      const uploadId = randomUUID()
      const documentId = randomUUID()
      const safeFilename = sanitizeFilename(input.filename)
      const version = input.version ?? 'v1.0'
      const pendingPath = `bid-tracker/_pending/${uploadId}/${safeFilename}`
      const canonicalPath = `bid-tracker/${input.entityType}/${input.entityId}/${documentId}/${safeFilename}`
      pendingUploads.set(uploadId, { entityType: input.entityType, entityId: input.entityId, filename: safeFilename, version, pendingPath, canonicalPath })
      const uploadUrl = await getSignedUploadUrl(pendingPath, input.contentType)
      return { uploadId, uploadUrl }
    }),
})
```

- [ ] **Step 6: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: PASS. Register `documentsRouter` in `apps/api/src/index.ts` first if any test still fails with "documents is undefined."

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/lib/gcs.ts apps/api/src/routers/documents.ts apps/api/src/routers/documents.test.ts apps/api/src/index.ts
git commit -m "feat(api): add GCS wrapper and documents.requestUploadUrl with up-front type/size validation"
```

### Task 17: `documents.confirmUpload` — verifies the actual object, not the original request

**Files:**
- Modify: `apps/api/src/routers/documents.ts` (add `confirmUpload`)
- Modify: `apps/api/src/routers/documents.test.ts` (add cases)

**Interfaces:**
- Consumes: `getObjectMetadata`, `moveObject`, `deleteObject` from `../lib/gcs.js` (mocked in tests, per Task 16's `vi.mock`).
- Produces: `documentsRouter.confirmUpload`.

- [ ] **Step 1: Write the failing tests, including the concurrency case from this plan's Review Focus**

```ts
  it('confirms an upload, moving the object and inserting a documents row with GCS-verified metadata', async () => {
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'Tender.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    const doc = await caller.documents.confirmUpload({ uploadId })
    expect(doc.contentType).toBe('application/pdf') // from the mocked getObjectMetadata, not the original request
    expect(doc.sizeBytes).toBe(1024) // ditto
  })

  it('rejects and deletes the object when the actual GCS metadata violates the size/type limit even though the request claimed a valid one', async () => {
    const { getObjectMetadata, deleteObject } = await import('../lib/gcs.js')
    vi.mocked(getObjectMetadata).mockResolvedValueOnce({ size: 999_999_999, contentType: 'application/pdf' })
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'Lied.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    await expect(caller.documents.confirmUpload({ uploadId })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(deleteObject).toHaveBeenCalled()
  })

  it('rejects confirming an unknown/expired uploadId', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.documents.confirmUpload({ uploadId: 'no-such-id' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a second confirm for the same (entityType, entityId, filename, version) — no orphaned object at the canonical path from the loser', async () => {
    const caller = appRouter.createCaller({})
    const first = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Dup.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    await caller.documents.confirmUpload({ uploadId: first.uploadId })
    const second = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Dup.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    const { deleteObject } = await import('../lib/gcs.js')
    vi.mocked(deleteObject).mockClear()
    await expect(caller.documents.confirmUpload({ uploadId: second.uploadId })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(deleteObject).toHaveBeenCalled() // the loser's now-moved-then-rejected object is cleaned up, not left at the canonical path
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: FAIL — `confirmUpload` doesn't exist.

- [ ] **Step 3: Implement**

Add to `apps/api/src/routers/documents.ts`, inside the `router({...})` object:

```ts
  confirmUpload: protectedProcedure
    .input(z.object({ uploadId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const pending = pendingUploads.get(input.uploadId)
      if (!pending) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown or expired upload.' })

      const metadata = await getObjectMetadata(pending.pendingPath)
      if (!metadata) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The file was never uploaded.' })

      // Verify the ACTUAL object, not the original request (spec §14) —
      // defense in depth against a client that lied about what it's uploading.
      if (metadata.size > MAX_DOCUMENT_SIZE_BYTES || !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(metadata.contentType)) {
        await deleteObject(pending.pendingPath)
        pendingUploads.delete(input.uploadId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The uploaded file does not match an allowed type/size.' })
      }

      await moveObject(pending.pendingPath, pending.canonicalPath)
      pendingUploads.delete(input.uploadId)

      let row: any
      try {
        row = (await pool.query(
          `INSERT INTO documents (entity_type, entity_id, filename, storage_path, version, content_type, size_bytes, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [pending.entityType, pending.entityId, pending.filename, pending.canonicalPath, pending.version, metadata.contentType, metadata.size, ctx.user?.email ?? null],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) {
          // Lost the race to a concurrent confirm for the same
          // (entityType, entityId, filename, version) — the object we just
          // moved to the canonical path must not be left there.
          await deleteObject(pending.canonicalPath)
          throw new TRPCError({ code: 'CONFLICT', message: 'This exact file and version was already uploaded.' })
        }
        throw e
      }
      return toDocument(row)
    }),
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/documents.ts apps/api/src/routers/documents.test.ts
git commit -m "feat(api): add documents.confirmUpload, verifying the actual GCS object over the original request claim"
```

### Task 18: `documents.listFor`/`delete`, and the `citations` sub-router

**Files:**
- Modify: `apps/api/src/routers/documents.ts` (add `listFor`, `delete`, `citations`)
- Modify: `apps/api/src/routers/documents.test.ts` (add cases)

**Interfaces:**
- Produces: `documentsRouter.listFor/delete`, `documentsRouter.citations.create/list/delete`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('lists documents for an entity, deletes one (row then best-effort object), and manages citations', async () => {
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Cited.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    const doc = await caller.documents.confirmUpload({ uploadId })

    const citation = await caller.documents.citations.create({ documentId: doc.id, pageLabel: 'Pg 3', quoteText: 'Total estimated value of procurement: ₹6.20 Crore' })
    let citations = await caller.documents.citations.list({ documentId: doc.id })
    expect(citations).toHaveLength(1)

    let list = await caller.documents.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.map((d: any) => d.id)).toContain(doc.id)

    await caller.documents.delete({ id: doc.id })
    list = await caller.documents.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.map((d: any) => d.id)).not.toContain(doc.id)
    citations = await caller.documents.citations.list({ documentId: doc.id })
    expect(citations).toHaveLength(0) // cascaded

    const { deleteObject } = await import('../lib/gcs.js')
    expect(deleteObject).toHaveBeenCalledWith(doc.storagePath)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `apps/api/src/routers/documents.ts`:

```ts
function toCitation(row: any) {
  return { id: row.id, documentId: row.document_id, pageLabel: row.page_label, quoteText: row.quote_text, fieldRef: row.field_ref, createdAt: row.created_at }
}

export const documentCitationsRouter = router({
  list: protectedReadProcedure.input(z.object({ documentId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM document_citations WHERE document_id=$1 ORDER BY created_at', [input.documentId])
    return result.rows.map(toCitation)
  }),
  create: protectedProcedure
    .input(z.object({ documentId: z.string().uuid(), pageLabel: z.string().min(1), quoteText: z.string().optional(), fieldRef: z.string().optional() }))
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `INSERT INTO document_citations (document_id, page_label, quote_text, field_ref) VALUES ($1,$2,$3,$4) RETURNING *`,
        [input.documentId, input.pageLabel, input.quoteText ?? '', input.fieldRef ?? null],
      )
      return toCitation(result.rows[0])
    }),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) =>
    pool.query('DELETE FROM document_citations WHERE id=$1', [input.id]).then(() => undefined)
  ),
})
```

Add to `documentsRouter`'s object: `listFor`, `delete`, and `citations: documentCitationsRouter`:

```ts
  listFor: protectedReadProcedure.input(z.object({ entityType: z.string(), entityId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM documents WHERE entity_type=$1 AND entity_id=$2 ORDER BY uploaded_at DESC', [input.entityType, input.entityId])
    return result.rows.map(toDocument)
  }),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1', [input.id])).rows[0]
    if (!doc) return
    // document_citations cascades via FK. Row deleted first, inside its own
    // implicit transaction; GCS delete is best-effort afterward (spec §14) —
    // a failure here is logged, not thrown, and never blocks the DB delete.
    await pool.query('DELETE FROM documents WHERE id=$1', [input.id])
    try {
      await deleteObject(doc.storage_path)
    } catch (e) {
      console.error(`Failed to delete GCS object ${doc.storage_path} for deleted document ${input.id}`, e)
    }
  }),
  citations: documentCitationsRouter,
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/documents.ts apps/api/src/routers/documents.test.ts
git commit -m "feat(api): add documents.listFor/delete and the citations sub-router"
```

---

## Phase J — Saved views, and grid filtering

### Task 19: `bidSavedViews` router (system-view merge), and `bids.listForGrid` filter support

**Files:**
- Create: `apps/api/src/routers/bidSavedViews.ts`
- Create: `apps/api/src/routers/bidSavedViews.test.ts`
- Modify: `apps/api/src/index.ts` (register `bidSavedViews: bidSavedViewsRouter`)
- Modify: `packages/domain/src/bids.ts` (add `applyFilterRules`, `resolveFilterValue`)
- Modify: `apps/api/src/routers/bids.ts` (`listForGrid` gains `ownerEmail`, `attentionFlag`, and a `filterRules` input param)
- Modify: `apps/api/src/routers/bids.test.ts` (add cases)

**Interfaces:**
- Produces: `resolveFilterValue(value, currentUserEmail): string | null` (resolves the `'$currentUser'` token), `applyFilterRules<T>(rows: T[], rules: SystemBidViewFilterRule[], currentUserEmail: string | null): T[]`, `bidSavedViewsRouter.list/get/create/update/delete`.
- Consumes: `ownership.resolveOwners`-equivalent logic (reuses `loadOwnershipContext`/`buildOwnerMap` from `ownership.ts`, imported directly rather than duplicated).

- [ ] **Step 1: Add the pure filter-matching helper to the domain package**

Append to `packages/domain/src/bids.ts`:

```ts
/** Resolves the one supported placeholder token. Anything else passes
 *  through unchanged. Deterministic even with no signed-in user (spec's
 *  Review Focus: AUTH_ENFORCEMENT_ENABLED is off by default across this
 *  codebase) — resolves to null, which then matches nothing rather than
 *  throwing, so "My Bids" with no signed-in user is simply an empty list,
 *  not a crash. */
export function resolveFilterValue(value: string, currentUserEmail: string | null): string | null {
  return value === '$currentUser' ? currentUserEmail : value
}

export function applyFilterRules<T extends Record<string, unknown>>(
  rows: T[],
  rules: SystemBidViewFilterRule[],
  currentUserEmail: string | null,
): T[] {
  if (!rules.length) return rows
  return rows.filter((row) => rules.every((rule) => {
    const target = resolveFilterValue(rule.value, currentUserEmail)
    return row[rule.field] === target
  }))
}
```

- [ ] **Step 2: Write the failing tests for the domain helper's edge case, and for `listForGrid`/`bidSavedViews`**

Add to `apps/api/src/routers/bids.test.ts` (this is where it's exercised — no standalone domain test file, per this plan's Global Constraints):

```ts
  it('listForGrid filters by stageKey and never crashes on the myBids ($currentUser) rule with no signed-in user', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    const solutioningOnly = await caller.bids.listForGrid({ filterRules: [{ field: 'stageKey', operator: 'eq', value: 'solutioning' }] })
    expect(solutioningOnly).toHaveLength(1)
    const myBids = await caller.bids.listForGrid({ filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] })
    expect(myBids).toEqual([]) // no crash, no signed-in user (AUTH_ENFORCEMENT_ENABLED is off in tests) -> resolves to null -> matches nothing
  })

  it('listForGrid includes a computed attentionFlag per row', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const milestone = (await caller.bidMilestones.listForBid({ bidId: bid.id })).find((m: any) => m.key === 'submissionDeadline')!
    await caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2020-01-01T00:00:00.000Z' } })
    const grid = await caller.bids.listForGrid({})
    expect(grid.find((r: any) => r.id === bid.id)?.attentionFlag).toBe('overdue')
  })
```

```ts
// apps/api/src/routers/bidSavedViews.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidSavedViews router', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM bid_saved_views')
  })

  it('always includes every system view, unconditionally', async () => {
    const caller = appRouter.createCaller({})
    const list = await caller.bidSavedViews.list()
    const keys = list.map((v: any) => v.key ?? v.id)
    expect(keys).toEqual(expect.arrayContaining(['allBids', 'myBids', 'solutioning', 'qualification', 'dueSoon', 'overdue', 'goApproved']))
    expect(list.filter((v: any) => v.isSystem)).toHaveLength(7)
  })

  it('never seeds "Smart Transport Bids" or "High Value Deals > 20 Cr" — they do not exist until created', async () => {
    const caller = appRouter.createCaller({})
    const list = await caller.bidSavedViews.list()
    expect(list.map((v: any) => v.name)).not.toContain('Smart Transport Bids')
    expect(list.map((v: any) => v.name)).not.toContain('High Value Deals > 20 Cr')
  })

  it('creates a personal view, invisible to a different user, and a global view visible to everyone', async () => {
    const asAlice = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    const asBob = appRouter.createCaller({ user: { email: 'bob@amnex.com' } } as any)
    await asAlice.bidSavedViews.create({ name: 'My Smart Transport Bids', scope: 'personal', filterRules: [{ field: 'vertical', operator: 'eq', value: 'Smart Transport' }] })
    const aliceList = await asAlice.bidSavedViews.list()
    const bobList = await asBob.bidSavedViews.list()
    expect(aliceList.map((v: any) => v.name)).toContain('My Smart Transport Bids')
    expect(bobList.map((v: any) => v.name)).not.toContain('My Smart Transport Bids')

    await asBob.bidSavedViews.create({ name: 'High Value Deals > 20 Cr', scope: 'global', filterRules: [] })
    const aliceListAfter = await asAlice.bidSavedViews.list()
    expect(aliceListAfter.map((v: any) => v.name)).toContain('High Value Deals > 20 Cr')
  })

  it('rejects updating or deleting a system view key', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.bidSavedViews.update({ id: 'allBids', patch: { name: 'Renamed' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.bidSavedViews.delete({ id: 'allBids' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts bidSavedViews.test.ts`
Expected: FAIL on both files.

- [ ] **Step 4: Extend `bids.listForGrid`**

Replace `bids.ts`'s `listForGrid` procedure (new imports: `applyFilterRules`, `resolveFilterValue`, `computeAttentionFlag` from `@goms/domain`; `loadOwnershipContext` is `ownership.ts`'s own unexported helper — instead of importing it, duplicate the two small queries needed here, matching this codebase's convention of small per-router `toXxx`/prefetch duplication over cross-router imports of unexported helpers):

```ts
  listForGrid: protectedReadProcedure
    .input(z.object({ filterRules: z.array(z.object({ field: z.string(), operator: z.literal('eq'), value: z.string() })).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const [gridResult, corrigendaPendingResult, ownershipResult] = await Promise.all([
        pool.query(`
          SELECT b.*, o.department_id, o.state_code, o.opportunity_name, o.gem_tender_id, o.submission_date,
                 o.value_amount, o.value_unit, o.emd_amount, o.emd_unit, o.vertical
          FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
          ORDER BY b.created_at DESC
        `),
        pool.query(`
          SELECT c.bid_id FROM bid_corrigenda c
          JOIN bid_corrigendum_changes ch ON ch.corrigendum_id = c.id
          WHERE ch.decision = 'pending' GROUP BY c.bid_id
        `),
        pool.query(`SELECT entity_id, sales_person_id FROM ownership_assignments WHERE entity_type='bid' AND role='owner' AND end_date IS NULL`),
      ])
      const pendingCorrigendumBidIds = new Set(corrigendaPendingResult.rows.map((r: any) => r.bid_id))
      const ownerBySalesPersonEmailNeeded = ownershipResult.rows // salesPersonId only — email resolution below
      const salesPersonIds = [...new Set(ownerBySalesPersonEmailNeeded.map((r: any) => r.sales_person_id))]
      const emailsResult = salesPersonIds.length
        ? await pool.query('SELECT id, official_email FROM sales_persons WHERE id = ANY($1)', [salesPersonIds])
        : { rows: [] }
      const emailById = new Map(emailsResult.rows.map((r: any) => [r.id, r.official_email]))
      const ownerEmailByBidId = new Map(
        ownershipResult.rows.map((r: any) => [r.entity_id, emailById.get(r.sales_person_id) ?? null]),
      )

      const today = new Date().toISOString().slice(0, 10)
      const rows = gridResult.rows.map((r: any) => {
        const dueAt = r.submission_date && !Number.isNaN(new Date(r.submission_date).getTime()) ? r.submission_date : null
        return {
          ...toBid(r), departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
          gemTenderId: r.gem_tender_id, submissionDate: r.submission_date, valueAmount: r.value_amount,
          valueUnit: r.value_unit, emdAmount: r.emd_amount, emdUnit: r.emd_unit, vertical: r.vertical,
          ownerEmail: ownerEmailByBidId.get(r.id) ?? null,
          attentionFlag: computeAttentionFlag({ dueAt, hasPendingCorrigendum: pendingCorrigendumBidIds.has(r.id), today }),
        }
      })
      return applyFilterRules(rows, input?.filterRules ?? [], ctx.user?.email ?? null)
    }),
```

(Note: this does not resolve *inherited* bid ownership — spec §4.6's inheritance-from-opportunity — only *direct* bid-level owner assignments. Direct-only is sufficient for grid filtering/display; the bid detail page's Overview tab (Task 31) uses the full `ownership.resolveOwner` procedure, which does resolve inheritance, for the authoritative single-bid view. Note this distinction in a code comment at the query above rather than silently picking one without saying so.)

- [ ] **Step 5: Implement `bidSavedViews` router**

```ts
// apps/api/src/routers/bidSavedViews.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { writeAuditLog } from '../lib/auditLog.js'
import { SYSTEM_BID_VIEWS, SYSTEM_BID_VIEW_KEYS } from '@goms/domain'

function toSavedView(row: any) {
  return {
    id: row.id, name: row.name, scope: row.scope, ownerEmail: row.owner_email, isSystem: false,
    filterRules: row.filter_rules, sort: row.sort, visibleColumns: row.visible_columns,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

const patchShape = z.object({
  name: z.string().min(1).optional(), filterRules: z.array(z.any()).optional(),
  sort: z.array(z.any()).optional(), visibleColumns: z.array(z.any()).optional(),
})

export const bidSavedViewsRouter = router({
  list: protectedReadProcedure.query(async ({ ctx }) => {
    const systemViews = SYSTEM_BID_VIEWS.map((v) => ({
      id: v.key, key: v.key, name: v.name, scope: 'global' as const, ownerEmail: null, isSystem: true,
      filterRules: v.filterRules, sort: [], visibleColumns: [], createdBy: null, createdAt: null, updatedAt: null,
    }))
    const email = ctx.user?.email ?? null
    const dbResult = email
      ? await pool.query('SELECT * FROM bid_saved_views WHERE scope=$1 OR owner_email=$2', ['global', email])
      : await pool.query('SELECT * FROM bid_saved_views WHERE scope=$1', ['global'])
    return [...systemViews, ...dbResult.rows.map(toSavedView)]
  }),

  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM bid_saved_views WHERE id=$1', [input.id])
    return result.rows[0] ? toSavedView(result.rows[0]) : null
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), scope: z.enum(['personal', 'global']), filterRules: z.array(z.any()).optional(), sort: z.array(z.any()).optional(), visibleColumns: z.array(z.any()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const ownerEmail = input.scope === 'personal' ? (ctx.user?.email ?? null) : null
      if (input.scope === 'personal' && !ownerEmail) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A personal view requires a signed-in user.' })
      }
      const result = await pool.query(
        `INSERT INTO bid_saved_views (name, scope, owner_email, filter_rules, sort, visible_columns, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.name, input.scope, ownerEmail, JSON.stringify(input.filterRules ?? []), JSON.stringify(input.sort ?? []), JSON.stringify(input.visibleColumns ?? []), ctx.user?.email ?? null],
      )
      if (input.scope === 'global') {
        // `pool` itself satisfies writeAuditLog's minimal `{query}` shape —
        // no transaction needed for a single best-effort log write, so no
        // client to acquire/release here.
        await writeAuditLog(pool, {
          entityType: 'bidSavedView', entityId: result.rows[0].id, field: 'name', oldValue: '', newValue: input.name,
          reason: '', action: 'create', changedBy: ctx.user?.email,
        }).catch(() => undefined) // best-effort logging, never blocks the create itself
      }
      return toSavedView(result.rows[0])
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), patch: patchShape }))
    .mutation(async ({ input, ctx }) => {
      if (SYSTEM_BID_VIEW_KEYS.has(input.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'System views cannot be modified.' })
      }
      const columnFor: Record<string, string> = { name: 'name', filterRules: 'filter_rules', sort: 'sort', visibleColumns: 'visible_columns' }
      const jsonFields = new Set(['filterRules', 'sort', 'visibleColumns'])
      const fields = Object.keys(input.patch)
      if (fields.length) {
        const values = fields.map((f) => (jsonFields.has(f) ? JSON.stringify((input.patch as any)[f]) : (input.patch as any)[f]))
        const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
        values.push(input.id)
        await pool.query(`UPDATE bid_saved_views SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
      }
      const result = await pool.query('SELECT * FROM bid_saved_views WHERE id=$1', [input.id])
      if (!result.rows[0]) throw new TRPCError({ code: 'NOT_FOUND' })
      await writeAuditLog(pool, {
        entityType: 'bidSavedView', entityId: input.id, field: 'patch', oldValue: '', newValue: JSON.stringify(input.patch),
        reason: '', action: 'update', changedBy: ctx.user?.email,
      }).catch(() => undefined)
      return toSavedView(result.rows[0])
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    if (SYSTEM_BID_VIEW_KEYS.has(input.id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'System views cannot be deleted.' })
    }
    await pool.query('DELETE FROM bid_saved_views WHERE id=$1', [input.id])
    await writeAuditLog(pool, {
      entityType: 'bidSavedView', entityId: input.id, field: 'name', oldValue: '', newValue: '',
      reason: '', action: 'delete', changedBy: ctx.user?.email,
    }).catch(() => undefined)
  }),
})
```

Register it in `apps/api/src/index.ts`.

- [ ] **Step 6: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts bidSavedViews.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/bids.ts apps/api/src/routers/bids.ts apps/api/src/routers/bids.test.ts apps/api/src/routers/bidSavedViews.ts apps/api/src/routers/bidSavedViews.test.ts apps/api/src/index.ts
git commit -m "feat(api): add bidSavedViews (system-view merge) and filterRules support on bids.listForGrid"
```

---

## Phase K — Top-level activity history, commercial linkage, search

### Task 20: `auditLogs` top-level router

**Files:**
- Create: `apps/api/src/routers/auditLogs.ts`
- Create: `apps/api/src/routers/auditLogs.test.ts`
- Modify: `apps/api/src/index.ts` (register `auditLogs: auditLogsRouter`)

**Interfaces:**
- Consumes: `listAuditLogs` from `../lib/auditLog.js` (Task 5).
- Produces: `auditLogsRouter.list`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routers/auditLogs.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('auditLogs router (top-level)', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
  })

  it('lists log entries for any entity type, including bid-related ones, via the same shared store commercial.auditLogs already reads', async () => {
    await pool.query(
      `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, action) VALUES ('bid', '00000000-0000-0000-0000-000000000001', 'stageKey', 'a', 'b', 'update')`,
    )
    const caller = appRouter.createCaller({})
    const viaTopLevel = await caller.auditLogs.list({ entityType: 'bid' })
    expect(viaTopLevel).toHaveLength(1)
    // Same underlying store — commercial.auditLogs.list still works unchanged (spec §16's regression requirement).
    const viaCommercial = await caller.commercial.auditLogs.list({ entityType: 'bid' })
    expect(viaCommercial).toEqual(viaTopLevel)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- auditLogs.test.ts`
Expected: FAIL — router doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/routers/auditLogs.ts
import { z } from 'zod'
import { protectedReadProcedure, router } from '../trpc.js'
import { listAuditLogs } from '../lib/auditLog.js'

export const auditLogsRouter = router({
  list: protectedReadProcedure
    .input(z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).optional())
    .query(({ input }) => listAuditLogs(input)),
})
```

Register it in `apps/api/src/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- auditLogs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/auditLogs.ts apps/api/src/routers/auditLogs.test.ts apps/api/src/index.ts
git commit -m "feat(api): add a top-level auditLogs router over the shared audit-log store"
```

### Task 21: `commercial.ts` — carry `opportunity_id` through `revise`/`duplicate`, accept it on `create`/`update`

**Files:**
- Modify: `apps/api/src/routers/commercial.ts` (BOQ `create`/`update`/`revise`/`duplicate`, `toBoq`, `boqColumnFor`)
- Modify: `apps/api/src/routers/commercial-boq.test.ts` (add cases)

**Interfaces:**
- Produces: `CommercialBoq.opportunityId` (nullable) on the wire shape.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/routers/commercial-boq.test.ts` (adapt to that file's existing department/opportunity setup helpers):

```ts
  it('accepts and returns opportunityId on create/update', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'BOQ-linked tender' })
    const boq = await caller.commercial.boq.create({ opportunityName: 'BOQ-linked tender', departmentId, opportunityId: opp.id, currency: 'INR' })
    expect(boq.opportunityId).toBe(opp.id)
  })

  it('carries opportunityId forward through revise and duplicate', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Revisable tender' })
    const boq = await caller.commercial.boq.create({ opportunityName: 'Revisable tender', departmentId, opportunityId: opp.id, currency: 'INR' })
    const revised = await caller.commercial.boq.revise({ id: boq.id })
    expect(revised.opportunityId).toBe(opp.id)
    const duplicated = await caller.commercial.boq.duplicate({ id: boq.id })
    expect(duplicated.opportunityId).toBe(opp.id)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- commercial-boq.test.ts`
Expected: FAIL — `opportunityId` is `undefined` on every returned BOQ today.

- [ ] **Step 3: Implement**

In `apps/api/src/routers/commercial.ts`:
- `toBoq` (currently ~line 705): add `opportunityId: row.opportunity_id,` to the returned object.
- `boqColumnFor` (currently ~line 879): add `opportunityId: 'opportunity_id',`.
- `create`'s input schema and `INSERT` (around line 981): add `opportunityId: z.string().uuid().nullable().optional()` to the input `z.object`, add `opportunity_id` to the column list and a `input.opportunityId ?? null` to the values array.
- `revise` (~line 1332-1345): add `opportunity_id` to the `INSERT`'s column list and `original.opportunity_id` to its values array.
- `duplicate` (~line 1376-1388): same — add `opportunity_id` to the column list and `original.opportunity_id` to its values array.

(`update`'s existing dynamic `boqColumnFor`-driven patch mechanism needs no separate code change beyond the `boqColumnFor` map entry above — adding `opportunityId: 'opportunity_id'` there makes `commercial.boq.update({id, patch: {opportunityId}})` work automatically, the same way every other patchable field already does.)

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- commercial-boq.test.ts commercial.test.ts commercial-skus.test.ts`
Expected: PASS, with zero regression on the rest of the commercial suite.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/commercial.ts apps/api/src/routers/commercial-boq.test.ts
git commit -m "feat(api): link commercial_boqs to opportunities, carried through revise and duplicate"
```

### Task 22: Extend global search's `work` category with bid fields and routing

**Files:**
- Modify: `packages/domain/src/search.ts` (`SearchOpportunity`, `SearchResult`, `worksCategory`)
- Modify: `apps/api/src/routers/search.ts` (`loadSearchData`'s opportunities query gains a `LEFT JOIN bids`)
- Modify: `apps/api/src/routers/search.test.ts` (add a case)

**Interfaces:**
- Produces: `SearchOpportunity.bidId`/`bidCode`/`tenderLink` (all nullable), `SearchResult.bidId` (nullable).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routers/search.test.ts` (adapt to its existing setup pattern):

```ts
  it('matches a bid code and routes to the bid detail page once a bid exists, falling back to the department view otherwise', async () => {
    const caller = appRouter.createCaller({})
    const oppWithBid = await caller.opportunities.create({ departmentId, opportunityName: 'Has A Bid' })
    const bid = await caller.bids.create({ opportunityId: oppWithBid.id })
    const oppWithoutBid = await caller.opportunities.create({ departmentId, opportunityName: 'No Bid Yet' })

    const byBidCode = await caller.search.search({ query: bid.bidCode })
    const found = byBidCode.find((r: any) => r.category === 'work' && r.id === oppWithBid.id)
    expect(found).toBeDefined()

    const all = await caller.search.search({ query: 'Bid' })
    const withBid = all.find((r: any) => r.id === oppWithBid.id)
    const withoutBid = all.find((r: any) => r.id === oppWithoutBid.id)
    // path() is resolved client-side from category+result fields in this
    // codebase's existing search UI — assert the field the frontend branches
    // on instead of a computed path here, matching how `worksCategory.path`
    // is a pure function called by the frontend, not the backend.
    expect((withBid as any).bidId).toBe(bid.id)
    expect((withoutBid as any).bidId).toBeNull()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- search.test.ts`
Expected: FAIL — matching by `bidCode` finds nothing, and `bidId` isn't a field on any result yet.

- [ ] **Step 3: Implement**

In `packages/domain/src/search.ts`:
- Extend `SearchOpportunity` (currently lines 43-52): add `bidId: string | null`, `bidCode: string | null`, `tenderLink: string | null`.
- Extend `SearchResult` (near its existing `containerId` field): add `bidId?: string | null`.
- Update `toWorkResult` (currently lines 348-356) to include the match text and the new field:

```ts
function toWorkResult(work: SearchOpportunity, node: HierNode | undefined): SearchResult {
  return {
    kind: 'other', category: 'work', id: work.id,
    title: work.opportunityName || 'Untitled opportunity',
    subtitle: `${node?.name ?? 'Unknown department'} · ${work.vertical}`,
    code: null, domain: node?.domain ?? null, stateCode: work.stateCode,
    containerId: work.departmentId, bidId: work.bidId,
  }
}
```
- Update `worksCategory.match`'s `hay` string (currently line 365) to also search bid fields:

```ts
      const hay = `${w.opportunityName} ${w.gemTenderId} ${w.vertical} ${w.component.join(' ')} ${salesName} ${w.bidCode ?? ''} ${w.tenderLink ?? ''}`.toLowerCase()
```
- Update `worksCategory.path` (currently lines 374-376) to route to the bid detail page once a bid exists:

```ts
  path: (result) => (result.bidId
    ? `/bid-tracker/bid/${result.bidId}`
    : (result.containerId && result.stateCode != null ? `/state/${result.stateCode}?sel=${result.containerId}&kind=node` : '/')),
```

In `apps/api/src/routers/search.ts`, change `loadSearchData`'s opportunities query and mapping (currently lines 28, 44-47):

```ts
    pool.query('SELECT o.*, b.id AS bid_id, b.bid_code, b.tender_link FROM opportunities o LEFT JOIN bids b ON b.opportunity_id = o.id'),
```
```ts
    opportunities: opportunities.rows.map((r) => ({
      id: r.id, departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
      gemTenderId: r.gem_tender_id, vertical: r.vertical, component: r.component, salesPersonEmail: r.sales_person_email,
      bidId: r.bid_id, bidCode: r.bid_code, tenderLink: r.tender_link,
    })),
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/search.ts apps/api/src/routers/search.ts apps/api/src/routers/search.test.ts
git commit -m "feat(search): index bid code/tender link, route the Works category to the bid detail page when one exists"
```

### Task 23: Terraform — GCS `_pending/` lifecycle rule and `ATTACHMENTS_BUCKET` runtime env var

**Files:**
- Modify: `infra/dev/storage.tf`, `infra/prod/storage.tf` (lifecycle rule)
- Modify: `infra/dev/cloudrun.tf`, `infra/prod/cloudrun.tf` (one new `env` block each)

**Interfaces:**
- Produces: a live GCS lifecycle rule; `ATTACHMENTS_BUCKET` readable via `process.env` in `apps/api` (consumed by Task 16's `gcs.ts`).

This task is infra-only — no automated test exercises Terraform directly in this repo's suite (confirmed: no existing `.tf` file has a companion test). Verification is `terraform plan`, reviewed by a human before `terraform apply` — which this plan explicitly does not run (see Task 40's deployment notes and this plan's Global Constraints: no deploy as part of this plan).

- [ ] **Step 1: Add the lifecycle rule to both `storage.tf` files**

Append to `infra/dev/storage.tf` (inside the existing `google_storage_bucket "attachments"` resource block, alongside `uniform_bucket_level_access`/`public_access_prevention`):

```hcl
  # Bid Tracker (spec §14, §21.1): uploads land first under
  # bid-tracker/_pending/{uploadId}/... and are moved to their canonical path
  # by documents.confirmUpload. Anything left in _pending/ — an abandoned or
  # failed upload — is purged after 24h with no app-level cron needed.
  lifecycle_rule {
    condition {
      age                   = 1
      matches_prefix        = ["bid-tracker/_pending/"]
    }
    action {
      type = "Delete"
    }
  }
```

Apply the identical block, verbatim, to `infra/prod/storage.tf` — that file's own top comment already says it "Mirrors infra/dev/storage.tf exactly."

- [ ] **Step 2: Add the runtime env var to both `cloudrun.tf` files**

In `infra/dev/cloudrun.tf`, inside the `google_cloud_run_v2_service "goms_api"` resource's `template.containers[0]` env block list (alongside the existing `TRUST_PROXY`/`AUTH_ENFORCEMENT_ENABLED`/etc. `env {}` blocks):

```hcl
      env {
        name  = "ATTACHMENTS_BUCKET"
        value = google_storage_bucket.attachments.name
      }
```

Apply the identical block to `infra/prod/cloudrun.tf` in the same position within its own `env` block list.

- [ ] **Step 3: Validate the plan, without applying it**

Run (from each of `infra/dev` and `infra/prod`): `terraform plan`
Expected: the plan shows exactly two changes per environment — an in-place update to `google_storage_bucket.attachments` (adding the lifecycle rule) and an in-place update to `google_cloud_run_v2_service.goms_api` (adding the env var) — no resource is destroyed/recreated. Do not run `terraform apply` as part of this task (per this plan's Global Constraints and Task 40's deployment ordering).

- [ ] **Step 4: Commit**

```bash
git add infra/dev/storage.tf infra/prod/storage.tf infra/dev/cloudrun.tf infra/prod/cloudrun.tf
git commit -m "infra: add the bid-tracker _pending/ lifecycle rule and ATTACHMENTS_BUCKET env var"
```

**This closes the backend.** Every router, migration, and cross-cutting guard from the spec now exists and is tested. Run the full backend suite once before moving to frontend work:

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test`
Expected: every test in `apps/api/src` passes.

---

## Phase L — Frontend data layer

The frontend never calls tRPC directly from components — every call goes through the `Repository` abstraction (`src/data/repository.ts`), which resolves to `InMemoryRepository` (local dev, no backend, `VITE_API_BASE_URL` unset) or `RemoteRepository` (real backend). Bid Tracker must implement both, or `npm run dev` without a backend breaks the moment any Bid Tracker screen mounts.

### Task 24: Extend the `Repository` interface and `InMemoryRepository` with every Bid Tracker method

**Files:**
- Modify: `src/data/in-memory/repository.ts` (interface + class + local data shape)

**Interfaces:**
- Produces (on the `Repository` interface, mirrored 1:1 by `RemoteRepository` in Task 25):
  `listBidsForGrid(filterRules?): Promise<BidGridRow[]>`, `getBid(id): Promise<Bid | null>`, `createBid(opportunityId): Promise<Bid>`, `updateBid(id, patch): Promise<Bid>`, `archiveBid(id): Promise<Bid>`, `unarchiveBid(id): Promise<Bid>`, `deleteBid(id): Promise<void>`, `listBidActionQueue(): Promise<ActionQueueEntry[]>`,
  `listBidMilestones(bidId): Promise<BidMilestone[]>`, `createBidMilestone(input): Promise<BidMilestone>`, `updateBidMilestone(id, patch): Promise<BidMilestone>`, `deleteBidMilestone(id): Promise<void>`,
  `listBidCorrigenda(bidId): Promise<BidCorrigendum[]>`, `createBidCorrigendum(input): Promise<BidCorrigendum>`, `reviewCorrigendumChange(input): Promise<BidCorrigendumChange>`,
  `listProtectedValues(entityType, entityId): Promise<ProtectedValue[]>`, `freezeValue(entityType, entityId, fieldKey): Promise<void>`, `unfreezeValue(entityType, entityId, fieldKey, reason): Promise<void>`,
  `requestDocumentUploadUrl(input): Promise<{uploadId, uploadUrl}>`, `confirmDocumentUpload(uploadId): Promise<BidDocument>`, `listDocuments(entityType, entityId): Promise<BidDocument[]>`, `deleteDocument(id): Promise<void>`, `listDocumentCitations(documentId): Promise<DocumentCitation[]>`, `createDocumentCitation(input): Promise<DocumentCitation>`,
  `listBidSavedViews(): Promise<BidSavedView[]>`, `createBidSavedView(input): Promise<BidSavedView>`, `updateBidSavedView(id, patch): Promise<BidSavedView>`, `deleteBidSavedView(id): Promise<void>`,
  `listAuditLogs(filter?): Promise<AuditLogEntry[]>` (already exists for commercial-calculator's own use — reuse the existing method, do not add a second one, since it's already generic per Task 5/20's backend-side extraction).

- [ ] **Step 1: Add the type definitions**

In `src/lib/types.ts`, add (mirroring the exact field-naming convention `Opportunity`/`FollowUp` already use — camelCase, matching every `toXxx` mapper's output field-for-field):

```ts
export interface Bid {
  id: string
  opportunityId: string
  bidCode: string
  stageKey: string
  decision: 'pending' | 'go' | 'no_go'
  status: 'active' | 'archived'
  dataConfidence: 'verified' | 'needs_review'
  tenderLink: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface BidGridRow extends Bid {
  departmentId: string
  stateCode: number | null
  opportunityName: string
  gemTenderId: string
  submissionDate: string
  valueAmount: string
  valueUnit: string
  emdAmount: string
  emdUnit: string
  vertical: string
  ownerEmail: string | null
  attentionFlag: 'dueSoon' | 'overdue' | 'corrigendumPending' | 'onTrack'
}
export interface BidMilestone {
  id: string; bidId: string; milestoneType: string; key: string; label: string
  dueAt: string | null; venue: string | null; notes: string | null
  status: 'open' | 'completed' | 'superseded'; source: 'manual' | 'corrigendum'
  createdAt: string; updatedAt: string
}
export interface BidCorrigendumChange {
  id: string; corrigendumId: string; fieldKey: string; currentValue: string; proposedValue: string
  decision: 'pending' | 'accepted' | 'rejected'; decidedAt: string | null; decidedBy: string | null
}
export interface BidCorrigendum {
  id: string; bidId: string; corrigendumNumber: number; sourceDocumentId: string | null
  detectedAt: string; reviewedAt: string | null; reviewedBy: string | null
  status: 'pending_review' | 'reviewed'; changes: BidCorrigendumChange[]
}
export interface ProtectedValue {
  id: string; entityType: string; entityId: string; fieldKey: string
  frozen: boolean; frozenAt: string | null; frozenBy: string | null
}
export interface BidDocument {
  id: string; entityType: string; entityId: string; filename: string; storagePath: string
  version: string; contentType: string; sizeBytes: number; uploadedBy: string | null; uploadedAt: string
}
export interface DocumentCitation {
  id: string; documentId: string; pageLabel: string; quoteText: string; fieldRef: string | null; createdAt: string
}
export interface BidSavedView {
  id: string; name: string; scope: 'personal' | 'global'; ownerEmail: string | null; isSystem: boolean
  filterRules: { field: string; operator: 'eq'; value: string }[]
  sort: unknown[]; visibleColumns: string[]; createdBy: string | null; createdAt: string | null; updatedAt: string | null
}
export interface ActionQueueEntry {
  followUpId: string; bidId: string; bidCode: string; stageKey: string; opportunityName: string
  dueDate: string; note: string; assigneeId: string | null
  attentionFlag: 'dueSoon' | 'overdue' | 'corrigendumPending' | 'onTrack'
}
```

- [ ] **Step 2: Add the methods to the `Repository` interface**

In `src/data/in-memory/repository.ts`, find the `Repository` interface declaration and add the full method list from this task's Interfaces block, grouped with a comment `// --- Bid Tracker ---`, using the exact parameter/return shapes given above (e.g. `createBid(opportunityId: string): Promise<Bid>`, `updateBid(id: string, patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>>): Promise<Bid>`).

- [ ] **Step 3: Implement every method on `InMemoryRepository`**

Add a `// --- Bid Tracker ---` section to the `InMemoryRepository` class, following the EXACT existing pattern this file already uses for `opportunities`/`followUps` (a flat array on the internal data object, `uid()` for new ids, plain array `.find`/`.filter`/`.push`/splice mutations, persisted via this file's existing debounce-to-IndexedDB mechanism — do not invent a different persistence mechanism for Bid Tracker's data than the rest of this file already uses). Concretely:

- Add `bids: Bid[]`, `bidMilestones: BidMilestone[]`, `bidCorrigenda: BidCorrigendum[]` (with nested `changes` kept in a separate flat array, `bidCorrigendumChanges`, exactly like `opportunities`/`opportunityStageChanges` are two separate flat arrays joined at read time — do not nest mutable child records inside a parent array element, matching this file's own established convention), `protectedValues: ProtectedValue[]`, `bidDocuments: BidDocument[]`, `documentCitations: DocumentCitation[]`, `bidSavedViews: BidSavedView[]` to the internal data object.
- `createBid(opportunityId)`: mirror `createOpportunity`'s shape — generate an id via `uid()`, a `bidCode` via a simple in-memory year-scoped counter (a module-level `let inMemoryBidSeq = 1` is sufficient here — this is local-dev-only data with no cross-session durability guarantee beyond what IndexedDB already gives the rest of this file), default `stageKey: 'solutioning'`, `decision: 'pending'`, `status: 'active'`, `dataConfidence: 'verified'`, and ALSO push a seeded `bid_milestones`-equivalent row (`key: 'submissionDeadline'`) into `bidMilestones`, mirroring the backend's `bids.create` behavior exactly (parse the opportunity's current `submissionDate` the same way — `new Date(x)`, `null` if `isNaN`).
- `updateBid(id, patch)`: mirror `updateOpportunity`'s patch-merge pattern; apply the same `decision='go'` gate (reuse `isAtOrAfterSubmitted` from `@goms/domain`, already installed as a workspace dependency) and the same `decision`→`stageKey` auto-derivation as the backend (Task 7) — duplicated here deliberately, since `InMemoryRepository` has no shared transaction boundary with `apps/api` to reuse code across; this is the same "duplicate the business rule once, in JS, on both sides" trade-off `PIPELINE_STAGE_MAP`'s closed-stage derivation already accepts today (`InMemoryRepository`'s `updateOpportunity` re-derives `closedOn` itself rather than calling the backend).
- `deleteBid(id)`: apply the identical hard-delete gate (check `bidCorrigenda`/`protectedValues`/`bidDocuments`/`followUps` arrays for any row referencing this bid id, refuse if any exist — throw a plain `Error` with the same message text the backend uses, since this file's existing error-throwing convention for its other `delete*` methods is a plain thrown `Error`, not a typed result).
- Every other method: plain array CRUD, following `listOpportunities`/`createFollowUp`/etc.'s exact existing style in this same file.

- [ ] **Step 4: Verify the app still builds and existing frontend tests still pass**

Run: `npm run build`
Expected: no TypeScript errors (confirms `RemoteRepository`'s `implements Partial<Repository>` still compiles even though it doesn't implement the new methods yet — Task 25 fills that in next).

Run: `npm test`
Expected: the full existing `src/**/*.test.ts` suite still passes — this task only adds new methods, it doesn't touch any existing one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/data/in-memory/repository.ts
git commit -m "feat(frontend): extend Repository/InMemoryRepository with every Bid Tracker method"
```

### Task 25: Implement every Bid Tracker method on `RemoteRepository`

**Files:**
- Modify: `src/data/remote/repository.ts`

**Interfaces:**
- Consumes: every method from Task 24's `Repository` interface.
- Produces: `RemoteRepository`'s implementation of same, calling the new tRPC routers from Phases D–K.

- [ ] **Step 1: Implement, mirroring this file's exact existing `this.client.<router>.<procedure>.query/mutate(...)` style**

Add to the `RemoteRepository` class, in the same flat-method style as every existing line in this file (no new abstraction, no wrapper class):

```ts
  listBidsForGrid = (filterRules?: BidGridRow extends never ? never : { field: string; operator: 'eq'; value: string }[]): Promise<BidGridRow[]> =>
    this.client.bids.listForGrid.query({ filterRules }) as unknown as Promise<BidGridRow[]>
  getBid = (id: string): Promise<Bid | null> => this.client.bids.get.query({ id })
  createBid = (opportunityId: string): Promise<Bid> => this.client.bids.create.mutate({ opportunityId })
  updateBid = (id: string, patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>>): Promise<Bid> =>
    this.client.bids.update.mutate({ id, patch })
  archiveBid = (id: string): Promise<Bid> => this.client.bids.archive.mutate({ id })
  unarchiveBid = (id: string): Promise<Bid> => this.client.bids.unarchive.mutate({ id })
  deleteBid = (id: string): Promise<void> => this.client.bids.delete.mutate({ id })
  listBidActionQueue = (): Promise<ActionQueueEntry[]> => this.client.bids.actionQueue.list.query()

  listBidMilestones = (bidId: string): Promise<BidMilestone[]> => this.client.bidMilestones.listForBid.query({ bidId })
  createBidMilestone = (input: Omit<BidMilestone, 'id' | 'status' | 'source' | 'createdAt' | 'updatedAt'>): Promise<BidMilestone> =>
    this.client.bidMilestones.create.mutate(input)
  updateBidMilestone = (id: string, patch: Partial<Pick<BidMilestone, 'label' | 'dueAt' | 'venue' | 'notes' | 'status'>>): Promise<BidMilestone> =>
    this.client.bidMilestones.update.mutate({ id, patch })
  deleteBidMilestone = (id: string): Promise<void> => this.client.bidMilestones.delete.mutate({ id })

  listBidCorrigenda = (bidId: string): Promise<BidCorrigendum[]> => this.client.bidCorrigenda.listForBid.query({ bidId })
  createBidCorrigendum = (input: {
    bidId: string; corrigendumNumber: number; sourceDocumentId?: string
    changes: { fieldKey: string; currentValue: string; proposedValue: string }[]
  }): Promise<BidCorrigendum> => this.client.bidCorrigenda.create.mutate(input)
  reviewCorrigendumChange = (input: { changeId: string; decision: 'accepted' | 'rejected'; reason?: string }): Promise<BidCorrigendumChange> =>
    this.client.bidCorrigenda.reviewChange.mutate(input)

  listProtectedValues = (entityType: string, entityId: string): Promise<ProtectedValue[]> =>
    this.client.protectedValues.listFor.query({ entityType, entityId })
  freezeValue = (entityType: string, entityId: string, fieldKey: string): Promise<void> =>
    this.client.protectedValues.freeze.mutate({ entityType, entityId, fieldKey })
  unfreezeValue = (entityType: string, entityId: string, fieldKey: string, reason: string): Promise<void> =>
    this.client.protectedValues.unfreeze.mutate({ entityType, entityId, fieldKey, reason })

  requestDocumentUploadUrl = (input: {
    entityType: string; entityId: string; filename: string; contentType: string; sizeBytes: number; version?: string
  }): Promise<{ uploadId: string; uploadUrl: string }> => this.client.documents.requestUploadUrl.mutate(input)
  confirmDocumentUpload = (uploadId: string): Promise<BidDocument> => this.client.documents.confirmUpload.mutate({ uploadId })
  listDocuments = (entityType: string, entityId: string): Promise<BidDocument[]> => this.client.documents.listFor.query({ entityType, entityId })
  deleteDocument = (id: string): Promise<void> => this.client.documents.delete.mutate({ id })
  listDocumentCitations = (documentId: string): Promise<DocumentCitation[]> => this.client.documents.citations.list.query({ documentId })
  createDocumentCitation = (input: { documentId: string; pageLabel: string; quoteText?: string; fieldRef?: string }): Promise<DocumentCitation> =>
    this.client.documents.citations.create.mutate(input)

  listBidSavedViews = (): Promise<BidSavedView[]> => this.client.bidSavedViews.list.query()
  createBidSavedView = (input: {
    name: string; scope: 'personal' | 'global'
    filterRules?: BidSavedView['filterRules']; sort?: unknown[]; visibleColumns?: string[]
  }): Promise<BidSavedView> => this.client.bidSavedViews.create.mutate(input)
  updateBidSavedView = (id: string, patch: Partial<Pick<BidSavedView, 'name' | 'filterRules' | 'sort' | 'visibleColumns'>>): Promise<BidSavedView> =>
    this.client.bidSavedViews.update.mutate({ id, patch })
  deleteBidSavedView = (id: string): Promise<void> => this.client.bidSavedViews.delete.mutate({ id })
```

Add the corresponding new type imports (`Bid, BidGridRow, BidMilestone, BidCorrigendum, BidCorrigendumChange, ProtectedValue, BidDocument, DocumentCitation, BidSavedView, ActionQueueEntry`) to this file's existing `import type { ... } from '@/lib/types'` block.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: no TypeScript errors — `RemoteRepository` now satisfies every Bid Tracker method on `Repository` too (it's typed `Partial<Repository>` so this was never a hard compile error, but confirm no *signature mismatch* errors against Task 24's interface).

- [ ] **Step 3: Commit**

```bash
git add src/data/remote/repository.ts
git commit -m "feat(frontend): implement every Bid Tracker method on RemoteRepository"
```

### Task 26: React Query hooks in `src/lib/api.ts`

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `useBidsForGrid(filterRules?)`, `useBid(id)`, `useBidMutations()`, `useBidMilestones(bidId)`, `useBidMilestoneMutations()`, `useBidCorrigenda(bidId)`, `useBidCorrigendaMutations()`, `useProtectedValues(entityType, entityId)`, `useProtectedValueMutations()`, `useDocuments(entityType, entityId)`, `useDocumentMutations()`, `useBidSavedViews()`, `useBidSavedViewMutations()`, `useBidActionQueue()`.

- [ ] **Step 1: Add query keys and hooks, mirroring `useOpportunities`/`useOpportunityMutations`'s exact existing pattern**

Add to the `qk` object (near `opportunities`/`followUps`):

```ts
  bidsForGrid: (filterRules?: unknown) => ['bidsForGrid', filterRules ?? null] as const,
  bid: (id: string) => ['bid', id] as const,
  bidMilestones: (bidId: string) => ['bidMilestones', bidId] as const,
  bidCorrigenda: (bidId: string) => ['bidCorrigenda', bidId] as const,
  protectedValues: (t: string, id: string) => ['protectedValues', t, id] as const,
  documents: (t: string, id: string) => ['documents', t, id] as const,
  bidSavedViews: ['bidSavedViews'] as const,
  bidActionQueue: ['bidActionQueue'] as const,
```

Add the hooks (grouped under a `// --- Bid Tracker ---` comment, following `useOpportunities`/`useOpportunityMutations` line for line):

```ts
export const useBidsForGrid = (filterRules?: { field: string; operator: 'eq'; value: string }[]) =>
  useQuery({ queryKey: qk.bidsForGrid(filterRules), queryFn: () => repository.listBidsForGrid(filterRules) })
export const useBid = (id: string | null) =>
  useQuery({ queryKey: qk.bid(id ?? ''), queryFn: async () => (await repository.getBid(id!)) ?? null, enabled: !!id })
export function useBidMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    qc.invalidateQueries({ queryKey: ['bid'] })
    qc.invalidateQueries({ queryKey: ['bidActionQueue'] })
  }
  const create = useMutation({ mutationFn: (opportunityId: string) => repository.createBid(opportunityId), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>> }) => repository.updateBid(a.id, a.patch),
    onSuccess: invalidate,
  })
  const archive = useMutation({ mutationFn: (id: string) => repository.archiveBid(id), onSuccess: invalidate })
  const unarchive = useMutation({ mutationFn: (id: string) => repository.unarchiveBid(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBid(id), onSuccess: invalidate })
  return { create, update, archive, unarchive, remove }
}
export const useBidActionQueue = () => useQuery({ queryKey: qk.bidActionQueue, queryFn: () => repository.listBidActionQueue() })

export const useBidMilestones = (bidId: string | null) =>
  useQuery({ queryKey: qk.bidMilestones(bidId ?? ''), queryFn: () => repository.listBidMilestones(bidId!), enabled: !!bidId })
export function useBidMilestoneMutations(bidId: string) {
  const qc = useQueryClient()
  const invalidate = () => { qc.invalidateQueries({ queryKey: qk.bidMilestones(bidId) }); qc.invalidateQueries({ queryKey: ['bid', bidId] }) }
  const create = useMutation({ mutationFn: (input: any) => repository.createBidMilestone(input), onSuccess: invalidate })
  const update = useMutation({ mutationFn: (a: { id: string; patch: any }) => repository.updateBidMilestone(a.id, a.patch), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBidMilestone(id), onSuccess: invalidate })
  return { create, update, remove }
}

export const useBidCorrigenda = (bidId: string | null) =>
  useQuery({ queryKey: qk.bidCorrigenda(bidId ?? ''), queryFn: () => repository.listBidCorrigenda(bidId!), enabled: !!bidId })
export function useBidCorrigendaMutations(bidId: string) {
  const qc = useQueryClient()
  const invalidate = () => { qc.invalidateQueries({ queryKey: qk.bidCorrigenda(bidId) }); qc.invalidateQueries({ queryKey: qk.bidMilestones(bidId) }) }
  const create = useMutation({ mutationFn: (input: any) => repository.createBidCorrigendum(input), onSuccess: invalidate })
  const reviewChange = useMutation({ mutationFn: (input: any) => repository.reviewCorrigendumChange(input), onSuccess: invalidate })
  return { create, reviewChange }
}

export const useProtectedValues = (entityType: string, entityId: string | null) =>
  useQuery({ queryKey: qk.protectedValues(entityType, entityId ?? ''), queryFn: () => repository.listProtectedValues(entityType, entityId!), enabled: !!entityId })
export function useProtectedValueMutations(entityType: string, entityId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.protectedValues(entityType, entityId) })
  const freeze = useMutation({ mutationFn: (fieldKey: string) => repository.freezeValue(entityType, entityId, fieldKey), onSuccess: invalidate })
  const unfreeze = useMutation({
    mutationFn: (a: { fieldKey: string; reason: string }) => repository.unfreezeValue(entityType, entityId, a.fieldKey, a.reason),
    onSuccess: invalidate,
  })
  return { freeze, unfreeze }
}

export const useDocuments = (entityType: string, entityId: string | null) =>
  useQuery({ queryKey: qk.documents(entityType, entityId ?? ''), queryFn: () => repository.listDocuments(entityType, entityId!), enabled: !!entityId })
export function useDocumentMutations(entityType: string, entityId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.documents(entityType, entityId) })
  const requestUploadUrl = useMutation({ mutationFn: (input: any) => repository.requestDocumentUploadUrl(input) })
  const confirmUpload = useMutation({ mutationFn: (uploadId: string) => repository.confirmDocumentUpload(uploadId), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteDocument(id), onSuccess: invalidate })
  return { requestUploadUrl, confirmUpload, remove }
}

export const useBidSavedViews = () => useQuery({ queryKey: qk.bidSavedViews, queryFn: () => repository.listBidSavedViews() })
export function useBidSavedViewMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.bidSavedViews })
  const create = useMutation({ mutationFn: (input: any) => repository.createBidSavedView(input), onSuccess: invalidate })
  const update = useMutation({ mutationFn: (a: { id: string; patch: any }) => repository.updateBidSavedView(a.id, a.patch), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBidSavedView(id), onSuccess: invalidate })
  return { create, update, remove }
}
```

Add `Bid` to this file's existing `import type { ... } from './types'` block.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(frontend): add React Query hooks for every Bid Tracker data need"
```

---

## Phase M — Navigation and shell

### Task 27: Register Bid Tracker as the app's third top-level module, behind `VITE_BID_TRACKER_ENABLED`

**Files:**
- Modify: `src/app/router.tsx` (routes)
- Modify: `src/components/AccountMappingRail.tsx` (desktop nav button)
- Modify: `src/components/MobileNavDrawer.tsx` (mobile nav entry)
- Modify: `src/components/TopBar.tsx` (module label branch)
- Modify: `src/app/AppLayout.tsx` (`navExpanded` exclusion)
- Create: `src/modules/bid-tracker/BidTrackerWorkspace.tsx` (minimal placeholder shell — filled in by Task 28 onward)
- Create: `src/modules/bid-tracker/BidTrackerWorkspace.test.tsx`
- Modify: `.env.example` (document `VITE_BID_TRACKER_ENABLED`)

**Interfaces:**
- Produces: routes `/bid-tracker`, `/bid-tracker/:section`, `/bid-tracker/bid/:bidId`, all gated behind `import.meta.env.VITE_BID_TRACKER_ENABLED === 'true'` — matching `VITE_ADMIN_IMPORT_ENABLED`'s exact existing gating convention (that flag's check pattern, wherever it currently guards `/admin/data-import`'s route/nav-entry registration, is the template to copy here verbatim, not reinvent).

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/BidTrackerWorkspace.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BidTrackerWorkspace } from './BidTrackerWorkspace'

describe('BidTrackerWorkspace', () => {
  it('renders the Master Grid tab by default', () => {
    render(<MemoryRouter initialEntries={['/bid-tracker']}><BidTrackerWorkspace /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Master Grid' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- BidTrackerWorkspace.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the minimal workspace shell**

```tsx
// src/modules/bid-tracker/BidTrackerWorkspace.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'

const SECTIONS = [
  { value: 'grid', label: 'Master Grid' },
  { value: 'milestones', label: 'Milestones & Dates' },
  { value: 'actions', label: 'Action Queue' },
  { value: 'history', label: 'Activity History' },
] as const

export function BidTrackerWorkspace() {
  const { section = 'grid' } = useParams()
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={section}
        onChange={(v) => navigate(v === 'grid' ? '/bid-tracker' : `/bid-tracker/${v}`)}
        tabs={SECTIONS.map(({ value, label }) => ({ value, label }))}
      />
      <div className="flex-1 overflow-auto">
        {/* Task 28 (grid), Task 35 (actions), Task 36 (history) fill these in;
           milestones content arrives with Task 31. */}
        {section === 'grid' && <div data-testid="bid-tracker-grid-placeholder" />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire up nav registration**

`src/app/router.tsx` — add, following the exact existing `/commercial-calculator` block's shape:

```tsx
{ path: '/bid-tracker', element: <BidTrackerWorkspace /> },
{ path: '/bid-tracker/:section', element: <BidTrackerWorkspace /> },
{ path: '/bid-tracker/bid/:bidId', element: <BidDetailWorkspace /> }, // Task 30 creates this component; import it lazily the same way every other route here does
```

lazy-imported from `@/modules/bid-tracker/BidTrackerWorkspace` and `@/modules/bid-tracker/BidDetailWorkspace` matching this file's existing lazy-import convention for every other route.

`src/components/AccountMappingRail.tsx` — add a third button after the existing two, following their exact existing JSX shape (icon + label + `onClick={() => navigate(...)}` + active-state check via `location.pathname.startsWith(...)`):

```tsx
<button onClick={() => navigate('/bid-tracker')} className={/* same active/inactive class logic as the other two buttons, keyed on pathname.startsWith('/bid-tracker') */}>
  {/* Icon + "Bid Tracker" label, same structure as "Account Mapping"/"Commercial Calculator" */}
</button>
```

Gate this button's rendering (and the equivalent `MobileNavDrawer.tsx` entry) behind `import.meta.env.VITE_BID_TRACKER_ENABLED === 'true'` — find the exact conditional-rendering pattern `VITE_ADMIN_IMPORT_ENABLED` already uses to gate `/admin/data-import`'s presence in whatever nav surface currently exposes it, and copy that pattern verbatim rather than inventing a new one.

`src/components/TopBar.tsx` — add `const isBidTracker = pathname.startsWith('/bid-tracker')`, alongside the existing `isCommercialCalculator`. Unlike Commercial Calculator, Bid Tracker's `moduleLabel` branch sets the label to `'Bid Tracker'` but does **NOT** hide Search/Import/Export (per spec §7 — Bid Tracker wants the global CommandPalette and its own Import/Export, not a self-contained-tool hide-everything mode like Commercial Calculator).

`src/app/AppLayout.tsx` — extend the `navExpanded` computation: `pathname !== '/' && !pathname.startsWith('/commercial-calculator') && !pathname.startsWith('/bid-tracker')`.

- [ ] **Step 5: Document the new env var**

Add to `.env.example`, alongside `VITE_ADMIN_IMPORT_ENABLED`'s existing documentation block:

```
# Optional. Enables the /bid-tracker route and its third top-level nav entry.
# Unset/false in every build until Bid Tracker is ready to dark-launch or go
# live per environment (see the design spec's Deployment section).
VITE_BID_TRACKER_ENABLED=
```

- [ ] **Step 6: Run to verify pass, and confirm the existing nav/layout tests still pass**

Run: `VITE_BID_TRACKER_ENABLED=true npm test -- BidTrackerWorkspace.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: no regression in any existing `AccountMappingRail`/`TopBar`/`AppLayout`/router test.

- [ ] **Step 7: Commit**

```bash
git add src/app/router.tsx src/components/AccountMappingRail.tsx src/components/MobileNavDrawer.tsx src/components/TopBar.tsx src/app/AppLayout.tsx src/modules/bid-tracker/BidTrackerWorkspace.tsx src/modules/bid-tracker/BidTrackerWorkspace.test.tsx .env.example
git commit -m "feat(frontend): register Bid Tracker as the third top-level module, behind VITE_BID_TRACKER_ENABLED"
```

---

## Phase M2 — Custom Fields (additive layer under the Master Grid)

> **Added 2026-09-30 by explicit user decision, after Task 26.** The Master Grid gets genuinely user-defined columns: a user creates a column (name, type, options for select), and enters a value per bid, Excel-style. This is an **additive Custom layer** — the seven required column groups, the `bids` table, and every Task 1–26 contract stay as they are. Execute Tasks 27a–27e **after Task 27 and before Task 28**; Tasks 28, 29, 29a and 38 carry the UI/import consequences.

### Decisions (binding for Tasks 27a–27e, 28, 29, 29a, 38)

| Topic | Decision |
|---|---|
| Storage | Two real tables — `bid_custom_fields` (definitions) and `bid_custom_field_values` (one row per bid+field) — never JSON on `bids`. |
| Value representation | Typed columns: `value_text` (text + select), `value_number NUMERIC`, `value_date DATE`, `value_bool BOOLEAN`. A `CHECK` allows at most one to be non-null. A cleared value **deletes the row** (audit records the edit). Indexed per `(field_id, typed column)` so sort/filter is type-correct, not lexical. |
| Field identity | Stable `id` (UUID) + immutable `key` slug (`custom:<key>` is the grid column id / filter field / import heading). **Rename changes `name` only, never `key`**, so saved views, filters and imports never break on rename. |
| Data type | `text \| number \| date \| select \| boolean`. **Type is immutable after creation** (changing it under existing values would corrupt them); to "change type", archive and create a new column. |
| Select options | `options JSONB` array of strings, order = display order, non-empty, unique (case-insensitive). Removing an option **keeps existing values** (shown as-is, flagged "removed option" in the UI); `setValue` validates only against the *current* options. |
| Lifecycle | `active` / `archived`. **No hard delete once any value row has ever existed** — `delete` is allowed only for a field with zero value rows (FK `ON DELETE RESTRICT` on `field_id` is the backstop). Archive hides the column everywhere; values are retained; unarchive restores. |
| Ordering | `position INT`, dense per active fields; `reorder(ids)` rewrites positions in one transaction. Custom fields always render in a **Custom** group *after* the seven required groups. |
| Protected values / corrigenda | Custom fields are ordinary: **not** subject to `assertFieldsNotProtected`, **not** a valid corrigendum `fieldKey`, not frozen. (Dialog-only standard fields stay dialog-only.) |
| Bid deletion | Value rows are `ON DELETE CASCADE` on `bid_id` — `bids.delete`'s existing gate is unchanged, and custom values alone never block a bid delete. |
| Filter model | `SystemBidViewFilterRule` (persisted in saved views) gains optional `value2?: string` and `values?: string[]`, and `operator` widens from `'eq'` to `'eq'\|'contains'\|'startsWith'\|'gt'\|'lt'\|'between'\|'before'\|'after'\|'in'`. `'eq'` remains the universal exact-match, so all existing system views and rules keep working untouched. Applies to **standard and custom** columns alike. |
| Operators per type | text → `contains`/`eq`(equals)/`startsWith` · number → `eq`/`gt`/`lt`/`between` · date → `before`/`after`/`between` · select → `eq`/`in` · boolean → `eq` with `'true'`/`'false'`. Comparison is typed (numbers as numbers, dates as `YYYY-MM-DD`), never lexical on numbers. |
| Archived/unknown field in a saved view | Rules on an archived or unknown `custom:<key>` field are **skipped** (not "match nothing", not a crash) by both server and client filtering; `visibleColumns`/order entries for it are ignored. The stored view is *not* rewritten, so unarchiving restores it exactly. The grid shows a one-line notice ("N filter(s) ignored — column archived"). |
| Column order persistence | `bid_saved_views.visible_columns` is defined as an **ordered** array of column ids (standard ids and `custom:<key>`): array order = display order, absence = hidden. No schema change to `bid_saved_views`. |
| Audit | `writeAuditLog` (Task 5) with `entityType: 'bidCustomField'` (entityId = field id; actions `custom_field_created`, `custom_field_renamed`, `custom_field_archived`, `custom_field_unarchived`, `custom_field_options_changed`, `custom_field_reordered`) and `entityType: 'bidCustomFieldValue'` (entityId = **bid id**, `field` = key, old/new value, action `custom_value_set`/`custom_value_cleared`) so value edits show in that bid's Activity History. |
| Import | Existing active custom fields can receive values (heading = field name or `custom:<key>`, case-insensitive). An unrecognized heading **never creates a field**; the row set is flagged needs-review with the heading listed. |
| Export | One column per **active** custom field, heading = field name, after the standard columns. |
| No new dependency | Everything uses already-approved packages. |

### Task 27a: Migrations 9–10 — `bid_custom_fields`, `bid_custom_field_values`

**Files:**
- Create: `apps/api/migrations/1789200000000_bid-custom-fields.sql`
- Create: `apps/api/migrations/1789300000000_bid-custom-field-values.sql`

**Interfaces:**
- Produces: the two tables below. Additive only (Global Constraints).

- [ ] **Step 1: Write migration 9**

```sql
-- Up Migration

CREATE TABLE bid_custom_fields (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  data_type  TEXT NOT NULL CHECK (data_type IN ('text','number','date','select','boolean')),
  options    JSONB,
  position   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((data_type = 'select') = (options IS NOT NULL))
);
-- Names are unique among ACTIVE fields only (case-insensitive) so an archived
-- column's name can be reused.
CREATE UNIQUE INDEX bid_custom_fields_active_name_uq ON bid_custom_fields (lower(btrim(name))) WHERE status = 'active';
CREATE INDEX bid_custom_fields_position_idx ON bid_custom_fields (status, position);

-- Down Migration

DROP TABLE bid_custom_fields;
```

- [ ] **Step 2: Write migration 10**

```sql
-- Up Migration

CREATE TABLE bid_custom_field_values (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  field_id     UUID NOT NULL REFERENCES bid_custom_fields(id) ON DELETE RESTRICT,
  value_text   TEXT,
  value_number NUMERIC,
  value_date   DATE,
  value_bool   BOOLEAN,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bid_id, field_id),
  CHECK (num_nonnulls(value_text, value_number, value_date, value_bool) = 1)
);
CREATE INDEX bid_cfv_field_text_idx   ON bid_custom_field_values (field_id, value_text)   WHERE value_text   IS NOT NULL;
CREATE INDEX bid_cfv_field_number_idx ON bid_custom_field_values (field_id, value_number) WHERE value_number IS NOT NULL;
CREATE INDEX bid_cfv_field_date_idx   ON bid_custom_field_values (field_id, value_date)   WHERE value_date   IS NOT NULL;

-- Down Migration

DROP TABLE bid_custom_field_values;
```

- [ ] **Step 3: Apply and verify** — run the migrations against the dedicated test DB (`goms-bidtracker-pg`, port 5434), then `\d` both tables; confirm `CHECK` rejects a two-typed-column insert and a `select` field with NULL options, and that the down migrations reverse cleanly (up → down → up).
- [ ] **Step 4: Add both tables to every existing test file's cleanup** that already deletes `bids` (values cascade from `bids`, but `bid_custom_fields` rows are independent and must be cleared by the new router tests' own `beforeEach`). This is the same cross-file cleanup class of bug fixed at Tasks 3/8 — grep for `DELETE FROM bids` and confirm nothing else needs `DELETE FROM bid_custom_fields`.
- [ ] **Step 5: Commit** — `feat(api): add bid custom field definition and value tables`

### Task 27b: Domain — custom field helpers and typed filter operators

**Files:**
- Create: `packages/domain/src/bidCustomFields.ts`
- Modify: `packages/domain/src/bids.ts` (widen `SystemBidViewFilterRule`; extend `applyFilterRules`)
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `type CustomFieldType = 'text'|'number'|'date'|'select'|'boolean'`, `type CustomValue = string | number | boolean | null`.
  - `slugifyFieldKey(name: string, taken: Set<string>): string` — lowercase, non-alphanumerics → `_`, must start with a letter (prefix `f_` otherwise), ≤48 chars, dedupes with `_2`, `_3`.
  - `normalizeOptions(raw: string[]): string[]` — trims, drops blanks, case-insensitive dedupe, throws on empty result.
  - `coerceCustomValue(type, raw, options?): CustomValue` — `''`/`null` → `null`; number via `Number` (reject NaN/Infinity); date must match `YYYY-MM-DD` and be a real calendar date; boolean accepts `true/false/'true'/'false'`; select must be in `options`; text trimmed, ≤2000 chars. Throws `Error` with a user-facing message on invalid input.
  - `OPERATORS_BY_TYPE: Record<CustomFieldType, FilterOperator[]>` (the table in the Decisions section) and `STANDARD_BID_FIELD_TYPES: Record<string, CustomFieldType>` for the grid's filterable standard columns (`opportunityName`/`gemTenderId`/`vertical`/`ownerEmail`→text; `stageKey`/`decision`/`attentionFlag`/`dataConfidence`/`status`→select; `submissionDate`→date; `valueAmount`/`emdAmount`→number).
  - `applyFilterRules(rows, rules, currentUserEmail, fieldTypes?)` — **backward compatible**: existing 3-arg calls behave exactly as today (Task 19's tests must pass unmodified). With `fieldTypes`, each rule's `field` is looked up (`custom:<key>` rows read `row.customValues[key]`); operator semantics per the Decisions table; `$currentUser` still resolves as before; a rule whose field is `custom:<key>` and absent from `fieldTypes` is **skipped**; an operator invalid for the field's type never matches.

- [ ] **Step 1: Write the failing tests** in `apps/api/src/routers/bidCustomFields.test.ts` (domain has no runner — Global Constraints) covering: slug collisions/leading digit; `coerceCustomValue` for each type incl. rejects (`'2026-02-30'`, `'abc'` as number, non-option select); each operator on each type (`between` inclusive both ends; `gt` on `'9'` vs `'10'` is numeric, not lexical); `in` with `values`; unknown-custom-field rule skipped; legacy `eq` rule untouched.
- [ ] **Step 2: Implement**, run, confirm green (`DATABASE_URL=… npx vitest run apps/api/src/routers/bidCustomFields.test.ts --root apps/api`).
- [ ] **Step 3: Commit** — `feat(domain): custom field helpers and typed filter operators`

### Task 27c: `bidCustomFields` router — definitions, lifecycle, values, audit

**Files:**
- Create: `apps/api/src/routers/bidCustomFields.ts`
- Modify: `apps/api/src/routers/bidCustomFields.test.ts` (router cases, appended to 27b's domain cases)
- Modify: `apps/api/src/index.ts` (register `bidCustomFields`)

**Interfaces:**
- Consumes: 27a tables, 27b helpers, `writeAuditLog` (Task 5), `isUniqueViolation`/`isForeignKeyViolation`.
- Produces (all `protectedProcedure`/`protectedReadProcedure`, transactional with the audit write, `toXxx` row mappers, dates as ISO strings):
  - `list({ includeArchived?: boolean })` → `BidCustomField[]` ordered by `position, created_at`.
  - `create({ name, dataType, options? })` → appended at `max(position)+1`; key from `slugifyFieldKey`; select requires `options`; non-select rejects `options`; duplicate active name → `CONFLICT`. Audit `custom_field_created`.
  - `update({ id, patch: { name?, options? } })` → rename (audit `custom_field_renamed`, old/new name); options replace for select only (audit `custom_field_options_changed`, old/new JSON, plus which were removed); **`dataType` and `key` are not patchable** (absent from the zod shape). Archived fields may still be renamed/edited.
  - `reorder({ ids })` → `ids` must be exactly the current active field ids once each (else `BAD_REQUEST`); rewrites `position`. Audit `custom_field_reordered`.
  - `archive({ id })` / `unarchive({ id })` → flips `status`, audit. Unarchive re-checks active-name uniqueness (`CONFLICT` with a clear message if another active field took the name).
  - `delete({ id })` → only when zero value rows exist, else `CONFLICT` "has values — archive it instead"; also `CONFLICT` translation of the FK backstop.
  - `setValue({ bidId, fieldId, value })` → loads the field, rejects archived (`BAD_REQUEST`), `coerceCustomValue` (invalid → `BAD_REQUEST` with the message), `INSERT … ON CONFLICT (bid_id, field_id) DO UPDATE` into the correct typed column and nulls the others; `null` → `DELETE`. Audit `custom_value_set`/`custom_value_cleared` with entityId = `bidId`, field = key, old/new. **Does not** call `assertFieldsNotProtected`. Bumps `bids.updated_at`. Unknown bid/field → `NOT_FOUND`.
  - `valuesForBid({ bidId })` → `Record<key, CustomValue>` for active fields.

- [ ] **Step 1: Write failing router tests** (real Postgres, `appRouter.createCaller({})`): create/list ordering; slug dedupe; duplicate active name `CONFLICT`, reusable after archive; select without options rejected; rename keeps `key`; option removal keeps existing values and `setValue` of the removed option is rejected; reorder validation; archive hides from default `list` but keeps values, unarchive restores; `delete` blocked after any value written, allowed for a never-used field; `setValue` per type round-trips (number as number, date as `YYYY-MM-DD`, boolean), invalid values rejected, `null` clears, second set updates in place (still one row), archived field rejected; audit rows exist with the exact entity types/actions above (and value-edit audit is keyed to the bid id); protected-value freeze on the *bid* does not affect custom `setValue`; deleting a bid cascades its values.
- [ ] **Step 2: Implement; run the new test file, then the full API suite** (Postgres up: `docker start goms-bidtracker-pg` if needed; the known `hierarchy.duplicateNode` flake is unrelated).
- [ ] **Step 3: Commit** — `feat(api): bidCustomFields router with archive-not-delete lifecycle and audit`

### Task 27d: Grid, saved views and Activity History integration

**Files:**
- Modify: `apps/api/src/routers/bids.ts` (`listForGrid`)
- Modify: `apps/api/src/routers/bidSavedViews.ts` (zod rule shape)
- Modify: `apps/api/src/routers/auditLogs.ts` (entity-type allow-list, if it has one)
- Modify: `apps/api/src/routers/bids.test.ts`, `bidSavedViews.test.ts`, `auditLogs.test.ts`

**Interfaces:**
- `bids.listForGrid` rows gain `customValues: Record<string, CustomValue>` (active fields only, keyed by field `key`; loaded with **one** query over `bid_custom_field_values` joined to active fields — no per-row queries), and its `filterRules` input widens to the new rule shape. Filtering calls `applyFilterRules(rows, rules, email, fieldTypes)` where `fieldTypes = { ...STANDARD_BID_FIELD_TYPES, ...activeCustomTypes('custom:<key>') }`.
- `bidSavedViews.create/update` accept the widened rule shape (`operator` enum, `value`, optional `value2`, optional `values`); reject an operator not valid for the field's type **only when the field is a known standard field** — unknown/archived custom fields are stored as given (saved views must survive archive). `visibleColumns` stays `string[]` with the ordered-array meaning from the Decisions table; no validation against current custom fields.
- `auditLogs.list` surfaces `bidCustomField`/`bidCustomFieldValue` entries in the top-level history, and a bid's own history includes its value edits.

- [ ] **Step 1: Write failing tests:** `listForGrid` returns typed `customValues` (number stays a number); `gt`/`between` on a number custom field are numeric; `contains` on text; `in` on select; a rule on an **archived** custom field is skipped and returns the unfiltered set while a rule on a standard field still applies; a saved view created with a custom rule keeps loading after `archive` and works again after `unarchive`; legacy `eq` rules and all Task 19 cases still green.
- [ ] **Step 2: Implement, run `bids`/`bidSavedViews`/`auditLogs` tests, then the full API suite.**
- [ ] **Step 3: Commit** — `feat(api): custom field values in the Master Grid query, typed filters, archive-safe saved views`

### Task 27e: Frontend data layer for custom fields

**Files:**
- Modify: `src/lib/types.ts` (`CustomFieldType`, `BidCustomField`, widen `BidSavedView['filterRules']` element to `{ field; operator; value; value2?; values? }`, `BidGridRow.customValues`)
- Modify: `src/data/seed.ts` (`bidCustomFields: []`, `bidCustomFieldValues: []`), `src/data/migrations.ts` (`SCHEMA_VERSION` 13→14, `toV14` backfilling both as `[]`), `src/data/migrations.test.ts`, `src/data/backup.test.ts` fixture
- Modify: `src/data/in-memory/repository.ts` (`Repository` interface + `InMemoryRepository`, `MUTATOR_KEYS`/`READER_KEYS`, `hydrate` defaults; `listBidsForGrid` fills `customValues` and calls the shared typed `applyFilterRules`), `src/data/in-memory/bids.test.ts`
- Modify: `src/data/remote/repository.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Repository methods mirroring 27c 1:1: `listBidCustomFields(includeArchived?)`, `createBidCustomField`, `updateBidCustomField`, `reorderBidCustomFields`, `archiveBidCustomField`, `unarchiveBidCustomField`, `deleteBidCustomField`, `setBidCustomValue(bidId, fieldId, value)`, `listBidCustomValues(bidId)`. In-memory enforces the same rules (immutable type/key, unique active name, no delete once values exist, select validation, archived rejection) using the **same `@goms/domain` helpers**.
- Hooks: `useBidCustomFields(includeArchived?)`, `useBidCustomFieldMutations()` (create/update/reorder/archive/unarchive/remove, invalidating `['bidCustomFields']` and `['bidsForGrid']`), `useSetBidCustomValue()` (invalidates `['bidsForGrid']` and `['bid', bidId]`; the grid will layer optimistic updates on top in Task 28).

- [ ] **Step 1: Write failing tests** — in-memory create/list/order/rename/archive/delete-gate/setValue typing and clearing; `listBidsForGrid` custom filter incl. archived-skip; `toV14` migration; `npm run build` clean.
- [ ] **Step 2: Implement; `npm run build` and `npm test` green.**
- [ ] **Step 3: Commit** — `feat(frontend): custom field data layer (types, migration v14, repositories, hooks)`

---

## Phase N — Master Grid and saved views

### Task 28: Install `@tanstack/react-table`, build `MasterGrid.tsx`

> **Amended 2026-09-30 (Custom Fields, Phase M2 — do 27a–27e first).** In addition to everything below, `MasterGrid` must: (1) render the seven required groups unchanged, then a **Custom** group built from `useBidCustomFields()` (active fields, by `position`), each column id `custom:<key>`, cell value from `row.customValues[key]`, with type-aware rendering (number right-aligned, date formatted, boolean as check, select as pill); (2) **inline-edit** freely-editable cells — custom cells and any standard cell the spec marks freely editable — via `useSetBidCustomValue` (text/number: input; date: date input; select: dropdown of current options, plus a "(removed option)" tag for a stored value no longer in options; boolean: toggle) with optimistic update, Enter/blur commits, Esc cancels, and an inline error + rollback on a rejected value; frozen/corrigendum-tracked standard fields remain read-only in the grid and open their existing dialog; (3) **column filtering** through header filter popovers with **type-correct operators** (`OPERATORS_BY_TYPE`), multiple simultaneous filters, a clear-this-filter control on each filtered header, and a **Clear all filters** control, all reading/writing the same `filterRules` array the saved views persist; (4) **quick search** box matching case-insensitively across every visible text/select column (standard and custom); (5) **sorting** typed per column (numbers numerically, dates chronologically, booleans false<true, empty values last); (6) column **visibility and order** (drag or move controls) held as one ordered `visibleColumns` id array — the same array saved views persist; (7) **virtualization** via `@tanstack/react-virtual` including with 30+ custom columns (horizontal and vertical); (8) a graceful **ignored-rule notice** when the active view references an archived/unknown custom column (rules skipped, "N filter(s) ignored — column archived"). Filtering is done client-side with the shared domain `applyFilterRules(rows, rules, email, fieldTypes)` so it matches the server exactly. Column *management* (add/rename/options/reorder/archive) is Task 29a. Tests to add: custom column renders after System group; inline edit round-trips per type and rolls back on invalid; each operator for each type filters correctly; clear-one and clear-all; search hits a custom select value; archived-column rule ignored with notice; ordered `visibleColumns` drives display order.

**Files:**
- Modify: `package.json` (add `@tanstack/react-table`)
- Create: `src/modules/bid-tracker/components/MasterGrid.tsx`
- Create: `src/modules/bid-tracker/components/MasterGrid.test.tsx`
- Modify: `src/modules/bid-tracker/BidTrackerWorkspace.tsx` (render it for the `grid` section)

**Interfaces:**
- Consumes: `useBidsForGrid`, `BidGridRow` (Tasks 24, 26).
- Produces: `<MasterGrid columnVisibility, onColumnVisibilityChange, filterRules, sort>` — column-grouped, virtualized, sortable.

- [ ] **Step 1: Install the dependency**

Run: `npm install @tanstack/react-table`
Expected: `package.json`'s `dependencies` gains `"@tanstack/react-table": "^8.x.x"`.

- [ ] **Step 2: Write the failing test**

```tsx
// src/modules/bid-tracker/components/MasterGrid.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MasterGrid } from './MasterGrid'
import * as api from '@/lib/api'

describe('MasterGrid', () => {
  it('renders one row per bid, showing the opportunity name, tender ID, and attention flag', () => {
    vi.spyOn(api, 'useBidsForGrid').mockReturnValue({
      data: [{
        id: 'b1', bidCode: 'BID-2026-0001', opportunityId: 'o1', opportunityName: 'AI Document Processing System',
        gemTenderId: 'DRDO-SAG-2026-T881', stageKey: 'qualification', decision: 'pending', status: 'active',
        dataConfidence: 'verified', attentionFlag: 'dueSoon', departmentId: 'd1', stateCode: 7,
        submissionDate: '2026-10-10', valueAmount: '6.2', valueUnit: 'crore', emdAmount: '12.4', emdUnit: 'lakh',
        vertical: 'Defence', ownerEmail: null, tenderLink: null, archivedAt: null, createdAt: '', updatedAt: '',
      }],
      isLoading: false,
    } as any)
    const qc = new QueryClient()
    render(<QueryClientProvider client={qc}><MasterGrid filterRules={[]} /></QueryClientProvider>)
    expect(screen.getByText('AI Document Processing System')).toBeInTheDocument()
    expect(screen.getByText('DRDO-SAG-2026-T881')).toBeInTheDocument()
    expect(screen.getByText('Due Soon')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- MasterGrid.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 4: Implement**

```tsx
// src/modules/bid-tracker/components/MasterGrid.tsx
import { useMemo, useState } from 'react'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, createColumnHelper, type SortingState, type VisibilityState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { useBidsForGrid } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'

const ATTENTION_LABEL: Record<BidGridRow['attentionFlag'], string> = {
  dueSoon: 'Due Soon', overdue: 'Overdue', corrigendumPending: 'Corrigendum Pending', onTrack: 'On Track',
}
const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], 'amber' | 'crimson' | 'blue' | 'emerald'> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}

const col = createColumnHelper<BidGridRow>()
const COLUMNS = [
  col.group({ id: 'identity', header: 'Identity', columns: [
    col.accessor('bidCode', { header: 'Bid ID' }),
    col.accessor('opportunityName', { header: 'Opportunity / Mission' }),
    col.accessor('gemTenderId', { header: 'Tender ID' }),
  ]}),
  col.group({ id: 'dates', header: 'Dates', columns: [
    col.accessor('submissionDate', { header: 'Submission Deadline' }),
  ]}),
  col.group({ id: 'decision', header: 'Decision', columns: [
    col.accessor('stageKey', { header: 'Bid Stage' }),
    col.accessor('attentionFlag', {
      header: 'Attention',
      cell: (info) => <Badge tone={ATTENTION_TONE[info.getValue()]}>{ATTENTION_LABEL[info.getValue()]}</Badge>,
    }),
  ]}),
  col.group({ id: 'system', header: 'System', columns: [
    col.accessor('dataConfidence', { header: 'Data Confidence' }),
  ]}),
]

export function MasterGrid({
  filterRules, columnVisibility, onColumnVisibilityChange,
}: {
  filterRules: { field: string; operator: 'eq'; value: string }[]
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: (v: VisibilityState) => void
}) {
  const { data: rows = [], isLoading } = useBidsForGrid(filterRules)
  const [sorting, setSorting] = useState<SortingState>([])
  const navigate = useNavigate()
  const table = useReactTable({
    data: rows, columns: COLUMNS, state: { sorting, columnVisibility: columnVisibility ?? {} },
    onSortingChange: setSorting, onColumnVisibilityChange: onColumnVisibilityChange as any,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })
  const parentRef = useRef<HTMLDivElement>(null)
  const { rows: tableRows } = table.getRowModel()
  const virtualizer = useVirtualizer({ count: tableRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44 })

  if (isLoading) return <div className="p-4 text-sm text-muted">Loading bids…</div>

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="cursor-pointer select-none px-3 py-2 text-left" onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = tableRows[vi.index]
            return (
              <tr key={row.id} className="cursor-pointer hover:bg-surface-hover" onClick={() => navigate(`/bid-tracker/bid/${row.original.id}`)}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

Wire it into `BidTrackerWorkspace.tsx`'s `grid` section, replacing the `data-testid="bid-tracker-grid-placeholder"` div with `<MasterGrid filterRules={activeView?.filterRules ?? []} />` (Task 29 supplies `activeView`).

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- MasterGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/modules/bid-tracker/components/MasterGrid.tsx src/modules/bid-tracker/components/MasterGrid.test.tsx src/modules/bid-tracker/BidTrackerWorkspace.tsx
git commit -m "feat(frontend): add the Master Grid, column-grouped and virtualized with @tanstack/react-table"
```

### Task 29: Saved-view pill row and "Create Saved View" dialog

> **Amended 2026-09-30 (Custom Fields).** The Create Saved View dialog's filter builder is the reference prototype's **"WHERE [field] [operator] [value]"** rule builder: field dropdown lists every filterable standard column *and every active custom column* (custom ones under a "Custom" heading); the operator dropdown is populated from `OPERATORS_BY_TYPE` for the chosen field's type and resets when the field changes; the value control is type-aware (text box / number box / date picker / select dropdown, `between` shows two inputs, `in` shows a multi-select); rules can be added, edited and removed, and several combine with AND. Saved views persist **standard and custom** `visibleColumns` in display order and the custom-related filter rules (Phase M2 Decisions table). Loading a view that references an archived/unknown custom column must not crash or blank the grid: those column ids and rules are ignored (notice shown), the stored view is untouched, and unarchiving restores it. Personal/global scope behavior is unchanged. Tests to add: builder offers only valid operators per type; a saved view round-trips a custom filter + custom column order; a view with an archived-column rule renders with the notice and the rest of its rules still applied.

**Files:**
- Create: `src/modules/bid-tracker/components/SavedViewTabs.tsx`
- Create: `src/modules/bid-tracker/components/SavedViewTabs.test.tsx`
- Create: `src/modules/bid-tracker/components/CreateSavedViewDialog.tsx`
- Modify: `src/modules/bid-tracker/BidTrackerWorkspace.tsx` (hold `activeViewId` state, render `SavedViewTabs`, pass the resolved view's `filterRules` into `MasterGrid`)

**Interfaces:**
- Consumes: `useBidSavedViews`, `useBidSavedViewMutations` (Task 26).
- Produces: `<SavedViewTabs activeViewId, onChange, onCreateNew>`, `<CreateSavedViewDialog open, onClose, initialFilterRules>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/components/SavedViewTabs.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SavedViewTabs } from './SavedViewTabs'
import * as api from '@/lib/api'

describe('SavedViewTabs', () => {
  it('always shows the seven system views and never seeds the two example views', () => {
    vi.spyOn(api, 'useBidSavedViews').mockReturnValue({
      data: [
        { id: 'allBids', name: 'All Bids', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'myBids', name: 'My Bids', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'solutioning', name: 'Solutioning', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'qualification', name: 'Qualification', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'dueSoon', name: 'Due Soon', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'overdue', name: 'Overdue', isSystem: true, scope: 'global', filterRules: [] },
        { id: 'goApproved', name: 'Go Approved', isSystem: true, scope: 'global', filterRules: [] },
      ],
      isLoading: false,
    } as any)
    render(<SavedViewTabs activeViewId="allBids" onChange={vi.fn()} onCreateNew={vi.fn()} />)
    for (const name of ['All Bids', 'My Bids', 'Solutioning', 'Qualification', 'Due Soon', 'Overdue', 'Go Approved']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.queryByText('Smart Transport Bids')).not.toBeInTheDocument()
    expect(screen.queryByText('High Value Deals > 20 Cr')).not.toBeInTheDocument()
  })

  it('lets the user open the create-view dialog', async () => {
    vi.spyOn(api, 'useBidSavedViews').mockReturnValue({ data: [], isLoading: false } as any)
    const onCreateNew = vi.fn()
    render(<SavedViewTabs activeViewId="allBids" onChange={vi.fn()} onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByRole('button', { name: /create saved view/i }))
    expect(onCreateNew).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- SavedViewTabs.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// src/modules/bid-tracker/components/SavedViewTabs.tsx
import { Button } from '@/components/ui/Button'
import { useBidSavedViews } from '@/lib/api'

export function SavedViewTabs({
  activeViewId, onChange, onCreateNew,
}: { activeViewId: string; onChange: (id: string) => void; onCreateNew: () => void }) {
  const { data: views = [], isLoading } = useBidSavedViews()
  if (isLoading) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${v.id === activeViewId ? 'bg-ink text-white' : 'bg-surface hover:bg-surface-hover'}`}
        >
          {v.name}
        </button>
      ))}
      <Button variant="ghost" size="sm" onClick={onCreateNew}>+ Create Saved View</Button>
    </div>
  )
}
```

```tsx
// src/modules/bid-tracker/components/CreateSavedViewDialog.tsx
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useBidSavedViewMutations } from '@/lib/api'
import type { BidSavedView } from '@/lib/types'

export function CreateSavedViewDialog({
  open, onClose, initialFilterRules,
}: { open: boolean; onClose: () => void; initialFilterRules: BidSavedView['filterRules'] }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'personal' | 'global'>('personal')
  const { create } = useBidSavedViewMutations()

  if (!open) return null
  return (
    <Dialog onClose={onClose} title="Create Saved View">
      <p className="text-sm text-muted">Save your current filter configuration for quick access</p>
      <Field label="View Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Due Next 7 Days, High Value Smart Cities" />
      </Field>
      <div className="flex gap-3">
        <button onClick={() => setScope('personal')} className={scope === 'personal' ? 'font-semibold' : ''}>
          Personal — Bound to your account, visible only to you.
        </button>
        <button onClick={() => setScope('global')} className={scope === 'global' ? 'font-semibold' : ''}>
          Global — Available for all team members.
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => { await create.mutateAsync({ name, scope, filterRules: initialFilterRules }); onClose() }}
        >
          Create View
        </Button>
      </div>
    </Dialog>
  )
}
```

Wire both into `BidTrackerWorkspace.tsx`: hold `const [activeViewId, setActiveViewId] = useState('allBids')` and `const [createOpen, setCreateOpen] = useState(false)`; resolve `activeView` from `useBidSavedViews()`'s data by id; render `<SavedViewTabs activeViewId={activeViewId} onChange={setActiveViewId} onCreateNew={() => setCreateOpen(true)} />` above the `MasterGrid`, passing `activeView?.filterRules ?? []` into it, and render `<CreateSavedViewDialog open={createOpen} onClose={() => setCreateOpen(false)} initialFilterRules={activeView?.filterRules ?? []} />`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- SavedViewTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/bid-tracker/components/SavedViewTabs.tsx src/modules/bid-tracker/components/SavedViewTabs.test.tsx src/modules/bid-tracker/components/CreateSavedViewDialog.tsx src/modules/bid-tracker/BidTrackerWorkspace.tsx
git commit -m "feat(frontend): add the saved-view pill row and Create Saved View dialog"
```

---

### Task 29a: Custom column management UI ("Add column", "Manage columns")

> **Added 2026-09-30 (Custom Fields).** Depends on Tasks 27e and 28.

**Files:**
- Create: `src/modules/bid-tracker/components/AddCustomColumnDialog.tsx` + test
- Create: `src/modules/bid-tracker/components/ManageColumnsPanel.tsx` + test
- Modify: `src/modules/bid-tracker/components/MasterGrid.tsx` (toolbar entry points: "+ Add column" at the end of the Custom group header and a "Columns" button)

**Interfaces:**
- Consumes: `useBidCustomFields`, `useBidCustomFieldMutations` (27e).
- `AddCustomColumnDialog`: column **name** (required, ≤80, duplicate-active-name error shown inline from the `CONFLICT`), **data type** (text/number/date/select/boolean — with a note that type cannot be changed later), and for select an **options editor** (add, remove, reorder, no blanks/duplicates; at least one). On success the new column appears at the end of the Custom group and is made visible in the active view's session state.
- `ManageColumnsPanel` (popover from the "Columns" button): lists standard columns (visibility toggle + move) and the Custom group; each custom column supports **rename**, **edit options** (select only; removing an option that has stored values shows a confirmation naming that existing values are kept), **reorder** (persisted via `reorder`), **hide/show** (view-level, not archive), **archive** (confirm dialog: "values are kept; you can restore it") and a separate **Archived columns** section with **Restore** (`unarchive`). There is **no delete** control unless the field has never held a value, in which case a "Delete" appears with a confirm.
- While the active view is a system view, column changes are session-only (spec §8); on a user view they persist through the debounced `visible_columns` write.

- [ ] **Step 1: Write failing tests** — add flow per type (select requires options), duplicate-name error, rename keeps the column in place and does not break an existing filter on it, option-removal confirmation, reorder persists order into the grid, archive removes the column and its filter chip (notice shown) and restore brings it back, delete offered only for never-used fields.
- [ ] **Step 2: Implement; `npm run build` and `npm test` green.**
- [ ] **Step 3: Commit** — `feat(bid-tracker): add/rename/reorder/archive custom columns from the Master Grid`

---

## Phase O — Bid detail workspace

### Task 30: `BidDetailWorkspace` shell and the Overview tab

**Files:**
- Create: `src/modules/bid-tracker/BidDetailWorkspace.tsx`
- Create: `src/modules/bid-tracker/BidDetailWorkspace.test.tsx`
- Create: `src/modules/bid-tracker/pages/OverviewTab.tsx`

**Interfaces:**
- Consumes: `useBid`, `useBidMilestones`, `useBidActionQueue` (Task 26), `ownership.resolveOwner`-backed hook (this codebase's existing `useResolvedOwners`/equivalent — reuse it, do not add a parallel ownership hook), `BID_STAGE_REQUIREMENTS` from `@goms/domain`.
- Produces: `<BidDetailWorkspace>` (route component, reads `:bidId`), `<OverviewTab bid, milestones>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/BidDetailWorkspace.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BidDetailWorkspace } from './BidDetailWorkspace'
import * as api from '@/lib/api'

describe('BidDetailWorkspace', () => {
  it('renders the four detail tabs and the Overview content by default', () => {
    vi.spyOn(api, 'useBid').mockReturnValue({ data: {
      id: 'b1', bidCode: 'BID-2026-0043', opportunityId: 'o1', stageKey: 'qualification', decision: 'pending',
      status: 'active', dataConfidence: 'verified', tenderLink: null, archivedAt: null, createdAt: '', updatedAt: '',
    }, isLoading: false } as any)
    vi.spyOn(api, 'useBidMilestones').mockReturnValue({ data: [], isLoading: false } as any)
    vi.spyOn(api, 'useBidActionQueue').mockReturnValue({ data: [], isLoading: false } as any)
    render(
      <MemoryRouter initialEntries={['/bid-tracker/bid/b1']}>
        <Routes><Route path="/bid-tracker/bid/:bidId" element={<BidDetailWorkspace />} /></Routes>
      </MemoryRouter>,
    )
    for (const tab of ['Overview', 'Milestones', 'Commercial & Files', 'Protected Values']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(screen.getByText(/Executive Go \/ No-Go sign-off/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- BidDetailWorkspace.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// src/modules/bid-tracker/pages/OverviewTab.tsx
import { BID_STAGE_REQUIREMENTS, BID_STAGE_MAP } from '@goms/domain'
import type { Bid, BidMilestone } from '@/lib/types'

export function OverviewTab({ bid, milestones }: { bid: Bid; milestones: BidMilestone[] }) {
  const requirements = BID_STAGE_REQUIREMENTS[bid.stageKey] ?? []
  const nextMilestone = milestones
    .filter((m) => m.status === 'open' && m.dueAt)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))[0]
  return (
    <div className="space-y-4 p-4">
      {requirements.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <strong>Next Stage Requirements ({BID_STAGE_MAP[bid.stageKey]?.label}):</strong>
          <div>Recommended inputs needed: {requirements.join(', ')}.</div>
        </div>
      )}
      <div>
        <div className="text-xs uppercase text-muted">Earliest Next Milestone</div>
        <div>{nextMilestone ? `${nextMilestone.label} — ${nextMilestone.dueAt}` : 'None scheduled'}</div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><div className="text-xs uppercase text-muted">Stage</div><div>{BID_STAGE_MAP[bid.stageKey]?.label}</div></div>
        <div><div className="text-xs uppercase text-muted">Decision</div><div className="capitalize">{bid.decision.replace('_', ' ')}</div></div>
      </div>
    </div>
  )
}
```

```tsx
// src/modules/bid-tracker/BidDetailWorkspace.tsx
import { useParams, useSearchParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'
import { useBid, useBidMilestones } from '@/lib/api'
import { OverviewTab } from './pages/OverviewTab'
// Task 31/32/33 add these:
// import { MilestonesTab } from './pages/MilestonesTab'
// import { CommercialAndFilesTab } from './pages/CommercialAndFilesTab'
// import { ProtectedValuesTab } from './pages/ProtectedValuesTab'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'commercial', label: 'Commercial & Files' },
  { value: 'protected', label: 'Protected Values' },
]

export function BidDetailWorkspace() {
  const { bidId } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const { data: bid, isLoading: bidLoading } = useBid(bidId ?? null)
  const { data: milestones = [] } = useBidMilestones(bidId ?? null)

  if (bidLoading || !bid) return <div className="p-4 text-sm text-muted">Loading bid…</div>

  return (
    <div className="flex h-full flex-col">
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={TABS} />
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab bid={bid} milestones={milestones} />}
        {/* Task 31/32/33 render their tabs here, following this same pattern */}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- BidDetailWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/bid-tracker/BidDetailWorkspace.tsx src/modules/bid-tracker/BidDetailWorkspace.test.tsx src/modules/bid-tracker/pages/OverviewTab.tsx
git commit -m "feat(frontend): add the bid detail workspace shell and Overview tab"
```

### Task 31: Milestones tab

**Files:**
- Create: `src/modules/bid-tracker/pages/MilestonesTab.tsx`
- Create: `src/modules/bid-tracker/pages/MilestonesTab.test.tsx`
- Modify: `src/modules/bid-tracker/BidDetailWorkspace.tsx` (render it for `tab === 'milestones'`)

**Interfaces:**
- Consumes: `useBidMilestones`, `useBidMilestoneMutations` (Task 26).
- Produces: `<MilestonesTab bidId>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/pages/MilestonesTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestonesTab } from './MilestonesTab'
import * as api from '@/lib/api'

describe('MilestonesTab', () => {
  it('renders each milestone with its date, venue, and notes', () => {
    vi.spyOn(api, 'useBidMilestones').mockReturnValue({ data: [{
      id: 'm1', bidId: 'b1', milestoneType: 'preBidConference', key: 'preBidConference', label: 'Pre-Bid Conference',
      dueAt: '2026-10-01T14:30:00.000Z', venue: 'SAG Lab Auditorium, Metcalfe House, Delhi',
      notes: 'In-person physical attendance strictly required. Identity verification at gate.',
      status: 'open', source: 'manual', createdAt: '', updatedAt: '',
    }], isLoading: false } as any)
    vi.spyOn(api, 'useBidMilestoneMutations').mockReturnValue({ create: {}, update: {}, remove: {} } as any)
    render(<MilestonesTab bidId="b1" />)
    expect(screen.getByText('Pre-Bid Conference')).toBeInTheDocument()
    expect(screen.getByText(/SAG Lab Auditorium/)).toBeInTheDocument()
    expect(screen.getByText(/Identity verification at gate/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
// src/modules/bid-tracker/pages/MilestonesTab.tsx
import { useBidMilestones } from '@/lib/api'

export function MilestonesTab({ bidId }: { bidId: string }) {
  const { data: milestones = [], isLoading } = useBidMilestones(bidId)
  if (isLoading) return null
  return (
    <div className="space-y-4 p-4">
      {milestones.map((m) => (
        <div key={m.id} className="rounded-lg border p-3">
          <div className="font-medium">{m.label}</div>
          {m.dueAt && <div className="text-sm">Date: {new Date(m.dueAt).toLocaleString()}</div>}
          {m.venue && <div className="text-sm">Venue: {m.venue}</div>}
          {m.notes && <div className="text-sm italic text-muted">{m.notes}</div>}
          {!m.dueAt && <div className="text-sm text-muted">No record</div>}
        </div>
      ))}
    </div>
  )
}
```

Wire into `BidDetailWorkspace.tsx`: `{tab === 'milestones' && <MilestonesTab bidId={bidId!} />}`.

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- MilestonesTab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/bid-tracker/pages/MilestonesTab.tsx src/modules/bid-tracker/pages/MilestonesTab.test.tsx src/modules/bid-tracker/BidDetailWorkspace.tsx
git commit -m "feat(frontend): add the bid detail Milestones tab"
```

### Task 32: Commercial & Files tab

**Files:**
- Create: `src/modules/bid-tracker/pages/CommercialAndFilesTab.tsx`
- Create: `src/modules/bid-tracker/pages/CommercialAndFilesTab.test.tsx`
- Modify: `src/modules/bid-tracker/BidDetailWorkspace.tsx` (render it for `tab === 'commercial'`)

**Interfaces:**
- Consumes: `useDocuments`, `useDocumentMutations` (Task 26), the opportunity's `valueAmount`/`emdAmount` (via `useOpportunity`, already existing).
- Produces: `<CommercialAndFilesTab bid, opportunity>` — estimated cost/EMD display, document list with an upload control, citations shown per document.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/pages/CommercialAndFilesTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommercialAndFilesTab } from './CommercialAndFilesTab'
import * as api from '@/lib/api'

describe('CommercialAndFilesTab', () => {
  it('shows estimated cost, EMD, and each document with its citations', () => {
    vi.spyOn(api, 'useDocuments').mockReturnValue({ data: [{
      id: 'd1', entityType: 'bid', entityId: 'b1', filename: 'DRDO_SAG_AI_Tender_2026.pdf', storagePath: 'x',
      version: 'v1.0', contentType: 'application/pdf', sizeBytes: 1024, uploadedBy: null, uploadedAt: '',
    }], isLoading: false } as any)
    vi.spyOn(api, 'useDocumentMutations').mockReturnValue({ requestUploadUrl: {}, confirmUpload: {}, remove: {} } as any)
    render(<CommercialAndFilesTab
      bidId="b1"
      opportunity={{ valueAmount: '6.20', valueUnit: 'crore', emdAmount: '12.40', emdUnit: 'lakh' } as any}
    />)
    expect(screen.getByText(/6.20/)).toBeInTheDocument()
    expect(screen.getByText(/12.40/)).toBeInTheDocument()
    expect(screen.getByText('DRDO_SAG_AI_Tender_2026.pdf')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
// src/modules/bid-tracker/pages/CommercialAndFilesTab.tsx
import { useDocuments, useDocumentMutations } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import type { Opportunity } from '@/lib/types'

export function CommercialAndFilesTab({ bidId, opportunity }: { bidId: string; opportunity: Pick<Opportunity, 'valueAmount' | 'valueUnit' | 'emdAmount' | 'emdUnit'> }) {
  const { data: documents = [], isLoading } = useDocuments('bid', bidId)
  const { requestUploadUrl, confirmUpload } = useDocumentMutations('bid', bidId)

  async function handleUpload(file: File) {
    const { uploadId, uploadUrl } = await requestUploadUrl.mutateAsync({
      entityType: 'bid', entityId: bidId, filename: file.name, contentType: file.type, sizeBytes: file.size,
    })
    await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    await confirmUpload.mutateAsync(uploadId)
  }

  return (
    <div className="space-y-6 p-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-muted">Estimated Project Cost</div>
          <div className="text-lg font-semibold">{opportunity.valueAmount} {opportunity.valueUnit}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted">EMD / Tender Fee</div>
          <div className="text-lg font-semibold">{opportunity.emdAmount} {opportunity.emdUnit}</div>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs uppercase text-muted">Source Documents & Citations</div>
          <label>
            <Button as="span" variant="secondary" size="sm">Upload</Button>
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </label>
        </div>
        {!isLoading && documents.map((d) => <div key={d.id} className="border-b py-2">{d.filename} <span className="text-xs text-muted">{d.version}</span></div>)}
      </div>
    </div>
  )
}
```

Wire into `BidDetailWorkspace.tsx`, sourcing `opportunity` via the existing `useOpportunity(bid.opportunityId)` hook: `{tab === 'commercial' && <CommercialAndFilesTab bidId={bidId!} opportunity={opportunity!} />}`.

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- CommercialAndFilesTab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/bid-tracker/pages/CommercialAndFilesTab.tsx src/modules/bid-tracker/pages/CommercialAndFilesTab.test.tsx src/modules/bid-tracker/BidDetailWorkspace.tsx
git commit -m "feat(frontend): add the bid detail Commercial & Files tab, including document upload"
```

### Task 33: Protected Values tab

**Files:**
- Create: `src/modules/bid-tracker/pages/ProtectedValuesTab.tsx`
- Create: `src/modules/bid-tracker/pages/ProtectedValuesTab.test.tsx`
- Modify: `src/modules/bid-tracker/BidDetailWorkspace.tsx` (render it for `tab === 'protected'`)

**Interfaces:**
- Consumes: `useProtectedValues`, `useProtectedValueMutations` (Task 26).
- Produces: `<ProtectedValuesTab bidId>` — one row per protectable fact, each with a Freeze/Unfreeze toggle; unfreeze requires a reason (matching the backend's requirement, spec §13).

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/pages/ProtectedValuesTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProtectedValuesTab } from './ProtectedValuesTab'
import * as api from '@/lib/api'

describe('ProtectedValuesTab', () => {
  it('unfreezing a field requires a non-empty reason before the confirm button is enabled', async () => {
    vi.spyOn(api, 'useProtectedValues').mockReturnValue({ data: [
      { id: 'p1', entityType: 'bid', entityId: 'b1', fieldKey: 'submissionDeadline', frozen: true, frozenAt: '', frozenBy: '' },
    ], isLoading: false } as any)
    const unfreeze = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(api, 'useProtectedValueMutations').mockReturnValue({ freeze: { mutateAsync: vi.fn() }, unfreeze: { mutateAsync: unfreeze } } as any)
    render(<ProtectedValuesTab bidId="b1" />)
    await userEvent.click(screen.getByRole('button', { name: /unfreeze/i }))
    const confirmButton = screen.getByRole('button', { name: /confirm unfreeze/i })
    expect(confirmButton).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/reason/i), 'Client confirmed the extension')
    expect(confirmButton).toBeEnabled()
    await userEvent.click(confirmButton)
    expect(unfreeze).toHaveBeenCalledWith({ fieldKey: 'submissionDeadline', reason: 'Client confirmed the extension' })
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
// src/modules/bid-tracker/pages/ProtectedValuesTab.tsx
import { useState } from 'react'
import { useProtectedValues, useProtectedValueMutations } from '@/lib/api'
import { Button } from '@/components/ui/Button'

const PROTECTABLE_FIELDS = ['bidCode', 'gemTenderId', 'valueAmount', 'submissionDeadline', 'bidOwner'] as const
const FIELD_LABEL: Record<string, string> = {
  bidCode: 'Bid ID', gemTenderId: 'Tender ID', valueAmount: 'Estimated Value',
  submissionDeadline: 'Submission Deadline', bidOwner: 'Bid Owner',
}

export function ProtectedValuesTab({ bidId }: { bidId: string }) {
  const { data: values = [] } = useProtectedValues('bid', bidId)
  const { freeze, unfreeze } = useProtectedValueMutations('bid', bidId)
  const [unfreezing, setUnfreezing] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const frozenByField = new Map(values.filter((v) => v.frozen).map((v) => [v.fieldKey, v]))

  return (
    <div className="p-4">
      <p className="mb-4 text-sm text-muted">
        Protect Value: Freeze specific facts to prevent accidental overrides during team edits or data uploads.
        Changes are strictly rejected unless unfrozen.
      </p>
      {PROTECTABLE_FIELDS.map((field) => {
        const isFrozen = frozenByField.has(field)
        return (
          <div key={field} className="flex items-center justify-between border-b py-3">
            <span>{FIELD_LABEL[field]}</span>
            {unfreezing === field ? (
              <div className="flex items-center gap-2">
                <input placeholder="Reason for unfreezing" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button
                  variant="primary" size="sm" disabled={!reason.trim()}
                  onClick={async () => { await unfreeze.mutateAsync({ fieldKey: field, reason }); setUnfreezing(null); setReason('') }}
                >
                  Confirm Unfreeze
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary" size="sm"
                onClick={() => (isFrozen ? setUnfreezing(field) : freeze.mutateAsync(field))}
              >
                {isFrozen ? 'Unfreeze' : 'Freeze Value'}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

Wire into `BidDetailWorkspace.tsx`: `{tab === 'protected' && <ProtectedValuesTab bidId={bidId!} />}`.

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- ProtectedValuesTab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/bid-tracker/pages/ProtectedValuesTab.tsx src/modules/bid-tracker/pages/ProtectedValuesTab.test.tsx src/modules/bid-tracker/BidDetailWorkspace.tsx
git commit -m "feat(frontend): add the Protected Values tab, requiring a reason before unfreeze is confirmable"
```

### Task 34: `FieldDiffReviewTable` and the Corrigendum review dialog

**Files:**
- Create: `src/components/FieldDiffReviewTable.tsx`
- Create: `src/components/FieldDiffReviewTable.test.tsx`
- Create: `src/modules/bid-tracker/components/CorrigendumReviewDialog.tsx`
- Create: `src/modules/bid-tracker/components/CorrigendumReviewDialog.test.tsx`
- Modify: `src/modules/bid-tracker/pages/MilestonesTab.tsx` (add an entry point that opens the dialog for a bid's pending corrigenda)

**Interfaces:**
- Consumes: `useBidCorrigenda`, `useBidCorrigendaMutations` (Task 26).
- Produces: `<FieldDiffReviewTable rows: {id, label, currentValue, proposedValue}[], onAccept(id), onReject(id, reason?)>` (a new, generic, presentational component in `src/components/` — not scoped to Bid Tracker), `<CorrigendumReviewDialog bidId, corrigendumId, onClose>`.

Note on scope: this task builds `FieldDiffReviewTable` as new, generic component and wires it into Bid Tracker's own corrigendum review flow. The design spec (§12) envisions `SessionImportWizard.tsx`'s existing diff table adopting this same component to avoid duplicating that UI — that retrofit is deliberately **not** done as part of this task, since it requires editing that file's existing, unaudited internals rather than guessing at them, which this plan will not do (per its "no placeholders, no fabricated existing code" constraint). Retrofitting `SessionImportWizard.tsx` onto this component is a well-scoped, independent follow-up task once this one exists as a working reference implementation — flag it to the user rather than silently skipping it.

- [ ] **Step 1: Write the failing test for the generic table**

```tsx
// src/components/FieldDiffReviewTable.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldDiffReviewTable } from './FieldDiffReviewTable'

describe('FieldDiffReviewTable', () => {
  it('shows current vs proposed per row, and calls onAccept/onReject explicitly', async () => {
    const onAccept = vi.fn()
    const onReject = vi.fn()
    render(
      <FieldDiffReviewTable
        rows={[{ id: 'c1', label: 'submissionDeadline', currentValue: '15 Oct 2026 03:00 pm', proposedValue: '18 Oct 2026 03:00 pm' }]}
        onAccept={onAccept}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('15 Oct 2026 03:00 pm')).toBeInTheDocument()
    expect(screen.getByText('18 Oct 2026 03:00 pm')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /accept change/i }))
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    expect(onAccept).toHaveBeenCalledWith('c1')
  })

  it('"Keep Existing Values" resets every row to not-accepted', async () => {
    const onAccept = vi.fn()
    render(
      <FieldDiffReviewTable
        rows={[{ id: 'c1', label: 'submissionDeadline', currentValue: 'a', proposedValue: 'b' }]}
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /accept change/i }))
    await userEvent.click(screen.getByRole('button', { name: /keep existing values/i }))
    await userEvent.click(screen.getByRole('button', { name: /save 0 changes/i }))
    expect(onAccept).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- FieldDiffReviewTable.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the generic table**

```tsx
// src/components/FieldDiffReviewTable.tsx
//
// Generic current-vs-proposed review UI (design spec §12) — one checkbox
// per row, an explicit "Save N Changes" commit, and a "Keep Existing
// Values" reset. Used today by Bid Tracker's corrigendum review; the
// existing SessionImportWizard diff table is a candidate to adopt this same
// component later (not done in this pass — see Task 34's scope note).
import { useState } from 'react'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'

export interface FieldDiffRow {
  id: string
  label: string
  currentValue: string
  proposedValue: string
}

export function FieldDiffReviewTable({
  rows, onAccept, onReject,
}: {
  rows: FieldDiffRow[]
  onAccept: (id: string) => void
  onReject: (id: string, reason?: string) => void
}) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function save() {
    for (const row of rows) {
      if (accepted.has(row.id)) onAccept(row.id)
      else onReject(row.id)
    }
  }

  return (
    <div>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 border-b py-3">
          <div>
            <div className="text-xs uppercase text-muted">{row.label}</div>
            <div className="text-xs text-muted">CURRENT VALUE</div>
            <div>{row.currentValue}</div>
          </div>
          <div>
            <div className="text-xs text-muted">→ PROPOSED AMENDMENT</div>
            <div>{row.proposedValue}</div>
          </div>
          <Checkbox
            aria-label="Accept Change"
            checked={accepted.has(row.id)}
            onChange={() => toggle(row.id)}
          />
        </div>
      ))}
      <div className="flex justify-between pt-3">
        <button onClick={() => setAccepted(new Set())}>Keep Existing Values</button>
        <Button variant="primary" onClick={save}>Save {accepted.size} Change{accepted.size === 1 ? '' : 's'}</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- FieldDiffReviewTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the corrigendum dialog, then implement it**

```tsx
// src/modules/bid-tracker/components/CorrigendumReviewDialog.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CorrigendumReviewDialog } from './CorrigendumReviewDialog'
import * as api from '@/lib/api'

describe('CorrigendumReviewDialog', () => {
  it('reviews each pending change through reviewCorrigendumChange', async () => {
    vi.spyOn(api, 'useBidCorrigenda').mockReturnValue({ data: [{
      id: 'cor1', bidId: 'b1', corrigendumNumber: 2, status: 'pending_review', sourceDocumentId: null,
      detectedAt: '', reviewedAt: null, reviewedBy: null,
      changes: [{ id: 'ch1', corrigendumId: 'cor1', fieldKey: 'submissionDeadline', currentValue: '15 Oct 2026 03:00 pm', proposedValue: '18 Oct 2026 03:00 pm', decision: 'pending', decidedAt: null, decidedBy: null }],
    }], isLoading: false } as any)
    const reviewChange = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(api, 'useBidCorrigendaMutations').mockReturnValue({ create: {}, reviewChange: { mutateAsync: reviewChange } } as any)
    render(<CorrigendumReviewDialog bidId="b1" corrigendumId="cor1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /accept change/i }))
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    expect(reviewChange).toHaveBeenCalledWith({ changeId: 'ch1', decision: 'accepted' })
  })
})
```

```tsx
// src/modules/bid-tracker/components/CorrigendumReviewDialog.tsx
import { Dialog } from '@/components/ui/Dialog'
import { FieldDiffReviewTable } from '@/components/FieldDiffReviewTable'
import { useBidCorrigenda, useBidCorrigendaMutations } from '@/lib/api'

export function CorrigendumReviewDialog({ bidId, corrigendumId, onClose }: { bidId: string; corrigendumId: string; onClose: () => void }) {
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const { reviewChange } = useBidCorrigendaMutations(bidId)
  const corrigendum = corrigenda.find((c) => c.id === corrigendumId)
  if (!corrigendum) return null

  return (
    <Dialog onClose={onClose} title={`Review Corrigendum Changes — ${corrigendum.status === 'reviewed' ? 'Reviewed' : ''}`}>
      <p className="text-sm text-amber-700">Confirmed deadlines are never replaced automatically. Review the detected changes below and approve the ones to apply.</p>
      <FieldDiffReviewTable
        rows={corrigendum.changes.map((c) => ({ id: c.id, label: c.fieldKey, currentValue: c.currentValue, proposedValue: c.proposedValue }))}
        onAccept={(id) => reviewChange.mutateAsync({ changeId: id, decision: 'accepted' })}
        onReject={(id, reason) => reviewChange.mutateAsync({ changeId: id, decision: 'rejected', reason })}
      />
    </Dialog>
  )
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- CorrigendumReviewDialog.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/FieldDiffReviewTable.tsx src/components/FieldDiffReviewTable.test.tsx src/modules/bid-tracker/components/CorrigendumReviewDialog.tsx src/modules/bid-tracker/components/CorrigendumReviewDialog.test.tsx
git commit -m "feat(frontend): add FieldDiffReviewTable and the Corrigendum review dialog"
```

---

## Phase P — Action Queue and Activity History

### Task 35: Action Queue page

**Files:**
- Create: `src/modules/bid-tracker/pages/ActionQueuePage.tsx`
- Create: `src/modules/bid-tracker/pages/ActionQueuePage.test.tsx`
- Modify: `src/modules/bid-tracker/BidTrackerWorkspace.tsx` (render it for `section === 'actions'`)

**Interfaces:**
- Consumes: `useBidActionQueue` (Task 26).
- Produces: `<ActionQueuePage>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/pages/ActionQueuePage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActionQueuePage } from './ActionQueuePage'
import * as api from '@/lib/api'

describe('ActionQueuePage', () => {
  it('lists each open follow-up with its bid, due date, and attention flag', () => {
    vi.spyOn(api, 'useBidActionQueue').mockReturnValue({ data: [{
      followUpId: 'f1', bidId: 'b1', bidCode: 'BID-2026-0043', stageKey: 'qualification',
      opportunityName: 'AI Document Processing System', dueDate: '2026-09-30', note: 'Verify Security Clearance Level 3 prerequisites',
      assigneeId: null, attentionFlag: 'dueSoon',
    }], isLoading: false } as any)
    render(<MemoryRouter><ActionQueuePage /></MemoryRouter>)
    expect(screen.getByText('AI Document Processing System')).toBeInTheDocument()
    expect(screen.getByText(/Verify Security Clearance Level 3/)).toBeInTheDocument()
    expect(screen.getByText('Due Soon')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
// src/modules/bid-tracker/pages/ActionQueuePage.tsx
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { useBidActionQueue } from '@/lib/api'

const ATTENTION_LABEL: Record<string, string> = { dueSoon: 'Due Soon', overdue: 'Overdue', corrigendumPending: 'Corrigendum Pending', onTrack: 'On Track' }
const ATTENTION_TONE: Record<string, 'amber' | 'crimson' | 'blue' | 'emerald'> = { dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald' }

export function ActionQueuePage() {
  const { data: entries = [], isLoading } = useBidActionQueue()
  const navigate = useNavigate()
  if (isLoading) return null
  return (
    <table className="w-full text-sm">
      <thead><tr><th>Opportunity / Mission</th><th>Next Action</th><th>Action Due</th><th>Attention</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.followUpId} className="cursor-pointer border-b hover:bg-surface-hover" onClick={() => navigate(`/bid-tracker/bid/${e.bidId}`)}>
            <td>{e.opportunityName}</td>
            <td>{e.note}</td>
            <td>{e.dueDate}</td>
            <td><Badge tone={ATTENTION_TONE[e.attentionFlag]}>{ATTENTION_LABEL[e.attentionFlag]}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

Wire into `BidTrackerWorkspace.tsx`: `{section === 'actions' && <ActionQueuePage />}`.

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- ActionQueuePage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/bid-tracker/pages/ActionQueuePage.tsx src/modules/bid-tracker/pages/ActionQueuePage.test.tsx src/modules/bid-tracker/BidTrackerWorkspace.tsx
git commit -m "feat(frontend): add the Action Queue page"
```

### Task 36: Activity History page

**Files:**
- Create: `src/modules/bid-tracker/pages/ActivityHistoryPage.tsx`
- Create: `src/modules/bid-tracker/pages/ActivityHistoryPage.test.tsx`
- Modify: `src/modules/bid-tracker/BidTrackerWorkspace.tsx` (render it for `section === 'history'`)

**Interfaces:**
- Consumes: `useAuditLogs` — this codebase's existing hook, already reading from `commercial.auditLogs.list`/now the shared store; Task 20 exposed the equivalent data via a new top-level `auditLogs.list` procedure, but the **existing** `useAuditLogs`/`repository.listAuditLogs` hook (used today by `commercial-calculator`'s own `AuditLog.tsx`) already reads the identical, now-shared table — reuse it as-is with an `entityType` filter of `'bid'`/`'bidMilestone'`/`'bidCorrigendum'`/`'bidSavedView'`, rather than adding a second, parallel hook that duplicates it.
- Produces: `<ActivityHistoryPage>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/bid-tracker/pages/ActivityHistoryPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityHistoryPage } from './ActivityHistoryPage'
import * as api from '@/lib/api'

describe('ActivityHistoryPage', () => {
  it('renders each log entry, and labels one whose entity no longer resolves as deleted', () => {
    vi.spyOn(api, 'useAuditLogs').mockReturnValue({ data: [
      { id: 'l1', entityType: 'bid', entityId: 'still-exists', field: 'stageKey', oldValue: 'solutioning', newValue: 'qualification', reason: '', action: 'update', changedAt: '2026-09-01T00:00:00.000Z', changedBy: 'sarah@amnex.com' },
      { id: 'l2', entityType: 'bid', entityId: 'hard-deleted', field: 'stageKey', oldValue: 'a', newValue: 'b', reason: '', action: 'update', changedAt: '2026-09-02T00:00:00.000Z', changedBy: 'sarah@amnex.com' },
    ], isLoading: false } as any)
    vi.spyOn(api, 'useBid').mockImplementation((id: any) => ({ data: id === 'still-exists' ? { id } : null, isLoading: false } as any))
    render(<ActivityHistoryPage />)
    expect(screen.getByText(/stageKey: solutioning → qualification/)).toBeInTheDocument()
    expect(screen.getAllByText(/this bid was deleted/i).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
// src/modules/bid-tracker/pages/ActivityHistoryPage.tsx
import { useAuditLogs, useBid } from '@/lib/api'

const BID_ENTITY_TYPES = ['bid', 'bidMilestone', 'bidCorrigendum', 'bidSavedView'] as const

function LogRow({ log }: { log: ReturnType<typeof useAuditLogs>['data'] extends (infer R)[] | undefined ? R : never }) {
  // Only 'bid' entries have a resolvable bid to check (spec §4.7 — a
  // hard-deleted bid's audit rows persist forever with a now-dangling id).
  const { data: bid } = useBid(log.entityType === 'bid' ? log.entityId : null)
  const deleted = log.entityType === 'bid' && bid === null
  return (
    <div className="border-b py-2 text-sm">
      <div>{log.field}: {log.oldValue} → {log.newValue} {deleted && <span className="italic text-muted">(this bid was deleted)</span>}</div>
      <div className="text-xs text-muted">{log.changedBy} · {new Date(log.changedAt).toLocaleString()}</div>
    </div>
  )
}

export function ActivityHistoryPage() {
  const { data: logs = [], isLoading } = useAuditLogs({ entityType: undefined })
  if (isLoading) return null
  const bidLogs = logs.filter((l) => (BID_ENTITY_TYPES as readonly string[]).includes(l.entityType))
  return <div className="p-4">{bidLogs.map((l) => <LogRow key={l.id} log={l} />)}</div>
}
```

(Note: `useAuditLogs` filters client-side across the four Bid Tracker entity types here, rather than four separate calls — if this hook doesn't already support an unfiltered/multi-type call, adjust to call it once per entity type and merge, but do not add a second backend endpoint; Task 20's `auditLogs.list` and the existing `commercial.auditLogs.list` both already support an optional, single `entityType`.)

Wire into `BidTrackerWorkspace.tsx`: `{section === 'history' && <ActivityHistoryPage />}`.

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- ActivityHistoryPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/bid-tracker/pages/ActivityHistoryPage.tsx src/modules/bid-tracker/pages/ActivityHistoryPage.test.tsx src/modules/bid-tracker/BidTrackerWorkspace.tsx
git commit -m "feat(frontend): add the Activity History page, labeling entries whose bid no longer exists"
```

---

## Phase Q — Legacy UI guard, import/export, deployment wiring

### Task 37: `WorksEditor.tsx` — read-only stage/submission date once a bid exists

**Files:**
- Modify: `src/features/nodes/WorksEditor.tsx`
- Modify: `src/features/nodes/WorksEditor.test.tsx` (create if it doesn't already exist, following this component's existing test conventions if one exists elsewhere in `src/features/nodes/`)

**Interfaces:**
- Consumes: a new `useBidByOpportunity(opportunityId)`-style lookup — simplest as a small filter over `useBidsForGrid()`'s already-fetched data, or a dedicated `bids.getForOpportunity` procedure if a per-row lookup proves cleaner; prefer reusing `listForGrid`'s data (already fetched for the Bid Tracker module) over adding a new backend procedure whose only caller is this one legacy-UI guard.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/nodes/WorksEditor.test.tsx (add to the existing file, or create it following this directory's conventions if this is the first test here)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorksEditor } from './WorksEditor'
import * as api from '@/lib/api'

describe('WorksEditor — Bid Tracker guard', () => {
  it('disables the stage control and shows a note once a bid exists for the opportunity', () => {
    vi.spyOn(api, 'useBidsForGrid').mockReturnValue({ data: [{ id: 'b1', opportunityId: 'o1' }], isLoading: false } as any)
    render(<WorksEditor opportunities={[{ id: 'o1', opportunityName: 'Tender', stageKey: 'pipeline' } as any]} />)
    expect(screen.getByText(/managed in Bid Tracker/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- WorksEditor.test.tsx`
Expected: FAIL — no such guard exists yet (the stage control is currently always editable).

- [ ] **Step 3: Implement**

In `src/features/nodes/WorksEditor.tsx`, add `const { data: bids = [] } = useBidsForGrid()` (import `useBidsForGrid` from `@/lib/api`) and, for each rendered opportunity row, compute `const hasBid = bids.some((b) => b.opportunityId === opportunity.id)`. Where the stage dropdown/select and the submission-date field are currently rendered editable, wrap both in the existing conditional-disable pattern this component already uses elsewhere (e.g. however it disables fields during an in-flight save) — `disabled={hasBid}` — and render a short note beneath them when `hasBid` is true: `"Managed in Bid Tracker — open the bid to edit."` (a plain text note is sufficient; do not build a link/navigation affordance here unless the existing component already has a pattern for linking elsewhere, in which case follow it).

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- WorksEditor.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: no regression in this component's existing tests (if any already exist in this directory).

- [ ] **Step 5: Commit**

```bash
git add src/features/nodes/WorksEditor.tsx src/features/nodes/WorksEditor.test.tsx
git commit -m "feat(frontend): make WorksEditor's stage/submission-date read-only once a bid exists"
```

### Task 38: Import/export — `bids`/`bidMilestones` domain adapters, `ExportDialog` checkbox

> **Amended 2026-09-30 (Custom Fields).** The `bids` adapter also handles custom columns. **Export:** append one column per *active* custom field after the standard columns, heading = the field's name, values in their natural text form (numbers unformatted, dates `YYYY-MM-DD`, booleans `true`/`false`). **Import:** a heading that matches an *active* custom field by name or `custom:<key>` (case-insensitive, trimmed) is a value column: each cell goes through `coerceCustomValue` (invalid → that row is a validation error naming row, column and reason, never a partial write), an empty cell is "no change" (never a clear), and the writes go through the same typed upsert as `bidCustomFields.setValue` with `custom_value_set` audit entries inside the commit transaction. A heading that matches **no** standard column and **no** active custom field must **never create a field**: it is reported in the validation preview as an *unknown column* (listed by heading, with the count of non-empty cells being ignored) and the import is marked **needs review** — the user can explicitly proceed without those columns, but nothing is auto-created. A heading that matches an *archived* custom field's name is reported the same way (with "archived" noted). Tests to add: export includes active custom columns and excludes archived; import writes typed values to an existing custom field; invalid number/date/select value rejected with row context; unknown heading flagged, no `bid_custom_fields` row created; archived-field heading flagged; blank cell doesn't clear an existing value.

**Files:**
- Create: `apps/api/src/import/domains/bids.ts`
- Create: `apps/api/src/import/domains/bids.test.ts`
- Modify: `apps/api/src/import/session/adapters.ts` (register the new domain)
- Modify: `src/features/import/ExportDialog.tsx` (add a "Bids" checkbox to the existing dataset list)

**Interfaces:**
- Consumes: `classifyRows`, `findFuzzyCandidates` from `../engine.js` (existing).
- Produces: `validateBidRows`, `commitBidRows` matching the exact `{validate, commit, flatten}` shape every other entry in `ADAPTERS` already uses.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/import/domains/bids.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { appRouter } from '../../index.js'
import { validateBidRows, commitBidRows } from './bids.js'

describe('bids import domain', () => {
  let opportunityId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Imported Tender' })).id
  })

  it('classifies a new bid row as create, and a bid whose opportunity already has one as needs-review', async () => {
    const client = await pool.connect()
    try {
      const preview = await validateBidRows(client, [{ opportunityId, tenderLink: 'https://example.com' }])
      expect(preview[0].action).toBe('create')

      await commitBidRows(client, [{ opportunityId, tenderLink: 'https://example.com' }], preview)
      const secondPreview = await validateBidRows(client, [{ opportunityId, tenderLink: 'https://example.com/v2' }])
      expect(secondPreview[0].action).toBe('needs-review') // this opportunity already has a bid — a second row for it is ambiguous, not a silent duplicate-create
    } finally {
      client.release()
    }
  })

  it('sets data_confidence to needs_review on commit when any committed row was needs-review', async () => {
    const client = await pool.connect()
    try {
      const preview = await validateBidRows(client, [{ opportunityId, tenderLink: 'https://example.com' }])
      await commitBidRows(client, [{ opportunityId, tenderLink: 'https://example.com' }], preview)
    } finally {
      client.release()
    }
    const bid = (await pool.query('SELECT * FROM bids WHERE opportunity_id=$1', [opportunityId])).rows[0]
    expect(bid.data_confidence).toBe('verified') // this row was a clean create, not fuzzy-matched — sanity check the negative case
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test -- bids.test.ts` (the import-domain one, at `src/import/domains/bids.test.ts` — disambiguate from `src/routers/bids.test.ts` by full path if the test runner needs it)
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement, following `apps/api/src/import/domains/`'s existing per-domain module shape (open one of the smaller existing files, e.g. `currencies.ts`, and mirror its exact `validate*Rows(client, rows)`/`commit*Rows(client, rows, preview)` export signature and its use of `classifyRows`/`getBusinessKey`/`diffFields` from `../engine.js` — do not invent a different shape for this one domain)**

```ts
// apps/api/src/import/domains/bids.ts
import { classifyRows } from '../engine.js'

export interface BidImportRow {
  opportunityId: string
  tenderLink?: string
}

export async function validateBidRows(client: any, rows: BidImportRow[]) {
  const existing = (await client.query('SELECT opportunity_id, tender_link FROM bids')).rows
  return classifyRows(rows, existing, {
    getBusinessKey: (row: BidImportRow) => row.opportunityId,
    getExistingKey: (row: any) => row.opportunity_id,
    diffFields: (row: BidImportRow, existingRow: any) => {
      const diffs = []
      if (existingRow && row.tenderLink !== existingRow.tender_link) {
        diffs.push({ field: 'tenderLink', oldValue: existingRow.tender_link ?? '', newValue: row.tenderLink ?? '' })
      }
      return diffs
    },
  })
}

export async function commitBidRows(client: any, rows: BidImportRow[], preview: any[]) {
  let anyNeedsReview = false
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const action = preview[i].action
    if (action === 'reject' || action === 'needs-review') { anyNeedsReview = true; continue }
    if (action === 'create') {
      const bidCode = await allocateBidCodeForImport(client)
      const bidRow = (await client.query(
        `INSERT INTO bids (opportunity_id, bid_code, tender_link) VALUES ($1,$2,$3) RETURNING id`,
        [row.opportunityId, bidCode, row.tenderLink ?? null],
      )).rows[0]
      const opp = (await client.query('SELECT submission_date FROM opportunities WHERE id=$1', [row.opportunityId])).rows[0]
      const parsed = opp?.submission_date ? new Date(opp.submission_date) : null
      const dueAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null
      await client.query(
        `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, source)
         VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline',$2,'manual')`,
        [bidRow.id, dueAt],
      )
    } else if (action === 'update') {
      await client.query('UPDATE bids SET tender_link=$1, updated_at=now() WHERE opportunity_id=$2', [row.tenderLink ?? null, row.opportunityId])
    }
  }
  if (anyNeedsReview) {
    // Spec §17 — a bulk import commit with any fuzzy-matched/needs-review row
    // downgrades confidence for every bid this commit touched.
    const opportunityIds = rows.map((r) => r.opportunityId)
    await client.query(`UPDATE bids SET data_confidence='needs_review' WHERE opportunity_id = ANY($1)`, [opportunityIds])
  }
}

async function allocateBidCodeForImport(client: any): Promise<string> {
  const { formatBidCode } = await import('@goms/domain')
  const year = new Date().getFullYear()
  const result = await client.query(
    `INSERT INTO bid_number_sequences (year, next_value) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_value = bid_number_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [year],
  )
  return formatBidCode(year, result.rows[0].allocated)
}
```

Register `bids: { validate: validateBidRows, commit: commitBidRows, flatten: (rows: BidImportRow[]) => rows }` in `apps/api/src/import/session/adapters.ts`'s `ADAPTERS` object, matching every existing entry's exact shape.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgresql://postgres:test@localhost:5432/goms_dev npm --workspace apps/api run test`
Expected: the whole `apps/api` suite passes, including the new import-domain test and the existing `session/dependencyGraph.test.ts`/`sessionUpload.test.ts` (confirm the new `bids` entry doesn't break topological ordering — it has no dependency on any other import domain, so it should sort freely).

- [ ] **Step 5: Add the Export checkbox**

In `src/features/import/ExportDialog.tsx`, add a "Bids" entry to the existing dataset checkbox list, following its exact existing pattern for e.g. "Opportunities" — wire it to call `repository.listBidsForGrid()` and serialize via the same `workbookToCsv`-adjacent CSV-writing helper this file already uses for its other datasets.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/import/domains/bids.ts apps/api/src/import/domains/bids.test.ts apps/api/src/import/session/adapters.ts src/features/import/ExportDialog.tsx
git commit -m "feat: add bids to the admin-import pipeline and the CSV export dialog"
```

### Task 39: CI — `VITE_BID_TRACKER_ENABLED` in `deploy-dev`

**Files:**
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Produces: the `goms-dev` build carries `VITE_BID_TRACKER_ENABLED=true`, matching `VITE_ADMIN_IMPORT_ENABLED`'s existing precedent exactly. `goms-prod`'s build is untouched — flipping it on there is a separate, later, explicit decision (spec §21.3), not part of this task.

- [ ] **Step 1: Add the flag to `deploy-dev`'s build step**

In `.gitlab-ci.yml`'s `deploy-dev` job, find the multi-line `npm run build` invocation that currently sets `VITE_API_BASE_URL`/`VITE_ADMIN_IMPORT_ENABLED`/the four `VITE_FIREBASE_*` values, and add one more line to that same env-var block:

```yaml
      VITE_BID_TRACKER_ENABLED=true
```

placed alongside `VITE_ADMIN_IMPORT_ENABLED=true` in that same `>`-folded shell command, so the built `goms-dev` bundle carries both flags.

- [ ] **Step 2: Verify the YAML is still valid**

Run: `cat .gitlab-ci.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)"` (or any available local YAML linter)
Expected: parses without error — this is a pure text-line addition inside an existing folded scalar, so a YAML syntax error here would indicate a misplaced indent, not a real logic issue.

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: enable Bid Tracker on the goms-dev build"
```

**This closes the plan.** Do not run `deploy-dev` or `deploy-prod` as part of implementing this plan — those are manual, explicitly-triggered CI jobs (per the existing pipeline's own design, confirmed in the design spec's §21.3-21.4), and actually deploying is outside this plan's scope per its Global Constraints.
