import type { CellValue, QueryResult, ResultColumn } from '@goms/domain'

/** Series colours are GOMS theme tokens (see studio.css) so both light and dark themes stay on-brand. Red and green are
 *  reserved for negative / positive changes and never used as a series colour. */
export const SERIES = ['var(--s-1)', 'var(--s-2)', 'var(--s-3)', 'var(--s-4)', 'var(--s-5)', 'var(--s-6)'] as const
export const seriesColor = (i: number) => SERIES[i % SERIES.length]

const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function formatValue(value: CellValue, column: ResultColumn | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return String(value)
  if (column?.format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (column?.format === 'currency' || column?.type === 'currency') return `₹${NUMBER.format(value)} Cr`
  return NUMBER.format(value)
}

/** Compact axis ticks: 1.2K, 3.4L (lakh) — the axis only, tooltips use formatValue. */
export function formatTick(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`
  if (abs >= 1e5) return `${(value / 1e5).toFixed(1)}L`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export interface Point { key: string; label: string; value: number }

/** The first dimension × first measure as plottable points. */
export function pointsOf(result: QueryResult): Point[] {
  const dim = result.columns.find((c) => c.role === 'dimension')
  const measure = result.columns.find((c) => c.role === 'measure')
  if (!dim || !measure) return []
  return result.rows.map((r) => ({
    key: String(r[dim.key] ?? ''), label: String(r[dim.labelKey ?? dim.key] ?? ''), value: typeof r[measure.key] === 'number' ? (r[measure.key] as number) : 0,
  }))
}

export const measureColumn = (result: QueryResult) => result.columns.find((c) => c.role === 'measure')

/** "Nice" axis maximum (1, 2, 2.5, 5 × 10^n) so gridlines land on round numbers. */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max) ?? 10
  return step * power
}
