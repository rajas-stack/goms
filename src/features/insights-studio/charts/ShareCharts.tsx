import type { QueryResult } from '@goms/domain'
import { formatValue, measureColumn, pointsOf, seriesColor } from './format'

/** Charts of one categorical dimension: ranked bars, a donut of shares, and a funnel for stage flows. */

const OTHERS = 8

export function BarList({ result }: { result: QueryResult }) {
  const points = pointsOf(result), column = measureColumn(result)
  const max = Math.max(1e-9, ...points.map((p) => Math.abs(p.value)))
  const total = points.reduce((n, p) => n + p.value, 0)
  return (
    <ul className="studio-bars">
      {points.map((p) => (
        <li key={p.key} title={`${p.label}: ${formatValue(p.value, column)}`}>
          <span className="studio-bar-label">{p.label}</span>
          <span className="studio-bar-track"><span style={{ width: `${(Math.abs(p.value) / max) * 100}%`, background: seriesColor(0) }} /></span>
          <strong>{formatValue(p.value, column)}</strong>
          {column?.format !== 'percent' && <small>{total ? `${Math.round((p.value / total) * 100)}%` : ''}</small>}
        </li>
      ))}
    </ul>
  )
}

export function Donut({ result, title }: { result: QueryResult; title: string }) {
  const column = measureColumn(result)
  const all = pointsOf(result).filter((p) => p.value > 0)
  const points = all.length > OTHERS
    ? [...all.slice(0, OTHERS - 1), { key: '__others', label: 'Others', value: all.slice(OTHERS - 1).reduce((n, p) => n + p.value, 0) }]
    : all
  const total = points.reduce((n, p) => n + p.value, 0)
  const r = 62, c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="studio-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${title}: total ${formatValue(total, column)}`}>
        <circle cx={80} cy={80} r={r} fill="none" className="studio-donut-track" strokeWidth={20} />
        {points.map((p, i) => {
          const length = total ? (p.value / total) * c : 0, start = offset
          offset += length
          return <circle key={p.key} cx={80} cy={80} r={r} fill="none" stroke={seriesColor(i)} strokeWidth={20} strokeDasharray={`${Math.max(0, length - 1.5)} ${c}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{`${p.label}: ${formatValue(p.value, column)}`}</title></circle>
        })}
        <text x={80} y={84} textAnchor="middle" className="studio-donut-total">{formatValue(total, column)}</text>
      </svg>
      <ul className="studio-legend">
        {points.map((p, i) => (
          <li key={p.key}><i style={{ background: seriesColor(i) }} /><span>{p.label}</span><small>{total ? `${Math.round((p.value / total) * 100)}%` : '0%'}</small></li>
        ))}
      </ul>
    </div>
  )
}

/** Stages in their declared order; each step shows its value and the conversion from the previous step. */
export function Funnel({ result }: { result: QueryResult }) {
  const points = pointsOf(result), column = measureColumn(result)
  const max = Math.max(1e-9, ...points.map((p) => p.value))
  return (
    <ol className="studio-funnel">
      {points.map((p, i) => {
        const prev = i > 0 ? points[i - 1].value : null
        return (
          <li key={p.key} title={`${p.label}: ${formatValue(p.value, column)}`}>
            <span className="studio-funnel-label">{p.label}</span>
            <span className="studio-funnel-bar"><span style={{ width: `${Math.max(2, (p.value / max) * 100)}%`, background: seriesColor(i) }} /></span>
            <strong>{formatValue(p.value, column)}</strong>
            <small>{prev ? `${Math.round((p.value / prev) * 100)}% of previous` : ''}</small>
          </li>
        )
      })}
    </ol>
  )
}
