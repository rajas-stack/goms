// Pure timeline math: domain, scale, view window (zoom/pan), variance,
// marker clustering and card density. No React in here — all of it is
// unit-tested directly.
import { diffDays, pluralDays, toDay } from './timelineDates'
import type { IsoDate, Milestone, TimelineEvent, TimelineEventSeverity } from './types'

export type ZoomPreset = '1W' | '1M' | '3M' | 'All'
export type ZoomLevel = ZoomPreset | 'custom'
export const ZOOM_PRESETS: readonly ZoomPreset[] = ['1W', '1M', '3M', 'All']
const PRESET_DAYS: Record<Exclude<ZoomPreset, 'All'>, number> = { '1W': 7, '1M': 30, '3M': 90 }
export const MIN_SPAN_DAYS = 3
const ALL_PAN_FRACTION = 0.25
const DOMAIN_MARGIN_FRACTION = 0.04

/** The scrollable range, in day numbers: the lifecycle plus a small margin so edge nodes are never cut. */
export interface Domain { startDay: number; endDay: number }
/** What the viewport shows: a window into the domain, in days. */
export interface ViewWindow { startDay: number; spanDays: number }

export function lifecycleDomain(startDate: IsoDate, endDate: IsoDate): Domain {
  const start = toDay(startDate)
  const end = Math.max(toDay(endDate), start + 1)
  const margin = Math.max(1, Math.round((end - start) * DOMAIN_MARGIN_FRACTION))
  return { startDay: start - margin, endDay: end + margin }
}

export const domainSpan = (d: Domain): number => d.endDay - d.startDay

/** Largest window the viewport may show: the whole domain, or a preset wider than it. */
const maxSpan = (domain: Domain) => Math.max(domainSpan(domain), PRESET_DAYS['3M'])

/** Keeps the window inside the domain; a window wider than the domain is centred on it. */
export function clampView(view: ViewWindow, domain: Domain): ViewWindow {
  const span = Math.min(Math.max(view.spanDays, MIN_SPAN_DAYS), maxSpan(domain))
  const total = domainSpan(domain)
  if (span >= total) return { startDay: domain.startDay - (span - total) / 2, spanDays: span }
  const startDay = Math.min(Math.max(view.startDay, domain.startDay), domain.endDay - span)
  return { startDay, spanDays: span }
}

export function presetSpan(preset: ZoomPreset, domain: Domain): number {
  return preset === 'All' ? domainSpan(domain) : PRESET_DAYS[preset]
}

export const viewCenter = (view: ViewWindow): number => view.startDay + view.spanDays / 2

/** Changes the time scale, keeping `centerDay` (default: the current centre) in the middle. */
export function zoomView(view: ViewWindow, preset: ZoomPreset, domain: Domain, centerDay = viewCenter(view)): ViewWindow {
  const spanDays = presetSpan(preset, domain)
  if (preset === 'All') return clampView({ startDay: domain.startDay, spanDays }, domain)
  return clampView({ startDay: centerDay - spanDays / 2, spanDays }, domain)
}

/** Scales the window by `factor` around `anchorDay` (which stays where it is on screen). */
export function scaleView(view: ViewWindow, factor: number, anchorDay: number, domain: Domain): ViewWindow {
  const spanDays = view.spanDays * factor
  const ratio = (anchorDay - view.startDay) / view.spanDays
  return clampView({ startDay: anchorDay - ratio * spanDays, spanDays }, domain)
}

export const panView = (view: ViewWindow, days: number, domain: Domain): ViewWindow =>
  clampView({ startDay: view.startDay + days, spanDays: view.spanDays }, domain)

export const centerView = (view: ViewWindow, day: number, domain: Domain): ViewWindow =>
  clampView({ startDay: day - view.spanDays / 2, spanDays: view.spanDays }, domain)

/** Window that frames [fromDay, toDay] with a little breathing room. */
export function fitView(fromDay: number, toDayNum: number, domain: Domain): ViewWindow {
  const span = Math.max(MIN_SPAN_DAYS, (toDayNum - fromDay) * 1.3)
  return clampView({ startDay: (fromDay + toDayNum) / 2 - span / 2, spanDays: span }, domain)
}

/** ← / → step: 7 / 30 / 90 days per preset; All (and custom) move ~25% of what is visible. */
export function panStepDays(zoom: ZoomLevel, view: ViewWindow): number {
  if (zoom === 'All' || zoom === 'custom') return Math.max(1, Math.round(view.spanDays * ALL_PAN_FRACTION))
  return PRESET_DAYS[zoom]
}

/** Which preset (if any) a window's span corresponds to. */
export function zoomLevelOf(spanDays: number, domain: Domain): ZoomLevel {
  const match = ZOOM_PRESETS.find((p) => Math.abs(presetSpan(p, domain) - spanDays) < 0.5)
  return match ?? 'custom'
}

/** Fraction of the way from start to end — the one rule for every horizontal position. */
export function positionRatio(day: number, startDay: number, endDay: number): number {
  return endDay === startDay ? 0 : (day - startDay) / (endDay - startDay)
}

export const dayToX = (day: number, originDay: number, pxPerDay: number): number => (day - originDay) * pxPerDay

export type TodayPlacement = 'inside' | 'before' | 'after'
export function todayPlacement(todayDay: number, startDay: number, endDay: number): TodayPlacement {
  if (todayDay < startDay) return 'before'
  if (todayDay > endDay) return 'after'
  return 'inside'
}

// --- Variance ----------------------------------------------------------------

export interface MilestoneVariance {
  plannedDuration: number
  actualDuration?: number
  /** + late / − early, vs plannedStart. */
  startDays?: number
  /** + late / − early, vs plannedEnd (finished phases only). */
  endDays?: number
  durationDays?: number
  /** Days an unfinished phase has run past its planned end, as of today. */
  overrunDays?: number
}

export function computeVariance(m: Milestone, today: IsoDate): MilestoneVariance {
  const plannedDuration = diffDays(m.plannedStart, m.plannedEnd)
  const startDays = m.actualStart ? diffDays(m.plannedStart, m.actualStart) : undefined
  const endDays = m.actualEnd ? diffDays(m.plannedEnd, m.actualEnd) : undefined
  const runningEnd = m.actualEnd ?? (m.actualStart ? today : undefined)
  const actualDuration = m.actualStart && runningEnd ? Math.max(0, diffDays(m.actualStart, runningEnd)) : undefined
  const durationDays = m.actualEnd && actualDuration !== undefined ? actualDuration - plannedDuration : undefined
  const over = !m.actualEnd && m.actualStart ? diffDays(m.plannedEnd, today) : undefined
  return { plannedDuration, actualDuration, startDays, endDays, durationDays, overrunDays: over !== undefined && over > 0 ? over : undefined }
}

const early = (n: number) => `${pluralDays(Math.abs(n))} early`
const late = (n: number) => `${pluralDays(n)} late`

export function describeStartVariance(days: number): string {
  if (days === 0) return 'Started on time'
  return `Started ${days > 0 ? late(days) : early(days)}`
}

export function describeEndVariance(days: number): string {
  if (days === 0) return 'Completed on time'
  return `Completed ${days > 0 ? late(days) : early(days)}`
}

export function describeDurationVariance(days: number): string {
  if (days === 0) return 'Took as long as planned'
  return `Took ${pluralDays(Math.abs(days))} ${days > 0 ? 'longer' : 'less'} than planned`
}

/** Human sentences for a phase's variance; empty when there is nothing actual to compare. */
export function varianceSummary(m: Milestone, today: IsoDate): string[] {
  const v = computeVariance(m, today)
  return [
    v.startDays !== undefined ? describeStartVariance(v.startDays) : null,
    v.endDays !== undefined ? describeEndVariance(v.endDays) : null,
    v.durationDays !== undefined ? describeDurationVariance(v.durationDays) : null,
    v.overrunDays !== undefined ? `Running ${pluralDays(v.overrunDays)} past plan` : null,
  ].filter((s): s is string => s !== null)
}

// --- Event clustering ------------------------------------------------------

const SEVERITY_RANK: Record<TimelineEventSeverity, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 }
export const maxSeverity = (events: TimelineEvent[]): TimelineEventSeverity =>
  events.reduce<TimelineEventSeverity>((top, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[top] ? e.severity : top), 'Low')

export interface EventCluster {
  id: string
  /** Mean day of its events — where the marker sits. */
  day: number
  events: TimelineEvent[]
  severity: TimelineEventSeverity
}

interface DatedEvent { e: TimelineEvent; day: number }

/** Groups markers that would sit closer than `minGapPx` at this scale into one "⚠ n" marker. */
export function clusterEvents(events: TimelineEvent[], pxPerDay: number, minGapPx: number): EventCluster[] {
  const sorted: DatedEvent[] = events
    .map((e) => ({ e, day: toDay(e.date) }))
    .filter((x) => !Number.isNaN(x.day))
    .sort((a, b) => a.day - b.day || a.e.id.localeCompare(b.e.id))
  const groups: DatedEvent[][] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && (item.day - last[0].day) * pxPerDay < minGapPx) last.push(item)
    else groups.push([item])
  }
  return groups.map((items) => {
    const list = items.map((x) => x.e)
    return {
      id: list.map((e) => e.id).join('|'),
      day: items.reduce((s, x) => s + x.day, 0) / items.length,
      events: list,
      severity: maxSeverity(list),
    }
  })
}

// --- Cards -----------------------------------------------------------------

export type CardDensity = 'compact' | 'medium' | 'full'
export const CARD_MEDIUM_MIN_PX = 96
export const CARD_FULL_MIN_PX = 176

/** How much a phase card can show in the pixels its phase occupies. */
export function cardDensity(widthPx: number): CardDensity {
  if (widthPx >= CARD_FULL_MIN_PX) return 'full'
  if (widthPx >= CARD_MEDIUM_MIN_PX) return 'medium'
  return 'compact'
}

/** "Commercial Proposal" → "Commercial"; short names pass through. */
export function shortName(name: string): string {
  if (name.length <= 11) return name
  const first = name.split(/\s+/)[0]
  return first.length <= 11 ? first : `${first.slice(0, 10)}…`
}

/** The phase "now": in progress or delayed first, then blocked. */
export function activeMilestone(milestones: Milestone[]): Milestone | undefined {
  return milestones.find((m) => m.status === 'IN_PROGRESS' || m.status === 'DELAYED')
    ?? milestones.find((m) => m.status === 'BLOCKED')
}

/** Today button target: today (clamped into the lifecycle), or the end date once the opportunity is closed. */
export function todayFocusDay(startDate: IsoDate, endDate: IsoDate, today: IsoDate, isClosed: boolean): number {
  const start = toDay(startDate)
  const end = toDay(endDate)
  if (isClosed) return end
  return Math.min(Math.max(toDay(today), start), end)
}

// --- Axis ------------------------------------------------------------------

export interface AxisTick { day: number; label: string; major: boolean }

/** Candidate tick steps in days; months are handled separately (calendar-aligned). */
const DAY_STEPS = [1, 2, 7, 14] as const
const MONTH_STEPS = [1, 3, 6, 12] as const
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Date ticks for [fromDay, toDay] spaced at least `minGapPx` apart: days or
 *  Monday-aligned weeks when zoomed in, 1st-of-month ticks when zoomed out. */
export function axisTicks(fromDayNum: number, toDayNum: number, pxPerDay: number, minGapPx = 72): AxisTick[] {
  const start = Math.floor(fromDayNum), end = Math.ceil(toDayNum)
  const dayStep = DAY_STEPS.find((s) => s * pxPerDay >= minGapPx)
  if (dayStep) {
    // Day 0 (1970-01-01) was a Thursday, so day 4 is a Monday: weekly ticks align to Mondays.
    const offset = dayStep >= 7 ? 4 : 0
    const first = Math.ceil((start - offset) / dayStep) * dayStep + offset
    const ticks: AxisTick[] = []
    for (let d = first; d <= end; d += dayStep) {
      const date = new Date(d * 86_400_000)
      const dom = date.getUTCDate()
      ticks.push({ day: d, label: `${String(dom).padStart(2, '0')} ${MONTHS_SHORT[date.getUTCMonth()]}`, major: dom <= dayStep })
    }
    return ticks
  }
  const monthStep = MONTH_STEPS.find((s) => s * 30.4 * pxPerDay >= minGapPx) ?? 12
  const first = new Date(start * 86_400_000)
  let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1
  if (m > 11) { m = 0; y++ }
  m = Math.ceil(m / monthStep) * monthStep
  const ticks: AxisTick[] = []
  for (;;) {
    if (m > 11) { y += Math.floor(m / 12); m %= 12 }
    const d = Date.UTC(y, m, 1) / 86_400_000
    if (d > end) break
    ticks.push({ day: d, label: m === 0 ? String(y) : `${MONTHS_SHORT[m]}${monthStep >= 3 ? ` ${String(y).slice(2)}` : ''}`, major: m === 0 })
    m += monthStep
  }
  return ticks
}

// --- Stage detail ----------------------------------------------------------

export interface StageOutlook {
  /** The end to show: actual end once finished, otherwise the forecast. */
  end: IsoDate
  endIsActual: boolean
  /** + days past the planned end (late), − early, 0 on plan. */
  endDelta: number
  /** Planned vs actual-so-far days, for the planned/actual comparison bars. */
  plannedDays: number
  actualDays?: number
  ongoing: boolean
}

/** Forecast for a stage: a started stage is expected to take its planned
 *  duration from its actual start, and can never end before today. */
export function stageOutlook(m: Milestone, today: IsoDate): StageOutlook {
  const v = computeVariance(m, today)
  if (m.actualEnd) {
    return { end: m.actualEnd, endIsActual: true, endDelta: diffDays(m.plannedEnd, m.actualEnd), plannedDays: v.plannedDuration, actualDays: v.actualDuration, ongoing: false }
  }
  if (m.actualStart) {
    const byPlan = toDay(m.actualStart) + v.plannedDuration
    const endDay = Math.max(byPlan, toDay(today))
    const end = new Date(endDay * 86_400_000).toISOString().slice(0, 10)
    return { end, endIsActual: false, endDelta: endDay - toDay(m.plannedEnd), plannedDays: v.plannedDuration, actualDays: v.actualDuration, ongoing: true }
  }
  return { end: m.plannedEnd, endIsActual: false, endDelta: 0, plannedDays: v.plannedDuration, ongoing: false }
}
