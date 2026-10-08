import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { cn } from '@/lib/utils'
import { SEVERITY_CLASS } from './statusStyles'
import { formatTimelineDate } from './timelineDates'
import type { TimelineEvent } from './types'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  )
}

export function SeverityChip({ e }: { e: TimelineEvent }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium', SEVERITY_CLASS[e.severity])}>{e.severity}</span>
}

/** Event facts; the owner shows with an avatar when they are a known person. */
export function EventInfo({ e, phaseName }: { e: TimelineEvent; phaseName?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-ink">
          <Icon name={e.status === 'Resolved' ? 'Check' : 'TriangleAlert'} size={13} className={e.status === 'Resolved' ? 'text-muted' : 'text-crimson'} />
          <span className="truncate">{e.title}</span>
        </span>
        <SeverityChip e={e} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <Row label="Type">{e.type}</Row>
        <Row label="Date">{formatTimelineDate(e.date)}</Row>
        <Row label="Status">{e.status}</Row>
        {phaseName && <Row label="Phase">{phaseName}</Row>}
        {(e.ownerPerson || e.owner) && <Row label="Owner">{e.ownerPerson ? <PersonName person={e.ownerPerson} size="2xs" /> : e.owner}</Row>}
      </dl>
      {e.description && <p className="text-[12px] text-muted">{e.description}</p>}
    </div>
  )
}

/** The events behind a "⚠ n" marker, as a list to pick from. */
export function ClusterList({ events, onPick }: { events: TimelineEvent[]; onPick: (id: string) => void }) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-semibold text-ink">{events.length} events</div>
      <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Grouped events">
        {sorted.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onPick(e.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-panel focus-visible:focus-ring">
              <Icon name={e.status === 'Resolved' ? 'Check' : 'TriangleAlert'} size={12} className={e.status === 'Resolved' ? 'text-muted' : 'text-crimson'} />
              <span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
              <span className="shrink-0 text-muted">{formatTimelineDate(e.date)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
