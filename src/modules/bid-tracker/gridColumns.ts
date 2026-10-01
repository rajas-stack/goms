// The Master Grid's column model (spec §8, §8.1): the seven required column
// groups as a static registry, plus the user-defined Custom group built
// dynamically from the custom-field definitions. Every column — standard or
// custom — is described by the same `GridColumnMeta`, so sorting, filtering,
// search, visibility/order and saved views all work off one shape.
import {
  BID_STAGES, ENTITY_FIELD_TYPES, flattenRules, parseMultiValue,
  type CustomFieldType, type FilterNode, type TypedFilterRule,
} from '@goms/domain'
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
  /** Fixed choices for a `select` / `multiselect` column (standard enums, or a
   *  custom field's options). Entity types (person, department, state) take
   *  theirs from the live records — see `optionsOf`. */
  options?: ColumnOption[]
  /** Inline-editable in the grid (while it is unlocked). `opportunity` = a plain
   *  Opportunity attribute patched via updateOpportunity; `custom` = a
   *  custom-field value. Everything else is read-only here. */
  editable?: 'opportunity' | 'custom'
  /** Why a standard column is NOT inline-editable (shown as its tooltip). Every
   *  standard column is either `editable` or carries a `readOnlyReason` — the
   *  explicit editable matrix, guarded by a test. */
  readOnlyReason?: string
  /** A cell may not be saved empty (Opportunity / Mission). */
  required?: boolean
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

const PROTECTED = "Protected value — changed through the bid's Protected Values / corrigendum flow"
const FROM_DEPARTMENT = "Comes from the opportunity's department — change it in Account Mapping"
const FROM_FOLLOW_UP = "Comes from the bid's open follow-up — edit it in the bid"

/** Every standard leaf column named by spec §8, in display order — and its
 *  place in the editable matrix. EDITABLE: plain Opportunity attributes (not
 *  protected, not corrigendum-tracked, no workflow) and every custom column.
 *  READ-ONLY (with the reason): ids and generated/system fields, protected or
 *  corrigendum-controlled values, workflow-controlled fields (stage, decision,
 *  ownership) and anything whose source of truth is another entity. */
export const STANDARD_COLUMNS: GridColumnMeta[] = [
  std('opportunityId', 'Opportunity ID', 'identity', 'text', { readOnlyReason: 'Generated identifier' }),
  std('opportunityName', 'Opportunity / Mission', 'identity', 'text', { editable: 'opportunity', required: true }),
  std('bidCode', 'Bid ID', 'identity', 'text', { readOnlyReason: 'Generated identifier' }),
  std('gemTenderId', 'Tender ID', 'identity', 'text', { readOnlyReason: PROTECTED }),
  std('tenderLink', 'Tender Link', 'identity', 'text', { readOnlyReason: PROTECTED }),

  std('departmentName', 'Department / Client', 'client', 'text', { readOnlyReason: FROM_DEPARTMENT }),
  std('stateCode', 'State', 'client', 'state', { readOnlyReason: FROM_DEPARTMENT }),
  std('city', 'City', 'client', 'text', { editable: 'opportunity' }),
  std('vertical', 'Sector', 'client', 'text', { editable: 'opportunity' }),

  std('ownerEmail', 'Bid Owner', 'ownership', 'text', { readOnlyReason: 'Ownership is assigned with Reassign Owner (keeps the ownership history)' }),
  std('solutionLeadEmail', 'Sales Lead / Solution Lead', 'ownership', 'text', { readOnlyReason: "Ownership is assigned in the bid's Overview (keeps the ownership history)" }),

  std('stageKey', 'Bid Stage', 'decision', 'select', { options: stageOptions, readOnlyReason: "Workflow-controlled — moves with the bid's stage actions" }),
  std('nextActionNote', 'Next Action', 'decision', 'text', { readOnlyReason: FROM_FOLLOW_UP }),
  std('nextActionAssigneeEmail', 'Action Owner', 'decision', 'text', { readOnlyReason: FROM_FOLLOW_UP }),
  std('nextActionDueDate', 'Action Due', 'decision', 'date', { readOnlyReason: FROM_FOLLOW_UP }),
  std('attentionFlag', 'Attention', 'decision', 'select', { options: ATTENTION_OPTIONS, readOnlyReason: 'Calculated from the deadline and corrigenda' }),
  std('decision', 'Decision', 'decision', 'select', { options: DECISION_OPTIONS, readOnlyReason: 'Workflow-controlled — Go / No-Go is decided in the bid' }),

  std('nextMilestoneLabel', 'Next Milestone', 'dates', 'text', { readOnlyReason: "Comes from the bid's milestones — edit them in the bid" }),
  std('daysRemaining', 'Days Remaining', 'dates', 'number', { readOnlyReason: 'Calculated from the next milestone' }),
  std('submissionDate', 'Submission Deadline', 'dates', 'date', { readOnlyReason: 'Protected deadline — edit the Submission Deadline milestone in the bid' }),

  std('documentCount', 'Tender Files', 'documents', 'number', { readOnlyReason: "Calculated from the bid's files" }),
  std('latestCorrigendumStatus', 'Latest Corrigendum', 'documents', 'select', { options: CORRIGENDUM_OPTIONS, readOnlyReason: 'Corrigendum-controlled — reviewed in the bid' }),

  std('updatedAt', 'Last Updated', 'system', 'date', { readOnlyReason: 'System field' }),
  std('updatedBy', 'Updated By', 'system', 'text', { readOnlyReason: 'System field' }),
  std('dataConfidence', 'Data Confidence', 'system', 'select', { options: CONFIDENCE_OPTIONS, readOnlyReason: 'Set by verification in the bid' }),
  std('manage', 'Manage', 'system', null, { readOnlyReason: 'Row action' }),
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
const WIDTH_BY_TYPE: Record<string, number> = {
  text: 170, number: 120, date: 130, select: 150, boolean: 110,
  currency: 140, url: 200, email: 210, phone: 150, person: 180, department: 230, state: 140, multiselect: 220,
}
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

// --- entity-backed columns ----------------------------------------------------

/** The live records behind person / department / state columns. A cell stores
 *  the record's id (state: its code); the NAME is looked up here, never copied. */
export interface EntityLookups { persons: ColumnOption[]; departments: ColumnOption[]; states: ColumnOption[] }
export const NO_LOOKUPS: EntityLookups = { persons: [], departments: [], states: [] }

export function buildLookups(input: {
  persons: { id: string; name: string }[]
  departments: { id: string; name: string; stateCode: number | null }[]
  states: { code: number; name: string }[]
}): EntityLookups {
  const stateName = new Map(input.states.map((s) => [s.code, s.name]))
  // Department names repeat across states, so a duplicate carries its state.
  const nameCount = new Map<string, number>()
  for (const d of input.departments) nameCount.set(d.name, (nameCount.get(d.name) ?? 0) + 1)
  return {
    persons: input.persons.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
    departments: input.departments.map((d) => ({
      value: d.id,
      label: (nameCount.get(d.name) ?? 0) > 1 && d.stateCode !== null && stateName.has(d.stateCode) ? `${d.name} (${stateName.get(d.stateCode)})` : d.name,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    states: input.states.map((s) => ({ value: String(s.code), label: s.name })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

/** The pick-list for a column: fixed options, or the live records for an entity type. */
export function optionsOf(col: Pick<GridColumnMeta, 'type' | 'options'> | undefined, lookups: EntityLookups = NO_LOOKUPS): ColumnOption[] {
  switch (col?.type) {
    case 'person': return lookups.persons
    case 'department': return lookups.departments
    case 'state': return lookups.states
    default: return col?.options ?? []
  }
}

/** Short names for a column's data type (badges, pickers). */
export const CUSTOM_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text', number: 'Number', date: 'Date', select: 'Select', boolean: 'Yes/No', currency: 'Amount', url: 'URL', email: 'Email',
  phone: 'Phone', person: 'Sales person', department: 'Department', state: 'State', multiselect: 'Multi-select',
}

export const isEntityType = (type: CustomFieldType | null) => !!type && ENTITY_FIELD_TYPES.includes(type)

export const isEmptyCell = (v: unknown) => v === null || v === undefined || v === ''

export function cellValue(row: BidGridRow, col: GridColumnMeta): unknown {
  if (col.custom) return row.customValues?.[col.custom.key]
  return (row as unknown as Record<string, unknown>)[col.id]
}

export const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)

/** One value as plain text, by type: what search matches, what sorting orders
 *  by for entity types, and what an export writes. Empty = ''. */
export function formatValueText(col: Pick<GridColumnMeta, 'type' | 'options'>, v: unknown, lookups: EntityLookups = NO_LOOKUPS): string {
  if (isEmptyCell(v)) return ''
  switch (col.type) {
    case 'boolean': return v ? 'Yes' : 'No'
    case 'currency': return Number.isFinite(Number(v)) ? formatCurrency(Number(v)) : String(v)
    case 'multiselect': return parseMultiValue(v).join(', ')
    case 'person': case 'department': case 'state':
      return optionsOf(col, lookups).find((o) => o.value === String(v))?.label ?? String(v)
    default: return String(v)
  }
}

/** Human text for a cell, used by quick search (and as the readable form of
 *  an enum value). Empty cells are ''. */
export function cellText(row: BidGridRow, col: GridColumnMeta, lookups: EntityLookups = NO_LOOKUPS): string {
  const v = cellValue(row, col)
  if (isEmptyCell(v)) return ''
  if (col.type === 'select') {
    const option = col.options?.find((o) => o.value === v)
    if (option) return `${option.label} ${String(v)}`
  }
  return formatValueText(col, v, lookups)
}

const SEARCHABLE: ReadonlySet<string> = new Set(['text', 'select', 'url', 'email', 'phone', 'person', 'department', 'state', 'multiselect'])

/** Quick search: a row matches when ANY visible text-like column contains the
 *  query (case-insensitive). Numbers, amounts, dates and booleans are not searched. */
export function rowMatchesSearch(row: BidGridRow, columns: GridColumnMeta[], query: string, lookups: EntityLookups = NO_LOOKUPS): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return columns.some((c) => !!c.type && SEARCHABLE.has(c.type) && cellText(row, c, lookups).toLowerCase().includes(q))
}

/** The value a column sorts by. Entity types sort by NAME (not id), a
 *  multi-select by its joined labels. */
export function sortKeyOf(row: BidGridRow, col: GridColumnMeta, lookups: EntityLookups = NO_LOOKUPS): unknown {
  const v = cellValue(row, col)
  if (isEmptyCell(v)) return undefined
  if (isEntityType(col.type) || col.type === 'multiselect') return formatValueText(col, v, lookups)
  return v
}

/** Typed comparison: numbers/amounts numerically, dates chronologically,
 *  booleans false<true, everything else case-insensitive natural order. */
export function compareTyped(type: CustomFieldType | null, a: unknown, b: unknown): number {
  switch (type) {
    case 'number': case 'currency': return Number(a) - Number(b)
    case 'date': return String(a).slice(0, 10).localeCompare(String(b).slice(0, 10))
    case 'boolean': return Number(Boolean(a)) - Number(Boolean(b))
    default: return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  }
}

// --- filters ----------------------------------------------------------------

/** A rule is applied only once it has everything its operator needs; a
 *  half-built rule in the filter editor must not blank the grid. */
export function isRuleComplete(rule: TypedFilterRule): boolean {
  if (rule.operator === 'in') return (rule.values?.length ?? 0) > 0
  if (rule.operator === 'between') return rule.value !== '' && !!rule.value2
  return rule.value !== ''
}

/** Rules that reference a custom column that is archived or unknown are
 *  ignored (not dropped) — surfaced as a notice, restored on unarchive. */
export function ignoredRules(rules: FilterNode[], columns: GridColumnMeta[]): TypedFilterRule[] {
  const known = new Set(columns.map((c) => c.id))
  return flattenRules(rules).filter((r) => r.field.startsWith(CUSTOM_COLUMN_PREFIX) && !known.has(r.field))
}

export const OPERATOR_LABEL: Record<string, string> = {
  eq: 'equals', contains: 'contains', startsWith: 'starts with', gt: 'greater than', lt: 'less than',
  between: 'between', before: 'before', after: 'after', in: 'is one of',
}
/** Boolean and entity columns read "is" rather than "equals"; multi-select reads "includes". */
export function operatorLabel(type: CustomFieldType | null, operator: string): string {
  if (type === 'multiselect') return operator === 'in' ? 'includes any of' : operator === 'eq' ? 'includes' : OPERATOR_LABEL[operator] ?? operator
  if (operator === 'eq' && (type === 'boolean' || isEntityType(type))) return 'is'
  return OPERATOR_LABEL[operator] ?? operator
}
