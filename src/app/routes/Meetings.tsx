import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAllEmployees, useAllTimelineEvents, useEmployeeDepartments } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui/Badge'
import { TIMELINE_META } from '@/lib/timeline-meta'
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
// they're posting history, not a meeting or a logged interaction.
const LOGGED_TYPES: TimelineEventType[] = ['meeting', 'call', 'email', 'whatsapp', 'followup', 'note', 'document', 'custom']

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
  const rows = useMemo(() => entries.filter((e) => employeeById.has(e.employeeId)), [entries, employeeById])

  function openPerson(employeeId: string) {
    navigate(`/directory?sel=${employeeId}&kind=employee`)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 8,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-6 py-4 backdrop-blur">
        <span className="eyebrow">Meetings</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Meetings</h1>
        <p className="text-[12px] text-muted">Every logged meeting and interaction, across every employee</p>
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

function TimelineRow({ entry, employee, department, onClick }: {
  entry: TimelineEvent
  employee: Employee
  department?: string
  onClick: () => void
}) {
  const meta = TIMELINE_META[entry.type]
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
          <span className="text-[13px] font-medium text-ink-900">{entry.title}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
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
