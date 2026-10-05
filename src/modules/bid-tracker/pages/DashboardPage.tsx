import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { useBidsForGrid } from '@/lib/api'
import { cn } from '@/lib/utils'
import { WORK_VERTICALS } from '@/features/nodes/department-meta'
import {
  computeDashboard, verticalLabel, verticalOptions,
  type DashboardCounts, type DashboardMeasure, type VerticalBreakdown,
} from '../dashboardMetrics'

/** One hue per measure, used for that measure EVERYWHERE on the dashboard (tile
 *  swatch and its by-vertical bars). Theme tokens only; red/green are kept for
 *  negative/positive meaning, so no measure uses them. */
export const MEASURE_COLORS: Record<DashboardMeasure, string> = {
  live: 'bg-goms-navy',
  pipeline: 'bg-goms-sky',
  campaign: 'bg-teal',
}

const MEASURES: { key: DashboardMeasure; label: string; noun: string; sheet: string; path: string; icon: string }[] = [
  { key: 'live', label: 'Live bids', noun: 'live bids', sheet: 'Bid Tracker', path: '/bid-tracker', icon: 'Flag' },
  { key: 'pipeline', label: 'Pipeline', noun: 'pipeline opportunities', sheet: 'Pipeline', path: '/bid-tracker/pipeline/funnel', icon: 'TrendingUp' },
  { key: 'campaign', label: 'Campaign', noun: 'campaign rows', sheet: 'Campaign', path: '/bid-tracker/campaign', icon: 'Send' },
]

/** The Opportunity Dashboard: a header, ONE filter row, then a responsive grid of
 *  panels. New visuals (and, later, a comments area) are added as more
 *  `DashboardPanel`s in the marked spot below. */
export function DashboardPage() {
  const { data: rows, isLoading } = useBidsForGrid()
  const [params, setParams] = useSearchParams()
  const vertical = params.get('vertical') || null
  const setVertical = (value: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set('vertical', value); else next.delete('vertical')
    return next
  }, { replace: true })

  const options = useMemo(() => verticalOptions(rows ?? [], WORK_VERTICALS), [rows])
  const data = useMemo(() => computeDashboard(rows ?? [], vertical), [rows, vertical])

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-paper" data-testid="opportunity-dashboard">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        <header>
          <h1 className="text-[20px] font-semibold text-ink-900">Opportunity dashboard</h1>
          <p className="text-[13px] text-muted">Live bids, pipeline and campaigns across every sheet. Archived rows are left out.</p>
        </header>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard filters">
          <label className="relative inline-flex items-center">
            <span className="mr-2 text-[12px] font-medium text-muted">Vertical</span>
            <select
              aria-label="Vertical" value={vertical ?? ''} onChange={(e) => setVertical(e.target.value || null)}
              className="h-8 appearance-none rounded-lg border border-line bg-white pl-2.5 pr-8 text-[13px] text-ink focus-visible:focus-ring"
            >
              <option value="">All verticals</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {vertical && !options.some((o) => o.value === vertical) && <option value={vertical}>{verticalLabel(vertical)}</option>}
            </select>
            <Icon name="ChevronDown" size={13} className="pointer-events-none absolute right-2.5 text-muted" />
          </label>
          {vertical && (
            <button type="button" onClick={() => setVertical(null)} className="h-8 rounded-lg px-2 text-[12px] font-medium text-goms-navy hover:bg-goms-sky/[0.12] focus-visible:focus-ring">
              Clear filter
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-[13px] text-muted" role="status">Loading dashboard…</p>
        ) : data.matched === 0 ? (
          <EmptyState filtered={!!vertical} label={vertical ? verticalLabel(vertical) : ''} onClear={() => setVertical(null)} />
        ) : (
          <>
            <section aria-label="Headline numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {MEASURES.map((m) => <StatTile key={m.key} measure={m} counts={data.counts} />)}
            </section>

            <div className="grid grid-cols-1 gap-4">
              <ByVerticalPanel groups={data.byVertical} selected={vertical} onSelect={setVertical} />
              {/* ── Future panels ─────────────────────────────────────────────
                  Add more visuals (and the comments area) here, each wrapped in
                  <DashboardPanel title=…>. The grid stacks them on small screens. */}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The frame every dashboard panel uses — title, optional actions, body. */
export function DashboardPanel({ title, description, actions, children }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-card border border-line bg-white p-4 shadow-panel">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-ink-900">{title}</h2>
          {description && <p className="text-[12px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function StatTile({ measure, counts }: { measure: (typeof MEASURES)[number]; counts: DashboardCounts }) {
  const value = counts[measure.key]
  return (
    <Link
      to={measure.path}
      aria-label={`${measure.label}: ${value}. Open ${measure.sheet}`}
      className="group flex flex-col gap-1 rounded-card border border-line bg-white p-4 shadow-panel transition-colors hover:border-goms-sky focus-visible:focus-ring"
    >
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-600">
        <span aria-hidden className={cn('h-2.5 w-2.5 rounded-sm', MEASURE_COLORS[measure.key])} />
        {measure.label}
        <Icon name="ArrowRight" size={13} className="ml-auto text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="text-[34px] font-semibold leading-none tabular-nums text-ink-900" data-testid={`tile-${measure.key}`}>{value}</span>
      <span className="text-[12px] text-muted">
        {measure.key === 'live' && (
          <>
            {counts.liveDueSoon} due soon
            {counts.liveOverdue > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-crimson">
                <Icon name="TriangleAlert" size={12} /> {counts.liveOverdue} overdue
              </span>
            )}
          </>
        )}
        {measure.key === 'pipeline' && `Funnel ${counts.funnel} · Backup ${counts.backup} · Commits ${counts.commits}`}
        {measure.key === 'campaign' && 'Rows in the Campaign sheet'}
      </span>
    </Link>
  )
}

/** Small multiples: one single-hue bar list per measure, same vertical order in each. */
function ByVerticalPanel({ groups, selected, onSelect }: {
  groups: VerticalBreakdown[]; selected: string | null; onSelect: (value: string | null) => void
}) {
  const [asTable, setAsTable] = useState(false)
  const table = <BreakdownTable groups={groups} />
  return (
    <DashboardPanel
      title="By vertical"
      description="Counts per vertical for each measure. Pick a vertical to filter the dashboard."
      actions={(
        <button
          type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink-600 hover:bg-panel focus-visible:focus-ring"
        >
          <Icon name={asTable ? 'BarChart3' : 'List'} size={13} /> {asTable ? 'View as bars' : 'View as table'}
        </button>
      )}
    >
      {asTable ? table : (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3" aria-hidden>
            {MEASURES.map((m) => (
              <BarList key={m.key} measure={m} groups={groups} selected={selected} onSelect={onSelect} />
            ))}
          </div>
          <div className="sr-only">{table}</div>
        </>
      )}
    </DashboardPanel>
  )
}

function BarList({ measure, groups, selected, onSelect }: {
  measure: (typeof MEASURES)[number]; groups: VerticalBreakdown[]; selected: string | null; onSelect: (value: string | null) => void
}) {
  const max = Math.max(1, ...groups.map((g) => g[measure.key]))
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-ink-700">
        <span className={cn('h-2 w-2 rounded-sm', MEASURE_COLORS[measure.key])} />
        {measure.label}
      </h3>
      <ul className="flex flex-col gap-0.5">
        {groups.map((g) => {
          const value = g[measure.key]
          const isSelected = g.value === selected
          return (
            <li key={g.value}>
              <button
                type="button" tabIndex={-1}
                title={`${g.label}: ${value} ${measure.noun}`}
                onClick={() => onSelect(isSelected ? null : g.value)}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2 rounded px-1 py-1 text-left text-[12px] hover:bg-panel',
                  isSelected && 'bg-goms-sky/[0.12]',
                )}
              >
                <span className={cn('truncate text-ink-600', isSelected && 'font-semibold text-ink-900')}>{g.label}</span>
                <span className="h-2">
                  {value > 0 && (
                    <span
                      className={cn('block h-2 rounded-r-[4px]', MEASURE_COLORS[measure.key], selected && !isSelected && 'opacity-35')}
                      style={{ width: `${(value / max) * 100}%` }}
                    />
                  )}
                </span>
                <span className={cn('text-right tabular-nums text-ink-700', isSelected && 'font-semibold text-ink-900')}>{value}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BreakdownTable({ groups }: { groups: VerticalBreakdown[] }) {
  return (
    <table className="w-full text-[12.5px]" aria-label="Counts by vertical">
      <thead>
        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
          <th scope="col" className="py-1.5 pr-3 font-semibold">Vertical</th>
          {MEASURES.map((m) => <th key={m.key} scope="col" className="py-1.5 pr-3 text-right font-semibold">{m.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.value} className="border-b border-line/60 last:border-0">
            <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">{g.label}</th>
            {MEASURES.map((m) => <td key={m.key} className="py-1.5 pr-3 text-right tabular-nums text-ink-700">{g[m.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmptyState({ filtered, label, onClear }: { filtered: boolean; label: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-white px-6 py-12 text-center" data-testid="dashboard-empty">
      <Icon name="BarChart3" size={22} className="text-muted" />
      <p className="text-[14px] font-medium text-ink">{filtered ? `Nothing in ${label}` : 'Nothing to show yet'}</p>
      <p className="max-w-sm text-[12.5px] text-muted">
        {filtered
          ? 'No live bids, pipeline opportunities or campaign rows match this vertical.'
          : 'Bids, pipeline opportunities and campaign rows appear here once they are added to their sheets.'}
      </p>
      {filtered && (
        <button type="button" onClick={onClear} className="mt-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-goms-navy hover:bg-goms-sky/[0.12] focus-visible:focus-ring">
          Show all verticals
        </button>
      )}
    </div>
  )
}
