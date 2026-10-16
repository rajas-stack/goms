import { getDataset, getField } from './catalog.js'
import { fieldTypeIsNumeric } from './fields.js'
import { daysBetween, isoDay } from './time.js'
import {
  COUNT_FIELD, type Aggregation, type ChartType, type DataRow, type DatasetDef, type FieldDef, type QueryMeasure, type QuerySpec, type TimeGrain,
} from './types.js'

/** "Smarter than the user": sensible defaults for a picked field and the best-fit chart for a query shape. */

export interface ChartRecommendation { chart: ChartType; reason: string; alternatives: ChartType[] }

/** A flow dimension (stages, approval status) reads best as a funnel. */
const isFlow = (field: FieldDef) => field.type === 'enum' && /stage|^status$/i.test(field.key)

const distinctOf = (field: FieldDef, distinct?: (key: string) => number) =>
  distinct?.(field.key) ?? field.enumValues?.length ?? (field.type === 'boolean' ? 2 : 50)

const additive = (m: QueryMeasure | undefined) => !!m && (m.field === COUNT_FIELD || m.agg === 'count' || m.agg === 'sum')

export function recommendChart(spec: QuerySpec, distinct?: (key: string) => number): ChartRecommendation {
  const dataset = getDataset(spec.datasetId)
  const fields = dataset ? spec.dimensions.map((d) => getField(dataset, d.field)).filter((f): f is FieldDef => !!f) : []
  const [first, second] = fields
  if (!first) return { chart: 'kpi', reason: 'A single number reads best as a KPI tile with its change vs the previous period.', alternatives: ['table'] }
  if (fields.length > 2 || spec.measures.length > 2) return { chart: 'table', reason: 'Many columns are easiest to compare in a table.', alternatives: ['groupedBar'] }
  if (!second) {
    if (first.type === 'date') {
      const coarse = ['quarter', 'half', 'year'].includes(spec.dimensions[0].grain ?? 'day')
      return coarse
        ? { chart: 'column', reason: 'Few time periods compare best side by side as columns.', alternatives: ['line', 'area', 'table'] }
        : { chart: 'line', reason: 'A trend over time reads best as a line.', alternatives: ['area', 'column', 'table'] }
    }
    if (isFlow(first)) return { chart: 'funnel', reason: `${first.label} is a progression, so a funnel shows where records drop off.`, alternatives: ['bar', 'column', 'table'] }
    const n = distinctOf(first, distinct)
    if (n <= 8 && additive(spec.measures[0])) return { chart: 'donut', reason: `${first.label} has few values, so a donut shows each share of the total.`, alternatives: ['bar', 'column', 'table'] }
    return { chart: 'bar', reason: `Ranked horizontal bars keep long ${first.label.toLowerCase()} names readable.`, alternatives: ['column', 'table'] }
  }
  const timeFirst = first.type === 'date' || second.type === 'date'
  if (!timeFirst && distinctOf(first, distinct) > 6 && distinctOf(second, distinct) > 6) {
    return { chart: 'heatmap', reason: 'Two dimensions with many values form a matrix; a heatmap shows the hot spots.', alternatives: ['stackedBar', 'table'] }
  }
  return { chart: 'stackedBar', reason: 'Stacked columns show the total and how each part contributes.', alternatives: ['groupedBar', 'heatmap', 'table'] }
}

/** Charts that can draw this query shape at all. */
export function compatibleCharts(spec: QuerySpec): ChartType[] {
  const dims = spec.dimensions.length
  if (dims === 0) return ['kpi', 'table']
  if (dims === 1) return ['line', 'area', 'column', 'bar', 'donut', 'funnel', 'table']
  if (dims === 2) return ['stackedBar', 'groupedBar', 'heatmap', 'table']
  return ['table']
}

/** The natural aggregation for a field: totals for money, averages for ages / ratios, distinct counts for text. */
export function defaultAggregation(field: FieldDef): Aggregation {
  if (field.key === COUNT_FIELD) return 'count'
  if (field.type === 'boolean') return 'avg'
  if (fieldTypeIsNumeric(field.type)) return /days|age|tenure|version|revision|price/i.test(field.key) ? 'avg' : 'sum'
  if (field.type === 'date') return 'max'
  return 'distinct'
}

export function defaultMeasure(dataset: DatasetDef): QueryMeasure {
  const field = getField(dataset, dataset.defaultMeasure)
  if (!field || field.key === COUNT_FIELD) return { field: COUNT_FIELD, agg: 'count' }
  return { field: field.key, agg: defaultAggregation(field), format: field.type === 'currency' ? 'currency' : undefined }
}

/** Aggregations that make sense for a field type. */
export function aggregationsFor(field: FieldDef): Aggregation[] {
  if (field.key === COUNT_FIELD) return ['count']
  if (fieldTypeIsNumeric(field.type)) return ['sum', 'avg', 'min', 'max', 'count', 'distinct']
  if (field.type === 'boolean') return ['avg', 'sum', 'count']
  if (field.type === 'date') return ['min', 'max', 'count', 'distinct']
  return ['distinct', 'count']
}

/** A time grain that gives roughly 6–24 buckets over the span the rows actually cover. */
export function suggestGrain(rows: readonly DataRow[], field: string): TimeGrain {
  const days = rows.map((r) => isoDay(r[field])).filter((d): d is string => d !== null).sort()
  if (days.length < 2) return 'month'
  const span = daysBetween(days[0], days[days.length - 1]) ?? 0
  if (span <= 45) return 'day'
  if (span <= 730) return 'month'
  if (span <= 2200) return 'quarter'
  return 'year'
}
