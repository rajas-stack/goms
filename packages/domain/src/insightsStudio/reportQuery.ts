import { fieldsWithSemantic, getDataset } from './catalog.js'
import { NO_PERIOD } from './templates.js'
import { periodRange, previousRange, type DateRange } from './time.js'
import type { QueryFilter, QuerySpec, ReportFilters, VisualSpec } from './types.js'

/** How report-level filters reach each widget: the period applies to the visual's period field (or its source's
 *  default date); vertical / team apply only to sources that carry a field with that meaning. A source without the
 *  field is left unfiltered rather than emptied — and `appliedFilters` says which ones applied. */

export interface EffectiveQuery { query: QuerySpec; range: DateRange | null; applied: string[] }

export function periodFieldOf(spec: VisualSpec): string | null {
  if (spec.periodField === NO_PERIOD) return null
  return spec.periodField ?? getDataset(spec.query.datasetId)?.timeField ?? null
}

export function effectiveQuery(spec: VisualSpec, filters: ReportFilters | undefined, rangeOverride?: DateRange | null): EffectiveQuery {
  const dataset = getDataset(spec.query.datasetId)
  const calendar = spec.query.calendar ?? filters?.calendar ?? 'fy'
  const extra: QueryFilter[] = []
  const applied: string[] = []
  const periodField = periodFieldOf(spec)
  const range = rangeOverride !== undefined ? rangeOverride : filters ? periodRange(filters.period, calendar) : null
  if (range && periodField) {
    extra.push({ field: periodField, op: 'between', value: [range.from, range.to] })
    applied.push('period')
  }
  if (dataset && filters?.vertical) {
    const [field] = fieldsWithSemantic(dataset, 'vertical')
    if (field) { extra.push({ field: field.key, op: 'eq', value: filters.vertical }); applied.push('vertical') }
  }
  if (dataset && filters?.team) {
    const [field] = [...fieldsWithSemantic(dataset, 'team'), ...fieldsWithSemantic(dataset, 'owner')]
    if (field) { extra.push({ field: field.key, op: 'eq', value: filters.team }); applied.push('team') }
  }
  return { query: { ...spec.query, calendar, filters: [...spec.query.filters, ...extra] }, range: periodField ? range : null, applied }
}

/** The same query over the previous, equally long period — for KPI deltas. Null when no period applies. */
export function previousQuery(spec: VisualSpec, filters: ReportFilters | undefined): QuerySpec | null {
  const current = effectiveQuery(spec, filters)
  return current.range ? effectiveQuery(spec, filters, previousRange(current.range)).query : null
}
