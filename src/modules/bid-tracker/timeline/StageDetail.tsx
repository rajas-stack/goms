import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { cn } from '@/lib/utils'
import { STATUS_META } from './statusStyles'
import { formatShortDate, formatTimelineDate, pluralDays } from './timelineDates'
import { computeVariance, stageOutlook } from './timelineMath'
import type { IsoDate, Milestone, TimelineNote } from './types'

const tile = 'neu-raised flex min-w-0 gap-2.5 rounded-xl p-3'

function TileIcon({ name }: { name: string }) {
  return <span className="neu-raised-sm flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-goms-navy"><Icon name={name} size={15} /></span>
}

function Signal({ tone, children }: { tone: 'good' | 'bad' | 'muted'; children: ReactNode }) {
  return (
    <span className={cn('mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-crimson' : 'text-muted')}>
      <span aria-hidden className={cn('h-3 w-3 rounded-full shadow-[inset_0_-1px_2px_rgb(0_0_0/0.2)]', tone === 'good' ? 'bg-emerald' : tone === 'bad' ? 'bg-crimson' : 'bg-edge')} />
      {children}
    </span>
  )
}

function DateTile({ icon, label, value, signal }: { icon: string; label: string; value: string; signal?: ReactNode }) {
  return (
    <div className={tile}>
      <TileIcon name={icon} />
      <div className="min-w-0">
        <div className="text-[11px] text-muted">{label}</div>
        <div className="text-[13px] font-semibold text-ink-900">{value}</div>
        {signal}
      </div>
    </div>
  )
}

function CompareBar({ label, days, max, fill, text, dot, value }: { label: string; days: number; max: number; fill: string; text: string; dot: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr_auto] items-center gap-2.5 text-[12px]">
      <span className="flex items-center gap-2 text-ink-700"><span aria-hidden className={cn('h-3 w-3 rounded-full', dot)} />{label}</span>
      <span className="neu-inset h-2.5 overflow-hidden rounded-full">
        <span className={cn('block h-full rounded-full', fill)} style={{ width: `${Math.max((days / Math.max(max, 1)) * 100, days > 0 ? 4 : 0)}%` }} />
      </span>
      <span className={cn('whitespace-nowrap font-semibold', text)}>{value}</span>
    </div>
  )
}

function delayText(delta: number): { tone: 'good' | 'bad'; text: string } {
  if (delta > 0) return { tone: 'bad', text: `${pluralDays(delta)} delay` }
  if (delta < 0) return { tone: 'good', text: `${pluralDays(-delta)} early` }
  return { tone: 'good', text: 'On plan' }
}

/** Facts for the selected stage: planned vs actual, start and end variance, the latest note. */
export function StageDetail({ m, today, note }: { m: Milestone; today: IsoDate; note?: TimelineNote | null }) {
  const meta = STATUS_META[m.status]
  const v = computeVariance(m, today)
  const outlook = stageOutlook(m, today)
  const late = outlook.ongoing && outlook.endDelta > 0
  const max = Math.max(outlook.plannedDays, outlook.actualDays ?? 0)
  const end = delayText(outlook.endDelta)
  const startSignal = v.startDays === undefined
    ? <Signal tone="muted">Not started</Signal>
    : v.startDays === 0 ? <Signal tone="good">On time</Signal>
      : v.startDays > 0 ? <Signal tone="bad">{pluralDays(v.startDays)} late</Signal> : <Signal tone="good">{pluralDays(-v.startDays)} early</Signal>

  return (
    <section aria-label={`${m.name} details`} data-testid="stage-detail" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.7fr_1fr_1fr_1fr_1.6fr]">
      <div className="neu-raised min-w-0 rounded-xl p-3 md:col-span-2 xl:col-span-1">
        <div className="flex gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-blue-50 to-blue-100 text-blue"><Icon name={m.icon ?? meta.glyph} size={16} /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-ink-900">{m.name}</h4>
              <span className={cn('rounded-full border px-2 py-px text-[10px] font-semibold', meta.segment)}>{meta.label}</span>
            </div>
            <div className="text-[12px] text-muted">{formatShortDate(m.plannedStart)} – {formatShortDate(m.plannedEnd)} · {pluralDays(outlook.plannedDays)} (planned)</div>
          </div>
        </div>
        <div className="neu-inset mt-2.5 space-y-1.5 rounded-lg px-2.5 py-2">
          <CompareBar label="Planned" days={outlook.plannedDays} max={max} fill="bg-gradient-to-r from-blue to-blue-600" text="text-blue-700" dot="bg-blue" value={pluralDays(outlook.plannedDays)} />
          {outlook.actualDays !== undefined
            ? <CompareBar label="Actual" days={outlook.actualDays} max={max}
                fill={late ? 'bg-gradient-to-r from-crimson/60 to-crimson' : 'bg-gradient-to-r from-emerald/70 to-emerald'}
                text={late ? 'text-crimson' : 'text-emerald-700'} dot={late ? 'bg-crimson' : 'bg-emerald'}
                value={`${pluralDays(outlook.actualDays)}${outlook.ongoing ? ' (ongoing)' : ''}`} />
            : <div className="grid grid-cols-[64px_1fr] gap-2.5 text-[12px] text-muted"><span className="flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-full bg-edge" />Actual</span>Not started yet</div>}
        </div>
      </div>
      <DateTile icon="CalendarDays" label="Planned Start" value={formatTimelineDate(m.plannedStart)} />
      <DateTile icon="CalendarDays" label="Actual Start" value={m.actualStart ? formatTimelineDate(m.actualStart) : '—'} signal={startSignal} />
      <DateTile icon="Clock"
        label={outlook.endIsActual ? 'Actual End' : outlook.ongoing ? 'Expected End' : 'Planned End'}
        value={formatTimelineDate(outlook.end)}
        signal={outlook.endIsActual || outlook.ongoing ? <Signal tone={end.tone}>{end.text}</Signal> : undefined} />
      <div className={cn(tile, 'flex-col')}>
        <div className="flex items-center gap-3">
          <TileIcon name="MessageSquareText" />
          <span className="text-[13px] font-semibold text-ink-900">Latest note</span>
        </div>
        {note
          ? (
            <>
              <p className="line-clamp-2 text-[12px] text-ink-700">{note.text}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span>{new Date(note.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {note.authorPerson ? <PersonName person={note.authorPerson} size="2xs" /> : note.author && <span>{note.author}</span>}
              </div>
            </>
          )
          : <p className="text-[12px] text-muted">No notes yet. Next actions added on this bid appear here.</p>}
      </div>
    </section>
  )
}
