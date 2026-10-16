import { useMemo } from 'react'
import { currentPeriod, periodLabel, periodRange, type ReportFilters, type ReportPeriod } from '@goms/domain'
import { useCanReadDataset, useDatasetRows, useToday } from '../data/hooks'

/** Report-level filters: period (FY / half / quarter / custom), year, vertical and team / owner. They apply to every
 *  widget whose source has the matching field (see effectiveQuery in @goms/domain). */

type Choice = 'all' | 'fy' | 'h1' | 'h2' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom'

const choiceOf = (p: ReportPeriod): Choice =>
  p.kind === 'half' ? (p.half === 2 ? 'h2' : 'h1') : p.kind === 'quarter' ? (`q${p.quarter ?? 1}` as Choice) : p.kind

function periodFor(choice: Choice, fy: number, current: ReportPeriod): ReportPeriod {
  if (choice === 'all') return { kind: 'all' }
  if (choice === 'fy') return { kind: 'fy', fy }
  if (choice === 'h1' || choice === 'h2') return { kind: 'half', fy, half: choice === 'h1' ? 1 : 2 }
  if (choice === 'custom') return { kind: 'custom', from: current.from ?? '', to: current.to ?? '' }
  return { kind: 'quarter', fy, quarter: Number(choice[1]) as 1 | 2 | 3 | 4 }
}

export function ReportFiltersBar({ filters, onChange }: { filters: ReportFilters; onChange: (f: ReportFilters) => void }) {
  const today = useToday()
  const calendar = filters.calendar ?? 'fy'
  const thisYear = currentPeriod(today, calendar).fy
  const fy = filters.period.fy ?? thisYear
  const choice = choiceOf(filters.period)
  const canReadMaster = useCanReadDataset('opportunities.master')
  const master = useDatasetRows(canReadMaster ? 'opportunities.master' : undefined)
  const verticals = useMemo(() => [...new Set((master.data ?? []).map((r) => r.vertical).filter((v): v is string => typeof v === 'string' && !!v))].sort(), [master.data])
  const range = periodRange(filters.period, calendar)
  const yearName = (y: number) => (calendar === 'fy' ? `FY${String(y).slice(-2)} (${y - 1}–${String(y).slice(-2)})` : String(y))
  return (
    <div className="studio-filters" role="group" aria-label="Report filters">
      <label className="studio-row">Period
        <select className="studio-select" aria-label="Report period" value={choice} onChange={(e) => onChange({ ...filters, period: periodFor(e.target.value as Choice, fy, filters.period) })}>
          <option value="all">All time</option><option value="fy">Full year</option><option value="h1">H1</option><option value="h2">H2</option>
          <option value="q1">Q1</option><option value="q2">Q2</option><option value="q3">Q3</option><option value="q4">Q4</option><option value="custom">Custom range</option>
        </select>
      </label>
      {choice !== 'all' && choice !== 'custom' && (
        <select className="studio-select" aria-label="Year" value={fy} onChange={(e) => onChange({ ...filters, period: { ...filters.period, fy: Number(e.target.value) } })}>
          {[thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{yearName(y)}</option>)}
        </select>
      )}
      {choice === 'custom' && (
        <>
          <input className="studio-input" type="date" aria-label="From date" value={filters.period.from ?? ''} onChange={(e) => onChange({ ...filters, period: { ...filters.period, from: e.target.value } })} />
          <input className="studio-input" type="date" aria-label="To date" value={filters.period.to ?? ''} onChange={(e) => onChange({ ...filters, period: { ...filters.period, to: e.target.value } })} />
        </>
      )}
      <select className="studio-select" aria-label="Year type" value={calendar} onChange={(e) => onChange({ ...filters, calendar: e.target.value as 'fy' | 'calendar' })}>
        <option value="fy">Financial year</option><option value="calendar">Calendar year</option>
      </select>
      <input className="studio-input" aria-label="Vertical filter" list="studio-verticals" placeholder="All verticals" value={filters.vertical ?? ''} onChange={(e) => onChange({ ...filters, vertical: e.target.value || undefined })} />
      <datalist id="studio-verticals">{verticals.map((v) => <option key={v} value={v} />)}</datalist>
      <input className="studio-input" aria-label="Team or owner filter" placeholder="All teams / owners" value={filters.team ?? ''} onChange={(e) => onChange({ ...filters, team: e.target.value || undefined })} />
      <span className="studio-chip studio-chip-accent">{periodLabel(filters.period, calendar)}{range ? ` · ${range.from} to ${range.to}` : ''}</span>
    </div>
  )
}
