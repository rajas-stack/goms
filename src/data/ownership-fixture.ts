import { uid } from '@/lib/utils'
import type { HierNode, OwnershipAssignment, SalesPerson } from '@/lib/types'

/** A deliberately tiny ownership fixture, in the same spirit as the QA Test
 *  department already in `buildSeed` — enough rows to make each distinct
 *  ownership state visible in the UI, and no more:
 *
 *   - a DIRECT owner on a parent org node, so its children render as INHERITED
 *   - a DIRECT owner on an unrelated node, for contrast
 *   - an open DELEGATE alongside an owner, showing delegation does not replace
 *   - one CLOSED row, so the history list is non-empty
 *   - everything else left unowned, so "Unassigned" is also visible
 *
 *  Rows are marked `reason: 'initial'` with an explicit note so they are
 *  recognizable as fixture data rather than mistaken for real assignments.
 *  Nodes are chosen structurally (first parent with children) rather than by
 *  hardcoded id, so the inheritance demo survives any id change.
 *
 *  Returns `[]` when there is nothing sensible to attach to. */
export function buildOwnershipFixture(nodes: HierNode[], people: SalesPerson[]): OwnershipAssignment[] {
  if (people.length < 3) return []

  const orgNodes = nodes.filter((n) => n.domain === 'org')
  const childCount = new Map<string, number>()
  for (const n of orgNodes) {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1)
  }

  // A parent with children is what makes inheritance observable: its
  // descendants will resolve to this owner without a row of their own.
  const parent = orgNodes.find((n) => (childCount.get(n.id) ?? 0) > 0)
  if (!parent) return []
  const other = orgNodes.find((n) => n.id !== parent.id && (childCount.get(n.id) ?? 0) === 0)

  const note = 'Demo fixture — illustrates ownership states'
  const base = {
    batchId: null as string | null,
    createdAt: '',
    createdBy: null as string | null,
  }

  const rows: OwnershipAssignment[] = [
    // Closed row first so the fixture also demonstrates history. Its end date
    // is the successor's start date — exclusive end means exactly adjacent.
    {
      ...base,
      id: uid('own'),
      entityType: 'orgNode',
      entityId: parent.id,
      salesPersonId: people[1].id,
      role: 'owner',
      startDate: '2025-04-01',
      endDate: '2026-01-01',
      reason: 'initial',
      note,
    },
    {
      ...base,
      id: uid('own'),
      entityType: 'orgNode',
      entityId: parent.id,
      salesPersonId: people[0].id,
      role: 'owner',
      startDate: '2026-01-01',
      endDate: null,
      reason: 'reassignment',
      note,
    },
    // Parallel delegate: the owner above stays open. On expiry this simply
    // stops resolving and the owner shows again.
    {
      ...base,
      id: uid('own'),
      entityType: 'orgNode',
      entityId: parent.id,
      salesPersonId: people[2].id,
      role: 'delegate',
      startDate: '2026-07-01',
      endDate: '2026-10-01',
      reason: 'delegation',
      note,
    },
  ]

  if (other) {
    rows.push({
      ...base,
      id: uid('own'),
      entityType: 'orgNode',
      entityId: other.id,
      salesPersonId: people[Math.min(3, people.length - 1)].id,
      role: 'owner',
      startDate: '2026-02-15',
      endDate: null,
      reason: 'initial',
      note,
    })
  }

  return rows
}
