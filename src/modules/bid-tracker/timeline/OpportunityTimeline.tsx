// Opportunity Lifecycle Timeline — a reusable, data-driven timeline. It renders
// whatever OpportunityTimeline it is given; it computes no business dates
// itself. Positions are strictly time-proportional.
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/Icon'
import { isoToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { FocusTarget } from './focus'
import { Diamond, Dot, GanttLabels, GanttLayer } from './GanttGrid'
import { StageCards } from './StageCards'
import { StageDetail } from './StageDetail'
import { GANTT } from './statusStyles'
import { ClusterList, EventInfo } from './TimelineDetails'
import { TimelineHeader } from './TimelineHeader'
import { formatTimelineDate, fromDay, toDay } from './timelineDates'
import { activeMilestone, clusterEvents, domainSpan, todayFocusDay, todayPlacement, type EventCluster, type ZoomPreset } from './timelineMath'
import type { IsoDate, Milestone, OpportunityTimeline as Timeline } from './types'
import { useElementWidth, useViewportGestures } from './useViewportGestures'
import { useTimelineViewport, type TimelineViewport } from './useTimelineViewport'

export interface OpportunityTimelineProps {
  timeline: Timeline
  /** Defaults to the viewer's local today. */
  today?: IsoDate
  /** Closed opportunities centre the end date on "Today". Defaults to `!!timeline.outcome`. */
  isClosed?: boolean
  className?: string
}

const CLUSTER_GAP_PX = 26
const HIGHLIGHT_MS = 2500
const KEY_ZOOM_FACTOR = 1.5

function useTimelineKeys(vp: TimelineViewport, timeline: Timeline, onToday: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const center = vp.view.startDay + vp.view.spanDays / 2
    const actions: Record<string, () => void> = {
      ArrowLeft: () => vp.step(-1),
      ArrowRight: () => vp.step(1),
      Home: () => vp.centerOn(toDay(timeline.startDate)),
      End: () => vp.centerOn(toDay(timeline.endDate)),
      '+': () => vp.scale(1 / KEY_ZOOM_FACTOR, center),
      '=': () => vp.scale(1 / KEY_ZOOM_FACTOR, center),
      '-': () => vp.scale(KEY_ZOOM_FACTOR, center),
      t: onToday,
    }
    const action = actions[e.key]
    if (!action) return
    e.preventDefault()
    action()
  }
}

/** The stage to describe by default: the running one, else the next upcoming, else the last. */
function defaultStage(milestones: Milestone[]): string | null {
  return (activeMilestone(milestones) ?? milestones.find((m) => m.status === 'UPCOMING') ?? milestones[milestones.length - 1])?.id ?? null
}

function Legend() {
  const item = 'flex items-center gap-2'
  return (
    <ul aria-label="Legend" className="neu-raised flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl px-4 py-2 text-[11px] text-ink-700">
      <li className={item}><Dot className="bg-blue" />Planned</li>
      <li className={item}><Dot className="bg-emerald" />Actual</li>
      <li className={item}><Dot className="bg-edge" />Upcoming</li>
      <li className={item}><Dot className="bg-crimson/70" />Delayed</li>
      <li className={item}><span aria-hidden className="w-6 border-t-2 border-dashed border-blue/60" />Planned dependency</li>
      <li className={item}><span aria-hidden className="w-6 border-t-2 border-dashed border-crimson/70" />Delayed dependency</li>
      <li className={item}><Diamond className="border-2 border-ink-900" />Milestone</li>
      <li className={item}><Icon name="TriangleAlert" size={12} className="text-crimson" />Issue</li>
      <li className={item}><span aria-hidden className="h-4 border-l-2 border-dashed border-ink-900" />Today</li>
    </ul>
  )
}

export function OpportunityTimeline({ timeline, today = isoToday(), isClosed = !!timeline.outcome, className }: OpportunityTimelineProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(frameRef)
  const vp = useTimelineViewport(timeline.startDate, timeline.endDate, width)
  const { dragging, handlers } = useViewportGestures(frameRef, vp)
  const { milestones, events } = timeline
  const [stageId, setStageId] = useState<string | null>(() => defaultStage(milestones))
  const [issue, setIssue] = useState<FocusTarget | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const originDay = vp.domain.startDay

  // Re-clustered only when the scale changes — never on a pan frame.
  const clusters = useMemo(() => clusterEvents(events, vp.pxPerDay, CLUSTER_GAP_PX), [events, vp.pxPerDay])
  const clusterById = useMemo(() => new Map<string, EventCluster>(clusters.map((c) => [c.id, c])), [clusters])
  const stage = milestones.find((m) => m.id === stageId) ?? milestones.find((m) => m.id === defaultStage(milestones))

  useEffect(() => {
    if (!highlightedId) return
    const t = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(t)
  }, [highlightedId])

  useEffect(() => {
    if (!issue) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setIssue(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [issue])

  const goToday = useCallback(() => {
    const day = todayFocusDay(timeline.startDate, timeline.endDate, today, isClosed)
    if (vp.zoom === 'All') vp.setZoom('1M', day)
    else vp.centerOn(day)
    const active = isClosed ? null : activeMilestone(milestones)?.id ?? null
    setHighlightedId(active)
    if (active) setStageId(active)
  }, [timeline.startDate, timeline.endDate, today, isClosed, vp, milestones])

  // Zooming keeps "now" in view: around today when it is on screen, otherwise around the current centre.
  const zoomTo = (preset: ZoomPreset) => {
    const focus = todayFocusDay(timeline.startDate, timeline.endDate, today, isClosed)
    const visible = focus >= vp.view.startDay && focus <= vp.view.startDay + vp.view.spanDays
    vp.setZoom(preset, visible ? focus : undefined)
  }

  const selectStage = useCallback((id: string) => { setStageId(id); setIssue(null) }, [])
  const onKeyDown = useTimelineKeys(vp, timeline, goToday)

  const issueContent = (t: FocusTarget) => {
    if (t.kind === 'cluster') {
      const c = clusterById.get(t.id)
      return c ? <ClusterList events={c.events} onPick={(id) => setIssue({ kind: 'event', id })} /> : null
    }
    const e = events.find((x) => x.id === t.id)
    return e ? <EventInfo e={e} phaseName={milestones.find((m) => m.id === e.milestoneId)?.name} /> : null
  }

  const offsetPx = (vp.view.startDay - originDay) * vp.pxPerDay
  const showToday = todayPlacement(toDay(today), toDay(timeline.startDate), toDay(timeline.endDate)) === 'inside' && !isClosed
  const whole = vp.zoom === 'All'
  const rangeStart = formatTimelineDate(whole ? timeline.startDate : fromDay(Math.round(vp.view.startDay)))
  const rangeEnd = formatTimelineDate(whole ? timeline.endDate : fromDay(Math.round(vp.view.startDay + vp.view.spanDays)))

  return (
    <section aria-label="Opportunity lifecycle timeline" className={cn('min-w-0 space-y-3 rounded-2xl bg-panel/50 p-3 sm:p-4', className)}>
      <TimelineHeader rangeStart={rangeStart} rangeEnd={rangeEnd} endEstimated={!!timeline.endDateEstimated} outcome={timeline.outcome}
        zoom={vp.zoom} onZoom={zoomTo} onToday={goToday} onStep={vp.step} />

      <StageCards milestones={milestones} today={today} selectedId={stage?.id ?? null} highlightedId={highlightedId} onSelect={selectStage} />

      <div className="neu-raised flex rounded-xl p-2.5">
        <GanttLabels />
        <div
          ref={frameRef}
          role="region"
          tabIndex={0}
          aria-label="Timeline viewport. Drag or use arrow keys to move, plus and minus to zoom."
          aria-roledescription="timeline"
          data-testid="timeline-frame"
          data-px-per-day={vp.pxPerDay.toFixed(4)}
          data-view-start={vp.view.startDay.toFixed(3)}
          className={cn('neu-inset relative min-w-0 flex-1 select-none overflow-hidden rounded-xl focus-visible:focus-ring', dragging ? 'cursor-grabbing' : 'cursor-grab')}
          style={{ height: GANTT.totalH, touchAction: 'pan-y' }}
          onKeyDown={onKeyDown}
          {...handlers}
        >
          <div
            data-testid="timeline-layer"
            className={cn('absolute inset-y-0 left-0 will-change-transform', !dragging && 'transition-transform duration-300 ease-out motion-reduce:transition-none')}
            style={{ width: domainSpan(vp.domain) * vp.pxPerDay, transform: `translate3d(${-offsetPx}px,0,0)` }}
          >
            <GanttLayer milestones={milestones} startDate={timeline.startDate} endDate={timeline.endDate} endEstimated={!!timeline.endDateEstimated}
              today={today} showToday={showToday} originDay={originDay} endDay={vp.domain.endDay} pxPerDay={vp.pxPerDay}
              viewStartDay={vp.view.startDay} viewSpanDays={vp.view.spanDays} selectedId={stage?.id ?? null}
              clusters={clusters} onSelectStage={selectStage} onSelect={setIssue} />
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {issue && (
          <motion.div key="issue" role="region" aria-label="Timeline details" data-testid="timeline-detail"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
            className="neu-raised relative rounded-xl p-3 pr-11">
            <button type="button" onClick={() => setIssue(null)} aria-label="Close details"
              className="neu-raised-sm absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-ink focus-visible:focus-ring">
              <Icon name="X" size={14} />
            </button>
            {issueContent(issue)}
          </motion.div>
        )}
      </AnimatePresence>

      {stage && <StageDetail m={stage} today={today} note={timeline.latestNote} />}
      <Legend />
    </section>
  )
}
