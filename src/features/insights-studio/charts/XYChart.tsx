import type { QueryResult } from '@goms/domain'
import { formatTick, formatValue, measureColumn, niceMax, pointsOf, seriesColor } from './format'

const W = 640, H = 240, LEFT = 48, RIGHT = 12, TOP = 12, BOTTOM = 40
const PLOT_W = W - LEFT - RIGHT, PLOT_H = H - TOP - BOTTOM

/** One series over an ordered axis: a line, a filled area, or columns. */
export function XYChart({ result, kind, title }: { result: QueryResult; kind: 'line' | 'area' | 'column'; title: string }) {
  const points = pointsOf(result), column = measureColumn(result)
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)))
  const step = PLOT_W / Math.max(points.length, 1)
  const x = (i: number) => LEFT + (kind === 'column' ? step * i + step / 2 : points.length > 1 ? (PLOT_W * i) / (points.length - 1) : PLOT_W / 2)
  const y = (v: number) => TOP + PLOT_H - (v / max) * PLOT_H
  const labelEvery = Math.max(1, Math.ceil(points.length / 10))
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const color = seriesColor(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.length} points`} className="studio-svg">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={LEFT} x2={W - RIGHT} y1={y((max * i) / 4)} y2={y((max * i) / 4)} className="studio-grid" />
          <text x={LEFT - 6} y={y((max * i) / 4) + 4} textAnchor="end" className="studio-tick">{formatTick((max * i) / 4)}</text>
        </g>
      ))}
      {kind === 'area' && points.length > 0 && <polygon points={`${x(0)},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`} fill={color} opacity={0.18} />}
      {kind !== 'column' && <polyline points={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={p.key || i}>
          <title>{`${p.label}: ${formatValue(p.value, column)}`}</title>
          {kind === 'column'
            ? <rect x={x(i) - Math.min(28, step * 0.36)} y={y(p.value)} width={Math.min(56, step * 0.72)} height={Math.max(0, y(0) - y(p.value))} rx={3} fill={color} />
            : <circle cx={x(i)} cy={y(p.value)} r={points.length > 40 ? 2 : 3.5} fill={color} className="studio-dot" />}
          {i % labelEvery === 0 && <text x={x(i)} y={H - BOTTOM + 16} textAnchor="middle" className="studio-tick">{p.label}</text>}
        </g>
      ))}
    </svg>
  )
}
