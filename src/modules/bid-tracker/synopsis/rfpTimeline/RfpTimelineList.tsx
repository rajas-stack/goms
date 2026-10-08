import { cn } from '@/lib/utils'
import { formatRfpDate, gapLabel, relativeLabel, statusOf, type RfpDate, type RfpStatus } from './rfpTimelineModel'

const STATUS_CHIP: Record<RfpStatus, { label: string; className: string }> = {
  past: { label: 'Passed', className: 'border-line bg-panel text-muted' },
  today: { label: 'Today', className: 'border-crimson/40 bg-crimson-100 text-crimson' },
  upcoming: { label: 'Upcoming', className: 'border-blue/40 bg-blue-50 text-blue-700' },
}

/** Every date in order, with what it is for and how far it sits from the one before. */
export function RfpTimelineList({ dates, now }: { dates: readonly RfpDate[]; now: Date }) {
  return (
    <ol aria-label="RFP dates in order" className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
      <li aria-hidden className="hidden grid-cols-[170px_minmax(0,1fr)_minmax(150px,200px)_110px] gap-4 bg-panel/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid">
        <span>Date</span><span>What it is for</span><span>Gap</span><span>Status</span>
      </li>
      {dates.map((entry, index) => {
        const status = statusOf(entry, now)
        const previous = dates[index - 1]
        return (
          <li key={entry.key} data-status={status} className="grid gap-1 px-4 py-2.5 text-[13px] md:grid-cols-[170px_minmax(0,1fr)_minmax(150px,200px)_110px] md:items-center md:gap-4">
            <span className={cn('font-semibold tabular-nums', status === 'past' ? 'text-muted' : 'text-ink-900')}>{formatRfpDate(entry)}</span>
            <span className="min-w-0 text-ink-800">{entry.label}</span>
            <span className="text-[12px] text-ink-600">
              {previous ? <>{gapLabel(previous, entry)} <span className="text-muted">after {previous.shortLabel}</span></> : <span className="text-muted">First date</span>}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn('inline-flex rounded-full border px-2 py-px text-[11px] font-medium', STATUS_CHIP[status].className)}>{STATUS_CHIP[status].label}</span>
              <span className="text-[11px] text-muted md:basis-full">{relativeLabel(entry, now)}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
