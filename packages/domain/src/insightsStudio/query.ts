import { getDataset, getField } from './catalog.js'
import { fieldTypeIsNumeric } from './fields.js'
import { bucketOf, isoDay } from './time.js'
import {
  COUNT_FIELD, type CellValue, type DataRow, type DatasetDef, type FieldDef, type QueryDimension, type QueryFilter, type QueryMeasure,
  type QueryResult, type QuerySpec, type ResultColumn,
} from './types.js'

/** The pure query engine: filter → group (with time buckets) → aggregate → sort → limit, over the tidy rows of ONE
 *  data source. Derived fields are computed per row from that same row only, so a result never mixes sources. */

export interface QueryOptions { today: string }

export const measureKey = (m: QueryMeasure): string => (m.field === COUNT_FIELD ? 'count' : `${m.agg}_${m.field}`)
export const labelKeyOf = (field: string): string => `${field}$label`
const BLANK = ''
const BLANK_LABEL = 'Not set'

/** Reads a field from a row, computing it when it is derived. */
export function fieldValue(row: DataRow, field: FieldDef, options: QueryOptions): CellValue {
  const value = field.derive ? field.derive(row, { today: options.today }) : row[field.key]
  return value === undefined ? null : value
}

const isEmpty = (v: CellValue) => v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))
const asNumber = (v: CellValue): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null)

/** Values compare as dates (ISO day), numbers, or case-insensitive text — whichever the field is. */
function comparable(v: CellValue, field: FieldDef): string | number | null {
  if (isEmpty(v)) return null
  if (field.type === 'date') return isoDay(v)
  if (fieldTypeIsNumeric(field.type)) return asNumber(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  return String(v).toLowerCase()
}

const list = (value: QueryFilter['value']): CellValue[] => (Array.isArray(value) ? [...value] : value === undefined ? [] : [value as CellValue])

export function matchesFilter(row: DataRow, field: FieldDef, filter: QueryFilter, options: QueryOptions): boolean {
  const raw = fieldValue(row, field, options)
  const v = comparable(raw, field)
  const targets = list(filter.value).map((t) => comparable(t, field))
  const [a, b] = targets
  switch (filter.op) {
    case 'empty': return v === null
    case 'notEmpty': return v !== null
    case 'isTrue': return raw === true || raw === 1
    case 'isFalse': return !(raw === true || raw === 1)
    case 'eq': return v === a
    case 'neq': return v !== a
    case 'in': return targets.includes(v)
    case 'nin': return !targets.includes(v)
    case 'contains': return v !== null && a !== null && a !== undefined && String(v).includes(String(a))
    case 'gt': return v !== null && a != null && v > a
    case 'gte': return v !== null && a != null && v >= a
    case 'lt': return v !== null && a != null && v < a
    case 'lte': return v !== null && a != null && v <= a
    case 'between': return v !== null && a != null && b != null && v >= a && v <= b
  }
}

interface GroupKey { key: string; label: string }

function dimensionKey(row: DataRow, field: FieldDef, dimension: QueryDimension, spec: QuerySpec, options: QueryOptions): GroupKey {
  const value = fieldValue(row, field, options)
  if (isEmpty(value)) return { key: BLANK, label: BLANK_LABEL }
  if (field.type === 'date') return bucketOf(value, dimension.grain ?? 'day', spec.calendar ?? 'fy') ?? { key: BLANK, label: BLANK_LABEL }
  if (typeof value === 'boolean') return { key: value ? 'true' : 'false', label: value ? 'Yes' : 'No' }
  const key = String(value)
  return { key, label: field.enumValues?.find((o) => o.value === key)?.label ?? key }
}

function aggregate(values: readonly CellValue[], measure: QueryMeasure, rowCount: number): CellValue {
  if (measure.field === COUNT_FIELD) return rowCount
  const present = values.filter((v) => !isEmpty(v))
  switch (measure.agg) {
    case 'count': return present.length
    case 'distinct': return new Set(present.map((v) => String(v))).size
    case 'sum': return present.reduce<number>((n, v) => n + (asNumber(v) ?? 0), 0)
    case 'avg': {
      const nums = present.map(asNumber).filter((n): n is number => n !== null)
      return nums.length ? nums.reduce((n, v) => n + v, 0) / nums.length : null
    }
    case 'min': case 'max': {
      if (!present.length) return null
      const sorted = [...present].sort((x, y) => (asNumber(x) !== null && asNumber(y) !== null ? asNumber(x)! - asNumber(y)! : String(x).localeCompare(String(y))))
      return measure.agg === 'min' ? sorted[0] : sorted[sorted.length - 1]
    }
  }
}

function requireField(dataset: DatasetDef, key: string): FieldDef {
  const field = getField(dataset, key)
  if (!field) throw new Error(`"${key}" is not a field of ${dataset.label}.`)
  return field
}

function columnsFor(dataset: DatasetDef, spec: QuerySpec): ResultColumn[] {
  return [
    ...spec.dimensions.map((d) => {
      const f = requireField(dataset, d.field)
      return { key: d.field, label: f.label, type: f.type, role: 'dimension' as const, labelKey: labelKeyOf(d.field) }
    }),
    ...spec.measures.map((m) => {
      const f = requireField(dataset, m.field)
      const type = m.agg === 'count' || m.agg === 'distinct' || m.field === COUNT_FIELD ? 'number' as const : f.type === 'boolean' ? 'number' as const : f.type
      const aggLabel = m.field === COUNT_FIELD ? f.label : m.agg === 'count' ? `Count of ${f.label}` : `${m.agg[0].toUpperCase()}${m.agg.slice(1)} of ${f.label}`
      return { key: measureKey(m), label: m.label || aggLabel, type, role: 'measure' as const, format: m.format }
    }),
  ]
}

function defaultOrder(dataset: DatasetDef, spec: QuerySpec): QuerySpec['sort'] {
  const first = spec.dimensions[0]
  if (!first) return undefined
  const field = requireField(dataset, first.field)
  if (field.type === 'date' || field.enumValues) return { by: first.field, dir: 'asc' }
  return spec.measures[0] ? { by: measureKey(spec.measures[0]), dir: 'desc' } : { by: first.field, dir: 'asc' }
}

function compareRows(dataset: DatasetDef, sort: NonNullable<QuerySpec['sort']>) {
  const field = getField(dataset, sort.by)
  const order = field?.enumValues ? new Map(field.enumValues.map((o, i) => [o.value, i])) : null
  const rank = (v: CellValue) => (order && typeof v === 'string' ? order.get(v) ?? order.size : v)
  const sign = sort.dir === 'asc' ? 1 : -1
  return (x: Record<string, CellValue>, y: Record<string, CellValue>) => {
    const a = rank(x[sort.by]), b = rank(y[sort.by])
    if (a === b) return 0
    if (a === null || a === BLANK) return 1
    if (b === null || b === BLANK) return -1
    return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * sign
  }
}

export function runQuery(rows: readonly DataRow[], spec: QuerySpec, options: QueryOptions): QueryResult {
  const dataset = getDataset(spec.datasetId)
  if (!dataset) throw new Error(`Unknown data source "${spec.datasetId}".`)
  const columns = columnsFor(dataset, spec)
  const filters = spec.filters.map((f) => ({ filter: f, field: requireField(dataset, f.field) }))
  const matched = rows.filter((row) => filters.every(({ filter, field }) => matchesFilter(row, field, filter, options)))
  const dims = spec.dimensions.map((d) => ({ d, field: requireField(dataset, d.field) }))
  const measures = spec.measures.map((m) => ({ m, field: requireField(dataset, m.field) }))

  const groups = new Map<string, { keys: GroupKey[]; rows: DataRow[] }>()
  for (const row of matched) {
    const keys = dims.map(({ d, field }) => dimensionKey(row, field, d, spec, options))
    const id = JSON.stringify(keys.map((k) => k.key))
    const group = groups.get(id)
    if (group) group.rows.push(row)
    else groups.set(id, { keys, rows: [row] })
  }
  if (!dims.length && !groups.size) groups.set('[]', { keys: [], rows: [] })

  const out = [...groups.values()].map(({ keys, rows: members }) => {
    const record: Record<string, CellValue> = {}
    dims.forEach(({ d }, i) => { record[d.field] = keys[i].key; record[labelKeyOf(d.field)] = keys[i].label })
    for (const { m, field } of measures) {
      record[measureKey(m)] = aggregate(m.field === COUNT_FIELD ? [] : members.map((r) => fieldValue(r, field, options)), m, members.length)
    }
    return record
  })
  const sort = spec.sort ?? defaultOrder(dataset, spec)
  const sorted = sort ? [...out].sort(compareRows(dataset, sort)) : out
  const limited = spec.limit && spec.limit > 0 ? sorted.slice(0, spec.limit) : sorted
  return { columns, rows: limited, matched: matched.length, groups: out.length }
}
