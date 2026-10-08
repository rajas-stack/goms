import { memo } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { FocusTarget } from './focus'
import { SEVERITY_CLASS } from './statusStyles'
import { formatTimelineDate, fromDay } from './timelineDates'
import { dayToX, type EventCluster } from './timelineMath'

interface MarkersProps {
  clusters: EventCluster[]
  originDay: number
  pxPerDay: number
  /** Row offset (px) inside the timeline layer. */
  top: number
  onHover?: (target: FocusTarget | null) => void
  onSelect: (target: FocusTarget) => void
}

const MARKER = 20

function markerLabel(c: EventCluster): string {
  if (c.events.length > 1) return `${c.events.length} events around ${formatTimelineDate(fromDay(Math.round(c.day)))}, show list`
  const e = c.events[0]
  return `${e.type}: ${e.title}, ${formatTimelineDate(e.date)}, ${e.severity} severity, ${e.status}`
}

/** ⚠ markers at their dates; overlapping ones are pre-grouped into "⚠ n" clusters. */
export const EventMarkers = memo(function EventMarkers({ clusters, originDay, pxPerDay, top, onHover, onSelect }: MarkersProps) {
  return (
    <div className="absolute inset-x-0" style={{ top, height: MARKER }}>
      {clusters.map((c) => {
        const x = dayToX(c.day, originDay, pxPerDay)
        const grouped = c.events.length > 1
        const resolved = c.events.every((e) => e.status === 'Resolved')
        const target: FocusTarget = grouped ? { kind: 'cluster', id: c.id } : { kind: 'event', id: c.events[0].id }
        return (
          <button
            key={c.id}
            type="button"
            data-marker={grouped ? 'cluster' : 'event'}
            aria-label={markerLabel(c)}
            className={cn(
              'absolute flex h-5 -translate-x-1/2 items-center justify-center gap-0.5 rounded-md border text-[11px] font-semibold',
              'transition-shadow duration-150 hover:shadow-panel focus-visible:focus-ring',
              grouped ? 'min-w-[32px] px-1' : 'w-5',
              resolved ? 'border-line bg-white text-muted' : SEVERITY_CLASS[c.severity],
            )}
            style={{ left: x }}
            onMouseEnter={() => onHover?.(target)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(target)}
            onBlur={() => onHover?.(null)}
            onClick={() => onSelect(target)}
          >
            <span className="absolute bottom-full left-1/2 h-1.5 w-px -translate-x-1/2 bg-current opacity-40" aria-hidden />
            <Icon name={resolved ? 'Check' : 'TriangleAlert'} size={11} />
            {grouped && <span>{c.events.length}</span>}
          </button>
        )
      })}
    </div>
  )
})
