# Sales Org Chart Tree + Sales Team Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Sales Team → Org Chart as a real top-down tree with connectors, and add a Sales Team Insights section to the Insights dashboard alongside Relationship Analytics — both driven only by data that genuinely exists today.

**Architecture:** Extract a pure `buildSalesOrgTree` function (manager grouping + orphan/cycle safety) shared by both features. Build a lightweight, purpose-built canvas for the org chart that reuses only the generic `CanvasProvider`/`computeEdges`/`elbowPath` primitives from the existing hierarchy-canvas engine (not the whole `HierarchyCanvas`). Build a pure `computeSalesTeamInsights` function consuming already-fetched React Query data, rendered through the existing Insights visual primitives (`Panel`/`StatCard`/`Bar`), extracted out of `RelationshipAnalytics.tsx` so both dashboards share one visual language. A new `Insights.tsx` tab shell wraps both.

**Tech Stack:** React 18, TypeScript, TanStack Query, react-router-dom, Tailwind, Vitest + Testing Library (existing stack — no new dependencies).

**Spec:** No separate spec file exists for this feature — the user approved the read-only audit findings and then approved this plan's own design in conversation on 2026-09-28. The "Approved Requirements" section immediately below is the spec this plan implements; it travels with this document.

## Approved Requirements (spec)

**1. Sales Team → Org Chart**
- Real top-down tree from `sales_postings.manager_id` only — never designation/tier/name/ordering, never `gm_override_id`, never the RM→GM→SalesHead ownership chain (`sales-hierarchy.ts`).
- Parent → child connectors (real lines, not indentation).
- Card: avatar (initials now, photo-ready later), full name, designation, email if available.
- Expand/collapse per branch + an obvious Expand all / Collapse all control.
- People with no manager → root nodes (expected, not an error).
- Orphaned/invalid manager references and manager cycles → handled safely, never inventing a parent, never silently dropping the person.
- Scrolls for large trees (no requirement for pan/zoom/drag-reparent).
- Visually distinct from Roster's flat list.
- Do not fork all of `HierarchyCanvas` — reuse only the edge/expand-state primitives.
- `gm_override_id` is a separate, informational override field (surfaced today in `SalesPersonDetails.tsx`/`SalesPersonFormDialog.tsx`) — it must not create a second tree edge.

**2. Insights → Sales Team Insights**
- New tab alongside the existing Relationship Analytics tab; Relationship Analytics unchanged.
- Metrics, only where the data genuinely supports them:
  - Exact: total members, status breakdown, team size by manager, ownership distribution, open follow-ups by assignee.
  - Partial (must say so): opportunities by salesperson and pipeline value (via `ownership_assignments` only, never the legacy `salesPersonEmail` field; pipeline value grouped by unit, never blended across units; unparseable values counted and excluded, not coerced to 0).
  - Ownership is never resolved by silent array/object ordering: if an entity somehow has more than one open `role: 'owner'` assignment (the DB constraint should prevent it, but the code must not trust that blindly), it is ambiguous — excluded from attribution and counted separately, never resolved by picking whichever row comes first.
  - Partial (must say so): activity/meeting volume — only events with an ID-carrying `attendees[].salesPersonId`; legacy name-only attendee entries counted as excluded, not guessed.
  - Excluded entirely: literal `customers` table ownership (no owner field exists there).
- Reuses the existing Insights visual system (`Panel`/`StatCard`/`Bar`/donut), not a new framework.
- Useful empty states, not misleading zeroes.

## Global Constraints

- No new npm dependencies (no react-flow, no d3-hierarchy) — the tree layout is plain flexbox + one SVG overlay, matching the existing canvas engine's own approach.
- Never treat `gm_override_id` or `sales-hierarchy.ts`'s RM→GM→SalesHead chain as the org-chart tree edge — the only edge is `SalesPosting.managerId`.
- Never attribute an opportunity via `Opportunity.salesPersonEmail` in any Insights metric — only `OwnershipAssignment` rows.
- Never sum `Opportunity.valueAmount` across different `valueUnit`s into one blended figure.
- Never pick an owner by array/object iteration order — if an entity has more than one open `role: 'owner'` `OwnershipAssignment` row, treat it as ambiguous and exclude it from attribution rather than silently choosing one.
- Never join a `TimelineEvent` to a salesperson via a legacy plain-string attendee name — only `AttendeeRef.salesPersonId`.
- `SalesPerson` has no `photoUrl` field today — every new Avatar call site passes `photoUrl: undefined` explicitly (matching every existing call site), so adding the field later is a one-line change per call site, not a redesign.
- Preserve all existing Sales Team functionality/data-fetching (Roster and Ownership tabs, `DetailsPanel` selection, `SalesEditLockToggle`) and the existing Relationship Analytics page unchanged in behavior.

## Review Focus

- Two sales people whose `managerId` point at each other (a manager cycle) must render as two flagged root cards exactly once each, never silently disappear and never duplicate — this is the one true "invented hierarchy" risk if handled naively (Task 2).
- A person whose `managerId` points at someone no longer in the live roster (deleted/transferred out) must render as a flagged root, not silently rejoin as a bare unflagged root indistinguishable from a genuine no-manager Sales Head (Task 2).
- An opportunity with no `ownership_assignments` row must show up as "unattributed," never silently attributed via `salesPersonEmail` and never silently excluded from the total count shown to the user (Task 9).
- `Opportunity.valueAmount` rows with different `valueUnit`s for the same person must never be added together into one number; a blank or non-numeric `valueAmount` must be excluded and counted, never coerced to 0 (Task 9).
- A `TimelineEvent` whose only attendees are legacy plain-string names must be excluded from per-person activity counts and counted in `excludedLegacyCount`, never string-matched against a person's name to guess attribution (Task 9).
- An opportunity with two or more open `role: 'owner'` assignments (a data anomaly the DB constraint should prevent, but the code must never trust blindly) must be counted as ambiguous, never resolved to whichever row happens to come first in the array (Task 9).

---

## File Structure

**New files**
- `src/features/sales/salesHierarchyTree.ts` — pure tree-building logic, shared by the org chart canvas and the Insights team-by-manager metric.
- `src/features/sales/salesHierarchyTree.test.ts`
- `src/features/sales/SalesOrgChartCard.tsx` — presentational card.
- `src/features/sales/SalesOrgChartCard.test.tsx`
- `src/features/sales/SalesOrgChartBranch.tsx` — recursive branch (registers with the canvas, renders a card + its children row).
- `src/features/sales/SalesOrgChartCanvas.tsx` — top-level canvas (provider + edges + toolbar).
- `src/features/sales/SalesOrgChartCanvas.test.tsx`
- `src/features/sales/salesTeamInsights.ts` — pure metrics calculation.
- `src/features/sales/salesTeamInsights.test.ts`
- `src/data/sales-status.ts` — `STATUS_STYLE`/`STATUS_LABEL`/`STATUS_FILTERS`, extracted out of `SalesWorkspace.tsx` so the Insights page can reuse them without duplication.
- `src/app/routes/InsightsPrimitives.tsx` — `StatCard`/`Panel`/`Bar`/`Empty`/`LegendRow`/`Donut`, extracted out of `RelationshipAnalytics.tsx` so both Insights tabs share one visual language.
- `src/app/routes/SalesTeamInsights.tsx`
- `src/app/routes/SalesTeamInsights.test.tsx`
- `src/app/routes/Insights.tsx` — the new tab shell that becomes the `/analytics` route target.
- `src/app/routes/Insights.test.tsx`

**Modified files**
- `src/features/canvas/canvasContext.tsx` — export `elbowPath` (moved here from `HierarchyCanvas.tsx`) so the sales canvas can reuse it without duplicating it.
- `src/features/canvas/HierarchyCanvas.tsx` — import `elbowPath` instead of declaring it locally.
- `src/app/routes/SalesWorkspace.tsx` — remove `OrgChart`/`OrgChartNode` and the local `STATUS_*` consts; render `<SalesOrgChartCanvas />` in the Org Chart tab; import `STATUS_*` from `src/data/sales-status.ts`.
- `src/app/routes/SalesWorkspace.test.tsx` — remove the `OrgChartNode` describe block (moved to `SalesOrgChartCard.test.tsx`).
- `src/app/routes/RelationshipAnalytics.tsx` — import the extracted primitives instead of defining them locally; no behavior change.
- `src/lib/api.ts` — add `useOpenFollowUps()`.
- `src/app/router.tsx` — lazy-load `Insights` instead of `RelationshipAnalytics` at `/analytics`.

---

### Task 1: Share `elbowPath` between the existing canvas and the new sales canvas

**Files:**
- Modify: `src/features/canvas/canvasContext.tsx`
- Modify: `src/features/canvas/HierarchyCanvas.tsx:29-32`
- Test: `src/features/canvas/canvasContext.test.ts`

**Interfaces:**
- Produces: `elbowPath(e: Edge): string`, exported from `@/features/canvas/canvasContext` — consumed by Task 5 (`SalesOrgChartCanvas.tsx`) and by `HierarchyCanvas.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/canvas/canvasContext.test.ts
import { describe, expect, it } from 'vitest'
import { elbowPath } from './canvasContext'

describe('elbowPath', () => {
  it('draws a vertical-then-horizontal-then-vertical elbow between two points', () => {
    const d = elbowPath({ key: 'a->b', x1: 100, y1: 50, x2: 220, y2: 150 })
    expect(d).toBe('M 100 50 V 100 H 220 V 150')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/canvas/canvasContext.test.ts`
Expected: FAIL — `elbowPath` is not exported from `canvasContext`.

- [ ] **Step 3: Move `elbowPath` into `canvasContext.tsx` and export it**

In `src/features/canvas/canvasContext.tsx`, add near the top (after the `Edge` interface, before `DragPayload`):

```ts
export function elbowPath(e: Edge): string {
  const midY = (e.y1 + e.y2) / 2
  return `M ${e.x1} ${e.y1} V ${midY} H ${e.x2} V ${e.y2}`
}
```

In `src/features/canvas/HierarchyCanvas.tsx`, delete the local `elbowPath` function (lines 29-32) and change the import on line 2 to:

```ts
import { CanvasProvider, useCanvas, elbowPath, type Edge } from './canvasContext'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/canvas/canvasContext.test.ts src/features/canvas/HierarchyCanvas.test.tsx`
Expected: PASS — the new test passes, and the existing `HierarchyCanvas.test.tsx` suite is unaffected (same rendering, just importing the function from one file over).

- [ ] **Step 5: Commit**

```bash
git add src/features/canvas/canvasContext.tsx src/features/canvas/HierarchyCanvas.tsx src/features/canvas/canvasContext.test.ts
git commit -m "refactor(canvas): export elbowPath so it can be shared with the sales org chart"
```

---

### Task 2: `buildSalesOrgTree` — the shared, orphan/cycle-safe tree builder

**Files:**
- Create: `src/features/sales/salesHierarchyTree.ts`
- Test: `src/features/sales/salesHierarchyTree.test.ts`

**Interfaces:**
- Consumes: `SalesPerson` and `SalesPosting` from `@/lib/types` (already defined, unchanged).
- Produces: `buildSalesOrgTree(people: SalesPerson[], postings: Record<string, SalesPosting>): SalesOrgTree` where
  ```ts
  interface SalesOrgTree {
    roots: SalesPerson[]
    childrenOf: Map<string, SalesPerson[]>
    flaggedRootIds: Set<string>
  }
  ```
  Consumed by Task 5 (`SalesOrgChartCanvas.tsx`) and Task 9 (`salesTeamInsights.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/sales/salesHierarchyTree.test.ts
import { describe, expect, it } from 'vitest'
import { buildSalesOrgTree } from './salesHierarchyTree'
import type { SalesPerson, SalesPosting } from '@/lib/types'

function person(id: string, name: string): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
    notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}

describe('buildSalesOrgTree', () => {
  it('groups people under their managerId and sorts children/roots by name', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const c = person('c', 'Carol')
    const people = [a, b, c]
    const postings = { b: posting('b', 'a'), c: posting('c', 'a'), a: posting('a', null) }
    const tree = buildSalesOrgTree(people, postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.childrenOf.get('a')?.map((p) => p.id)).toEqual(['b', 'c'])
    expect(tree.flaggedRootIds.size).toBe(0)
  })

  it('treats a missing posting/managerId as a legitimate, unflagged root', () => {
    const a = person('a', 'Alice')
    const tree = buildSalesOrgTree([a], {})
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(false)
  })

  it('flags a managerId that does not resolve to anyone in the live roster as a root, without inventing a parent', () => {
    const a = person('a', 'Alice')
    const postings = { a: posting('a', 'ghost-id') }
    const tree = buildSalesOrgTree([a], postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
  })

  it('flags a self-referencing managerId as a root rather than looping', () => {
    const a = person('a', 'Alice')
    const postings = { a: posting('a', 'a') }
    const tree = buildSalesOrgTree([a], postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
  })

  it('breaks a two-person manager cycle into two flagged roots, each rendered exactly once', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const postings = { a: posting('a', 'b'), b: posting('b', 'a') }
    const tree = buildSalesOrgTree([a, b], postings)
    expect(tree.roots.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
    expect(tree.flaggedRootIds.has('b')).toBe(true)
    // Neither cycle member appears as anyone's child — no duplicate rendering.
    expect([...tree.childrenOf.values()].flat()).toHaveLength(0)
  })

  it('still nests a legitimate report under a cycle member once that member is a root', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const d = person('d', 'Dave') // reports to Alice, who is part of the a<->b cycle
    const postings = { a: posting('a', 'b'), b: posting('b', 'a'), d: posting('d', 'a') }
    const tree = buildSalesOrgTree([a, b, d], postings)
    expect(tree.roots.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(tree.flaggedRootIds.has('d')).toBe(false)
    expect(tree.childrenOf.get('a')?.map((p) => p.id)).toEqual(['d'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sales/salesHierarchyTree.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `buildSalesOrgTree`**

```ts
// src/features/sales/salesHierarchyTree.ts
import type { SalesPerson, SalesPosting } from '@/lib/types'

export interface SalesOrgTree {
  roots: SalesPerson[]
  childrenOf: Map<string, SalesPerson[]>
  /** Root ids forced there only because their `managerId` is broken (points
   *  to nobody in the live roster) or is part of a manager cycle — never a
   *  legitimate "top of the chain" person like an unmanaged Sales Head. The
   *  UI must flag these distinctly rather than rendering them the same way. */
  flaggedRootIds: Set<string>
}

/** Builds the manager -> direct-reports tree strictly from
 *  `SalesPosting.managerId` — never `gm_override_id`, designation, tier, or
 *  name/ordering (a hierarchy must not be invented from those).
 *
 *  A person with no open posting or an unset `managerId` is a legitimate
 *  root. A `managerId` that doesn't resolve to a live person, or that would
 *  require rendering a cycle, is ALSO forced to the root list — never
 *  dropped, never given an invented parent — but marked in
 *  `flaggedRootIds` so the UI can show it as broken rather than intentional. */
export function buildSalesOrgTree(
  people: SalesPerson[],
  postings: Record<string, SalesPosting>,
): SalesOrgTree {
  const byId = new Map(people.map((p) => [p.id, p]))
  const rawManagerOf = new Map<string, string | null>()
  const resolvedManagerOf = new Map<string, string | null>()
  for (const p of people) {
    const raw = postings[p.id]?.managerId ?? null
    rawManagerOf.set(p.id, raw)
    resolvedManagerOf.set(p.id, raw && byId.has(raw) ? raw : null)
  }

  // Cycle detection over the resolved-manager graph. Each person has at most
  // one outgoing edge (their manager), so this is a simple functional-graph
  // walk: a person is a cycle member only if following managers from them
  // eventually loops back to themselves. Someone who merely reports (however
  // indirectly) to a cycle member is NOT a cycle member — they still nest
  // normally under that member once the cycle is broken below.
  const cycleMembers = new Set<string>()
  const state = new Map<string, 'visiting' | 'done'>()
  function visit(id: string, path: string[]) {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      const idx = path.indexOf(id)
      for (const m of path.slice(idx)) cycleMembers.add(m)
      return
    }
    state.set(id, 'visiting')
    const next = resolvedManagerOf.get(id) ?? null
    if (next) visit(next, [...path, id])
    state.set(id, 'done')
  }
  for (const p of people) visit(p.id, [])

  const childrenOf = new Map<string, SalesPerson[]>()
  const roots: SalesPerson[] = []
  const flaggedRootIds = new Set<string>()

  for (const p of people) {
    if (cycleMembers.has(p.id)) {
      // A cycle can't be rendered as a tree — break it by treating every
      // member as its own root instead of picking a "winning" parent.
      roots.push(p)
      flaggedRootIds.add(p.id)
      continue
    }
    const managerId = resolvedManagerOf.get(p.id)
    if (managerId) {
      childrenOf.set(managerId, [...(childrenOf.get(managerId) ?? []), p])
    } else {
      roots.push(p)
      // A raw reference that didn't resolve to anyone in the live roster is
      // a broken link, not an intentional "top of the chain" — flag it
      // distinctly from a genuine no-manager root.
      if (rawManagerOf.get(p.id)) flaggedRootIds.add(p.id)
    }
  }

  for (const [, kids] of childrenOf) kids.sort((a, b) => a.name.localeCompare(b.name))
  roots.sort((a, b) => a.name.localeCompare(b.name))

  return { roots, childrenOf, flaggedRootIds }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/sales/salesHierarchyTree.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/salesHierarchyTree.ts src/features/sales/salesHierarchyTree.test.ts
git commit -m "feat(sales): add orphan/cycle-safe manager-tree builder shared by org chart and insights"
```

---

### Task 3: Extract `STATUS_STYLE`/`STATUS_LABEL`/`STATUS_FILTERS`

**Files:**
- Create: `src/data/sales-status.ts`
- Modify: `src/app/routes/SalesWorkspace.tsx:39-56` (delete the local consts, import instead)

**Interfaces:**
- Produces: `STATUS_STYLE`, `STATUS_LABEL`, `STATUS_FILTERS` from `@/data/sales-status` — consumed by `SalesWorkspace.tsx` (unchanged usage), Task 4 (`SalesOrgChartCard.tsx`), and Task 11 (`SalesTeamInsights.tsx`).

- [ ] **Step 1: Create the shared module**

```ts
// src/data/sales-status.ts
import type { SalesPerson } from '@/lib/types'

export const STATUS_STYLE: Record<SalesPerson['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700',
  onLeave: 'bg-amber-50 text-amber-700',
  resigned: 'bg-ink-900/[0.06] text-ink-600',
  inactive: 'bg-ink-900/[0.06] text-ink-600',
}

export const STATUS_LABEL: Record<SalesPerson['status'], string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

export const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'onLeave', label: 'On leave' },
  { key: 'resigned', label: 'Resigned' },
  { key: 'inactive', label: 'Inactive' },
] as const
```

- [ ] **Step 2: Update `SalesWorkspace.tsx`**

Delete lines 39-56 (the local `STATUS_STYLE`/`STATUS_LABEL`/`STATUS_FILTERS` consts) and add to the import block at the top:

```ts
import { STATUS_STYLE, STATUS_LABEL, STATUS_FILTERS } from '@/data/sales-status'
```

- [ ] **Step 3: Run the existing suite to verify no regression**

Run: `npx vitest run src/app/routes/SalesWorkspace.test.tsx`
Expected: PASS — identical behavior, only the import location changed.

- [ ] **Step 4: Commit**

```bash
git add src/data/sales-status.ts src/app/routes/SalesWorkspace.tsx
git commit -m "refactor(sales): extract status label/style/filter constants for reuse in Insights"
```

---

### Task 4: `SalesOrgChartCard` — the presentational node

**Files:**
- Create: `src/features/sales/SalesOrgChartCard.tsx`
- Test: `src/features/sales/SalesOrgChartCard.test.tsx`

**Interfaces:**
- Consumes: `STATUS_STYLE`/`STATUS_LABEL` from `@/data/sales-status` (Task 3), `Avatar` from `@/components/ui/Avatar`.
- Produces: `SalesOrgChartCard` (forwardRef<HTMLDivElement, Props>) — consumed by Task 5 (`SalesOrgChartBranch.tsx`).

```ts
interface SalesOrgChartCardProps {
  person: SalesPerson
  posting: SalesPosting | undefined
  flagged: boolean
  selected: boolean
  expanded: boolean
  canExpand: boolean
  directReportCount: number
  onSelect: () => void
  onToggle: () => void
}
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/sales/SalesOrgChartCard.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalesOrgChartCard } from './SalesOrgChartCard'
import type { SalesPerson, SalesPosting } from '@/lib/types'

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const POSTING: SalesPosting = {
  id: 'post-1', salesPersonId: 'sp-alice', designation: 'Regional Manager', tierKey: 'rm',
  managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
  changeType: 'initial', reason: '', createdAt: '', createdBy: null,
}

function baseProps(overrides: Partial<Parameters<typeof SalesOrgChartCard>[0]> = {}) {
  return {
    person: ALICE, posting: POSTING, flagged: false, selected: false, expanded: false,
    canExpand: false, directReportCount: 0, onSelect: vi.fn(), onToggle: vi.fn(),
    ...overrides,
  }
}

describe('SalesOrgChartCard', () => {
  it('renders name, designation, email, and an initials-only avatar', () => {
    render(<SalesOrgChartCard {...baseProps()} />)
    expect(screen.getByText('Alice Anderson')).toBeInTheDocument()
    expect(screen.getByText('Regional Manager')).toBeInTheDocument()
    expect(screen.getByText('alice@amnex.com')).toBeInTheDocument()
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveTextContent('AA')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn()
    render(<SalesOrgChartCard {...baseProps({ onSelect })} />)
    await userEvent.click(screen.getByText('Alice Anderson'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows an expand/collapse toggle only when it has direct reports, and does not also select', async () => {
    const onToggle = vi.fn()
    const onSelect = vi.fn()
    render(<SalesOrgChartCard {...baseProps({ canExpand: true, directReportCount: 3, onToggle, onSelect })} />)
    await userEvent.click(screen.getByTestId('sales-org-chart-toggle-sp-alice'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks a flagged (broken-reference) node distinctly', () => {
    render(<SalesOrgChartCard {...baseProps({ flagged: true })} />)
    expect(screen.getByTestId('sales-org-chart-card-sp-alice')).toHaveClass('border-dashed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sales/SalesOrgChartCard.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the card**

```tsx
// src/features/sales/SalesOrgChartCard.tsx
import { forwardRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, STATUS_STYLE } from '@/data/sales-status'
import type { SalesPerson, SalesPosting } from '@/lib/types'

export const SalesOrgChartCard = forwardRef<HTMLDivElement, {
  person: SalesPerson
  posting: SalesPosting | undefined
  flagged: boolean
  selected: boolean
  expanded: boolean
  canExpand: boolean
  directReportCount: number
  onSelect: () => void
  onToggle: () => void
}>(({ person, posting, flagged, selected, expanded, canExpand, directReportCount, onSelect, onToggle }, ref) => (
  <div
    ref={ref}
    data-canvas-card
    data-testid={`sales-org-chart-card-${person.id}`}
    onClick={onSelect}
    className={cn(
      'relative flex w-[220px] cursor-pointer flex-col items-center gap-2 rounded-card border bg-white px-3.5 py-3 text-center shadow-panel transition-colors',
      selected ? 'border-ink-900/30 ring-2 ring-ink-900/10' : 'border-line hover:border-ink-600/40',
      flagged && 'border-dashed border-amber',
    )}
  >
    <Avatar person={{ name: person.name, photoUrl: undefined }} size="md" />
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold text-ink-900">{person.name}</div>
      <div className="truncate text-[11px] text-muted">{posting?.designation || '—'}</div>
      {person.officialEmail && (
        <div className="truncate text-[10px] text-muted/80">{person.officialEmail}</div>
      )}
    </div>
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLE[person.status])}>
      {STATUS_LABEL[person.status] ?? person.status}
    </span>
    {flagged && (
      <Tooltip label="This person's reporting-manager reference is broken or circular — shown as a root rather than guessing a parent.">
        <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Icon name="CircleAlert" size={11} />
        </span>
      </Tooltip>
    )}
    {canExpand && (
      <Tooltip label={expanded ? 'Collapse' : `Show ${directReportCount} direct report${directReportCount === 1 ? '' : 's'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          data-testid={`sales-org-chart-toggle-${person.id}`}
          className={cn(
            'absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border bg-white text-muted shadow-sm hover:border-ink-600 hover:text-ink-900',
            expanded && 'border-ink-600 text-ink-900',
          )}
        >
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      </Tooltip>
    )}
  </div>
))
SalesOrgChartCard.displayName = 'SalesOrgChartCard'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/sales/SalesOrgChartCard.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/SalesOrgChartCard.tsx src/features/sales/SalesOrgChartCard.test.tsx
git commit -m "feat(sales): add SalesOrgChartCard, the org-chart tree's presentational node"
```

---

### Task 5: `SalesOrgChartBranch` + `SalesOrgChartCanvas` — the tree itself

**Files:**
- Create: `src/features/sales/SalesOrgChartBranch.tsx`
- Create: `src/features/sales/SalesOrgChartCanvas.tsx`
- Test: `src/features/sales/SalesOrgChartCanvas.test.tsx`

**Interfaces:**
- Consumes: `buildSalesOrgTree`/`SalesOrgTree` (Task 2), `SalesOrgChartCard` (Task 4), `CanvasProvider`/`useCanvas`/`elbowPath`/`type Edge` from `@/features/canvas/canvasContext` (Task 1), `useCurrentPostings`/`useSalesPersons` from `@/lib/api`, `useWorkspace` from `@/features/workspace/context`.
- Produces: `SalesOrgChartCanvas` (no props) — consumed by Task 6 (`SalesWorkspace.tsx`'s Org Chart tab) and visually verified in Task 7.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/sales/SalesOrgChartCanvas.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { SalesOrgChartCanvas } from './SalesOrgChartCanvas'
import type { SalesPerson, SalesPosting } from '@/lib/types'

vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn() }),
}))

function person(id: string, name: string): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
    notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}

const ALICE = person('a', 'Alice')
const BOB = person('b', 'Bob')

function stub(people: SalesPerson[], postings: Record<string, SalesPosting>) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: postings } as unknown as ReturnType<typeof api.useCurrentPostings>)
}

describe('SalesOrgChartCanvas', () => {
  it('shows an empty state when there are no sales people', () => {
    stub([], {})
    render(<SalesOrgChartCanvas />)
    expect(screen.getByText(/No sales people yet/i)).toBeInTheDocument()
  })

  it('renders a root and, once expanded, its direct report — with a connecting line', async () => {
    stub([ALICE, BOB], { b: posting('b', 'a'), a: posting('a', null) })
    render(<SalesOrgChartCanvas />)
    expect(screen.getByTestId('sales-org-chart-card-a')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('sales-org-chart-toggle-a'))
    expect(screen.getByTestId('sales-org-chart-card-b')).toBeInTheDocument()
    expect(document.querySelector('svg path')).toBeTruthy()
  })

  it('Expand all reveals every branch without individually toggling each one', async () => {
    stub([ALICE, BOB], { b: posting('b', 'a'), a: posting('a', null) })
    render(<SalesOrgChartCanvas />)
    expect(screen.queryByTestId('sales-org-chart-card-b')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Expand all/i }))
    expect(screen.getByTestId('sales-org-chart-card-b')).toBeInTheDocument()
  })

  it('renders a broken manager reference as its own flagged root instead of disappearing', () => {
    stub([ALICE], { a: posting('a', 'ghost') })
    render(<SalesOrgChartCanvas />)
    const card = screen.getByTestId('sales-org-chart-card-a')
    expect(within(card).getByText('Alice')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sales/SalesOrgChartCanvas.test.tsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `SalesOrgChartBranch`**

```tsx
// src/features/sales/SalesOrgChartBranch.tsx
import { useLayoutEffect, useRef } from 'react'
import { useCanvas } from '@/features/canvas/canvasContext'
import { useWorkspace } from '@/features/workspace/context'
import { SalesOrgChartCard } from './SalesOrgChartCard'
import type { SalesOrgTree } from './salesHierarchyTree'
import type { SalesPerson, SalesPosting } from '@/lib/types'

export function SalesOrgChartBranch({ person, depth, parentKey, tree, postings, ws }: {
  person: SalesPerson
  depth: number
  parentKey: string | null
  tree: SalesOrgTree
  postings: Record<string, SalesPosting>
  ws: ReturnType<typeof useWorkspace>
}) {
  const canvas = useCanvas()
  const key = `sp:${person.id}`
  const kids = tree.childrenOf.get(person.id) ?? []
  const expanded = canvas.isExpanded(key, depth)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    canvas.setCardRef(key, ref.current)
    if (parentKey) canvas.setParent(key, parentKey)
    return () => {
      canvas.setCardRef(key, null)
      if (parentKey) canvas.clearParent(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, parentKey])

  return (
    <div className="flex flex-col items-center">
      <SalesOrgChartCard
        ref={ref}
        person={person}
        posting={postings[person.id]}
        flagged={tree.flaggedRootIds.has(person.id)}
        selected={ws.selection?.kind === 'salesPerson' && ws.selection.id === person.id}
        expanded={expanded}
        canExpand={kids.length > 0}
        directReportCount={kids.length}
        onSelect={() => ws.select('salesPerson', person.id)}
        onToggle={() => canvas.setNodeExpanded(key, depth, !expanded)}
      />
      {expanded && kids.length > 0 && (
        <div className="mt-8 flex items-start gap-8">
          {kids.map((k) => (
            <SalesOrgChartBranch key={k.id} person={k} depth={depth + 1} parentKey={key} tree={tree} postings={postings} ws={ws} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement `SalesOrgChartCanvas`**

```tsx
// src/features/sales/SalesOrgChartCanvas.tsx
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { CanvasProvider, elbowPath, useCanvas, type Edge } from '@/features/canvas/canvasContext'
import { useWorkspace } from '@/features/workspace/context'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { buildSalesOrgTree } from './salesHierarchyTree'
import { SalesOrgChartBranch } from './SalesOrgChartBranch'

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted">
        <Icon name={icon} size={18} />
      </div>
      <p className="text-sm text-muted">{message}</p>
    </div>
  )
}

export function SalesOrgChartCanvas() {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return (
    <CanvasProvider onChange={bump}>
      <SalesOrgChartStage version={version} />
    </CanvasProvider>
  )
}

function SalesOrgChartStage({ version }: { version: number }) {
  const canvas = useCanvas()
  const ws = useWorkspace()
  const { data: people = [], isLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edge[]>([])

  const tree = buildSalesOrgTree(people, postings)

  const recompute = useCallback(() => {
    setEdges(canvas.computeEdges(contentRef.current))
  }, [canvas])

  useLayoutEffect(() => { recompute() }, [version, recompute, tree.roots.length])
  useLayoutEffect(() => {
    if (!contentRef.current) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [recompute])

  if (isLoading) return <p className="px-4 py-6 text-sm text-muted">Loading org chart…</p>
  if (people.length === 0) {
    return <EmptyState icon="Network" message="No sales people yet — add your first one from the Roster tab." />
  }

  return (
    <div className="relative flex h-full w-full flex-col" data-testid="sales-org-chart">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-line bg-white/90 px-3 py-1.5">
        <Tooltip label="Expand all branches">
          <button
            onClick={() => canvas.setAllExpanded(true)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-600 hover:bg-panel hover:text-ink-900"
          >
            <Icon name="ChevronsDown" size={13} /> Expand all
          </button>
        </Tooltip>
        <Tooltip label="Collapse all branches">
          <button
            onClick={() => canvas.setAllExpanded(false)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-600 hover:bg-panel hover:text-ink-900"
          >
            <Icon name="ChevronsUp" size={13} /> Collapse all
          </button>
        </Tooltip>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-6">
        <div ref={contentRef} className="relative inline-flex items-start gap-8">
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {edges.map((e) => (
              <path key={e.key} d={elbowPath(e)} fill="none" stroke="#B7C2D0" strokeWidth={1.5} />
            ))}
          </svg>
          {tree.roots.map((person) => (
            <SalesOrgChartBranch
              key={person.id}
              person={person}
              depth={0}
              parentKey={null}
              tree={tree}
              postings={postings}
              ws={ws}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/sales/SalesOrgChartCanvas.test.tsx`
Expected: PASS (all 4 tests). Note: `jsdom` has no real layout engine, so `computeEdges` will return zero-sized rects — the test only asserts an `<svg><path>` element exists, not real coordinates (matching how `HierarchyCanvas.test.tsx` already treats layout-derived geometry as untestable under jsdom).

- [ ] **Step 6: Commit**

```bash
git add src/features/sales/SalesOrgChartBranch.tsx src/features/sales/SalesOrgChartCanvas.tsx src/features/sales/SalesOrgChartCanvas.test.tsx
git commit -m "feat(sales): add SalesOrgChartCanvas, a top-down tree with connectors and expand/collapse"
```

---

### Task 6: Wire the new canvas into the Org Chart tab

**Files:**
- Modify: `src/app/routes/SalesWorkspace.tsx:392-478` (delete `OrgChartNode` and `OrgChart`, render `SalesOrgChartCanvas` instead)
- Modify: `src/app/routes/SalesWorkspace.test.tsx` (remove the `OrgChartNode avatar` describe block, lines 45-64; remove the now-unused `OrgChartNode` import)

**Interfaces:**
- Consumes: `SalesOrgChartCanvas` from `@/features/sales/SalesOrgChartCanvas` (Task 5).

- [ ] **Step 1: Update `SalesWorkspace.tsx`**

Delete lines 392-478 (the `OrgChartNode` export and `OrgChart` function) entirely. Add to the import block:

```ts
import { SalesOrgChartCanvas } from '@/features/sales/SalesOrgChartCanvas'
```

In `SalesWorkspaceBody` (around line 512), change:

```tsx
{active.key === 'roster' ? <Roster /> : active.key === 'orgchart' ? <OrgChart /> : <Ownership />}
```

to:

```tsx
{active.key === 'roster' ? <Roster /> : active.key === 'orgchart' ? <SalesOrgChartCanvas /> : <Ownership />}
```

- [ ] **Step 2: Update `SalesWorkspace.test.tsx`**

Remove the `import { Ownership, OrgChartNode, RosterRow } from './SalesWorkspace'` line's `OrgChartNode` (leave `Ownership, RosterRow`), and delete the entire `describe('OrgChartNode avatar (Task 9.3)', ...)` block (lines 45-64) — that coverage now lives in `SalesOrgChartCard.test.tsx` (Task 4).

- [ ] **Step 3: Run the full Sales Team test suite**

Run: `npx vitest run src/app/routes/SalesWorkspace.test.tsx src/features/sales/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/routes/SalesWorkspace.tsx src/app/routes/SalesWorkspace.test.tsx
git commit -m "feat(sales): replace the flat Org Chart list with the connected-tree canvas"
```

---

### Task 7: Visual verification of the Org Chart canvas (browser check)

The jsdom tests in Tasks 2, 4, and 5 verify structure (correct grouping, correct props, correct DOM nodes) but jsdom has no real layout engine — it cannot confirm the tree actually *looks* like a top-down hierarchy with aligned connectors, or that scrolling/expand-collapse feel right at a larger size. This task is a manual/visual check in a real browser, not new automated test code — no test file is added or committed here, and no source file changes either. It exists specifically so a rendering or layout mistake that jsdom cannot see isn't discovered only after Task 12 ships the whole feature.

**Files:** none (no code changes — verification only).

**Interfaces:** none produced. Consumes the fully-wired Org Chart tab from Task 6.

- [ ] **Step 1: Start the app against local, non-production data**

Run the frontend alone, with no `VITE_API_BASE_URL` set, so it uses the in-memory repository seeded by `buildSalesRoster()` (`src/data/sales-roster-seed.ts`), which is the existing `SALES_TEAM` roster already used for local dev/demo — not production data:

```bash
npm run dev
```

Open the printed local URL and navigate to **Sales Team → Org Chart** (`/sales/orgchart`).

- [ ] **Step 2: Check the base tree renders top-down with aligned connectors**

Confirm: the roots render across the top, each root's direct reports render in a row beneath it, and every parent→child pair has a visible elbow line connecting the bottom-center of the parent card to the top-center of the child card — not a floating line, not an indentation-only list. Expand a few branches (the seeded roster has more than one management level) and confirm connectors re-align correctly as new rows appear.

- [ ] **Step 3: Check expand/collapse, per-node and bulk**

Click a single node's chevron toggle and confirm only that branch's children show/hide, siblings unaffected. Click **Collapse all**, confirm every branch (including root-level ones) collapses to just the root row. Click **Expand all**, confirm the full tree reappears, connectors included.

- [ ] **Step 4: Check multiple root branches render side by side**

Confirm the seeded roster's multiple top-level roots (people with no manager) render as separate, non-overlapping trees side by side, each independently expandable/collapsible.

- [ ] **Step 5: Check flagged orphan/cycle roots, created and reverted locally**

Using the app's own existing "unlock editing" + sales-person edit flow (`SalesEditLockToggle` + `SalesPersonFormDialog`'s manager field — no script, no direct DB/API write), temporarily:
  - Set one person's manager to someone who no longer has a current posting, or clear-then-reset in a way that leaves a stale reference if the UI allows it — if the UI's own validation prevents constructing an invalid reference this way, note that as a finding rather than forcing one through another path.
  - Set two people's managers to point at each other (A → B, B → A).

Confirm both cases render as **flagged root cards** (dashed border + warning icon per Task 4) rather than disappearing or duplicating anywhere in the tree. Then revert both edits back to their original values (or discard, if using the in-memory repository, by simply reloading the page — in-memory state doesn't persist).

- [ ] **Step 6: Check scrolling with a larger tree**

With Expand all active on the full seeded roster, confirm the canvas scrolls both directions (`overflow-auto`) to reach every card without any card being clipped, and that the Expand all/Collapse all toolbar stays reachable (not scrolled out of view) while the tree area scrolls beneath it.

- [ ] **Step 7: Record the outcome**

No commit for this task (nothing changed). If every check in Steps 2-6 passes, proceed to Task 8. If any check fails, fix the specific issue in the relevant earlier task's files (Task 4/5/6), re-run that task's automated tests, and repeat this task's checks before proceeding — do not continue to Task 8 with a known visual defect.

---

### Task 8: `useOpenFollowUps` hook

**Files:**
- Modify: `src/lib/api.ts` (add near `useFollowUps`, after line 214)

**Interfaces:**
- Produces: `useOpenFollowUps(): UseQueryResult<FollowUp[]>` — consumed by Task 11 (`SalesTeamInsights.tsx`).

- [ ] **Step 1: Add the hook**

`repository.listOpenFollowUps()` and the `qk.openFollowUps` query key already exist (`src/data/in-memory/repository.ts:1603`, `src/data/remote/repository.ts:214`, `src/lib/api.ts:38`) — only the hook wrapper is missing. Add directly below `useFollowUps` in `src/lib/api.ts`:

```ts
/** Every open follow-up across every entity — used by Sales Team Insights'
 *  "open follow-ups by assignee" metric, not scoped to one entity. */
export const useOpenFollowUps = () =>
  useQuery({ queryKey: qk.openFollowUps, queryFn: () => repository.listOpenFollowUps() })
```

(`useFollowUpMutations`'s `invalidate()` already invalidates `['openFollowUps']` at line 219 — no change needed there.)

- [ ] **Step 2: Verify the app still typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): add useOpenFollowUps hook for Sales Team Insights"
```

---

### Task 9: `computeSalesTeamInsights` — the pure metrics module

**Files:**
- Create: `src/features/sales/salesTeamInsights.ts`
- Test: `src/features/sales/salesTeamInsights.test.ts`

**Interfaces:**
- Consumes: `buildSalesOrgTree` (Task 2), `attendeeSalesPersonId` from `@/lib/attendees` (existing), `FollowUp`/`OwnershipAssignment`/`Opportunity`/`SalesPerson`/`SalesPosting`/`TimelineEvent` from `@/lib/types` (existing, unchanged).
- Produces: `computeSalesTeamInsights(input): SalesTeamInsightsData` and `parseOpportunityValue(raw: string): number | null` — consumed by Task 9 (`SalesTeamInsights.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/sales/salesTeamInsights.test.ts
import { describe, expect, it } from 'vitest'
import { computeSalesTeamInsights, parseOpportunityValue } from './salesTeamInsights'
import type {
  FollowUp, Opportunity, OwnershipAssignment, SalesPerson, SalesPosting, TimelineEvent,
} from '@/lib/types'

function person(id: string, name: string, status: SalesPerson['status'] = 'active'): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status,
    notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}
function ownership(overrides: Partial<OwnershipAssignment>): OwnershipAssignment {
  return {
    id: 'own-1', entityType: 'orgNode', entityId: 'e1', salesPersonId: 'a', role: 'owner',
    startDate: '2024-01-01', endDate: null, reason: 'initial', batchId: null, note: '',
    createdAt: '', createdBy: null, ...overrides,
  }
}
function opportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: 'opp-1', departmentId: 'd1', stateCode: 1, stageKey: 'pipeline', closedOn: null,
    opportunityName: 'Deal', gemTenderId: '', publishDate: '', submissionDate: '', vertical: '',
    component: [], quantity: '', currency: 'INR', valueAmount: '', valueUnit: 'lakh',
    budgetKnown: '', emdAmount: '', emdUnit: '', salesPersonEmail: '', createdAt: '', createdBy: null,
    ...overrides,
  }
}
function followUp(overrides: Partial<FollowUp>): FollowUp {
  return {
    id: 'fu-1', entityType: 'contact', entityId: 'e1', assigneeId: null, dueDate: '2026-01-01',
    status: 'open', note: '', createdAt: '', createdBy: null, ...overrides,
  }
}
function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'ev-1', employeeId: 'e1', type: 'meeting', title: 'Meeting', date: '2026-01-01',
    note: '', source: 'manual', ...overrides,
  }
}

const ASOF = '2026-06-01'

describe('parseOpportunityValue', () => {
  it('parses a plain number', () => expect(parseOpportunityValue('42.5')).toBe(42.5))
  it('strips thousands separators', () => expect(parseOpportunityValue('1,234')).toBe(1234))
  it('treats a blank string as missing, not zero', () => expect(parseOpportunityValue('')).toBeNull())
  it('treats non-numeric text as unparseable', () => expect(parseOpportunityValue('TBD')).toBeNull())
})

describe('computeSalesTeamInsights', () => {
  it('counts total members and status breakdown', () => {
    const people = [person('a', 'Alice', 'active'), person('b', 'Bob', 'onLeave')]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.totalMembers).toBe(2)
    expect(data.statusBreakdown).toEqual({ active: 1, onLeave: 1, resigned: 0, inactive: 0 })
  })

  it('derives team-by-manager from the same tree as the org chart', () => {
    const people = [person('a', 'Alice'), person('b', 'Bob'), person('c', 'Carol')]
    const postings = { b: posting('b', 'a'), c: posting('c', 'a') }
    const data = computeSalesTeamInsights({
      people, postings, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.teamByManager).toEqual([{ managerId: 'a', managerName: 'Alice', directReportCount: 2 }])
  })

  it('counts ownership only for open, role=owner assignments, split by entity type', () => {
    const people = [person('a', 'Alice')]
    const ownershipRows = [
      ownership({ entityType: 'orgNode', salesPersonId: 'a' }),
      ownership({ entityType: 'contact', salesPersonId: 'a', id: 'own-2' }),
      ownership({ entityType: 'orgNode', salesPersonId: 'a', id: 'own-3', role: 'delegate' }),
      ownership({ entityType: 'orgNode', salesPersonId: 'a', id: 'own-4', endDate: '2025-01-01' }), // closed before asOf
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.ownershipByPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', orgNode: 1, contact: 1, opportunity: 0, total: 2 }])
  })

  it('groups open follow-ups by assignee, with a distinct Unassigned bucket', () => {
    const people = [person('a', 'Alice')]
    const followUps = [followUp({ assigneeId: 'a' }), followUp({ assigneeId: 'a', id: 'fu-2' }), followUp({ assigneeId: null, id: 'fu-3' })]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: followUps, timelineEvents: [], asOf: ASOF,
    })
    expect(data.followUpsByAssignee).toContainEqual({ salesPersonId: 'a', name: 'Alice', count: 2 })
    expect(data.followUpsByAssignee).toContainEqual({ salesPersonId: null, name: 'Unassigned', count: 1 })
  })

  it('attributes opportunities only via ownership_assignments, never salesPersonEmail, and counts the rest as unattributed', () => {
    const people = [person('a', 'Alice')]
    const opportunities = [
      opportunity({ id: 'opp-owned', salesPersonEmail: 'someone-else@amnex.com' }),
      opportunity({ id: 'opp-bare', salesPersonEmail: 'a@amnex.com' }), // legacy field only — must NOT be attributed
    ]
    const ownershipRows = [ownership({ entityType: 'opportunity', entityId: 'opp-owned', salesPersonId: 'a' })]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.opportunities.byPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', count: 1 }])
    expect(data.opportunities.unattributedCount).toBe(1)
  })

  it('treats an opportunity with more than one open owner assignment as ambiguous, never picking one by array order', () => {
    const people = [person('a', 'Alice'), person('b', 'Bob')]
    const opportunities = [opportunity({ id: 'opp-conflict' })]
    // The DB's `ownership_assignments_one_open_owner_per_entity` constraint
    // should prevent this, but the pure function must not assume the
    // invariant holds — it must never resolve the conflict by picking
    // whichever row happens to come first or last.
    const ownershipRows = [
      ownership({ id: 'own-a', entityType: 'opportunity', entityId: 'opp-conflict', salesPersonId: 'a' }),
      ownership({ id: 'own-b', entityType: 'opportunity', entityId: 'opp-conflict', salesPersonId: 'b' }),
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.opportunities.byPerson).toEqual([])
    expect(data.opportunities.unattributedCount).toBe(0)
    expect(data.opportunities.ambiguousCount).toBe(1)
  })

  it('groups pipeline value by unit and never blends lakh with crore, excluding unparseable amounts', () => {
    const people = [person('a', 'Alice')]
    const opportunities = [
      opportunity({ id: 'o1', valueAmount: '10', valueUnit: 'lakh' }),
      opportunity({ id: 'o2', valueAmount: '20', valueUnit: 'lakh' }),
      opportunity({ id: 'o3', valueAmount: '3', valueUnit: 'crore' }),
      opportunity({ id: 'o4', valueAmount: 'TBD', valueUnit: 'lakh' }),
    ]
    const ownershipRows = opportunities.map((o) => ownership({ entityType: 'opportunity', entityId: o.id, salesPersonId: 'a', id: `own-${o.id}` }))
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    const row = data.pipelineValue.byPerson[0]
    expect(row.totalsByUnit).toContainEqual({ unit: 'lakh', total: 30, count: 2 })
    expect(row.totalsByUnit).toContainEqual({ unit: 'crore', total: 3, count: 1 })
    expect(row.unparseableCount).toBe(1)
  })

  it('counts activity only from events with an ID-carrying attendee, excluding legacy name-only entries', () => {
    const people = [person('a', 'Alice')]
    const events = [
      event({ id: 'ev-a', attendees: [{ salesPersonId: 'a', name: 'Alice' }] }),
      event({ id: 'ev-legacy', attendees: ['Alice Anderson'] }),
      event({ id: 'ev-none' }),
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: events, asOf: ASOF,
    })
    expect(data.activity.byPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', count: 1 }])
    expect(data.activity.reliableEventCount).toBe(1)
    expect(data.activity.excludedLegacyCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sales/salesTeamInsights.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the module**

```ts
// src/features/sales/salesTeamInsights.ts
import { buildSalesOrgTree } from './salesHierarchyTree'
import { attendeeSalesPersonId } from '@/lib/attendees'
import type {
  FollowUp, Opportunity, OwnershipAssignment, SalesPerson, SalesPosting, TimelineEvent,
} from '@/lib/types'

export interface TeamByManager {
  managerId: string
  managerName: string
  directReportCount: number
}
export interface OwnershipByPerson {
  salesPersonId: string
  name: string
  orgNode: number
  contact: number
  opportunity: number
  total: number
}
export interface FollowUpsByAssignee {
  /** null = follow-ups with no assignee set. */
  salesPersonId: string | null
  name: string
  count: number
}
export interface OpportunitiesByPerson {
  salesPersonId: string
  name: string
  count: number
}
export interface PipelineValueUnitTotal {
  unit: string
  total: number
  count: number
}
export interface PipelineValueByPerson {
  salesPersonId: string
  name: string
  totalsByUnit: PipelineValueUnitTotal[]
  unparseableCount: number
}
export interface ActivityByPerson {
  salesPersonId: string
  name: string
  count: number
}
export interface SalesTeamInsightsData {
  totalMembers: number
  statusBreakdown: Record<SalesPerson['status'], number>
  teamByManager: TeamByManager[]
  rootCount: number
  flaggedCount: number
  ownershipByPerson: OwnershipByPerson[]
  followUpsByAssignee: FollowUpsByAssignee[]
  opportunities: { byPerson: OpportunitiesByPerson[]; unattributedCount: number; ambiguousCount: number }
  pipelineValue: { byPerson: PipelineValueByPerson[] }
  activity: { byPerson: ActivityByPerson[]; reliableEventCount: number; excludedLegacyCount: number }
}

function nameOf(people: SalesPerson[], id: string | null): string {
  if (!id) return 'Unassigned'
  return people.find((p) => p.id === id)?.name ?? id
}

function isOpenAssignment(a: OwnershipAssignment, asOf: string): boolean {
  return a.startDate <= asOf && (a.endDate === null || asOf < a.endDate)
}

/** Parses a GOMS opportunity value field (`valueAmount`/`emdAmount`) safely.
 *  These are free TEXT — a blank string is the documented "not yet entered"
 *  default, never a real zero, so it's excluded rather than counted as ₹0.
 *  Anything else that doesn't parse to a finite number is excluded too,
 *  rather than silently coerced. */
export function parseOpportunityValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function computeSalesTeamInsights(input: {
  people: SalesPerson[]
  postings: Record<string, SalesPosting>
  ownership: OwnershipAssignment[]
  opportunities: Opportunity[]
  openFollowUps: FollowUp[]
  timelineEvents: TimelineEvent[]
  asOf: string
}): SalesTeamInsightsData {
  const { people, postings, ownership, opportunities, openFollowUps, timelineEvents, asOf } = input

  const statusBreakdown: Record<SalesPerson['status'], number> = {
    active: 0, onLeave: 0, resigned: 0, inactive: 0,
  }
  for (const p of people) statusBreakdown[p.status] += 1

  const tree = buildSalesOrgTree(people, postings)
  const teamByManager: TeamByManager[] = [...tree.childrenOf.entries()]
    .map(([managerId, kids]) => ({ managerId, managerName: nameOf(people, managerId), directReportCount: kids.length }))
    .sort((a, b) => b.directReportCount - a.directReportCount)

  const openOwnership = ownership.filter((a) => a.role === 'owner' && isOpenAssignment(a, asOf))
  const ownershipByPersonMap = new Map<string, OwnershipByPerson>()
  for (const a of openOwnership) {
    const row = ownershipByPersonMap.get(a.salesPersonId) ?? {
      salesPersonId: a.salesPersonId, name: nameOf(people, a.salesPersonId), orgNode: 0, contact: 0, opportunity: 0, total: 0,
    }
    if (a.entityType === 'orgNode') row.orgNode += 1
    else if (a.entityType === 'contact') row.contact += 1
    else if (a.entityType === 'opportunity') row.opportunity += 1
    row.total += 1
    ownershipByPersonMap.set(a.salesPersonId, row)
  }
  const ownershipByPerson = [...ownershipByPersonMap.values()].sort((a, b) => b.total - a.total)

  const followUpsByAssigneeMap = new Map<string | null, number>()
  for (const f of openFollowUps) followUpsByAssigneeMap.set(f.assigneeId, (followUpsByAssigneeMap.get(f.assigneeId) ?? 0) + 1)
  const followUpsByAssignee: FollowUpsByAssignee[] = [...followUpsByAssigneeMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  // Opportunities: attribution ONLY via ownership_assignments — the legacy
  // `Opportunity.salesPersonEmail` field is transitional and unenforced, and
  // is never used to attribute a metric here.
  //
  // A well-formed roster has at most one OPEN owner-role assignment per
  // entity (enforced in the DB by
  // `ownership_assignments_one_open_owner_per_entity`), but this function
  // must not silently trust that invariant — if it's ever violated (bad
  // data, a race, an in-memory/dev repository without the constraint),
  // picking whichever row happens to come first/last in the array would be
  // exactly the kind of silent, ordering-dependent guess this page exists to
  // avoid. Such an opportunity is counted as ambiguous instead, separate
  // from "no owner at all" — never attributed, never blended.
  const openOwnersByOppId = new Map<string, string[]>()
  for (const a of openOwnership) {
    if (a.entityType !== 'opportunity') continue
    openOwnersByOppId.set(a.entityId, [...(openOwnersByOppId.get(a.entityId) ?? []), a.salesPersonId])
  }
  const opportunityOwnerByOppId = new Map<string, string>()
  let ambiguousCount = 0
  for (const [oppId, ownerIds] of openOwnersByOppId) {
    if (ownerIds.length === 1) opportunityOwnerByOppId.set(oppId, ownerIds[0])
    else ambiguousCount += 1
  }

  const oppByPersonMap = new Map<string, number>()
  let unattributedCount = 0
  for (const o of opportunities) {
    const ownerId = opportunityOwnerByOppId.get(o.id)
    if (ownerId) { oppByPersonMap.set(ownerId, (oppByPersonMap.get(ownerId) ?? 0) + 1); continue }
    // Exactly one of: no open owner row at all (unattributed), or 2+ open
    // owner rows (already counted above as ambiguous) — never both.
    if (!openOwnersByOppId.has(o.id)) unattributedCount += 1
  }
  const opportunitiesByPerson: OpportunitiesByPerson[] = [...oppByPersonMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  // Pipeline value: grouped by (person, valueUnit) — never summed across
  // units, since 'lakh' and 'crore' rows would otherwise silently blend into
  // one meaningless number.
  const pipelineMap = new Map<string, PipelineValueByPerson>()
  for (const o of opportunities) {
    const ownerId = opportunityOwnerByOppId.get(o.id)
    if (!ownerId) continue
    const row = pipelineMap.get(ownerId) ?? { salesPersonId: ownerId, name: nameOf(people, ownerId), totalsByUnit: [], unparseableCount: 0 }
    const parsed = parseOpportunityValue(o.valueAmount)
    if (parsed === null) {
      row.unparseableCount += 1
    } else {
      const unit = o.valueUnit || 'unspecified'
      const existing = row.totalsByUnit.find((u) => u.unit === unit)
      if (existing) { existing.total += parsed; existing.count += 1 }
      else row.totalsByUnit.push({ unit, total: parsed, count: 1 })
    }
    pipelineMap.set(ownerId, row)
  }

  // Activity: only events with at least one ID-carrying attendee are
  // attributed to a salesperson — a legacy plain-name attendee can't be
  // reliably resolved to a SalesPerson.id, so it's excluded rather than
  // guessed at by string-matching a name.
  const activityByPersonMap = new Map<string, number>()
  let reliableEventCount = 0
  let excludedLegacyCount = 0
  for (const e of timelineEvents) {
    const ids = (e.attendees ?? []).map(attendeeSalesPersonId).filter((id): id is string => !!id)
    if (ids.length === 0) { excludedLegacyCount += 1; continue }
    reliableEventCount += 1
    for (const id of new Set(ids)) activityByPersonMap.set(id, (activityByPersonMap.get(id) ?? 0) + 1)
  }
  const activityByPerson: ActivityByPerson[] = [...activityByPersonMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  return {
    totalMembers: people.length,
    statusBreakdown,
    teamByManager,
    rootCount: tree.roots.length,
    flaggedCount: tree.flaggedRootIds.size,
    ownershipByPerson,
    followUpsByAssignee,
    opportunities: { byPerson: opportunitiesByPerson, unattributedCount, ambiguousCount },
    pipelineValue: { byPerson: [...pipelineMap.values()] },
    activity: { byPerson: activityByPerson, reliableEventCount, excludedLegacyCount },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/sales/salesTeamInsights.test.ts`
Expected: PASS (all 12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/salesTeamInsights.ts src/features/sales/salesTeamInsights.test.ts
git commit -m "feat(sales): add pure Sales Team Insights metric calculations"
```

---

### Task 10: Extract shared Insights visual primitives

**Files:**
- Create: `src/app/routes/InsightsPrimitives.tsx`
- Modify: `src/app/routes/RelationshipAnalytics.tsx:109-184` (delete the local defs, import instead)

**Interfaces:**
- Produces: `StatCard`, `Panel` (with `title: React.ReactNode`, widened from `string`), `Bar`, `Empty`, `LegendRow`, `Donut` — consumed by `RelationshipAnalytics.tsx` (unchanged usage) and Task 11 (`SalesTeamInsights.tsx`).

- [ ] **Step 1: Create the shared primitives file**

Move `StatCard`, `Panel`, `Donut`, `LegendRow`, `Bar`, `Empty` out of `RelationshipAnalytics.tsx` (lines 109-184, 203-205) verbatim, with one change: widen `Panel`'s `title` prop from `string` to `React.ReactNode` so a confidence tag can sit next to it (Task 11).

```tsx
// src/app/routes/InsightsPrimitives.tsx
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

export function StatCard({ icon, label, value, sub, tone }: {
  icon: string; label: string; value: number; sub?: string
  tone: 'emerald' | 'amber' | 'crimson' | 'indigo'
}) {
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    crimson: 'bg-crimson-100 text-crimson',
    indigo: 'bg-indigo-100 text-indigo-600',
  }
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>
          <Icon name={icon} size={17} />
        </span>
      </div>
      <div className="mt-3 font-display text-2xl font-bold text-ink-900">{value}</div>
      <div className="text-[12px] text-muted">{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  )
}

export function Panel({ title, icon, children }: { title: React.ReactNode; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-panel sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        <Icon name={icon} size={15} className="text-muted" />{title}
      </h3>
      {children}
    </div>
  )
}

export function Donut({ connected, notConnected }: { connected: number; notConnected: number }) {
  const total = connected + notConnected
  const pct = total > 0 ? (connected / total) * 100 : 0
  const deg = (pct / 100) * 360
  return (
    <div className="relative h-32 w-32 shrink-0">
      <div
        className="h-32 w-32 rounded-full"
        style={{ background: `conic-gradient(#2F8F5B 0deg ${deg}deg, #DDE3EC ${deg}deg 360deg)` }}
      />
      <div className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-white">
        <span className="font-display text-xl font-bold text-ink-900">{Math.round(pct)}%</span>
        <span className="text-[10px] text-muted">connected</span>
      </div>
    </div>
  )
}

export function LegendRow({ swatch, label, value, total }: { swatch: string; label: string; value: number; total?: number }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className={cn('h-2.5 w-2.5 rounded-sm', swatch)} />
      <span className="text-ink-800">{label}</span>
      <span className="ml-auto font-medium text-ink-900">
        {value}{total ? <span className="text-muted"> · {total ? Math.round((value / total) * 100) : 0}%</span> : ''}
      </span>
    </div>
  )
}

export function Bar({ label, value, max, barClass }: { label: string; value: number; max: number; barClass: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] capitalize text-muted">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[12px] font-medium text-ink-900">{value}</span>
    </div>
  )
}

export function Empty({ label }: { label: string }) {
  return <p className="text-sm text-muted">{label}</p>
}
```

- [ ] **Step 2: Update `RelationshipAnalytics.tsx`**

Delete the moved function definitions (former lines 109-184 and 203-205). Add to the imports:

```ts
import { StatCard, Panel, Bar, Empty, LegendRow, Donut } from './InsightsPrimitives'
```

`InteractionRow` stays in `RelationshipAnalytics.tsx` (it's specific to that page's `InteractionSummary`/`TIMELINE_META`, not shared).

- [ ] **Step 3: Run a smoke test to protect the extraction**

No test file exists for `RelationshipAnalytics.tsx` today. Add a minimal one so this refactor (and any future change to it) is guarded:

```tsx
// src/app/routes/RelationshipAnalytics.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { RelationshipAnalytics } from './RelationshipAnalytics'

function stub(overrides: Partial<ReturnType<typeof api.useRelationshipAnalytics>['data']> = {}) {
  vi.spyOn(api, 'useRelationshipAnalytics').mockReturnValue({
    data: {
      total: 10, connected: 6, notConnected: 4, vacant: 1, highPriority: 2,
      qualityDist: { excellent: 1, good: 2, neutral: 1, weak: 1, poor: 1 },
      statusDist: { engaged: 2, developing: 2, new: 1, dormant: 1 },
      upcomingMeetings: [], recentInteractions: [],
      ...overrides,
    },
  } as unknown as ReturnType<typeof api.useRelationshipAnalytics>)
}

describe('RelationshipAnalytics', () => {
  it('renders its stat cards using the extracted shared primitives', () => {
    stub()
    render(<MemoryRouter><RelationshipAnalytics /></MemoryRouter>)
    expect(screen.getByText('Relationship Analytics')).toBeInTheDocument()
    expect(screen.getByText('Connected officials')).toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/app/routes/RelationshipAnalytics.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/routes/InsightsPrimitives.tsx src/app/routes/RelationshipAnalytics.tsx src/app/routes/RelationshipAnalytics.test.tsx
git commit -m "refactor(insights): extract shared Panel/StatCard/Bar primitives for reuse by Sales Team Insights"
```

---

### Task 11: `SalesTeamInsights` page

**Files:**
- Create: `src/app/routes/SalesTeamInsights.tsx`
- Test: `src/app/routes/SalesTeamInsights.test.tsx`

**Interfaces:**
- Consumes: `computeSalesTeamInsights` (Task 9), `useSalesPersons`/`useCurrentPostings`/`useOwnershipAssignments`/`useOpportunities`/`useOpenFollowUps`/`useAllTimelineEvents` from `@/lib/api`, `STATUS_LABEL` from `@/data/sales-status` (Task 3), `Panel`/`StatCard`/`Bar`/`Empty` from `./InsightsPrimitives` (Task 10), `isoToday` from `@/lib/dates`.
- Produces: `SalesTeamInsights` (no props) — consumed by Task 12 (`Insights.tsx`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/routes/SalesTeamInsights.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { SalesTeamInsights } from './SalesTeamInsights'
import type { SalesPerson } from '@/lib/types'

const ALICE: SalesPerson = {
  id: 'a', employeeCode: 'E1', name: 'Alice', officialEmail: 'a@amnex.com', personalEmail: '',
  mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
  notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function stub(people: SalesPerson[]) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useOwnershipAssignments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOwnershipAssignments>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useOpenFollowUps').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpenFollowUps>)
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllTimelineEvents>)
}

describe('SalesTeamInsights', () => {
  it('shows an empty state instead of misleading zeroes when there is no sales team data', () => {
    stub([])
    render(<SalesTeamInsights />)
    expect(screen.getByText(/No sales team data yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Total sales-team members')).not.toBeInTheDocument()
  })

  it('renders the summary stat and flags the two partial panels', () => {
    stub([ALICE])
    render(<SalesTeamInsights />)
    expect(screen.getByText('Total sales-team members')).toBeInTheDocument()
    expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/routes/SalesTeamInsights.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the page**

```tsx
// src/app/routes/SalesTeamInsights.tsx
import { useMemo } from 'react'
import {
  useAllTimelineEvents, useCurrentPostings, useOpenFollowUps, useOpportunities,
  useOwnershipAssignments, useSalesPersons,
} from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { computeSalesTeamInsights } from '@/features/sales/salesTeamInsights'
import { STATUS_LABEL } from '@/data/sales-status'
import { Bar, Empty, Panel, StatCard } from './InsightsPrimitives'
import { Icon } from '@/components/ui/Icon'

function ConfidenceTag() {
  return (
    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Partial
    </span>
  )
}

const STATUS_KEYS = Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]

export function SalesTeamInsights() {
  const { data: people = [], isLoading: peopleLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: ownership = [] } = useOwnershipAssignments()
  const { data: opportunities = [] } = useOpportunities()
  const { data: openFollowUps = [] } = useOpenFollowUps()
  const { data: timelineEvents = [] } = useAllTimelineEvents()

  const data = useMemo(
    () => computeSalesTeamInsights({ people, postings, ownership, opportunities, openFollowUps, timelineEvents, asOf: isoToday() }),
    [people, postings, ownership, opportunities, openFollowUps, timelineEvents],
  )

  if (peopleLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Loading sales team insights…</div>
  }
  if (people.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted">
          <Icon name="Users" size={18} />
        </div>
        <p className="text-sm text-muted">No sales team data yet — add people from the Sales Team tab first.</p>
      </div>
    )
  }

  const maxOf = (n: number[]) => Math.max(1, ...n)
  const maxTeamSize = maxOf(data.teamByManager.map((t) => t.directReportCount))
  const maxOwnership = maxOf(data.ownershipByPerson.map((o) => o.total))
  const maxFollowUps = maxOf(data.followUpsByAssignee.map((f) => f.count))
  const maxOpportunities = maxOf(data.opportunities.byPerson.map((o) => o.count))
  const maxActivity = maxOf(data.activity.byPerson.map((a) => a.count))

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-4 py-4 sm:px-6">
        <span className="eyebrow">Sales Team</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Sales Team Insights</h1>
        <p className="text-[12px] text-muted">Roster, reporting hierarchy, ownership, and pipeline — all from live GOMS data</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatCard icon="Users" tone="emerald" label="Total sales-team members" value={data.totalMembers} />
          <StatCard icon="UserCheck" tone="indigo" label="Active" value={data.statusBreakdown.active} sub={`${data.totalMembers - data.statusBreakdown.active} other status`} />
          <StatCard icon="CalendarClock" tone="amber" label="Open follow-ups" value={openFollowUps.length} />
          <StatCard icon="Briefcase" tone="crimson" label="Unattributed opportunities" value={data.opportunities.unattributedCount} sub={data.opportunities.ambiguousCount > 0 ? `${data.opportunities.ambiguousCount} ambiguous` : undefined} />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Status breakdown" icon="PieChart">
            <div className="space-y-2.5">
              {STATUS_KEYS.map((s) => (
                <Bar key={s} label={STATUS_LABEL[s]} value={data.statusBreakdown[s]} max={data.totalMembers} barClass="bg-indigo" />
              ))}
            </div>
          </Panel>

          <Panel title={`Team size by manager · ${data.teamByManager.length}`} icon="Network">
            {data.teamByManager.length === 0 ? (
              <Empty label="No manager relationships recorded yet." />
            ) : (
              <div className="space-y-2.5">
                {data.teamByManager.map((t) => (
                  <Bar key={t.managerId} label={t.managerName} value={t.directReportCount} max={maxTeamSize} barClass="bg-teal" />
                ))}
              </div>
            )}
            {data.flaggedCount > 0 && (
              <p className="mt-3 text-[11px] text-amber-700">
                {data.flaggedCount} {data.flaggedCount === 1 ? 'person has' : 'people have'} a broken or circular manager reference — shown in the Org Chart as flagged roots, not counted under any manager here.
              </p>
            )}
          </Panel>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title={`Ownership distribution · ${data.ownershipByPerson.length}`} icon="Building2">
            {data.ownershipByPerson.length === 0 ? (
              <Empty label="No ownership assignments yet." />
            ) : (
              <div className="space-y-2.5">
                {data.ownershipByPerson.map((o) => (
                  <Bar key={o.salesPersonId} label={o.name} value={o.total} max={maxOwnership} barClass="bg-emerald" />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={`Open follow-ups by assignee · ${openFollowUps.length}`} icon="CalendarClock">
            {data.followUpsByAssignee.length === 0 ? (
              <Empty label="No open follow-ups." />
            ) : (
              <div className="space-y-2.5">
                {data.followUpsByAssignee.map((f) => (
                  <Bar key={f.salesPersonId ?? 'unassigned'} label={f.name} value={f.count} max={maxFollowUps} barClass="bg-amber" />
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title={<span className="flex items-center gap-2">Opportunities by salesperson <ConfidenceTag /></span>} icon="Briefcase">
            <p className="mb-3 text-[11px] text-muted">
              Based on explicit ownership assignments only — {data.opportunities.unattributedCount} without one {data.opportunities.unattributedCount === 1 ? 'is' : 'are'} excluded, never guessed from the legacy contact-email field.
              {data.opportunities.ambiguousCount > 0 && ` ${data.opportunities.ambiguousCount} more ${data.opportunities.ambiguousCount === 1 ? 'has' : 'have'} more than one open owner recorded — also excluded as ambiguous, never resolved by picking one.`}
            </p>
            {data.opportunities.byPerson.length === 0 ? (
              <Empty label="No opportunities with a recorded owner yet." />
            ) : (
              <div className="space-y-2.5">
                {data.opportunities.byPerson.map((o) => (
                  <Bar key={o.salesPersonId} label={o.name} value={o.count} max={maxOpportunities} barClass="bg-indigo" />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Pipeline value by salesperson <ConfidenceTag /></span>} icon="TrendingUp">
            <p className="mb-3 text-[11px] text-muted">Grouped by value unit — lakh and crore rows are never summed into one figure.</p>
            {data.pipelineValue.byPerson.length === 0 ? (
              <Empty label="No parseable opportunity values yet." />
            ) : (
              <div className="space-y-3">
                {data.pipelineValue.byPerson.map((p) => (
                  <div key={p.salesPersonId} className="text-[12px]">
                    <div className="font-medium text-ink-900">{p.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                      {p.totalsByUnit.map((u) => (
                        <span key={u.unit}>{u.total.toLocaleString('en-IN')} {u.unit} <span className="text-[10px]">({u.count})</span></span>
                      ))}
                      {p.unparseableCount > 0 && <span className="text-amber-700">{p.unparseableCount} unparseable, excluded</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <Panel title={<span className="flex items-center gap-2">Activity volume by salesperson <ConfidenceTag /></span>} icon="Handshake">
          <p className="mb-3 text-[11px] text-muted">
            {data.activity.reliableEventCount} of {data.activity.reliableEventCount + data.activity.excludedLegacyCount} interactions have an identifiable attendee; {data.activity.excludedLegacyCount} legacy interaction{data.activity.excludedLegacyCount === 1 ? '' : 's'} without one {data.activity.excludedLegacyCount === 1 ? 'is' : 'are'} excluded rather than guessed from a name.
          </p>
          {data.activity.byPerson.length === 0 ? (
            <Empty label="No attributable activity yet." />
          ) : (
            <div className="space-y-2.5">
              {data.activity.byPerson.map((a) => (
                <Bar key={a.salesPersonId} label={a.name} value={a.count} max={maxActivity} barClass="bg-teal" />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/routes/SalesTeamInsights.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/SalesTeamInsights.tsx src/app/routes/SalesTeamInsights.test.tsx
git commit -m "feat(insights): add Sales Team Insights page with exact/partial metric labeling"
```

---

### Task 12: `Insights` tab shell + routing

**Files:**
- Create: `src/app/routes/Insights.tsx`
- Test: `src/app/routes/Insights.test.tsx`
- Modify: `src/app/router.tsx:10,57` (lazy-load `Insights` instead of `RelationshipAnalytics` at `/analytics`)

**Interfaces:**
- Consumes: `Tabs` from `@/components/ui/Tabs` (existing), `SalesTeamInsights` (Task 11), `RelationshipAnalytics` (existing, unchanged).
- Produces: `Insights` (no props) — becomes the `/analytics` route element.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/routes/Insights.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Insights } from './Insights'
import type { SalesPerson } from '@/lib/types'

function stubAll() {
  const people: SalesPerson[] = []
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useOwnershipAssignments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOwnershipAssignments>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useOpenFollowUps').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpenFollowUps>)
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllTimelineEvents>)
  vi.spyOn(api, 'useRelationshipAnalytics').mockReturnValue({ data: undefined } as unknown as ReturnType<typeof api.useRelationshipAnalytics>)
}

describe('Insights', () => {
  it('defaults to the Sales Team Insights tab', () => {
    stubAll()
    render(<MemoryRouter><Insights /></MemoryRouter>)
    expect(screen.getByText(/No sales team data yet/i)).toBeInTheDocument()
  })

  it('switches to Relationship Analytics on tab click, without losing it on switch back', async () => {
    stubAll()
    render(<MemoryRouter><Insights /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Relationship Analytics' }))
    expect(screen.getByText('Loading analytics…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sales Team Insights' }))
    expect(screen.getByText(/No sales team data yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/routes/Insights.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `Insights.tsx`**

```tsx
// src/app/routes/Insights.tsx
import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { SalesTeamInsights } from './SalesTeamInsights'
import { RelationshipAnalytics } from './RelationshipAnalytics'

const TABS = [
  { value: 'salesTeam', label: 'Sales Team Insights' },
  { value: 'relationships', label: 'Relationship Analytics' },
] as const

export function Insights() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('salesTeam')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-paper/70 px-3 pt-2 sm:px-6">
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'salesTeam' ? <SalesTeamInsights /> : <RelationshipAnalytics />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `router.tsx`**

Change line 10 from:

```ts
const RelationshipAnalytics = lazy(() => import('./routes/RelationshipAnalytics').then((m) => ({ default: m.RelationshipAnalytics })))
```

to:

```ts
const Insights = lazy(() => import('./routes/Insights').then((m) => ({ default: m.Insights })))
```

Change line 57 from `{ path: '/analytics', element: <RelationshipAnalytics /> }` to `{ path: '/analytics', element: <Insights /> }`.

(`SecondaryNav.tsx` needs no change — its `/analytics` tile already points at the right path, and its label is already "Insights".)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/routes/Insights.test.tsx src/app/routes/RelationshipAnalytics.test.tsx src/app/routes/SalesTeamInsights.test.tsx`
Expected: PASS (all).

- [ ] **Step 6: Full-suite regression check**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: PASS, no new failures anywhere in the repo.

- [ ] **Step 7: Commit**

```bash
git add src/app/routes/Insights.tsx src/app/routes/Insights.test.tsx src/app/router.tsx
git commit -m "feat(insights): add the Insights tab shell and route Sales Team Insights alongside Relationship Analytics"
```

---

## Self-Review

**Spec coverage:**
- Real tree from `managerId` only, no invented hierarchy → Task 2, Task 5.
- Connectors → Task 5 (`elbowPath`/`computeEdges`, Task 1).
- Card with avatar/name/designation/email → Task 4.
- Photo-ready avatar without a future redesign → Task 4 (documented in Global Constraints).
- Expand/collapse + Expand all/Collapse all → Task 5 (reuses `CanvasProvider`'s `isExpanded`/`setNodeExpanded`/`setAllExpanded`).
- No-manager roots vs. orphaned/cyclic roots handled distinctly → Task 2, surfaced in Task 4/5's `flagged` prop.
- Scrolling for large trees, no forced pan/zoom/drag → Task 5 (`overflow-auto`, no viewport transform).
- Visually distinct from Roster → Task 4/5 (card grid tree vs. Roster's row list).
- Not forking all of `HierarchyCanvas` → Task 1 (only `elbowPath`/`CanvasProvider` reused), Task 5.
- `gm_override_id` not used as a tree edge → Task 2 (`buildSalesOrgTree` never reads it); it remains exclusively an informational field on `SalesPersonDetails.tsx`/`SalesPersonFormDialog.tsx`, untouched by this plan.
- Sales Team Insights tab alongside Relationship Analytics, unchanged → Task 10, Task 12.
- Exact metrics (members, status, team-by-manager, ownership, follow-ups) → Task 9.
- Partial metrics clearly labeled (opportunities, pipeline, activity) → Task 9 (data shape), Task 11 (`ConfidenceTag`).
- `salesPersonEmail` never used as attribution → Task 9 (test + Global Constraint).
- Pipeline value never blended across units, unparseable tracked → Task 9.
- Activity legacy attendees excluded, not guessed → Task 9.
- Ownership never resolved by silent array/object ordering when an entity has more than one open owner → Task 9 (`ambiguousCount`, tested).
- Customer-table ownership excluded entirely → not implemented anywhere in this plan (by omission, per the audit finding that no such relationship exists) — reflected in the Approved Requirements section.
- Reuses existing visual system → Task 10 (`InsightsPrimitives.tsx`).
- Useful empty states → Task 5 (org chart), Task 11 (Insights).
- Visual/layout correctness (connectors, expand/collapse, scrolling, flagged roots) confirmed in a real browser, not just jsdom → Task 7.

**Placeholder scan:** none — every step has real, complete code; no "TODO"/"handle appropriately" language.

**Type consistency:** `SalesOrgTree`, `SalesTeamInsightsData` and their nested types are defined once (Task 2, Task 9) and referenced with the same names/shapes in every consuming task (Task 4, 5, 6, 10, 11). `STATUS_LABEL`/`STATUS_STYLE` defined once (Task 3), imported everywhere else.

**Review Focus:** all six items have a task and an explicit test (Task 2's cycle/orphan tests; Task 9's opportunity-attribution, ambiguous-owner, pipeline-unit, and activity-exclusion tests).

---

## Execution Handoff

**Approved 2026-09-28.** Execution approach: **Subagent-driven** (superpowers:subagent-driven-development) — a fresh subagent implements each task, a fresh reviewer checks it, then the next dependent task starts only after that review. Tasks 2 and 9 carry the highest-risk logic (cycle detection; ownership/opportunity/pipeline/activity attribution rules, including the ambiguous-owner case) and later tasks depend on their exact interfaces, so a per-task review catches a wrong assumption before it propagates.

Two amendments made before execution began (both reflected in the tasks above): a test for multiple open owner assignments on the same opportunity (Task 9, `ambiguousCount` — never resolved by array/object order), and a manual browser-based visual verification step for the Org Chart canvas (Task 7, after Task 6) covering top-down layout, connector alignment, expand/collapse (single and bulk), multiple root branches, flagged orphan/cycle roots, and scrolling on a larger tree — jsdom tests stay structural-only; Task 7 is where layout is actually eyeballed.
