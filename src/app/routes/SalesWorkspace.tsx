import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  useAllEmployees, useCurrentPostings, useDepartments, useOpportunities, useOwnershipAssignments,
  useResolvedOwners, useSalesPersons,
} from '@/lib/api'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace/context'
import { SalesDetailsSidebar, SalesDetailsSidebarProvider, useSalesDetailsSidebar } from '@/features/sales/SalesDetailsSidebar'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'
import { Tooltip } from '@/components/ui/Tooltip'
import { Avatar } from '@/components/ui/Avatar'
import { useSalesEditLock } from '@/features/sales/salesEditLock'
import { SalesEditLockToggle } from '@/features/sales/SalesEditLockToggle'
import { OwnerBadge } from '@/features/sales/OwnerBadge'
import { SalesPersonFormDialog } from '@/features/sales/SalesPersonFormDialog'
import { SalesOrgChartCanvas } from '@/features/sales/SalesOrgChartCanvas'
import { Button } from '@/components/ui/Button'
import { tierLabel, tierRank } from '@/data/sales-tiers'
import { PIPELINE_STAGE_MAP } from '@/data/pipeline-stages'
import { isoToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { SalesPerson, SalesPosting } from '@/lib/types'
import { STATUS_STYLE, STATUS_LABEL, STATUS_FILTERS } from '@/data/sales-status'

/** The Sales Master workspace. Mirrors StateWorkspace's structure — header row
 *  with a tab strip and a content area — with the shared DetailsPanel shown in a
 *  contextual slide-in sidebar (SalesDetailsSidebar) rather than a permanent column.
 *
 *  All three sections are built: Roster, Org Chart, and Ownership (which
 *  doubles as the destination for the header's per-kind ownership counts). */
const SECTIONS = [
  { key: 'roster', label: 'Roster', phase: 1 },
  { key: 'orgchart', label: 'Org Chart', phase: 2 },
  { key: 'ownership', label: 'Ownership', phase: 3 },
] as const

function SummaryCard({ label, value, icon, href }: { label: string; value: number; icon: string; href: string }) {
  return (
    <Link
      to={href}
      className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-1.5 shadow-sm transition-colors hover:border-ink-600/30 hover:bg-panel/60 focus-visible:focus-ring"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel text-ink-700">
        <Icon name={icon} size={14} />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight text-ink-900">{value}</div>
        <div className="truncate text-[11px] leading-tight text-muted">{label}</div>
      </div>
    </Link>
  )
}

/** Four at-a-glance counts, derived from data already loaded elsewhere on this
 *  page rather than a new query — they update the moment any of those queries
 *  are invalidated (a new hire, a reassignment, a new opportunity), with no
 *  separate refresh path to keep in sync.
 *
 *  Each card is also a link into the view that explains its number: Roster
 *  for headcount, and the Ownership tab (scoped to the selected salesperson,
 *  if any) for the three ownership-derived counts — reusing that tab's own
 *  Departments/Contacts/Opportunities switcher rather than building new pages. */
function SummaryCards({ basePath }: { basePath: string }) {
  const ws = useWorkspace()
  const { data: people = [] } = useSalesPersons()
  const { data: assignments = [] } = useOwnershipAssignments()
  const { data: opportunities = [] } = useOpportunities()
  const asOf = isoToday()

  const openOwned = (entityType: string) =>
    new Set(
      assignments
        .filter((a) => a.entityType === entityType && a.role === 'owner' && a.startDate <= asOf && (a.endDate === null || asOf < a.endDate))
        .map((a) => a.entityId),
    ).size
  const openOpportunities = opportunities.filter((o) => !PIPELINE_STAGE_MAP[o.stageKey]?.isClosed).length

  const selectedPersonId = ws.selection?.kind === 'salesPerson' ? ws.selection.id : null
  const ownershipHref = (view: string) => `${basePath}/ownership?view=${view}${selectedPersonId ? `&owner=${selectedPersonId}` : ''}`

  return (
    <div className="grid grid-cols-2 gap-2 border-b border-line px-3 py-2 sm:grid-cols-4">
      <SummaryCard label="Total sales people" value={people.length} icon="Users" href={`${basePath}/roster`} />
      <SummaryCard label="Departments owned" value={openOwned('orgNode')} icon="Building2" href={ownershipHref('orgNode')} />
      <SummaryCard label="Contacts managed" value={openOwned('contact')} icon="User" href={ownershipHref('contact')} />
      <SummaryCard label="Open opportunities" value={openOpportunities} icon="Briefcase" href={ownershipHref('opportunity')} />
    </div>
  )
}

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

export function RosterRow({ person, posting, selected, onSelect }: {
  person: SalesPerson
  posting: SalesPosting | undefined
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex min-h-[52px] w-full items-center gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors',
        selected ? 'border-ink-900/20 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel',
      )}
    >
      <Avatar person={{ name: person.name, photoUrl: person.photoUrl }} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-ink-900">{person.name}</div>
        <div className="truncate text-[12px] leading-tight text-muted">
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
  const details = useSalesDetailsSidebar()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]['key']>('all')
  const { data: people = [], isLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { unlocked } = useSalesEditLock()

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byStatus = statusFilter === 'all' ? people : people.filter((p) => p.status === statusFilter)
    const matched = q
      ? byStatus.filter((p) =>
          p.name.toLowerCase().includes(q) ||
          p.officialEmail.toLowerCase().includes(q) ||
          p.mobile.toLowerCase().includes(q) ||
          (postings[p.id]?.designation ?? '').toLowerCase().includes(q))
      : byStatus
    // Seniority first, then name — a flat alphabetical list of 24 people buries
    // the reporting shape that the Phase 2 org chart will make explicit.
    return [...matched].sort((a, b) => {
      const ra = tierRank(postings[a.id]?.tierKey ?? '')
      const rb = tierRank(postings[b.id]?.tierKey ?? '')
      return ra - rb || a.name.localeCompare(b.name)
    })
  }, [people, postings, query, statusFilter])

  const [formOpen, setFormOpen] = useState(false)

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, designation or mobile…"
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-[12px] text-muted">
          {rows.length}{rows.length !== people.length && ` of ${people.length}`} people
        </span>
        <Tooltip label={unlocked ? 'Add a sales person' : 'Unlock editing to add a sales person'}>
          <Button size="sm" variant="primary" disabled={!unlocked} onClick={() => setFormOpen(true)}>
            + Add
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors',
              statusFilter === f.key
                ? 'border-ink-900/20 bg-ink-900/[0.06] text-ink-900'
                : 'border-line bg-white text-ink-600 hover:bg-panel',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="px-1 text-sm text-muted">Loading roster…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="Users"
          message={
            people.length === 0
              ? 'No sales people yet — add your first one to get started.'
              : query
                ? `No one matches “${query}”.`
                : 'No one matches this filter.'
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {rows.map((p) => (
            <RosterRow
              key={p.id}
              person={p}
              posting={postings[p.id]}
              selected={ws.selection?.kind === 'salesPerson' && ws.selection.id === p.id}
              onSelect={() => { ws.select('salesPerson', p.id); details.reveal() }}
            />
          ))}
        </div>
      )}

      <SalesPersonFormDialog open={formOpen} personId={null} onClose={() => setFormOpen(false)} />
    </div>
  )
}

const OWNERSHIP_VIEWS = [
  { key: 'orgNode', label: 'Departments', icon: 'Building2' },
  { key: 'contact', label: 'Contacts', icon: 'User' },
  { key: 'opportunity', label: 'Opportunities', icon: 'Briefcase' },
] as const

/** Accounts (every record of the chosen kind + its resolved owner) and Gaps
 *  (unassigned only) — the two views spec §5.3 lists for Ownership.
 *  Delegations is left for the full Phase 3 build; it needs the batch/wizard
 *  machinery this hour deliberately skips.
 *
 *  The Departments/Contacts/Opportunities switcher and the `?owner=` scoping
 *  (from a SummaryCards click) both reuse `useResolvedOwners` — already
 *  generic over entity type — so this stays one view, not three new pages.
 *
 *  Resolution is batched through `useResolvedOwners` (one call for every
 *  record), not per row — a per-row `effectiveOwner` call would re-walk the
 *  ancestor chain for each of them, which spec §13 names the design's single
 *  largest performance risk. */
export function Ownership() {
  const ws = useWorkspace()
  const details = useSalesDetailsSidebar()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = OWNERSHIP_VIEWS.some((v) => v.key === searchParams.get('view')) ? searchParams.get('view')! : 'orgNode'
  const ownerFilter = searchParams.get('owner')
  const [gapsOnly, setGapsOnly] = useState(false)
  const { data: departments = [] } = useDepartments()
  const { data: employees = [] } = useAllEmployees()
  const { data: opportunities = [] } = useOpportunities()
  const { data: people = [] } = useSalesPersons()
  const asOf = isoToday()

  const entities = useMemo(() => {
    if (view === 'contact') {
      return employees.map((e) => ({ id: e.id, label: e.vacant ? `${e.designation || 'Vacant position'} · Vacant` : e.name }))
    }
    if (view === 'opportunity') {
      return opportunities.map((o) => ({ id: o.id, label: o.opportunityName || 'Untitled opportunity' }))
    }
    return departments.map((d) => ({ id: d.id, label: d.name }))
  }, [view, departments, employees, opportunities])

  const ids = useMemo(() => entities.map((e) => e.id), [entities])
  const { data: owners = {} } = useResolvedOwners(view, ids, asOf)
  const ownerPerson = ownerFilter ? people.find((p) => p.id === ownerFilter) : undefined

  let rows = gapsOnly ? entities.filter((e) => !owners[e.id]) : entities
  if (ownerFilter) rows = rows.filter((e) => owners[e.id]?.salesPersonId === ownerFilter)
  const gapCount = entities.filter((e) => !owners[e.id]).length
  const viewLabel = OWNERSHIP_VIEWS.find((v) => v.key === view)!.label

  function selectView(key: string) {
    setSearchParams((p) => { p.set('view', key); return p }, { replace: true })
  }
  function clearOwnerFilter() {
    setSearchParams((p) => { p.delete('owner'); return p }, { replace: true })
  }
  function openEntity(id: string) {
    details.reveal()
    if (view === 'contact') { ws.select('employee', id); return }
    if (view === 'opportunity') {
      const dept = opportunities.find((o) => o.id === id)?.departmentId
      if (dept) ws.select('node', dept)
      return
    }
    ws.select('node', id)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-panel p-0.5">
          {OWNERSHIP_VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => selectView(v.key)}
              className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium', view === v.key ? 'bg-white shadow-sm' : 'text-muted')}
            >
              {v.label}
            </button>
          ))}
        </div>
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
      </div>

      {ownerFilter && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-1.5 text-[12px]">
          <span className="text-muted">Owned by</span>
          {ownerPerson && <Avatar person={{ name: ownerPerson.name, photoUrl: ownerPerson.photoUrl }} size="xs" />}
          <span className="font-medium text-ink-900">{ownerPerson?.name ?? ownerFilter}</span>
          <button onClick={clearOwnerFilter} className="ml-auto font-medium text-ink-600 hover:text-ink-900">Clear</button>
        </div>
      )}

      <span className="text-[12px] text-muted">{rows.length} of {entities.length} {viewLabel.toLowerCase()}</span>

      {rows.length === 0 ? (
        <EmptyState
          icon={gapsOnly ? 'CircleCheck' : OWNERSHIP_VIEWS.find((v) => v.key === view)!.icon}
          message={
            ownerFilter
              ? `No ${viewLabel.toLowerCase()} owned by this person.`
              : gapsOnly
                ? `No gaps — every ${viewLabel.toLowerCase().slice(0, -1)} resolves to an owner.`
                : `No ${viewLabel.toLowerCase()} owned yet.`
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {rows.map((e) => (
            <button
              key={e.id}
              onClick={() => openEntity(e.id)}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-1.5 text-left hover:bg-panel"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{e.label}</span>
              <OwnerBadge owner={owners[e.id]} people={people} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SalesWorkspaceBody({ basePath }: { basePath: string }) {
  const { section } = useParams()
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]
  const ws = useWorkspace()
  const details = useSalesDetailsSidebar()
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full flex-col">
      <SummaryCards basePath={basePath} />
      {/* Below `sm` the tabs drop to their own full-width row (order-last) so the lock pill sits
          beside the title instead of crowding them; from `sm` up it is the single row it always was. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 sm:flex-nowrap">
        <span className="shrink-0 text-sm font-semibold text-ink-900">Sales Team</span>
        <div className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              to={`${basePath}/${s.key}`}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 sm:px-2.5 sm:py-1 text-[13px] font-medium transition-colors',
                s.key === active.key
                  ? 'bg-ink-900/[0.06] text-ink-900'
                  : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {ws.selection && !details.open && (
            <Button size="sm" variant="secondary" onClick={details.reveal}>
              <Icon name="Eye" size={14} /> Show details
            </Button>
          )}
          <SalesEditLockToggle />
        </div>
      </div>

      <div ref={contentRef} className="flex min-h-0 flex-1">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {active.key === 'roster' ? <Roster /> : active.key === 'orgchart' ? <SalesOrgChartCanvas /> : <Ownership />}
        </motion.div>
        <SalesDetailsSidebar containerRef={contentRef} />
      </div>
    </div>
  )
}

export function SalesWorkspace({ basePath = '/sales' }: { basePath?: string } = {}) {
  // `WorkspaceProvider` is mounted per-route in this app, not once at the
  // layout — `useWorkspace()` throws without it. `-1` is the existing
  // cross-state sentinel (Directory uses it too): the sales roster is national,
  // not scoped to one state. `basePath` lets Teams embed this under
  // `/teams/sales` so its section links stay inside the Teams tab.
  return (
    <WorkspaceProvider stateCode={-1}>
      <SalesDetailsSidebarProvider>
        <SalesWorkspaceBody basePath={basePath} />
      </SalesDetailsSidebarProvider>
    </WorkspaceProvider>
  )
}
