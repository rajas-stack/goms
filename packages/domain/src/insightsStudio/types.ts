import type { PolicyModuleKey } from '../rbac/policy.js'

/** Insights Studio: a semantic catalog of the platform's data sources, a pure query engine over their rows, and the
 *  saved visuals / reports built on top. Everything here is plain data so specs can be stored as JSON and validated
 *  on both the server and the client. */

export type FieldType = 'string' | 'number' | 'currency' | 'date' | 'boolean' | 'enum'
export type FieldRole = 'dimension' | 'measure'
/** Cross-source meaning of a field, used by report-level filters (vertical / team) without guessing from names. */
export type FieldSemantic = 'vertical' | 'team' | 'owner' | 'state' | 'value'

/** One cell of a tidy row. Dates are ISO strings (`YYYY-MM-DD` or full ISO); booleans stay booleans. */
export type CellValue = string | number | boolean | null
export type DataRow = Readonly<Record<string, CellValue>>

export interface EnumOption { value: string; label: string }

export interface DerivedContext { today: string }

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  role: FieldRole
  description?: string
  enumValues?: readonly EnumOption[]
  semantic?: FieldSemantic
  /** Computed from the row (and today's date) instead of read from it. Never stored. */
  derive?: (row: DataRow, ctx: DerivedContext) => CellValue
  /** Shown as a quick breakdown on the Data Sources page. */
  breakdown?: boolean
}

export interface DatasetDef {
  id: string
  label: string
  /** The GOMS module / sheet that owns these records — the lineage shown to users. */
  module: string
  description: string
  /** The read permissions that gate this source (any one suffices — the same rule as the API procedure that serves the
   *  rows). A user who can read none of them never sees the source. */
  rbacModules: readonly PolicyModuleKey[]
  fields: readonly FieldDef[]
  /** The date a report period applies to by default. */
  timeField?: string
  /** Default measure for new visuals: a numeric field key, or COUNT_FIELD for "number of records". */
  defaultMeasure: string
  /** What one row is, e.g. "opportunity", "bid milestone". */
  rowNoun: string
  /** Visual ideas offered when this source is picked. */
  suggestions?: readonly VisualSuggestion[]
}

/** `count` over this pseudo-field counts rows. */
export const COUNT_FIELD = '*'

export const AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max', 'distinct'] as const
export type Aggregation = (typeof AGGREGATIONS)[number]

export const TIME_GRAINS = ['day', 'month', 'quarter', 'half', 'year'] as const
export type TimeGrain = (typeof TIME_GRAINS)[number]
/** Indian financial year (April–March, the default) or the calendar year. */
export type FiscalCalendar = 'fy' | 'calendar'

export const FILTER_OPS = ['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'empty', 'notEmpty', 'isTrue', 'isFalse'] as const
export type FilterOp = (typeof FILTER_OPS)[number]

export interface QueryDimension { field: string; grain?: TimeGrain }
export interface QueryMeasure { field: string; agg: Aggregation; label?: string; format?: 'number' | 'currency' | 'percent' }
export interface QueryFilter { field: string; op: FilterOp; value?: CellValue | readonly CellValue[] }
export interface QuerySort { by: string; dir: 'asc' | 'desc' }

export interface QuerySpec {
  datasetId: string
  dimensions: readonly QueryDimension[]
  measures: readonly QueryMeasure[]
  filters: readonly QueryFilter[]
  calendar?: FiscalCalendar
  sort?: QuerySort
  limit?: number
}

/** A dimension column holds a sortable key in `key` and the display text in `labelKey`. */
export interface ResultColumn { key: string; label: string; type: FieldType; role: FieldRole; labelKey?: string; format?: QueryMeasure['format'] }
/** `matched` = source rows that passed the filters; `groups` = groups before `limit`. */
export interface QueryResult { columns: ResultColumn[]; rows: Record<string, CellValue>[]; matched: number; groups: number }

export const CHART_TYPES = ['kpi', 'line', 'area', 'column', 'bar', 'stackedBar', 'groupedBar', 'donut', 'funnel', 'heatmap', 'table'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export interface VisualSpec {
  query: QuerySpec
  chart: ChartType
  /** Which date a report period filters on (defaults to the dataset's timeField). */
  periodField?: string
  /** KPI tiles: show the change vs the previous period of the same length. */
  compare?: boolean
}

export interface VisualSuggestion { name: string; description: string; spec: VisualSpec }

export interface InsightVisual {
  id: string
  name: string
  description: string
  spec: VisualSpec
  ownerEmail: string
  shared: boolean
  builtIn?: boolean
  createdAt: string
  updatedAt: string
}

export interface InsightVisualInput { name: string; description?: string; spec: VisualSpec; shared?: boolean }

export const REPORT_GRID_COLUMNS = 12

export interface ReportWidget {
  id: string
  kind: 'visual' | 'text'
  visualId?: string
  title?: string
  /** For text widgets: a section heading (first line) and optional body. */
  text?: string
  x: number
  y: number
  w: number
  h: number
}

export type PeriodKind = 'all' | 'fy' | 'half' | 'quarter' | 'custom'
export interface ReportPeriod { kind: PeriodKind; fy?: number; half?: 1 | 2; quarter?: 1 | 2 | 3 | 4; from?: string; to?: string }
export interface ReportFilters { period: ReportPeriod; calendar?: FiscalCalendar; vertical?: string; team?: string }

export interface InsightReport {
  id: string
  name: string
  description: string
  widgets: ReportWidget[]
  filters: ReportFilters
  ownerEmail: string
  shared: boolean
  builtIn?: boolean
  createdAt: string
  updatedAt: string
}

export interface InsightReportInput { name: string; description?: string; widgets: ReportWidget[]; filters: ReportFilters; shared?: boolean }

/** One corrigendum register row across all bids (insightsStudio.corrigenda), flattened for the Corrigenda source. */
export interface InsightCorrigendumRow {
  id: string; bidId: string; bidCode: string; sheet: string; opportunityName: string; corrigendumNumber: number
  status: 'pending_review' | 'reviewed'; reviewStatus: string; impactLevel: string
  technicalImpact: boolean; commercialImpact: boolean; submissionDateImpact: boolean
  changeCount: number; pendingChanges: number; detectedAt: string | null; publishedDate: string | null
}
