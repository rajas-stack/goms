import type { ChartType, QueryResult } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { formatValue } from './format'
import { Heatmap, SeriesColumns } from './MatrixCharts'
import { BarList, Donut, Funnel } from './ShareCharts'
import { XYChart } from './XYChart'

/** Renders a query result as the chosen chart. KPI tiles compare with the previous period when one is given. */
export function ChartView({ chart, result, previous, title }: { chart: ChartType; result: QueryResult; previous?: QueryResult | null; title: string }) {
  const dims = result.columns.filter((c) => c.role === 'dimension').length
  if (chart === 'kpi' || dims === 0) return <KpiTile result={result} previous={previous ?? null} />
  if (!result.rows.length) return <div className="studio-empty">No matching records</div>
  if (chart === 'table' || dims > 2) return <DataTable result={result} title={title} />
  if (dims === 2) {
    if (chart === 'heatmap') return <Heatmap result={result} title={title} />
    return <SeriesColumns result={result} stacked={chart !== 'groupedBar'} title={title} />
  }
  if (chart === 'line' || chart === 'area' || chart === 'column') return <XYChart result={result} kind={chart} title={title} />
  if (chart === 'donut') return <Donut result={result} title={title} />
  if (chart === 'funnel') return <Funnel result={result} />
  return <BarList result={result} />
}

export function KpiTile({ result, previous }: { result: QueryResult; previous: QueryResult | null }) {
  const measures = result.columns.filter((c) => c.role === 'measure')
  return (
    <div className="studio-kpis">
      {measures.map((m) => {
        const current = result.rows[0]?.[m.key], before = previous?.rows[0]?.[m.key]
        return (
          <div key={m.key} className="studio-kpi">
            <strong>{formatValue(current ?? null, m)}</strong>
            <span className="studio-kpi-label">{m.label}</span>
            <Delta current={typeof current === 'number' ? current : null} before={typeof before === 'number' ? before : null} percentPoints={m.format === 'percent'} hasPrevious={!!previous} />
          </div>
        )
      })}
    </div>
  )
}

function Delta({ current, before, percentPoints, hasPrevious }: { current: number | null; before: number | null; percentPoints: boolean; hasPrevious: boolean }) {
  if (!hasPrevious) return null
  if (current === null || before === null || (before === 0 && !percentPoints)) return <span className="studio-delta">No prior-period baseline</span>
  const change = percentPoints ? (current - before) * 100 : ((current - before) / Math.abs(before)) * 100
  const tone = change > 0 ? 'studio-up' : change < 0 ? 'studio-down' : ''
  return (
    <span className={`studio-delta ${tone}`}>
      {change !== 0 && <Icon name={change > 0 ? 'ArrowUp' : 'ArrowDown'} size={12} />}
      {change > 0 ? '+' : ''}{change.toFixed(1)}{percentPoints ? ' pp' : '%'} <span>vs previous period</span>
    </span>
  )
}

export function DataTable({ result, title }: { result: QueryResult; title: string }) {
  return (
    <div className="studio-table-wrap">
      <table className="studio-table" aria-label={title}>
        <thead><tr>{result.columns.map((c) => <th key={c.key} scope="col" className={c.role === 'measure' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>{result.columns.map((c) => <td key={c.key} className={c.role === 'measure' ? 'num' : ''}>{c.role === 'dimension' ? String(row[c.labelKey ?? c.key] ?? '') : formatValue(row[c.key] ?? null, c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

