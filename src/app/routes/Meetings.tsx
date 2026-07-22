import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAllEmployees, useAllTimelineEvents, useEmployeeDepartments } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui/Badge'
import { TIMELINE_META } from '@/lib/timeline-meta'
import { cn } from '@/lib/utils'
import type { Employee, TimelineEvent, TimelineEventType } from '@/lib/types'

// Row height is fixed (same markup on every row, single-line content), so a
// static estimate is exact rather than approximate — no per-row measurement
// needed. `space-y-2` between rows in the old non-virtualized markup is
// folded into this constant (row box + gap) so virtualized rows line up
// identically to the plain-map version.
const ROW_HEIGHT = 56
const ROW_GAP = 8

/** `meeting` gets its own tab; every other manually-loggable type is grouped
 *  as "Events". Lifecycle events (`joined`/`promoted`/`transferred`) are
 *  deliberately excluded from both — they're posting history, not a meeting
 *  or a logged interaction. */
const MEETING_TYPES: TimelineEventType[] = ['meeting']
const EVENT_TYPES: TimelineEventType[] = ['call', 'email', 'whatsapp', 'followup', 'note', 'document', 'custom']

type Tab = 'meetings' | 'events'

/** Read-through, cross-employee view over `TimelineEvent` rows — the same
 *  data that's already shown embedded in each Employee's profile timeline,
 *  just aggregated and filtered here. Purely a browse/navigate surface: no
 *  mutation of any kind happens from this screen — editing or deleting an
 *  event still happens from the person's own profile. */
export function Meetings() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('meetings')
  const { data: employees = [] } = useAllEmployees()
  const { data: deptById = {} } = useEmployeeDepartments()
  const { data: events = [] } = useAllTimelineEvents({ types: tab === 'meetings' ? MEETING_TYPES : EVENT_TYPES })

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e] as const)), [employees])

  // Defensive: only show rows whose employee still resolves (deletion already
  // cascades to timeline rows in the repository, so this should be a no-op).
  const rows = useMemo(() => events.filter((e) => employeeById.has(e.employeeId)), [events, employeeById])

  function openPerson(employeeId: string) {
    navigate(`/directory?sel=${employeeId}&kind=employee`)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  // `measureElement` re-measures each row's real rendered height after first
  // paint and self-corrects — `estimateSize` only needs to be a reasonable
  // starting guess (row height + the old `space-y-2` gap), not exact.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 8,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-6 py-4 backdrop-blur">
        <span className="eyebrow">Meetings & Events</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Meetings & Events</h1>
        <p className="text-[12px] text-muted">Every logged meeting and interaction, across every employee</p>

        <div className="mt-3 flex gap-2">
          <TabChip label={`Meetings`} active={tab === 'meetings'} onClick={() => setTab('meetings')} />
          <TabChip label={`Events`} active={tab === 'events'} onClick={() => setTab('events')} />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {tab === 'meetings' ? 'No meetings logged yet.' : 'No events logged yet.'}
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
                  <EventRow
                    event={e}
                    employee={employeeById.get(e.employeeId)!}
                    department={deptById[e.employeeId]?.name}
                    onClick={() => openPerson(e.employeeId)}
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

function TabChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-8 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors',
        active ? 'bg-ink-900 text-paper' : 'border border-line text-ink-700 hover:bg-ink-900/[0.05]',
      )}
    >
      {label}
    </button>
  )
}

function EventRow({ event, employee, department, onClick }: {
  event: TimelineEvent
  employee: Employee
  department?: string
  onClick: () => void
}) {
  const meta = TIMELINE_META[event.type]
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-ink-600"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
        <Icon name={meta.icon} size={15} className="text-ink-700" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink-900">{event.title}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">
          <span className="font-medium text-ink-700">{employee.name}</span>
          {department && ` · ${department}`}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] text-muted">
        {event.date}{event.time && ` · ${event.time}`}
      </span>
    </button>
  )
}
