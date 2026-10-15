import {
  COUNT_FIELD, compatibleCharts, defaultAggregation, defaultMeasure, getDataset, getField, recommendChart, suggestGrain,
  type ChartType, type DataRow, type QueryDimension, type QueryFilter, type QueryMeasure, type VisualSpec,
} from '@goms/domain'

/** The visual builder's working state, with pure, immutable update helpers. The chart follows the recommendation until
 *  the user picks one; any query change that makes their pick impossible falls back to the recommendation. */

export interface Draft { spec: VisualSpec; chartChosen: boolean }

export function draftForSource(datasetId: string): Draft {
  const dataset = getDataset(datasetId)
  if (!dataset) throw new Error(`Unknown data source "${datasetId}".`)
  const query = { datasetId, dimensions: [], measures: [defaultMeasure(dataset)], filters: [] }
  return { spec: { query, chart: 'kpi', compare: true }, chartChosen: false }
}

export const draftFromSpec = (spec: VisualSpec): Draft => ({ spec, chartChosen: true })

/** Re-derives the chart after a query change. */
function rechart(draft: Draft, rows: readonly DataRow[] | undefined): Draft {
  const distinct = (key: string) => new Set((rows ?? []).map((r) => r[key])).size || 50
  const recommended = recommendChart(draft.spec.query, rows ? distinct : undefined).chart
  const keep = draft.chartChosen && compatibleCharts(draft.spec.query).includes(draft.spec.chart)
  return { ...draft, chartChosen: keep, spec: { ...draft.spec, chart: keep ? draft.spec.chart : recommended } }
}

const withQuery = (draft: Draft, patch: Partial<VisualSpec['query']>, rows?: readonly DataRow[]): Draft =>
  rechart({ ...draft, spec: { ...draft.spec, query: { ...draft.spec.query, ...patch } } }, rows)

/** Sets (or clears, with field '') the dimension at `index`. Dates get a time grain suited to the data's span. */
export function setDimension(draft: Draft, index: number, field: string, rows?: readonly DataRow[]): Draft {
  const dataset = getDataset(draft.spec.query.datasetId)!
  const def = field ? getField(dataset, field) : undefined
  const next: QueryDimension | null = def ? { field, ...(def.type === 'date' ? { grain: suggestGrain(rows ?? [], field) } : {}) } : null
  const dims = [...draft.spec.query.dimensions]
  if (next) dims[index] = next
  else dims.splice(index, 1)
  return withQuery(draft, { dimensions: dims.filter(Boolean), sort: undefined }, rows)
}

export function setGrain(draft: Draft, index: number, grain: QueryDimension['grain'], rows?: readonly DataRow[]): Draft {
  return withQuery(draft, { dimensions: draft.spec.query.dimensions.map((d, i) => (i === index ? { ...d, grain } : d)) }, rows)
}

/** Picking a measure field also picks its natural aggregation and number format. */
export function setMeasureField(draft: Draft, index: number, field: string, rows?: readonly DataRow[]): Draft {
  const dataset = getDataset(draft.spec.query.datasetId)!
  const def = getField(dataset, field)
  if (!def) return draft
  const agg = defaultAggregation(def)
  const measure: QueryMeasure = {
    field, agg, ...(def.type === 'currency' && (agg === 'sum' || agg === 'avg') ? { format: 'currency' as const } : {}),
    ...(def.type === 'boolean' && agg === 'avg' ? { format: 'percent' as const } : {}),
  }
  return withQuery(draft, { measures: draft.spec.query.measures.map((m, i) => (i === index ? measure : m)), sort: undefined }, rows)
}

export function setMeasureAgg(draft: Draft, index: number, agg: QueryMeasure['agg'], rows?: readonly DataRow[]): Draft {
  const measures = draft.spec.query.measures.map((m, i) => {
    if (i !== index) return m
    const format = agg === 'count' || agg === 'distinct' ? undefined : m.format
    return { field: m.field, agg, ...(format ? { format } : {}) }
  })
  return withQuery(draft, { measures, sort: undefined }, rows)
}

export const addMeasure = (draft: Draft, rows?: readonly DataRow[]): Draft =>
  withQuery(draft, { measures: [...draft.spec.query.measures, { field: COUNT_FIELD, agg: 'count' }] }, rows)
export const removeMeasure = (draft: Draft, index: number, rows?: readonly DataRow[]): Draft =>
  draft.spec.query.measures.length <= 1 ? draft : withQuery(draft, { measures: draft.spec.query.measures.filter((_, i) => i !== index), sort: undefined }, rows)

export const setFilters = (draft: Draft, filters: QueryFilter[]): Draft => ({ ...draft, spec: { ...draft.spec, query: { ...draft.spec.query, filters } } })

export const chooseChart = (draft: Draft, chart: ChartType): Draft => ({ ...draft, chartChosen: true, spec: { ...draft.spec, chart } })

export const patchSpec = (draft: Draft, patch: Partial<VisualSpec>): Draft => ({ ...draft, spec: { ...draft.spec, ...patch } })

/** A readable default name, e.g. "Value (INR Cr) by Vertical". */
export function suggestName(spec: VisualSpec): string {
  const dataset = getDataset(spec.query.datasetId)
  if (!dataset) return 'New visual'
  const measure = spec.query.measures[0]
  const what = measure ? (measure.field === COUNT_FIELD ? `${dataset.label} records` : getField(dataset, measure.field)?.label ?? measure.field) : dataset.label
  const by = spec.query.dimensions.map((d) => getField(dataset, d.field)?.label ?? d.field)
  return by.length ? `${what} by ${by.join(' and ')}` : what
}
