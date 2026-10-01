import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useAllEmployees, useAllTimelineEvents, useCurrentPostings, useDepartments, useEmployeeDepartments, useSalesPersons, useStates,
} from '@/lib/api'
import { useHighlightOnArrival } from '@/lib/useHighlightOnArrival'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { MobileFilterBar } from '@/components/MobileFilterBar'
import { Input } from '@/components/ui/Field'
import { TimelineEventDialog } from '@/features/employees/TimelineEventDialog'
import { ALL_EVENT_TYPES, TIMELINE_META, timelineEventLabel } from '@/lib/timeline-meta'
import {
  buildMeetingFacets, EMPTY_MEETING_FILTERS, isAccountManagerDesignation, isBuSalesDesignation, matchesMeetingFilters,
  regionOptions, type MeetingFacetContext, type MeetingFilters,
} from '@/lib/meetingFilters'
import { cn } from '@/lib/utils'
import type { Employee, SalesPerson, SalesPosting, TimelineEvent, TimelineEventType } from '@/lib/types'

// Row height is fixed (same markup on every row, single-line content), so a
// static estimate is exact rather than approximate — no per-row measurement
// needed. `space-y-2` between rows in the old non-virtualized markup is
// folded into this constant (row box + gap) so virtualized rows line up
// identically to the plain-map version.
const ROW_HEIGHT = 56
const ROW_GAP = 8

// Every manually-loggable timeline type is shown here in one list. Lifecycle
// entries (`joined`/`promoted`/`transferred`) are deliberately excluded —
// they're posting history, not a meeting or a logged interaction. Exported
// so Task 8.5's department-level Meetings section (DepartmentSection.tsx)
// filters to the exact same set — both readers must agree on what counts as
// a "meeting" or this page and the department view would silently diverge.
export const LOGGED_TYPES: TimelineEventType[] = ['meeting', 'inPerson', 'call', 'email', 'whatsapp', 'followup', 'note', 'document', 'custom']

/** Read-through, cross-employee view over `TimelineEvent` rows — the same
 *  data that's already shown embedded in each Employee's profile timeline,
 *  just aggregated here. Browsing and filtering never mutate anything;
 *  "Create Meeting" opens the same `TimelineEventDialog` the global "Add
 *  Activity" FAB uses, and editing or deleting an entry still happens from
 *  the person's own profile. */
export function Meetings() {
  const navigate = useNavigate()
  const { data: employees = [] } = useAllEmployees()
  const { data: deptById = {} } = useEmployeeDepartments()
  const { data: departments = [] } = useDepartments()
  const { data: states = [] } = useStates()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const { data: entries = [] } = useAllTimelineEvents({ types: LOGGED_TYPES })
  const [createOpen, setCreateOpen] = useState(false)

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e] as const)), [employees])

  // Defensive: only show rows whose employee still resolves (deletion already
  // cascades to timeline rows in the repository, so this should be a no-op).
  const allRows = useMemo(() => entries.filter((e) => employeeById.has(e.employeeId)), [entries, employeeById])

  const [filters, setFilters] = useState<MeetingFilters>(EMPTY_MEETING_FILTERS)
  const [date, setDate] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const setFilter = (key: keyof MeetingFilters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }))

  const facetCtx = useMemo<MeetingFacetContext>(() => ({
    salesPersons, currentPostings, employeeById, deptById,
    stateCodeByDeptId: new Map(departments.map((d) => [d.id, d.stateCode] as const)),
  }), [salesPersons, currentPostings, employeeById, deptById, departments])

  const facetsById = useMemo(
    () => new Map(allRows.map((r) => [r.id, buildMeetingFacets(r, facetCtx)] as const)),
    [allRows, facetCtx],
  )

  const departmentOptions: ComboboxOption[] = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of Object.values(deptById)) map.set(d.id, d.name)
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [deptById])

  // States that an existing department actually sits in — the same
  // employee → department → stateCode path the State filter matches on.
  const stateOptions: ComboboxOption[] = useMemo(() => {
    const used = new Set(Object.values(deptById).map((d) => facetCtx.stateCodeByDeptId.get(d.id)))
    return states
      .filter((s) => used.has(s.code))
      .map((s) => ({ value: String(s.code), label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [states, deptById, facetCtx])

  const accountManagerOptions = useMemo(
    () => salesPersonOptions(salesPersons, currentPostings, isAccountManagerDesignation),
    [salesPersons, currentPostings],
  )
  const buSalesOptions = useMemo(
    () => salesPersonOptions(salesPersons, currentPostings, isBuSalesDesignation),
    [salesPersons, currentPostings],
  )
  const regionOpts = useMemo(() => regionOptions(facetCtx), [facetCtx])

  const activeFilterCount = [
    filters.departmentId, filters.stateCode, filters.accountManagerId, filters.buSalesId, filters.region,
    date, timeFrom, timeTo,
  ].filter(Boolean).length
  const hasFilters = activeFilterCount > 0 || filters.search.trim() !== ''
  function clearFilters() {
    setFilters(EMPTY_MEETING_FILTERS); setDate(''); setTimeFrom(''); setTimeTo('')
  }

  const rows = useMemo(() => allRows.filter((e) => {
    if (!matchesMeetingFilters(facetsById.get(e.id)!, filters)) return false
    if (date && e.date !== date) return false
    // Entries logged without a time of day can't be placed in a time-of-day
    // range, so a range filter excludes them rather than guessing.
    if ((timeFrom || timeTo) && !e.time) return false
    if (timeFrom && e.time! < timeFrom) return false
    if (timeTo && e.time! > timeTo) return false
    return true
  }), [allRows, facetsById, filters, date, timeFrom, timeTo])

  // `highlight` here is consumed by EmployeeDetails (a different reader than
  // this page's own `useHighlightOnArrival` below) to scroll to and briefly
  // highlight this specific timeline entry within the employee's profile —
  // without it, "showing meeting details" just looked like "landed on the
  // employee's generic profile" since nothing pointed at the actual meeting.
  function openPerson(employeeId: string, entryId: string) {
    navigate(`/directory?sel=${employeeId}&kind=employee&highlight=${entryId}`)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 8,
  })

  // Lets a search-palette Meeting result land here scrolled-to and briefly
  // highlighted (?highlight=<entryId>) — search-categories.ts's meeting
  // category is the only current producer of this query param.
  const highlightedId = useHighlightOnArrival(
    rows,
    (r) => r.id,
    (index) => virtualizer.scrollToIndex(index, { align: 'center' }),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 space-y-3 border-b border-line bg-white/80 px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Engagement</span>
            <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Meetings</h1>
            <p className="text-[12px] text-muted">Every logged meeting and interaction, across every employee</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Icon name="Plus" size={15} /> Create Meeting
          </Button>
        </div>

        {/* Search plus eight filters is a desktop-width toolbar — below `sm`
            the filters collapse behind a Filter button (search stays visible)
            so the meeting list stays the first thing on screen. */}
        <div className="space-y-2 sm:flex sm:items-start sm:gap-2 sm:space-y-0">
          <div className="relative sm:w-64 sm:shrink-0">
            <Icon name="Search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              type="search"
              value={filters.search}
              onChange={(e) => setFilter('search')(e.target.value)}
              placeholder="Search meetings…"
              aria-label="Search meetings"
              className="h-9 pl-8 text-[13px]"
            />
          </div>
          <MobileFilterBar activeCount={activeFilterCount} className="sm:min-w-0 sm:flex-1">
            <div className="mt-2 grid grid-cols-1 gap-2 sm:mt-0 sm:flex sm:flex-wrap sm:items-center">
              <Combobox
                value={filters.departmentId}
                onChange={setFilter('departmentId')}
                options={departmentOptions}
                placeholder="Department"
                aria-label="Filter by department"
                className="min-w-[9rem] flex-1"
              />
              <Combobox
                value={filters.stateCode}
                onChange={setFilter('stateCode')}
                options={stateOptions}
                placeholder="State"
                aria-label="Filter by state"
                className="min-w-[8rem] flex-1"
              />
              <Combobox
                value={filters.accountManagerId}
                onChange={setFilter('accountManagerId')}
                options={accountManagerOptions}
                placeholder="Account Manager"
                aria-label="Filter by account manager"
                className="min-w-[10rem] flex-1"
              />
              <Combobox
                value={filters.buSalesId}
                onChange={setFilter('buSalesId')}
                options={buSalesOptions}
                placeholder="BU Sales"
                aria-label="Filter by BU sales"
                className="min-w-[8rem] flex-1"
              />
              <Combobox
                value={filters.region}
                onChange={setFilter('region')}
                options={regionOpts}
                placeholder="Region"
                aria-label="Filter by region"
                className="min-w-[12rem] flex-1"
              />
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="h-9 w-full text-[13px] sm:w-[9rem]" />
              <div className="flex items-center gap-1.5">
                <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} aria-label="Time from" className="h-9 w-full text-[13px] sm:w-[7rem]" />
                <span className="text-[12px] text-muted">to</span>
                <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} aria-label="Time to" className="h-9 w-full text-[13px] sm:w-[7rem]" />
              </div>
              {hasFilters && (
                <Button size="sm" variant="ghost" onClick={clearFilters} className="h-11 w-full justify-center sm:h-8 sm:w-auto">
                  <Icon name="X" size={13} /> Clear filters
                </Button>
              )}
            </div>
          </MobileFilterBar>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {allRows.length === 0 ? 'No meetings logged yet.' : 'No meetings match these filters.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const e = rows[vi.index]
              return (
                <div
                  key={e.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                  className="pb-2"
                >
                  <TimelineRow
                    entry={e}
                    employee={employeeById.get(e.employeeId)!}
                    department={deptById[e.employeeId]?.name}
                    highlighted={e.id === highlightedId}
                    onClick={() => openPerson(e.employeeId, e.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TimelineEventDialog
        open={createOpen}
        employeeId={null}
        typeFilter={ALL_EVENT_TYPES}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}

/** Sales people whose CURRENT posting designation passes `match`, by name. */
function salesPersonOptions(
  salesPersons: SalesPerson[],
  currentPostings: Record<string, SalesPosting>,
  match: (designation: string) => boolean,
): ComboboxOption[] {
  return salesPersons
    .filter((p) => match(currentPostings[p.id]?.designation ?? ''))
    .map((p) => ({ value: p.id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function TimelineRow({ entry, employee, department, highlighted, onClick }: {
  entry: TimelineEvent
  employee: Employee
  department?: string
  highlighted?: boolean
  onClick: () => void
}) {
  const meta = TIMELINE_META[entry.type]
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        highlighted ? 'border-teal-600 bg-teal-100/40' : 'border-line bg-white hover:border-ink-600',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
        <Icon name={meta.icon} size={15} className="text-ink-700" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink-900">{entry.title}</span>
          <Badge tone={meta.tone}>{timelineEventLabel(entry)}</Badge>
          {entry.attended === true && <Badge tone="emerald">Attended</Badge>}
          {entry.attended === false && <Badge tone="crimson">Not attended</Badge>}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          <span className="font-medium text-ink-700">{employee.name}</span>
          {department && ` · ${department}`}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] text-muted">
        {entry.date}{entry.time && ` · ${entry.time}`}
      </span>
    </button>
  )
}
