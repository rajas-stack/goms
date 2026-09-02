import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAllEmployees, useAllTimelineEvents, useEmployeeDepartments } from '@/lib/api'
import { useHighlightOnArrival } from '@/lib/useHighlightOnArrival'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { MobileFilterBar } from '@/components/MobileFilterBar'
import { Input } from '@/components/ui/Field'
import { TIMELINE_META, timelineEventLabel } from '@/lib/timeline-meta'
import { cn } from '@/lib/utils'
import type { Employee, TimelineEvent, TimelineEventType } from '@/lib/types'

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
 *  just aggregated here. Purely a browse/navigate surface: no mutation of any
 *  kind happens from this screen — editing or deleting an entry still happens
 *  from the person's own profile. */
export function Meetings() {
  const navigate = useNavigate()
  const { data: employees = [] } = useAllEmployees()
  const { data: deptById = {} } = useEmployeeDepartments()
  const { data: entries = [] } = useAllTimelineEvents({ types: LOGGED_TYPES })

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e] as const)), [employees])

  // Defensive: only show rows whose employee still resolves (deletion already
  // cascades to timeline rows in the repository, so this should be a no-op).
  const allRows = useMemo(() => entries.filter((e) => employeeById.has(e.employeeId)), [entries, employeeById])

  const [departmentId, setDepartmentId] = useState('')
  const [personId, setPersonId] = useState('')
  const [attended, setAttended] = useState<'' | 'yes' | 'no'>('')
  const [type, setType] = useState<TimelineEventType | ''>('')
  const [date, setDate] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')

  const departmentOptions: ComboboxOption[] = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of Object.values(deptById)) map.set(d.id, d.name)
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [deptById])

  const personOptions: ComboboxOption[] = useMemo(
    () => [...new Set(allRows.map((r) => r.employeeId))]
      .map((id) => ({ value: id, label: employeeById.get(id)?.name ?? 'Unknown' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [allRows, employeeById],
  )

  const typeOptions: ComboboxOption[] = useMemo(
    () => LOGGED_TYPES.map((t) => ({ value: t, label: TIMELINE_META[t].label })),
    [],
  )

  const hasFilters = departmentId !== '' || personId !== '' || attended !== '' || type !== ''
    || date !== '' || timeFrom !== '' || timeTo !== ''
  const activeFilterCount = [departmentId, personId, attended, type, date, timeFrom, timeTo].filter(Boolean).length
  function clearFilters() {
    setDepartmentId(''); setPersonId(''); setAttended(''); setType(''); setDate(''); setTimeFrom(''); setTimeTo('')
  }

  const rows = useMemo(() => allRows.filter((e) => {
    if (departmentId && deptById[e.employeeId]?.id !== departmentId) return false
    if (personId && e.employeeId !== personId) return false
    if (attended === 'yes' && e.attended !== true) return false
    if (attended === 'no' && e.attended !== false) return false
    if (type && e.type !== type) return false
    if (date && e.date !== date) return false
    // Entries logged without a time of day can't be placed in a time-of-day
    // range, so a range filter excludes them rather than guessing.
    if ((timeFrom || timeTo) && !e.time) return false
    if (timeFrom && e.time! < timeFrom) return false
    if (timeTo && e.time! > timeTo) return false
    return true
  }), [allRows, deptById, departmentId, personId, attended, type, date, timeFrom, timeTo])

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
        <div>
          <span className="eyebrow">Engagement</span>
          <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Meetings</h1>
          <p className="text-[12px] text-muted">Every logged meeting and interaction, across every employee</p>
        </div>

        {/* Seven controls is a desktop-width filter row — below `sm` they
            collapse behind a Filter button so the meeting list stays the first
            thing on screen. */}
        <MobileFilterBar activeCount={activeFilterCount}>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Combobox
            value={departmentId}
            onChange={setDepartmentId}
            options={departmentOptions}
            placeholder="All departments"
            aria-label="Filter by department"
            className="min-w-[9rem] flex-1"
          />
          <Combobox
            value={personId}
            onChange={setPersonId}
            options={personOptions}
            placeholder="All people"
            aria-label="Filter by person"
            className="min-w-[9rem] flex-1"
          />
          <Combobox
            value={type}
            onChange={(v) => setType(v as TimelineEventType | '')}
            options={typeOptions}
            placeholder="All types"
            aria-label="Filter by type"
            className="min-w-[9rem] flex-1"
          />
          <Combobox
            value={attended}
            onChange={(v) => setAttended(v as '' | 'yes' | 'no')}
            options={[{ value: 'yes', label: 'Attended' }, { value: 'no', label: 'Not attended' }]}
            placeholder="Attended?"
            aria-label="Filter by attendance"
            className="min-w-[8rem] flex-1"
          />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="w-full sm:w-[9rem]" />
          <div className="flex items-center gap-1.5">
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} aria-label="From time" className="w-full sm:w-[7rem]" />
            <span className="text-[12px] text-muted">to</span>
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} aria-label="To time" className="w-full sm:w-[7rem]" />
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-11 w-full justify-center sm:h-auto sm:w-auto">
              <Icon name="X" size={13} /> Clear filters
            </Button>
          )}
        </div>
        </MobileFilterBar>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No meetings logged yet.</p>
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
    </div>
  )
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
