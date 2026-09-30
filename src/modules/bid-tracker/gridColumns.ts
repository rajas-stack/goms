// The Master Grid's column model (spec §8, §8.1): the seven required column
// groups as a static registry, plus the user-defined Custom group built
// dynamically from the custom-field definitions. Every column — standard or
// custom — is described by the same `GridColumnMeta`, so sorting, filtering,
// search, visibility/order and saved views all work off one shape.
import { BID_STAGES, type CustomFieldType, type TypedFilterRule } from '@goms/domain'
import type { BidCustomField, BidGridRow } from '@/lib/types'

export type GridGroupId = 'identity' | 'client' | 'ownership' | 'decision' | 'dates' | 'documents' | 'system' | 'custom'

/** The seven required groups, in spec §8 order. The Custom group always
 *  follows them and is not part of this list (it only exists when there are
 *  custom columns to show). */
export const GRID_GROUPS: { id: GridGroupId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'client', label: 'Client' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'decision', label: 'Decision' },
  { id: 'dates', label: 'Dates' },
  { id: 'documents', label: 'Documents' },
  { id: 'system', label: 'System' },
]
export const CUSTOM_GROUP = { id: 'custom' as const, label: 'Custom' }

export interface ColumnOption { value: string; label: string }

export interface GridColumnMeta {
  /** Stable id: the `BidGridRow` key for a standard column (also the filter
   *  `field`), `custom:<key>` for a custom one, `manage` for the actions cell. */
  id: string
  header: string
  group: GridGroupId
  /** null = not a data column (Manage): not sortable/filterable/searchable. */
  type: CustomFieldType | null
  /** Fixed choices for a `select` column (standard enums, or a custom field's options). */
  options?: ColumnOption[]
  /** Inline-editable in the grid. `opportunity` = a plain Opportunity attribute
   *  patched via updateOpportunity; `custom` = a custom-field value. Everything
   *  else is read-only here — dialog-controlled (protected/corrigendum-tracked,
   *  or governed by a workflow such as stage/decision). */
  editable?: 'opportunity' | 'custom'
  /** The custom-field definition, for `custom:` columns. */
  custom?: BidCustomField
}

const stageOptions: ColumnOption[] = BID_STAGES.map((s) => ({ value: s.key, label: s.label }))
export const DECISION_OPTIONS: ColumnOption[] = [
  { value: 'pending', label: 'Pending' }, { value: 'go', label: 'Go' }, { value: 'no_go', label: 'No-Go' },
]
export const ATTENTION_OPTIONS: ColumnOption[] = [
  { value: 'dueSoon', label: 'Due Soon' }, { value: 'overdue', label: 'Overdue' },
  { value: 'corrigendumPending', label: 'Corrigendum Pending' }, { value: 'onTrack', label: 'On Track' },
]
const CONFIDENCE_OPTIONS: ColumnOption[] = [
  { value: 'verified', label: 'Verified' }, { value: 'needs_review', label: 'Needs Review' },
]
const CORRIGENDUM_OPTIONS: ColumnOption[] = [
  { value: 'pending_review', label: 'Pending Review' }, { value: 'reviewed', label: 'Reviewed' },
]

const std = (id: string, header: string, group: GridGroupId, type: CustomFieldType | null, extra: Partial<GridColumnMeta> = {}): GridColumnMeta =>
  ({ id, header, group, type, ...extra })

/** Every standard leaf column named by spec §8, in display order. */
export const STANDARD_COLUMNS: GridColumnMeta[] = [
  std('opportunityId', 'Opportunity ID', 'identity', 'text'),
  std('opportunityName', 'Opportunity / Mission', 'identity', 'text'),
  std('bidCode', 'Bid ID', 'identity', 'text'),
  std('gemTenderId', 'Tender ID', 'identity', 'text'),
  std('tenderLink', 'Tender Link', 'identity', 'text'),

  std('departmentName', 'Department / Client', 'client', 'text'),
  std('stateCode', 'State', 'client', 'number'),
  // City and Sector are plain Opportunity attributes: not protected, not
  // corrigendum-tracked, no workflow — the standard columns safe to edit inline.
  std('city', 'City', 'client', 'text', { editable: 'opportunity' }),
  std('vertical', 'Sector', 'client', 'text', { editable: 'opportunity' }),

  std('ownerEmail', 'Bid Owner', 'ownership', 'text'),
  std('solutionLeadEmail', 'Sales Lead / Solution Lead', 'ownership', 'text'),

  std('stageKey', 'Bid Stage', 'decision', 'select', { options: stageOptions }),
  std('nextActionNote', 'Next Action', 'decision', 'text'),
  std('nextActionAssigneeEmail', 'Action Owner', 'decision', 'text'),
  std('nextActionDueDate', 'Action Due', 'decision', 'date'),
  std('attentionFlag', 'Attention', 'decision', 'select', { options: ATTENTION_OPTIONS }),
  std('decision', 'Decision', 'decision', 'select', { options: DECISION_OPTIONS }),

  std('nextMilestoneLabel', 'Next Milestone', 'dates', 'text'),
  std('daysRemaining', 'Days Remaining', 'dates', 'number'),
  std('submissionDate', 'Submission Deadline', 'dates', 'date'),

  std('documentCount', 'Tender Files', 'documents', 'number'),
  std('latestCorrigendumStatus', 'Latest Corrigendum', 'documents', 'select', { options: CORRIGENDUM_OPTIONS }),

  std('updatedAt', 'Last Updated', 'system', 'date'),
  std('updatedBy', 'Updated By', 'system', 'text'),
  std('dataConfidence', 'Data Confidence', 'system', 'select', { options: CONFIDENCE_OPTIONS }),
  std('manage', 'Manage', 'system', null),
]

/** Fixed pixel widths. The grid is a `table-layout: fixed` sheet: with auto
 *  layout the browser re-measures every column as rows scroll in and out of the
 *  virtualized window, so columns would jitter sideways while scrolling. */
const WIDTH_BY_ID: Record<string, number> = {
  opportunityId: 130, opportunityName: 280, bidCode: 120, gemTenderId: 190, tenderLink: 100,
  departmentName: 240, stateCode: 130, city: 130, vertical: 140, ownerEmail: 210, solutionLeadEmail: 230,
  stageKey: 150, nextActionNote: 220, nextActionAssigneeEmail: 210, nextActionDueDate: 120, attentionFlag: 170, decision: 110,
  nextMilestoneLabel: 180, daysRemaining: 130, submissionDate: 160, documentCount: 110, latestCorrigendumStatus: 170,
  updatedAt: 150, updatedBy: 170, dataConfidence: 150, manage: 110,
}
const WIDTH_BY_TYPE: Record<string, number> = { text: 170, number: 120, date: 130, select: 150, boolean: 110 }
/** Never narrower than the header needs: label + sort arrow + menu button. */
const headerWidth = (c: GridColumnMeta) => Math.ceil(c.header.length * 7.4) + 58 + (c.editable ? 16 : 0)
export const columnWidth = (c: GridColumnMeta): number =>
  Math.max(WIDTH_BY_ID[c.id] ?? WIDTH_BY_TYPE[c.type ?? 'text'], headerWidth(c))

export const CUSTOM_COLUMN_PREFIX = 'custom:'

export function customColumnMeta(field: BidCustomField): GridColumnMeta {
  return {
    id: `${CUSTOM_COLUMN_PREFIX}${field.key}`,
    header: field.name,
    group: 'custom',
    type: field.dataType,
    options: field.options?.map((o) => ({ value: o, label: o })),
    editable: 'custom',
    custom: field,
  }
}

/** Standard columns, then the ACTIVE custom columns by `position`. Custom
 *  columns are built from the definitions on every call — nothing about a
 *  particular custom column is hard-coded. */
export function resolveColumns(customFields: BidCustomField[]): GridColumnMeta[] {
  const custom = customFields
    .filter((f) => f.status === 'active')
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
    .map(customColumnMeta)
  return [...STANDARD_COLUMNS, ...custom]
}

/** `visibleColumns` is the ORDERED list saved views persist: array order is
 *  display order and absence means hidden. `undefined`/empty = the default
 *  view: everything, in canonical order. Ids that no longer exist (an
 *  archived custom column) are dropped here, not from the stored view. */
export function resolveVisibleColumns(all: GridColumnMeta[], visibleColumns: string[] | undefined): GridColumnMeta[] {
  if (!visibleColumns || visibleColumns.length === 0) return all
  const byId = new Map(all.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: GridColumnMeta[] = []
  for (const id of visibleColumns) {
    const col = byId.get(id)
    if (col && !seen.has(id)) { seen.add(id); out.push(col) }
  }
  return out
}

export const isEmptyCell = (v: unknown) => v === null || v === undefined || v === ''

export function cellValue(row: BidGridRow, col: GridColumnMeta): unknown {
  if (col.custom) return row.customValues?.[col.custom.key]
  return (row as unknown as Record<string, unknown>)[col.id]
}

/** Human text for a cell, used by quick search (and as the readable form of
 *  an enum value). Empty cells are ''. */
export function cellText(row: BidGridRow, col: GridColumnMeta): string {
  const v = cellValue(row, col)
  if (isEmptyCell(v)) return ''
  if (col.type === 'boolean') return v ? 'Yes' : 'No'
  const option = col.options?.find((o) => o.value === v)
  return option ? `${option.label} ${String(v)}` : String(v)
}

/** Quick search: a row matches when ANY visible text/select column contains
 *  the query (case-insensitive). Other types are not searched. */
export function rowMatchesSearch(row: BidGridRow, columns: GridColumnMeta[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return columns.some((c) => (c.type === 'text' || c.type === 'select') && cellText(row, c).toLowerCase().includes(q))
}

/** A rule is applied only once it has everything its operator needs; a
 *  half-built rule in the filter editor must not blank the grid. */
export function isRuleComplete(rule: TypedFilterRule): boolean {
  if (rule.operator === 'in') return (rule.values?.length ?? 0) > 0
  if (rule.operator === 'between') return rule.value !== '' && !!rule.value2
  return rule.value !== ''
}

/** Rules that reference a custom column that is archived or unknown are
 *  ignored (not dropped) — surfaced as a notice, restored on unarchive. */
export function ignoredRules(rules: TypedFilterRule[], columns: GridColumnMeta[]): TypedFilterRule[] {
  const known = new Set(columns.map((c) => c.id))
  return rules.filter((r) => r.field.startsWith(CUSTOM_COLUMN_PREFIX) && !known.has(r.field))
}

export const OPERATOR_LABEL: Record<string, string> = {
  eq: 'equals', contains: 'contains', startsWith: 'starts with', gt: 'greater than', lt: 'less than',
  between: 'between', before: 'before', after: 'after', in: 'is one of',
}
/** Boolean columns read "is" rather than "equals". */
export const operatorLabel = (type: CustomFieldType | null, operator: string) =>
  type === 'boolean' && operator === 'eq' ? 'is' : OPERATOR_LABEL[operator] ?? operator
