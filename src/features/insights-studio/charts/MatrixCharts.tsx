import type { QueryResult } from '@goms/domain'
import { formatTick, formatValue, measureColumn, niceMax, seriesColor } from './format'

/** Two-dimension charts: stacked / grouped columns (first dimension on the axis, second as series) and a heatmap. */

interface Axis { key: string; label: string }
interface Matrix { xs: Axis[]; series: Axis[]; value: (x: string, s: string) => number }

const MAX_SERIES = 8

export function matrixOf(result: QueryResult): Matrix {
  const [d1, d2] = result.columns.filter((c) => c.role === 'dimension')
  const measure = measureColumn(result)
  const xs = new Map<string, string>(), totals = new Map<string, number>(), cells = new Map<string, number>()
  for (const row of result.rows) {
    const x = String(row[d1.key] ?? ''), s = String(row[d2.key] ?? ''), v = typeof row[measure!.key] === 'number' ? (row[measure!.key] as number) : 0
    xs.set(x, String(row[d1.labelKey ?? d1.key] ?? x))
    totals.set(s, (totals.get(s) ?? 0) + v)
    cells.set(`${x}\u0000${s}`, (cells.get(`${x}\u0000${s}`) ?? 0) + v)
  }
  const labels = new Map(result.rows.map((r) => [String(r[d2.key] ?? ''), String(r[d2.labelKey ?? d2.key] ?? '')]))
  const series = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SERIES).map(([key]) => ({ key, label: labels.get(key) ?? key }))
  return { xs: [...xs.entries()].map(([key, label]) => ({ key, label })), series, value: (x, s) => cells.get(`${x}\u0000${s}`) ?? 0 }
}

const W = 640, H = 240, LEFT = 48, TOP = 12, BOTTOM = 40, PLOT_W = W - LEFT - 12, PLOT_H = H - TOP - BOTTOM

export function SeriesColumns({ result, stacked, title }: { result: QueryResult; stacked: boolean; title: string }) {
  const m = matrixOf(result), column = measureColumn(result)
  const heights = m.xs.map((x) => (stacked ? m.series.reduce((n, s) => n + m.value(x.key, s.key), 0) : Math.max(0, ...m.series.map((s) => m.value(x.key, s.key)))))
  const max = niceMax(Math.max(0, ...heights)), step = PLOT_W / Math.max(1, m.xs.length)
  const y = (v: number) => TOP + PLOT_H - (v / max) * PLOT_H
  const band = Math.min(64, step * 0.74), every = Math.max(1, Math.ceil(m.xs.length / 10))
  return (
    <>
      <ul className="studio-legend studio-legend-row">{m.series.map((s, i) => <li key={s.key}><i style={{ background: seriesColor(i) }} /><span>{s.label}</span></li>)}</ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${m.xs.length} groups by ${m.series.length} series`} className="studio-svg">
        {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={LEFT} x2={W - 12} y1={y((max * i) / 4)} y2={y((max * i) / 4)} className="studio-grid" /><text x={LEFT - 6} y={y((max * i) / 4) + 4} textAnchor="end" className="studio-tick">{formatTick((max * i) / 4)}</text></g>)}
        {m.xs.map((x, xi) => {
          const left = LEFT + step * xi + (step - band) / 2
          let base = 0
          return (
            <g key={x.key || xi}>
              {m.series.map((s, si) => {
                const v = m.value(x.key, s.key)
                const rect = stacked
                  ? { x: left, y: y(base + v), w: band, h: y(base) - y(base + v) }
                  : { x: left + (band / m.series.length) * si, y: y(v), w: band / m.series.length - 1, h: y(0) - y(v) }
                base += v
                return <rect key={s.key} x={rect.x} y={rect.y} width={Math.max(0, rect.w)} height={Math.max(0, rect.h)} fill={seriesColor(si)}><title>{`${x.label} · ${s.label}: ${formatValue(v, column)}`}</title></rect>
              })}
              {xi % every === 0 && <text x={left + band / 2} y={H - BOTTOM + 16} textAnchor="middle" className="studio-tick">{x.label}</text>}
            </g>
          )
        })}
      </svg>
    </>
  )
}

export function Heatmap({ result, title }: { result: QueryResult; title: string }) {
  const m = matrixOf(result), column = measureColumn(result)
  const max = Math.max(1e-9, ...m.xs.flatMap((x) => m.series.map((s) => m.value(x.key, s.key))))
  return (
    <div className="studio-table-wrap">
      <table className="studio-heatmap" aria-label={title}>
        <thead><tr><th scope="col" />{m.series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
        <tbody>
          {m.xs.map((x) => (
            <tr key={x.key}>
              <th scope="row">{x.label}</th>
              {m.series.map((s) => {
                const v = m.value(x.key, s.key)
                return <td key={s.key} style={{ background: `color-mix(in srgb, var(--s-1) ${Math.round((v / max) * 85)}%, transparent)` }} title={`${x.label} · ${s.label}: ${formatValue(v, column)}`}>{v ? formatValue(v, column) : ''}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
