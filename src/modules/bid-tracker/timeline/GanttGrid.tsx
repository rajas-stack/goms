import { memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EventMarkers } from './EventMarkers'
import type { FocusTarget } from './focus'
import { GANTT } from './statusStyles'
import { diffDays, formatShortDate, pluralDays, toDay } from './timelineDates'
import { axisTicks, dayToX, type EventCluster } from './timelineMath'
import type { IsoDate, Milestone } from './types'

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Space kept between a bar's end dot and the next bar's, so the dashed dependency shows. */
const BAR_INSET_PX = 8
const LABEL_MIN_PX = 54
const CHIP_W_PX = 64
const DOT_ONLY_PX = 24

interface LayerProps {
  milestones: Milestone[]
  startDate: IsoDate
  endDate: IsoDate
  endEstimated: boolean
  today: IsoDate
  showToday: boolean
  originDay: number
  endDay: number
  pxPerDay: number
  viewStartDay: number
  viewSpanDays: number
  selectedId: string | null
  clusters: EventCluster[]
  onSelectStage: (id: string) => void
  onSelect: (target: FocusTarget) => void
}

/** Left column: the three row names, as raised pills. */
export function GanttLabels() {
  const pill = 'neu-raised-sm flex items-center gap-2 rounded-lg px-2.5 text-[12px] font-semibold text-ink-900'
  return (
    <div className="w-[112px] shrink-0 space-y-0 pr-2.5" aria-hidden>
      <div style={{ height: GANTT.headerH }} />
      <div className="flex items-center" style={{ height: GANTT.rowH }}><span className={cn(pill, 'h-8 w-full')}><Dot className="bg-blue" />Planned</span></div>
      <div className="flex items-center" style={{ height: GANTT.rowH }}><span className={cn(pill, 'h-8 w-full')}><Dot className="bg-emerald" />Actual</span></div>
      <div className="flex items-center" style={{ height: GANTT.milestoneH }}><span className={cn(pill, 'h-8 w-full')}><Diamond className="border-2 border-ink-900 bg-transparent" />Milestones</span></div>
    </div>
  )
}

export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-3 w-3 shrink-0 rounded-full shadow-[inset_0_-2px_3px_rgb(0_0_0/0.18)]', className)} />
}

export function Diamond({ className, size = 12 }: { className?: string; size?: number }) {
  return <span aria-hidden className={cn('inline-block shrink-0 rotate-45 rounded-[2px]', className)} style={{ width: size, height: size }} />
}

function MonthRow({ originDay, endDay, pxPerDay }: Pick<LayerProps, 'originDay' | 'endDay' | 'pxPerDay'>) {
  const months: { start: number; end: number; label: string }[] = []
  const d = new Date(originDay * 86_400_000)
  let y = d.getUTCFullYear(), m = d.getUTCMonth()
  for (;;) {
    const start = Math.max(Date.UTC(y, m, 1) / 86_400_000, originDay)
    if (start >= endDay) break
    const end = Math.min(Date.UTC(y, m + 1, 1) / 86_400_000, endDay)
    months.push({ start, end, label: `${MONTHS_LONG[m]} ${y}` })
    m++; if (m > 11) { m = 0; y++ }
  }
  return (
    <>
      {months.map((mo, i) => (
        <span key={mo.label} className={cn('absolute top-0 flex items-center overflow-hidden whitespace-nowrap pl-2.5 text-[12px] font-semibold text-ink-900', i > 0 && 'border-l border-edge')}
          style={{ left: dayToX(mo.start, originDay, pxPerDay), width: (mo.end - mo.start) * pxPerDay, height: GANTT.monthH }}>
          {(mo.end - mo.start) * pxPerDay > 70 ? mo.label : MONTHS_LONG[Number(new Date(mo.start * 86_400_000).getUTCMonth())].slice(0, 3)}
        </span>
      ))}
    </>
  )
}

function DayRow({ pxPerDay, originDay, viewStartDay, viewSpanDays }: Pick<LayerProps, 'pxPerDay' | 'originDay' | 'viewStartDay' | 'viewSpanDays'>) {
  const daily = pxPerDay >= GANTT.dayMinPx
  const ticks = axisTicks(viewStartDay - viewSpanDays, viewStartDay + 2 * viewSpanDays, pxPerDay, GANTT.dayMinPx)
  const width = daily ? pxPerDay : undefined
  return (
    <>
      {ticks.map((t) => {
        const x = dayToX(t.day, originDay, pxPerDay)
        return (
          <span key={t.day}>
            <span className="absolute border-l border-line/70" style={{ left: x, top: GANTT.monthH, height: GANTT.totalH - GANTT.monthH }} aria-hidden />
            <span className={cn('absolute flex items-center whitespace-nowrap text-[11px] tabular-nums text-ink-600', daily ? 'justify-center' : 'pl-1.5')}
              style={{ left: x, width, top: GANTT.monthH, height: GANTT.dayH }}>
              {daily ? t.label.slice(0, 2) : t.label}
            </span>
          </span>
        )
      })}
    </>
  )
}

function Bar({ left, width, top, className, label, title, ends, onClick, selected }: {
  left: number; width: number; top: number; className: string; label: ReactNode; title: string; ends: string; onClick: () => void; selected: boolean
}) {
  // Too short for a pill (e.g. a stage that began today): a single dot.
  if (width < DOT_ONLY_PX) {
    return (
      <button type="button" onClick={onClick} aria-label={title} title={title}
        className={cn('absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white shadow focus-visible:focus-ring', ends)}
        style={{ left: left + width / 2, top: top + GANTT.rowH / 2 - 7 }} />
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={title} title={title}
      className={cn('absolute flex h-6 items-center justify-center rounded-full text-[11px] font-semibold transition-[box-shadow,transform] duration-150 hover:-translate-y-px focus-visible:focus-ring',
        'shadow-[0_2px_6px_rgb(var(--c-shadow)/0.18),inset_0_1px_0_rgb(255_255_255/0.35)]', className, selected && 'ring-2 ring-blue ring-offset-2 ring-offset-white')}
      style={{ left, width, top: top + (GANTT.rowH - 24) / 2 }}>
      <span className={cn('absolute -left-1 h-3 w-3 rounded-full border-2 border-white shadow', ends)} aria-hidden />
      {width >= LABEL_MIN_PX && <span className="truncate px-2.5">{label}</span>}
      <span className={cn('absolute -right-1 h-3 w-3 rounded-full border-2 border-white shadow', ends)} aria-hidden />
    </button>
  )
}

function Dashed({ from, to, top, className }: { from: number; to: number; top: number; className: string }) {
  if (to - from < 4) return null
  return <span aria-hidden className={cn('absolute border-t-2 border-dashed', className)} style={{ left: from, width: to - from, top: top + GANTT.rowH / 2 - 1 }} />
}

/** Everything that moves with pan/zoom: header, bars, milestones, guide lines. */
export const GanttLayer = memo(function GanttLayer(p: LayerProps) {
  const x = (iso: IsoDate) => dayToX(toDay(iso), p.originDay, p.pxPerDay)
  const plannedTop = GANTT.headerH
  const actualTop = GANTT.headerH + GANTT.rowH
  const msTop = GANTT.headerH + 2 * GANTT.rowH
  const todayDay = toDay(p.today)
  const inset = (w: number) => Math.min(BAR_INSET_PX, w / 4)

  const planned = p.milestones.map((m) => {
    const l = x(m.plannedStart), r = x(m.plannedEnd)
    const i = inset(r - l)
    return { m, left: l + i, right: r - i }
  })

  const actual = p.milestones.flatMap((m) => {
    if (!m.actualStart) return []
    const endIso = m.actualEnd ?? p.today
    const ongoing = !m.actualEnd
    const late = ongoing && todayDay > toDay(m.plannedEnd)
    const l = x(m.actualStart), r = Math.max(x(endIso), l + 16)
    const i = inset(r - l)
    const days = Math.max(diffDays(m.actualStart, endIso), 0)
    return [{ m, left: l + i, right: r - i, days, ongoing, late }]
  })
  const lastActualRight = actual.length ? actual[actual.length - 1].right : null

  // Milestone diamonds: completed stage ends, then today and the deadline. Chips that would overlap are dropped.
  const doneMarks = p.milestones.filter((m) => m.actualEnd && m.status === 'COMPLETED').map((m) => ({ id: m.id, x: x(m.actualEnd!), date: m.actualEnd! }))
  const todayX = dayToX(todayDay, p.originDay, p.pxPerDay)
  const endX = x(p.endDate)
  const reserved = [p.showToday ? todayX : null, endX].filter((v): v is number => v !== null)
  let lastChip = -Infinity
  // A completion diamond sitting on the Today / Deadline diamond would hide it: drop it.
  const chips = doneMarks.filter((d) => reserved.every((r) => Math.abs(r - d.x) >= 14)).map((d) => {
    const free = d.x - lastChip >= CHIP_W_PX && reserved.every((r) => Math.abs(r - d.x) >= CHIP_W_PX + 20)
    if (free) lastChip = d.x
    return { ...d, chip: free }
  })

  return (
    <>
      <MonthRow originDay={p.originDay} endDay={p.endDay} pxPerDay={p.pxPerDay} />
      <span aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: GANTT.monthH }} />
      <span aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: GANTT.headerH }} />
      <DayRow pxPerDay={p.pxPerDay} originDay={p.originDay} viewStartDay={p.viewStartDay} viewSpanDays={p.viewSpanDays} />
      <span aria-hidden className="absolute inset-x-0 border-t border-line/70" style={{ top: actualTop }} />
      <span aria-hidden className="absolute inset-x-0 border-t border-line/70" style={{ top: msTop }} />

      {/* Planned */}
      {planned.map((b, i) => (
        <span key={b.m.id}>
          {i > 0 && <Dashed from={planned[i - 1].right + 6} to={b.left - 6} top={plannedTop} className="border-blue/50" />}
          <Bar left={b.left} width={b.right - b.left} top={plannedTop} selected={p.selectedId === b.m.id} onClick={() => p.onSelectStage(b.m.id)}
            className="bg-gradient-to-b from-blue-100 to-blue-200 text-blue-700" ends="bg-blue"
            label={pluralDays(diffDays(b.m.plannedStart, b.m.plannedEnd))}
            title={`${b.m.name} planned: ${formatShortDate(b.m.plannedStart)} to ${formatShortDate(b.m.plannedEnd)}, ${pluralDays(diffDays(b.m.plannedStart, b.m.plannedEnd))}`} />
        </span>
      ))}

      {/* Actual */}
      {actual.map((b, i) => (
        <span key={b.m.id}>
          {i > 0 && <Dashed from={actual[i - 1].right + 6} to={b.left - 6} top={actualTop} className={b.late ? 'border-crimson/60' : 'border-emerald/60'} />}
          <Bar left={b.left} width={b.right - b.left} top={actualTop} selected={false} onClick={() => p.onSelectStage(b.m.id)}
            className={b.late ? 'bg-gradient-to-b from-crimson/60 to-crimson/80 text-white' : b.ongoing ? 'bg-gradient-to-b from-emerald/60 to-emerald/80 text-white' : 'bg-gradient-to-b from-emerald-600 to-emerald text-white'}
            ends={b.late ? 'bg-crimson' : 'bg-emerald'}
            label={`${pluralDays(b.days)}${b.ongoing ? ' (ongoing)' : ''}`}
            title={`${b.m.name} actual: ${formatShortDate(b.m.actualStart!)} to ${b.ongoing ? 'today' : formatShortDate(b.m.actualEnd!)}, ${pluralDays(b.days)}${b.ongoing ? ' so far' : ''}`} />
        </span>
      ))}
      {/* Upcoming: grey dashed placeholders on the actual row */}
      {p.milestones.filter((m) => !m.actualStart).map((m) => {
        const l = Math.max(x(m.plannedStart), (lastActualRight ?? -Infinity) + 6), r = x(m.plannedEnd)
        if (r - l < 8) return null
        return (
          <span key={`up:${m.id}`} aria-hidden>
            <Dashed from={l} to={r} top={actualTop} className="border-edge" />
            <span className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-edge" style={{ left: r, top: actualTop + GANTT.rowH / 2 - 5 }} />
          </span>
        )
      })}

      {/* Milestones row */}
      {chips.map((d) => (
        <span key={`d:${d.id}`} className="absolute" style={{ left: d.x, top: actualTop + GANTT.rowH / 2 + 4 }}>
          <span aria-hidden className="absolute h-[26px] -translate-x-1/2 border-l-2 border-dashed border-emerald/60" style={{ top: 0 }} />
          <Diamond className="absolute top-[22px] -translate-x-1/2 border-2 border-white bg-emerald shadow" size={11} />
          {d.chip && <span className="neu-raised-sm absolute top-[38px] -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-px text-[10px] font-semibold text-ink-900">{formatShortDate(d.date)}</span>}
        </span>
      ))}
      <EventMarkers clusters={p.clusters} originDay={p.originDay} pxPerDay={p.pxPerDay} top={msTop + 6} onSelect={p.onSelect} />

      {/* Deadline */}
      <span aria-hidden className="absolute border-l-2 border-dashed border-crimson/70" style={{ left: endX, top: GANTT.monthH, height: GANTT.totalH - GANTT.monthH }} />
      <span className="absolute" style={{ left: endX, top: msTop + 22 }} data-testid="deadline-marker">
        <Diamond className="absolute -translate-x-1/2 border-2 border-white bg-edge shadow" size={13} />
        <span className="neu-raised-sm absolute -top-1.5 right-3 whitespace-nowrap rounded-md px-1.5 py-0.5 text-right text-[10px] font-semibold leading-tight text-ink-900">
          {formatShortDate(p.endDate)}<br /><span className="font-medium text-muted">{p.endEstimated ? 'Est. end' : 'Deadline'}</span>
        </span>
      </span>

      {/* Today */}
      {p.showToday && (
        <span data-testid="today-marker" className="pointer-events-none absolute" style={{ left: todayX, top: GANTT.monthH }}>
          <span aria-hidden className="absolute border-l-2 border-dashed border-blue" style={{ height: GANTT.totalH - GANTT.monthH }} />
          <span className="absolute" style={{ top: msTop - GANTT.monthH + 16 }}>
            <Diamond className="absolute -translate-x-1/2 border-2 border-white bg-blue shadow-[0_0_0_3px_rgb(var(--c-blue)/0.25)]" size={13} />
            <span className="neu-raised-sm absolute -top-1.5 left-3 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-blue">
              Today<br />{formatShortDate(p.today)}
            </span>
          </span>
        </span>
      )}
    </>
  )
})
