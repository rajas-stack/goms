import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { formatRfpDate, layoutChart, statusOf, type RfpDate, type RfpMarker } from './rfpTimelineModel'

const MIN_WIDTH_PER_MARKER = 120
const pct = (value: number) => `${(value * 100).toFixed(3)}%`

/** Keeps edge labels inside the track instead of centring them off-screen. */
function anchorStyle(position: number): CSSProperties {
  const shift = position < 0.12 ? '0%' : position > 0.88 ? '-100%' : '-50%'
  return { left: pct(position), transform: `translateX(${shift})` }
}

function MarkerLabel({ marker, above, now }: { marker: RfpMarker; above: boolean; now: Date }) {
  const past = statusOf(marker.items[marker.items.length - 1], now) === 'past'
  return (
    <div className={cn('absolute flex w-max max-w-[170px] flex-col', above ? 'bottom-[calc(50%+22px)]' : 'top-[calc(50%+22px)]')} style={anchorStyle(marker.position)}>
      <div className={cn('rounded-xl px-2.5 py-1.5 text-left', past ? 'neu-inset' : 'neu-raised-sm')}>
        <div className={cn('text-[11px] font-semibold tabular-nums', past ? 'text-muted' : 'text-ink-900')}>
          {formatRfpDate({ date: marker.date, hasTime: false })}
        </div>
        {marker.items.map(item => (
          <div key={item.key} className={cn('truncate text-[11.5px] leading-snug', past ? 'text-muted' : 'text-ink-700')} title={item.label}>
            {item.shortLabel}{item.hasTime && <span className="text-muted"> · {item.date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Horizontal, time-proportional view of the RFP dates: each marker is a
 *  date, the bar between two markers is the phase between them. The list
 *  below the chart carries the same facts for screen readers. */
export function RfpTimelineChart({ dates, now }: { dates: readonly RfpDate[]; now: Date }) {
  const { markers, phases, todayPosition } = layoutChart(dates, now)
  const minWidth = Math.max(560, markers.length * MIN_WIDTH_PER_MARKER)
  const nextUpcoming = markers.find(marker => statusOf(marker.items[0], now) !== 'past')

  return (
    <figure aria-label="Timeline of RFP dates" className="neu-raised overflow-hidden rounded-2xl">
      <div className="overflow-x-auto scrollbar-thin" data-testid="rfp-timeline-chart">
        <div className="relative mx-auto h-[248px]" style={{ minWidth }} aria-hidden>
          <div className="neu-inset absolute left-[2%] right-[2%] top-1/2 h-2 -translate-y-1/2 rounded-full" />
          {phases.map(phase => {
            const left = phase.from.position
            const width = phase.to.position - left
            return (
              <div key={`${phase.from.id}>${phase.to.id}`} className="absolute top-1/2 h-2 -translate-y-1/2" style={{ left: pct(left), width: pct(width) }}>
                <div className={cn('h-full w-full rounded-full', phase.status === 'future' ? 'border-y border-dashed border-blue/40 bg-blue/[0.06]' : phase.status === 'past' ? 'bg-emerald/45' : 'bg-blue/15')} />
                {phase.status === 'current' && <div className="absolute inset-y-0 left-0 rounded-full bg-blue/70" style={{ width: pct(phase.progress) }} />}
                {width > 0.06 && (
                  <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-medium tabular-nums text-muted">
                    {phase.days} {phase.days === 1 ? 'day' : 'days'}
                  </span>
                )}
              </div>
            )
          })}
          {todayPosition !== null && (
            <div className="absolute inset-y-3 w-0 border-l-2 border-dashed border-crimson/70" style={{ left: pct(todayPosition) }}>
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-crimson px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">Today</span>
            </div>
          )}
          {markers.map((marker, index) => {
            const past = statusOf(marker.items[marker.items.length - 1], now) === 'past'
            const isNext = marker === nextUpcoming
            return (
              <div key={marker.id}>
                <span className={cn('absolute h-[18px] w-px bg-line', index % 2 === 0 ? 'bottom-[calc(50%+6px)]' : 'top-[calc(50%+6px)]')} style={{ left: pct(marker.position) }} />
                <span
                  data-marker-status={past ? 'past' : 'upcoming'}
                  className={cn(
                    'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                    past ? 'bg-emerald shadow-[0_0_0_3px_rgb(var(--c-emerald)/0.18)]' : 'border-2 border-blue bg-white',
                    isNext && 'shadow-[0_0_0_5px_rgb(var(--c-blue)/0.18)] motion-safe:animate-pulse',
                  )}
                  style={{ left: pct(marker.position) }}
                />
                <MarkerLabel marker={marker} above={index % 2 === 0} now={now} />
              </div>
            )
          })}
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 px-4 py-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald" /> Passed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-blue bg-white" /> Upcoming</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-crimson/70" /> Today</span>
        <span>Spacing is proportional to time.</span>
      </figcaption>
    </figure>
  )
}
