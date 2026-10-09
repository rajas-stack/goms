import { Fragment, memo } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { STATUS_META } from './statusStyles'
import { diffDays, formatShortDate, pluralDays, toDay } from './timelineDates'
import type { IsoDate, Milestone, MilestoneStatus } from './types'

const ICON_TILE: Record<MilestoneStatus, string> = {
  COMPLETED: 'bg-gradient-to-b from-emerald-50 to-emerald-100 text-emerald-700',
  IN_PROGRESS: 'bg-gradient-to-b from-blue-50 to-blue-100 text-blue',
  UPCOMING: 'neu-raised-sm text-muted',
  DELAYED: 'bg-gradient-to-b from-rose-50 to-crimson-100 text-crimson',
  BLOCKED: 'bg-gradient-to-b from-amber-50 to-amber-100 text-amber-700',
}

/** ✓ when done, a progress ring while running, an empty ring when upcoming. */
function StatusMark({ m, today }: { m: Milestone; today: IsoDate }) {
  if (m.status === 'COMPLETED') {
    return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald text-white shadow-[0_2px_6px_rgb(var(--c-emerald)/0.45)]"><Icon name="Check" size={13} /></span>
  }
  const span = Math.max(diffDays(m.plannedStart, m.plannedEnd), 1)
  const running = m.status === 'IN_PROGRESS' || m.status === 'DELAYED'
  const fraction = running ? Math.min(Math.max((toDay(today) - toDay(m.plannedStart)) / span, 0.08), 1) : 0
  const r = 13, c = 2 * Math.PI * r
  const stroke = m.status === 'DELAYED' ? 'stroke-crimson' : m.status === 'BLOCKED' ? 'stroke-amber' : 'stroke-blue'
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-line" />
      {running && <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className={stroke} strokeDasharray={`${fraction * c} ${c}`} />}
    </svg>
  )
}

/** The lifecycle as a row of stage cards joined by chevrons. */
export const StageCards = memo(function StageCards({ milestones, today, selectedId, highlightedId, onSelect }: {
  milestones: Milestone[]; today: IsoDate; selectedId: string | null; highlightedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto px-1 pb-2 pt-1 scrollbar-thin" data-testid="stage-cards">
      {milestones.map((m, i) => {
        const active = m.status === 'IN_PROGRESS' || m.status === 'DELAYED'
        const days = diffDays(m.plannedStart, m.plannedEnd)
        const selected = selectedId === m.id
        return (
          <Fragment key={m.id}>
            {i > 0 && <Icon name="ChevronRight" size={14} className="shrink-0 self-center text-edge" />}
            <button
              type="button"
              data-phase-card={m.id}
              aria-pressed={selected}
              aria-label={`${m.name}: ${STATUS_META[m.status].label}, planned ${formatShortDate(m.plannedStart)} to ${formatShortDate(m.plannedEnd)}, ${pluralDays(days)}`}
              onClick={() => onSelect(m.id)}
              className={cn(
                'neu-raised flex min-w-[170px] flex-1 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 focus-visible:focus-ring',
                active ? 'border-blue/70 bg-none bg-gradient-to-br from-blue-50 to-white' : 'border-transparent',
                m.status === 'DELAYED' && 'border-crimson/60 from-rose-50',
                selected && 'ring-2 ring-blue/50 ring-offset-2 ring-offset-paper',
                highlightedId === m.id && 'ring-2 ring-blue ring-offset-2 ring-offset-paper',
              )}
            >
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]', ICON_TILE[m.status])}>
                <Icon name={m.icon ?? STATUS_META[m.status].glyph} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('line-clamp-2 block text-[12px] font-semibold leading-tight', active ? (m.status === 'DELAYED' ? 'text-crimson' : 'text-blue-700') : 'text-ink-900')}>{m.name}</span>
                <span className="block text-[11px] text-ink-600">{formatShortDate(m.plannedStart)} – {formatShortDate(m.plannedEnd)}</span>
                <span className="block text-[11px] text-muted">{pluralDays(days)}{!!m.issueCount && <span className="ml-1.5 text-crimson">· {m.issueCount} open issue{m.issueCount === 1 ? '' : 's'}</span>}</span>
              </span>
              <StatusMark m={m} today={today} />
            </button>
          </Fragment>
        )
      })}
    </div>
  )
})
