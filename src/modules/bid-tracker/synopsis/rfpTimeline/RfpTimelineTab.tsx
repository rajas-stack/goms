import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useSynopsis } from '../api'
import { documentToGeneral } from '../generalFields'
import { RfpTimelineChart } from './RfpTimelineChart'
import { RfpTimelineList } from './RfpTimelineList'
import { buildRfpTimeline, calendarDays, formatRfpDate, relativeLabel, statusOf, type RfpTimeline } from './rfpTimelineModel'

interface Props {
  bidId: string
  /** Switches the bid page to the General tab. */
  onOpenGeneral: () => void
  /** Injectable clock for tests. */
  now?: Date
}

/** Read-only view of the dates entered in General, in order and to scale. */
export function RfpTimelineTab({ bidId, onOpenGeneral, now }: Props) {
  const query = useSynopsis(bidId, 'general')
  const timeline = useMemo(() => buildRfpTimeline(documentToGeneral(query.data?.document)), [query.data])
  const today = useMemo(() => now ?? new Date(), [now])

  if (query.isLoading) return <div role="status" className="p-6 text-sm text-muted">Loading RFP timeline...</div>
  if (query.isError) {
    return (
      <div role="alert" className="space-y-2 p-6 text-sm text-crimson">
        <p>{query.error.message}</p>
        <Button size="sm" onClick={() => void query.refetch()}>Retry</Button>
      </div>
    )
  }

  return (
    <section aria-labelledby="rfp-timeline-heading" className="min-w-0 space-y-4 px-4 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="rfp-timeline-heading" className="text-base font-semibold text-ink-900">RFP Timeline</h2>
          <p className="text-[12px] text-muted">Every date and time from the General tab, in order.</p>
        </div>
        <Button size="sm" onClick={onOpenGeneral}><Icon name="Pencil" size={13} /> Edit dates in General</Button>
      </header>
      {timeline.dates.length === 0 ? <EmptyState timeline={timeline} onOpenGeneral={onOpenGeneral} /> : (
        <>
          <Summary timeline={timeline} now={today} />
          <RfpTimelineChart dates={timeline.dates} now={today} />
          <RfpTimelineList dates={timeline.dates} now={today} />
        </>
      )}
      {timeline.unreadable.length > 0 && <Unreadable timeline={timeline} />}
    </section>
  )
}

function Summary({ timeline, now }: { timeline: RfpTimeline; now: Date }) {
  const { dates } = timeline
  const next = dates.find(entry => statusOf(entry, now) !== 'past')
  const span = calendarDays(dates[0].date, dates[dates.length - 1].date)
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="neu-raised-sm rounded-xl px-3 py-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Next up</dt>
        <dd className="text-[13px] font-semibold text-ink-900">
          {next ? <>{next.shortLabel} <span className="font-normal text-blue-700">· {relativeLabel(next, now)}</span></> : <span className="font-normal text-muted">All dates have passed</span>}
        </dd>
      </div>
      <div className="neu-raised-sm rounded-xl px-3 py-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Span</dt>
        <dd className="text-[13px] text-ink-900">
          <span className="font-semibold">{span} {span === 1 ? 'day' : 'days'}</span>
          <span className="text-muted"> · {formatRfpDate({ date: dates[0].date, hasTime: false })} to {formatRfpDate({ date: dates[dates.length - 1].date, hasTime: false })}</span>
        </dd>
      </div>
      <div className="neu-raised-sm rounded-xl px-3 py-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Dates</dt>
        <dd className="text-[13px] text-ink-900">
          <span className="font-semibold">{dates.length}</span>
          <span className="text-muted"> · {dates.filter(entry => statusOf(entry, now) === 'past').length} passed</span>
        </dd>
      </div>
    </dl>
  )
}

function EmptyState({ timeline, onOpenGeneral }: { timeline: RfpTimeline; onOpenGeneral: () => void }) {
  return (
    <div className="neu-inset flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
      <span className="neu-raised-sm flex h-12 w-12 items-center justify-center rounded-xl text-muted"><Icon name="CalendarClock" size={22} /></span>
      <div>
        <p className="text-[14px] font-semibold text-ink-900">No dates to show yet</p>
        <p className="mx-auto max-w-md text-[13px] text-muted">
          {timeline.unreadable.length
            ? 'The dates entered in General could not be read. Check them there and they will appear here.'
            : 'Fill in the key dates (publishing, queries, pre-bid meeting, bid submission, opening) in the General tab and they will appear here as a timeline.'}
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onOpenGeneral}>Fill in General</Button>
    </div>
  )
}

function Unreadable({ timeline }: { timeline: RfpTimeline }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-3">
      <p className="text-[12px] font-semibold text-ink-700">Not placed on the timeline (no date found)</p>
      <ul className="mt-1 space-y-0.5 text-[12px]">
        {timeline.unreadable.map(entry => (
          <li key={entry.key} className="min-w-0 break-words"><span className="text-ink-700">{entry.label}:</span> <span className="text-muted">{entry.raw}</span></li>
        ))}
      </ul>
    </div>
  )
}
