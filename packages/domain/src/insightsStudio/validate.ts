import { getDataset, getField } from './catalog.js'
import { aggregationsFor } from './recommend.js'
import { isBuiltInId, isKnownBuiltInVisual, NO_PERIOD } from './templates.js'
import {
  AGGREGATIONS, CHART_TYPES, FILTER_OPS, REPORT_GRID_COLUMNS, TIME_GRAINS, type InsightReportInput, type InsightVisualInput,
  type ReportFilters, type ReportWidget, type VisualSpec,
} from './types.js'

/** One set of rules for the server router and the local store: every id a spec names must exist in the catalog,
 *  so a saved visual can never point at a field of another source. Errors are user-facing sentences. */

export const STUDIO_LIMITS = {
  name: 120, description: 1000, text: 2000, dimensions: 3, measures: 4, filters: 16, listValues: 100, valueLength: 200,
  widgets: 60, rowLimit: 1000, maxHeight: 24,
} as const

const fail = (message: string): never => { throw new Error(message) }
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value)

function cleanText(value: unknown, label: string, max: number, required: boolean): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) fail(`${label} is required.`)
  if (text.length > max) fail(`${label} must be at most ${max} characters.`)
  return text
}

function checkValue(value: unknown): void {
  const values = Array.isArray(value) ? value : [value]
  if (values.length > STUDIO_LIMITS.listValues) fail('A filter can list at most 100 values.')
  for (const v of values) {
    if (v !== null && v !== undefined && !['string', 'number', 'boolean'].includes(typeof v)) fail('Filter values must be text, numbers or yes/no.')
    if (typeof v === 'string' && v.length > STUDIO_LIMITS.valueLength) fail('A filter value is too long.')
  }
}

/** Throws when the spec names an unknown source, a field of another source, or an impossible aggregation. */
export function assertValidVisualSpec(spec: VisualSpec): void {
  if (!spec || typeof spec !== 'object' || !spec.query) fail('The visual has no query.')
  const { query } = spec
  const dataset = getDataset(query.datasetId) ?? fail(`Unknown data source "${String(query.datasetId)}".`)
  if (!oneOf(CHART_TYPES, spec.chart)) fail('Unknown chart type.')
  if (!Array.isArray(query.dimensions) || query.dimensions.length > STUDIO_LIMITS.dimensions) fail('A visual can group by at most 3 fields.')
  if (!Array.isArray(query.measures) || !query.measures.length || query.measures.length > STUDIO_LIMITS.measures) fail('Choose between 1 and 4 measures.')
  if (!Array.isArray(query.filters) || query.filters.length > STUDIO_LIMITS.filters) fail('A visual can have at most 16 filters.')
  const field = (key: unknown) => (typeof key === 'string' ? getField(dataset, key) : undefined) ?? fail(`"${String(key)}" is not a field of ${dataset.label}.`)
  for (const d of query.dimensions) {
    const f = field(d.field)
    if (d.grain !== undefined && (!oneOf(TIME_GRAINS, d.grain) || f.type !== 'date')) fail(`${f.label} cannot be grouped by time.`)
  }
  for (const m of query.measures) {
    const f = field(m.field)
    if (!oneOf(AGGREGATIONS, m.agg) || !aggregationsFor(f).includes(m.agg)) fail(`${f.label} cannot be aggregated with "${String(m.agg)}".`)
    if (m.label !== undefined) cleanText(m.label, 'Measure label', STUDIO_LIMITS.name, false)
  }
  for (const f of query.filters) {
    field(f.field)
    if (!oneOf(FILTER_OPS, f.op)) fail('Unknown filter operator.')
    checkValue(f.value)
  }
  if (query.sort && (typeof query.sort.by !== 'string' || !['asc', 'desc'].includes(query.sort.dir))) fail('Invalid sort.')
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > STUDIO_LIMITS.rowLimit)) fail('Limit must be between 1 and 1000.')
  if (query.calendar !== undefined && !['fy', 'calendar'].includes(query.calendar)) fail('Unknown calendar.')
  if (spec.periodField !== undefined && spec.periodField !== NO_PERIOD && field(spec.periodField).type !== 'date') fail('The period field must be a date.')
}

export function normalizeVisualInput(input: InsightVisualInput): Required<InsightVisualInput> {
  assertValidVisualSpec(input.spec)
  return {
    name: cleanText(input.name, 'Name', STUDIO_LIMITS.name, true),
    description: cleanText(input.description, 'Description', STUDIO_LIMITS.description, false),
    spec: input.spec, shared: input.shared === true,
  }
}

function checkWidget(w: ReportWidget, visualExists: (id: string) => boolean): ReportWidget {
  if (typeof w.id !== 'string' || !w.id || w.id.length > 64) fail('Every widget needs an id.')
  for (const n of [w.x, w.y, w.w, w.h]) if (!Number.isInteger(n) || n < 0) fail('Widget positions must be whole numbers.')
  if (w.w < 1 || w.x + w.w > REPORT_GRID_COLUMNS || w.h < 1 || w.h > STUDIO_LIMITS.maxHeight || w.y > 500) fail('A widget does not fit on the 12-column grid.')
  if (w.kind === 'visual') {
    if (typeof w.visualId !== 'string' || (isBuiltInId(w.visualId) ? !isKnownBuiltInVisual(w.visualId) : !visualExists(w.visualId))) fail('A widget points at a visual that does not exist.')
  } else if (w.kind !== 'text') fail('Unknown widget kind.')
  const title = w.title === undefined ? undefined : cleanText(w.title, 'Widget title', STUDIO_LIMITS.name, false)
  const text = w.kind === 'text' ? cleanText(w.text, 'Text', STUDIO_LIMITS.text, false) : undefined
  return { id: w.id, kind: w.kind, ...(w.kind === 'visual' ? { visualId: w.visualId } : { text }), ...(title ? { title } : {}), x: w.x, y: w.y, w: w.w, h: w.h }
}

function checkFilters(filters: ReportFilters): ReportFilters {
  const p = filters?.period
  if (!p || !['all', 'fy', 'half', 'quarter', 'custom'].includes(p.kind)) fail('Choose a report period.')
  if (['fy', 'half', 'quarter'].includes(p.kind) && (!Number.isInteger(p.fy) || p.fy! < 2000 || p.fy! > 2100)) fail('Choose a financial year.')
  const vertical = cleanText(filters.vertical, 'Vertical', STUDIO_LIMITS.valueLength, false)
  const team = cleanText(filters.team, 'Team', STUDIO_LIMITS.valueLength, false)
  return {
    period: { kind: p.kind, ...(p.fy ? { fy: p.fy } : {}), ...(p.kind === 'half' ? { half: p.half === 2 ? 2 : 1 } : {}),
      ...(p.kind === 'quarter' ? { quarter: ([1, 2, 3, 4].includes(p.quarter ?? 0) ? p.quarter : 1) } : {}),
      ...(p.kind === 'custom' ? { from: cleanText(p.from, 'From', 10, true), to: cleanText(p.to, 'To', 10, true) } : {}) },
    calendar: filters.calendar === 'calendar' ? 'calendar' : 'fy',
    ...(vertical ? { vertical } : {}), ...(team ? { team } : {}),
  }
}

/** `visualExists` answers for saved (non-built-in) visual ids. */
export function normalizeReportInput(input: InsightReportInput, visualExists: (id: string) => boolean): Required<InsightReportInput> {
  if (!Array.isArray(input.widgets) || input.widgets.length > STUDIO_LIMITS.widgets) fail('A report can hold at most 60 widgets.')
  const widgets = input.widgets.map((w) => checkWidget(w, visualExists))
  if (new Set(widgets.map((w) => w.id)).size !== widgets.length) fail('Widget ids must be unique.')
  return {
    name: cleanText(input.name, 'Name', STUDIO_LIMITS.name, true),
    description: cleanText(input.description, 'Description', STUDIO_LIMITS.description, false),
    widgets, filters: checkFilters(input.filters), shared: input.shared === true,
  }
}
