import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCurrentPostings, useDepartments, useResolvedOwners, useSalesPersons } from '@/lib/api'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace/context'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'
import { OwnerBadge } from '@/features/sales/OwnerBadge'
import { SalesPersonFormDialog } from '@/features/sales/SalesPersonFormDialog'
import { Button } from '@/components/ui/Button'
import { tierLabel, tierRank } from '@/data/sales-tiers'
import { isoToday } from '@/lib/dates'
import { cn, initials } from '@/lib/utils'
import type { SalesPerson, SalesPosting } from '@/lib/types'

/** The Sales Master workspace. Mirrors StateWorkspace's structure — header row
 *  with a tab strip, a content area, and the shared resizable DetailsPanel —
 *  which is the main reason the module reads as native rather than bolted on
 *  (spec §5.3).
 *
 *  Only Roster is built. The other sections are declared here rather than
 *  hidden so the intended shape is visible and each lands in its own phase;
 *  they render an explicit "coming in phase N" panel instead of a dead tab. */
const SECTIONS = [
  { key: 'roster', label: 'Roster', phase: 1 },
  { key: 'orgchart', label: 'Org Chart', phase: 2 },
  { key: 'ownership', label: 'Ownership', phase: 3 },
] as const

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  onLeave: 'bg-amber-50 text-amber-700',
  resigned: 'bg-ink-900/[0.06] text-ink-600',
  inactive: 'bg-ink-900/[0.06] text-ink-600',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

function RosterRow({ person, posting, selected, onSelect }: {
  person: SalesPerson
  posting: SalesPosting | undefined
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ink-900/20 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-[11px] font-semibold text-ink-700">
        {initials(person.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink-900">{person.name}</div>
        <div className="truncate text-[12px] text-muted">
          {posting?.designation || 'No current posting'}
        </div>
      </div>
      {posting && (
        <span className="hidden shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700 sm:inline">
          {tierLabel(posting.tierKey)}
        </span>
      )}
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[person.status])}>
        {STATUS_LABEL[person.status] ?? person.status}
      </span>
    </button>
  )
}

function Roster() {
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const { data: people = [], isLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? people.filter((p) =>
          p.name.toLowerCase().includes(q) ||
          p.officialEmail.toLowerCase().includes(q) ||
          (postings[p.id]?.designation ?? '').toLowerCase().includes(q))
      : people
    // Seniority first, then name — a flat alphabetical list of 24 people buries
    // the reporting shape that the Phase 2 org chart will make explicit.
    return [...matched].sort((a, b) => {
      const ra = tierRank(postings[a.id]?.tierKey ?? '')
      const rb = tierRank(postings[b.id]?.tierKey ?? '')
      return ra - rb || a.name.localeCompare(b.name)
    })
  }, [people, postings, query])

  const [formOpen, setFormOpen] = useState(false)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the sales team…"
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-[12px] text-muted">
          {rows.length}{rows.length !== people.length && ` of ${people.length}`} people
        </span>
        <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
          + Add
        </Button>
      </div>

      {isLoading ? (
        <p className="px-1 text-sm text-muted">Loading roster…</p>
      ) : rows.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          {people.length === 0 ? 'No sales people yet.' : `No one matches “${query}”.`}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {rows.map((p) => (
            <RosterRow
              key={p.id}
              person={p}
              posting={postings[p.id]}
              selected={ws.selection?.kind === 'salesPerson' && ws.selection.id === p.id}
              onSelect={() => ws.select('salesPerson', p.id)}
            />
          ))}
        </div>
      )}

      <SalesPersonFormDialog open={formOpen} personId={null} onClose={() => setFormOpen(false)} />
    </div>
  )
}

/** Accounts (every department + its resolved owner) and Gaps (unassigned
 *  only) — the two views spec §5.3 lists for Ownership. Delegations is left
 *  for the full Phase 3 build; it needs the batch/wizard machinery this hour
 *  deliberately skips.
 *
 *  Resolution is batched through `useResolvedOwners` (one call for every
 *  department), not per row — a per-row `effectiveOwner` call would re-walk
 *  the ancestor chain for each of them, which spec §13 names the design's
 *  single largest performance risk. */
function Ownership() {
  const ws = useWorkspace()
  const [gapsOnly, setGapsOnly] = useState(false)
  const { data: departments = [] } = useDepartments()
  const asOf = isoToday()
  const ids = useMemo(() => departments.map((d) => d.id), [departments])
  const { data: owners = {} } = useResolvedOwners('orgNode', ids, asOf)
  const { data: people = [] } = useSalesPersons()

  const rows = gapsOnly ? departments.filter((d) => !owners[d.id]) : departments
  const gapCount = departments.filter((d) => !owners[d.id]).length

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-panel p-0.5">
          <button
            onClick={() => setGapsOnly(false)}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium', !gapsOnly ? 'bg-white shadow-sm' : 'text-muted')}
          >
            Accounts
          </button>
          <button
            onClick={() => setGapsOnly(true)}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium', gapsOnly ? 'bg-white shadow-sm' : 'text-muted')}
          >
            Gaps{gapCount > 0 && ` · ${gapCount}`}
          </button>
        </div>
        <span className="text-[12px] text-muted">{rows.length} of {departments.length} departments</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          {gapsOnly ? 'No gaps — every department resolves to an owner.' : 'No departments.'}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {rows.map((d) => (
            <button
              key={d.id}
              onClick={() => ws.select('node', d.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-panel"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{d.name}</span>
              <OwnerBadge owner={owners[d.id]} people={people} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Manager → direct reports, as a simple indented tree — not the heavyweight
 *  HierarchyCanvas (659 lines fused to Employee/HierNode/stateCode), which
 *  the spec explicitly warns against forking for this. ~40 people doesn't
 *  need drag-to-reparent or pan/zoom for a demo; that machinery is real
 *  Phase 2 scope. */
function OrgChartNode({ person, childrenOf, postings, depth, ws }: {
  person: SalesPerson
  childrenOf: Map<string, SalesPerson[]>
  postings: Record<string, SalesPosting>
  depth: number
  ws: ReturnType<typeof useWorkspace>
}) {
  const kids = childrenOf.get(person.id) ?? []
  const posting = postings[person.id]
  const selected = ws.selection?.kind === 'salesPerson' && ws.selection.id === person.id

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <button
        onClick={() => ws.select('salesPerson', person.id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left',
          selected ? 'border-ink-900/20 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel',
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel text-[10px] font-semibold text-ink-700">
          {initials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink-900">{person.name}</div>
          <div className="truncate text-[11px] text-muted">{posting?.designation || '—'}</div>
        </div>
        {kids.length > 0 && (
          <span className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-ink-600">{kids.length}</span>
        )}
      </button>
      {kids.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5 border-l border-line pl-2.5">
          {kids.map((k) => (
            <OrgChartNode key={k.id} person={k} childrenOf={childrenOf} postings={postings} depth={depth + 1} ws={ws} />
          ))}
        </div>
      )}
    </div>
  )
}

function OrgChart() {
  const ws = useWorkspace()
  const { data: people = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()

  const { roots, childrenOf } = useMemo(() => {
    const map = new Map<string, SalesPerson[]>()
    const rootList: SalesPerson[] = []
    for (const p of people) {
      const managerId = postings[p.id]?.managerId ?? null
      if (managerId && people.some((m) => m.id === managerId)) {
        map.set(managerId, [...(map.get(managerId) ?? []), p])
      } else {
        rootList.push(p)
      }
    }
    for (const [, kids] of map) kids.sort((a, b) => a.name.localeCompare(b.name))
    rootList.sort((a, b) => a.name.localeCompare(b.name))
    return { roots: rootList, childrenOf: map }
  }, [people, postings])

  if (people.length === 0) {
    return <p className="p-4 text-sm text-muted">No sales people yet.</p>
  }

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-3">
      {roots.map((p) => (
        <OrgChartNode key={p.id} person={p} childrenOf={childrenOf} postings={postings} depth={0} ws={ws} />
      ))}
    </div>
  )
}

function SalesWorkspaceBody() {
  const { section } = useParams()
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
        <span className="mr-2 shrink-0 text-sm font-semibold text-ink-900">Sales Team</span>
        {SECTIONS.map((s) => (
          <a
            key={s.key}
            href={`/sales/${s.key}`}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors',
              s.key === active.key
                ? 'bg-ink-900/[0.06] text-ink-900'
                : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
            )}
          >
            {s.label}
          </a>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 flex-1 overflow-hidden">
          {active.key === 'roster' ? <Roster /> : active.key === 'orgchart' ? <OrgChart /> : <Ownership />}
        </motion.div>
        <aside className="hidden w-[380px] shrink-0 border-l border-line lg:block">
          <DetailsPanel />
        </aside>
      </div>
    </div>
  )
}

export function SalesWorkspace() {
  // `WorkspaceProvider` is mounted per-route in this app, not once at the
  // layout — `useWorkspace()` throws without it. `-1` is the existing
  // cross-state sentinel (Directory uses it too): the sales roster is national,
  // not scoped to one state.
  return (
    <WorkspaceProvider stateCode={-1}>
      <SalesWorkspaceBody />
    </WorkspaceProvider>
  )
}
