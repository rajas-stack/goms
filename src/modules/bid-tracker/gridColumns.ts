// The Master Grid's column model (spec §8, §8.1): the seven required column
// groups as a static registry, plus the user-defined Custom group built
// dynamically from the custom-field definitions. Every column — standard or
// custom — is described by the same `GridColumnMeta`, so sorting, filtering,
// search, visibility/order and saved views all work off one shape.
import {
  BID_STAGES, ENTITY_FIELD_TYPES, OPPORTUNITY_TYPES, flattenRules, parseMultiValue,
  type CustomFieldType, type FilterNode, type TypedFilterRule,
} from '@goms/domain'
import type { BidCustomField, BidGridRow, DeliveryTeamKey, DeliveryTeamMember } from '@/lib/types'

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

export interface ColumnOption {
  value: string
  label: string
  /** A person's official email (the Bid Owner column stores emails). */
  email?: string
  /** Set on person options so grid cells and pickers can show the face beside the name. */
  photoUrl?: string | null
  isPerson?: boolean
}

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
   *  custom-field value. `department` re-points the opportunity (and its state);
   *  `solutionLead` records a new Sales/Solution Lead assignment; `nextAction`
   *  replaces the bid's open follow-up; `verify` marks the bid verified.
   *  Everything else is read-only here. */
  editable?: 'opportunity' | 'custom' | 'owner' | 'bid' | 'department' | 'solutionLead' | 'nextAction' | 'verify'
  /** Pick-list source when the cell's stored value is not what the list shows:
   *  `personByEmail` = Sales Team by email (the list shows names); `department` = live departments by id. */
  pick?: 'personByEmail' | 'department'
  /** Row field the editor reads when it differs from the displayed one (Department / Client edits `departmentId`). */
  editKey?: keyof BidGridRow
  /** Read-only by default, but a user may unlock the column (per sheet) to edit it through this
   *  write path. Interim per-browser switch until role-based access decides who may. */
  unlockable?: 'opportunity'
  /** Roster source for a role assignment person field. */
  teamKey?: 'sales' | DeliveryTeamKey
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
export const OPPORTUNITY_TYPE_OPTIONS: ColumnOption[] = OPPORTUNITY_TYPES.map((t) => ({ value: t, label: t }))
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
  std('opportunityType', 'Opportunity Type', 'identity', 'select', { options: OPPORTUNITY_TYPE_OPTIONS, editable: 'opportunity' }),
  std('bidCode', 'Bid ID', 'identity', 'text', { readOnlyReason: 'Generated identifier' }),
  // Unlockable: the opportunity update still refuses a value frozen by the Protected Values flow.
  std('gemTenderId', 'Tender ID', 'identity', 'text', { readOnlyReason: PROTECTED, unlockable: 'opportunity' }),
  // Edits go through bids.update, which refuses a frozen (protected) value with its own message.
  std('tenderLink', 'Tender Link', 'identity', 'text', { editable: 'bid' }),

  // Picking a department also moves the opportunity's State to that department's.
  std('departmentName', 'Department / Client', 'client', 'text', { editable: 'department', pick: 'department', editKey: 'departmentId', required: true }),
  std('stateCode', 'State', 'client', 'state', { readOnlyReason: FROM_DEPARTMENT, unlockable: 'opportunity' }),
  std('city', 'City', 'client', 'text', { editable: 'opportunity' }),
  std('vertical', 'Sector', 'client', 'text', { editable: 'opportunity' }),

  // Picking a person records a new ownership assignment (the history is kept), same as Reassign Owner.
  std('geoSalesPersonId', 'Geo-sales', 'ownership', 'person', { editable: 'opportunity', teamKey: 'sales' }),
  std('buSalesPersonId', 'BU-sales', 'ownership', 'person', { editable: 'opportunity', teamKey: 'sales' }),
  std('preSalesPersonId', 'Pre-sales', 'ownership', 'person', { editable: 'opportunity', teamKey: 'preSales' }),
  std('legalPersonId', 'Legal', 'ownership', 'person', { editable: 'opportunity', teamKey: 'legal' }),
  std('bidTeamMemberId', 'Bid', 'ownership', 'person', { editable: 'opportunity', teamKey: 'bid' }),
  std('ownerEmail', 'Bid Owner', 'ownership', 'text', { editable: 'owner', pick: 'personByEmail', required: true }),
  // Like Bid Owner: ends the current lead and records the new one (history kept).
  std('solutionLeadEmail', 'Sales Lead / Solution Lead', 'ownership', 'text', { editable: 'solutionLead', pick: 'personByEmail' }),

  // Stage and Decision change through bids.update, which enforces the stage / Go rules.
  std('stageKey', 'Bid Stage', 'decision', 'select', { options: stageOptions, editable: 'bid', required: true }),
  // The three Next Action columns edit the bid's open follow-up (replaced, so its history stays).
  std('nextActionNote', 'Next Action', 'decision', 'text', { editable: 'nextAction' }),
  std('nextActionAssigneeEmail', 'Action Owner', 'decision', 'text', { editable: 'nextAction', pick: 'personByEmail' }),
  std('nextActionDueDate', 'Action Due', 'decision', 'date', { editable: 'nextAction' }),
  std('attentionFlag', 'Attention', 'decision', 'select', { options: ATTENTION_OPTIONS, readOnlyReason: 'Calculated from the deadline and corrigenda' }),
  std('decision', 'Decision', 'decision', 'select', { options: DECISION_OPTIONS, editable: 'bid', required: true }),

  std('nextMilestoneLabel', 'Next Milestone', 'dates', 'text', { readOnlyReason: "Comes from the bid's milestones — edit them in the bid" }),
  std('daysRemaining', 'Days Remaining', 'dates', 'number', { readOnlyReason: 'Calculated from the next milestone' }),
  std('submissionDate', 'Submission Deadline', 'dates', 'date', { readOnlyReason: 'Protected deadline — edit the Submission Deadline milestone in the bid' }),

  std('documentCount', 'Tender Files', 'documents', 'number', { readOnlyReason: "Calculated from the bid's files" }),
  std('latestCorrigendumStatus', 'Latest Corrigendum', 'documents', 'select', { options: CORRIGENDUM_OPTIONS, readOnlyReason: 'Corrigendum-controlled — reviewed in the bid' }),

  std('updatedAt', 'Last Updated', 'system', 'date', { readOnlyReason: 'System field' }),
  std('updatedBy', 'Updated By', 'system', 'text', { readOnlyReason: 'System field' }),
  // Only "Verified" can be chosen by hand; Needs Review is set by corrigenda and imports.
  std('dataConfidence', 'Data Confidence', 'system', 'select', { options: CONFIDENCE_OPTIONS, editable: 'verify', required: true }),
  std('manage', 'Manage', 'system', null, { readOnlyReason: 'Row action' }),
]

/** Fixed pixel widths. The grid is a `table-layout: fixed` sheet: with auto
 *  layout the browser re-measures every column as rows scroll in and out of the
 *  virtualized window, so columns would jitter sideways while scrolling. */
const WIDTH_BY_ID: Record<string, number> = {
  opportunityId: 260, opportunityName: 280, opportunityType: 150, bidCode: 120, gemTenderId: 190, tenderLink: 100,
  departmentName: 240, stateCode: 130, city: 130, vertical: 140,
  geoSalesPersonId: 180, buSalesPersonId: 180, preSalesPersonId: 180, legalPersonId: 180, bidTeamMemberId: 180,
  ownerEmail: 210, solutionLeadEmail: 230,
  stageKey: 150, nextActionNote: 220, nextActionAssigneeEmail: 210, nextActionDueDate: 120, attentionFlag: 170, decision: 110,
  nextMilestoneLabel: 180, daysRemaining: 130, submissionDate: 160, documentCount: 110, latestCorrigendumStatus: 170,
  updatedAt: 150, updatedBy: 170, dataConfidence: 150, manage: 130,
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

const HIDDEN_COLUMN_PREFIX = '~hidden:'

export function columnIdFromOrderToken(token: string): string {
  return token.startsWith(HIDDEN_COLUMN_PREFIX) ? token.slice(HIDDEN_COLUMN_PREFIX.length) : token
}

export function isHiddenColumnOrderToken(token: string): boolean {
  return token.startsWith(HIDDEN_COLUMN_PREFIX)
}

/** Full stable order encoded in the existing saved-view column array. Legacy
 *  lists contain only shown ids; missing ids become hidden markers at the end.
 *  Newer lists retain hidden ids in place so toggling visibility cannot move
 *  columns. Unknown ids are preserved for other Master Grid scopes and ignored
 *  when the current scope resolves its actual columns. */
export function orderedColumnIds(all: GridColumnMeta[], saved: string[] | undefined): string[] {
  if (!saved?.length) return all.map((column) => column.id)
  const known = new Set(all.map((column) => column.id))
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const token of saved) {
    const id = columnIdFromOrderToken(token)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ordered.push(token)
  }
  for (const column of all) {
    if (seen.has(column.id)) continue
    seen.add(column.id)
    ordered.push(known.has(column.id) ? `${HIDDEN_COLUMN_PREFIX}${column.id}` : column.id)
  }
  return ordered
}

export function setColumnVisibility(all: GridColumnMeta[], saved: string[] | undefined, id: string, shown: boolean): string[] {
  return orderedColumnIds(all, saved).map((token) => {
    if (columnIdFromOrderToken(token) !== id) return token
    return shown ? id : `${HIDDEN_COLUMN_PREFIX}${id}`
  })
}

export function showAllColumnIds(all: GridColumnMeta[], saved: string[] | undefined): string[] {
  const currentIds = new Set(all.map((column) => column.id))
  return orderedColumnIds(all, saved).map((token) => {
    const id = columnIdFromOrderToken(token)
    return currentIds.has(id) ? id : token
  })
}

/** `visibleColumns` persists the full order using hidden markers; legacy arrays
 *  remain compatible. `undefined`/empty = default: every column, canonical
 *  order. */
export function resolveVisibleColumns(all: GridColumnMeta[], visibleColumns: string[] | undefined): GridColumnMeta[] {
  if (!visibleColumns || visibleColumns.length === 0) return all
  const byId = new Map(all.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: GridColumnMeta[] = []
  for (const token of orderedColumnIds(all, visibleColumns)) {
    if (isHiddenColumnOrderToken(token)) continue
    const id = columnIdFromOrderToken(token)
    const col = byId.get(id)
    if (col && !seen.has(id)) { seen.add(id); out.push(col) }
  }
  return out
}

// --- entity-backed columns ----------------------------------------------------

/** The live records behind person / department / state columns. A cell stores
 *  the record's id (state: its code); the NAME is looked up here, never copied. */
export interface EntityLookups {
  persons: ColumnOption[]
  deliveryTeamNames: Record<DeliveryTeamKey, ColumnOption[]>
  deliveryTeams: Record<DeliveryTeamKey, ColumnOption[]>
  departments: ColumnOption[]
  states: ColumnOption[]
}
export const NO_LOOKUPS: EntityLookups = {
  persons: [], deliveryTeamNames: { preSales: [], legal: [], bid: [] },
  deliveryTeams: { preSales: [], legal: [], bid: [] }, departments: [], states: [],
}

export function buildLookups(input: {
  persons: { id: string; name: string; officialEmail?: string; photoUrl?: string | null }[]
  deliveryTeamMembers?: DeliveryTeamMember[]
  departments: { id: string; name: string; stateCode: number | null }[]
  states: { code: number; name: string }[]
}): EntityLookups {
  const stateName = new Map(input.states.map((s) => [s.code, s.name]))
  // Department names repeat across states, so a duplicate carries its state.
  const nameCount = new Map<string, number>()
  for (const d of input.departments) nameCount.set(d.name, (nameCount.get(d.name) ?? 0) + 1)
  const members = (team: DeliveryTeamKey, activeOnly: boolean): ColumnOption[] =>
    input.deliveryTeamMembers
      ?.filter((member) => member.team === team && (!activeOnly || member.status === 'active'))
      .map((member) => ({ value: member.id, label: member.name, email: member.email || undefined, isPerson: true })) ?? []
  return {
    persons: input.persons
      .map((p) => ({ value: p.id, label: p.name, email: p.officialEmail, photoUrl: p.photoUrl ?? null, isPerson: true }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    deliveryTeamNames: { preSales: members('preSales', false), legal: members('legal', false), bid: members('bid', false) },
    deliveryTeams: { preSales: members('preSales', true), legal: members('legal', true), bid: members('bid', true) },
    departments: input.departments.map((d) => ({
      value: d.id,
      label: (nameCount.get(d.name) ?? 0) > 1 && d.stateCode !== null && stateName.has(d.stateCode) ? `${d.name} (${stateName.get(d.stateCode)})` : d.name,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    states: input.states.map((s) => ({ value: String(s.code), label: s.name })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

/** The pick-list for a column: fixed options, or the live records for an entity type. */
export function optionsOf(col: Pick<GridColumnMeta, 'type' | 'options' | 'teamKey'> & { pick?: GridColumnMeta['pick'] } | undefined, lookups: EntityLookups = NO_LOOKUPS): ColumnOption[] {
  if (col?.pick === 'personByEmail') return lookups.persons.filter((p) => p.email).map((p) => ({ ...p, value: p.email! }))
  if (col?.pick === 'department') return lookups.departments
  if (col?.teamKey) return col.teamKey === 'sales' ? lookups.persons : lookups.deliveryTeams[col.teamKey]
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
  // The Opportunity ID column shows the human-readable code (the raw id only for
  // a row that has none yet) — so search, sort and export all work on the code.
  if (col.id === 'opportunityId') return row.opportunityCode || row.opportunityId
  return (row as unknown as Record<string, unknown>)[col.id]
}

/** The value an inline editor starts from — `editKey` when the cell displays something derived. */
export function editValue(row: BidGridRow, col: GridColumnMeta): unknown {
  return col.editKey ? row[col.editKey] : cellValue(row, col)
}

export const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)

/** One value as plain text, by type: what search matches, what sorting orders
 *  by for entity types, and what an export writes. Empty = ''. */
/** The person a cell points at (by id, or by email for Bid Owner / Lead / Action Owner),
 *  or null when the column isn't a person column or the value is empty. Unknown ids/emails
 *  still render as a person with the raw value as the name. */
export function personOf(col: GridColumnMeta, v: unknown, lookups: EntityLookups = NO_LOOKUPS): { name: string; photoUrl: string | null } | null {
  if (isEmptyCell(v)) return null
  const byEmail = col.pick === 'personByEmail' || col.id === 'updatedBy'
  if (!byEmail && col.type !== 'person') return null
  const value = String(v)
  const pool = col.teamKey && col.teamKey !== 'sales' ? lookups.deliveryTeamNames[col.teamKey] : lookups.persons
  const match = byEmail
    ? lookups.persons.find((p) => p.email?.toLowerCase() === value.toLowerCase())
    : pool.find((p) => p.value === value)
  return { name: match?.label ?? value, photoUrl: match?.photoUrl ?? null }
}

export function formatValueText(col: Pick<GridColumnMeta, 'type' | 'options' | 'teamKey'>, v: unknown, lookups: EntityLookups = NO_LOOKUPS): string {
  if (isEmptyCell(v)) return ''
  if (col.teamKey && col.teamKey !== 'sales') {
    return lookups.deliveryTeamNames[col.teamKey].find((option) => option.value === String(v))?.label ?? String(v)
  }
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
