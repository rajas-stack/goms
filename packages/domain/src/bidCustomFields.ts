// User-defined Master Grid columns (spec §8.1): field types, key/option/value
// normalization, and the type-aware filter operators shared by the API, the
// in-memory repository and the grid, so all three filter identically.

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean'
export type CustomValue = string | number | boolean | null

export type FilterOperator = 'eq' | 'contains' | 'startsWith' | 'gt' | 'lt' | 'between' | 'before' | 'after' | 'in'

/** Structurally the persisted saved-view rule (`SystemBidViewFilterRule` in
 *  bids.ts). `eq` stays valid for every type — it is what the seven system
 *  views use — so widening the operator set never invalidates a stored rule. */
export interface TypedFilterRule {
  field: string
  operator: FilterOperator
  value: string
  value2?: string
  values?: string[]
}

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select', 'boolean']

/** Operators offered per type. `eq` is "equals" for text/number/select and
 *  the true/false test for boolean (value `'true'`/`'false'`). */
export const OPERATORS_BY_TYPE: Record<CustomFieldType, FilterOperator[]> = {
  text: ['contains', 'eq', 'startsWith'],
  number: ['eq', 'gt', 'lt', 'between'],
  date: ['before', 'after', 'between'],
  select: ['eq', 'in'],
  boolean: ['eq'],
}

/** Filterable standard grid columns and their types. Anything not listed is
 *  treated as text. */
export const STANDARD_BID_FIELD_TYPES: Record<string, CustomFieldType> = {
  opportunityName: 'text',
  gemTenderId: 'text',
  vertical: 'text',
  ownerEmail: 'text',
  stageKey: 'select',
  decision: 'select',
  attentionFlag: 'select',
  dataConfidence: 'select',
  status: 'select',
  submissionDate: 'date',
  valueAmount: 'number',
  emdAmount: 'number',
  opportunityId: 'text',
  bidCode: 'text',
  tenderLink: 'text',
  departmentName: 'text',
  city: 'text',
  stateCode: 'number',
  solutionLeadEmail: 'text',
  nextActionNote: 'text',
  nextActionAssigneeEmail: 'text',
  nextActionDueDate: 'date',
  nextMilestoneLabel: 'text',
  daysRemaining: 'number',
  documentCount: 'number',
  latestCorrigendumStatus: 'select',
  updatedBy: 'text',
  updatedAt: 'date',
}

export const CUSTOM_FIELD_PREFIX = 'custom:'
const MAX_KEY_LENGTH = 48
const MAX_TEXT_LENGTH = 2000
const MAX_OPTION_LENGTH = 80
const MAX_OPTIONS = 100

/** Slug for a new field's immutable `key`: lowercase, non-alphanumerics → `_`,
 *  starts with a letter, ≤48 chars, deduped against `taken` with `_2`, `_3`… */
export function slugifyFieldKey(name: string, taken: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) base = 'field'
  if (!/^[a-z]/.test(base)) base = `f_${base}`
  base = base.slice(0, 44).replace(/_+$/, '')
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`.slice(0, MAX_KEY_LENGTH)
  return key
}

/** Trims, drops blanks, dedupes case-insensitively (first spelling wins). */
export function normalizeOptions(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const option = item.trim()
    if (!option) continue
    if (option.length > MAX_OPTION_LENGTH) throw new Error(`An option can be at most ${MAX_OPTION_LENGTH} characters.`)
    const folded = option.toLowerCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(option)
  }
  if (!out.length) throw new Error('A select column needs at least one option.')
  if (out.length > MAX_OPTIONS) throw new Error(`A select column can have at most ${MAX_OPTIONS} options.`)
  return out
}

function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** Validates and normalizes one cell value for a field of `type`. Empty
 *  (`null`/`undefined`/blank) → `null`, which callers treat as "clear".
 *  Throws an `Error` with a user-facing message on invalid input. */
export function coerceCustomValue(type: CustomFieldType, raw: unknown, options?: string[] | null): CustomValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  switch (type) {
    case 'text': {
      const text = String(raw).trim()
      if (text.length > MAX_TEXT_LENGTH) throw new Error(`Text can be at most ${MAX_TEXT_LENGTH} characters.`)
      return text
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && NUMBER_PATTERN.test(raw.trim()) ? Number(raw.trim()) : NaN
      if (!Number.isFinite(n)) throw new Error('Enter a valid number.')
      return n
    }
    case 'date': {
      if (typeof raw !== 'string' || !isRealIsoDate(raw.trim())) throw new Error('Enter a valid date (YYYY-MM-DD).')
      return raw.trim()
    }
    case 'boolean': {
      if (raw === true || raw === 'true') return true
      if (raw === false || raw === 'false') return false
      throw new Error('Enter true or false.')
    }
    case 'select': {
      const value = String(raw)
      if (!options?.includes(value)) throw new Error(`"${value}" is not one of this column's options.`)
      return value
    }
  }
}

function isoDatePart(v: unknown): string | null {
  const s = String(v).slice(0, 10)
  return isRealIsoDate(s) ? s : null
}

/** One typed rule against one cell value. An empty cell never matches; an
 *  operator not valid for the type never matches (`eq` is valid for all). */
export function matchesTypedRule(
  type: CustomFieldType,
  cell: unknown,
  rule: Pick<TypedFilterRule, 'operator' | 'value2' | 'values'>,
  target: string,
): boolean {
  if (cell === null || cell === undefined || cell === '') return false
  if (rule.operator !== 'eq' && !OPERATORS_BY_TYPE[type].includes(rule.operator)) return false

  switch (type) {
    case 'text':
    case 'select': {
      const s = String(cell)
      switch (rule.operator) {
        case 'eq': return s === target
        case 'contains': return s.toLowerCase().includes(target.toLowerCase())
        case 'startsWith': return s.toLowerCase().startsWith(target.toLowerCase())
        case 'in': return !!rule.values?.includes(s)
        default: return false
      }
    }
    case 'boolean':
      return String(cell) === target
    case 'number': {
      const n = Number(cell)
      const a = Number(target)
      if (!Number.isFinite(n) || !Number.isFinite(a)) return false
      if (rule.operator === 'eq') return n === a
      if (rule.operator === 'gt') return n > a
      if (rule.operator === 'lt') return n < a
      if (rule.operator === 'between') {
        const b = Number(rule.value2)
        if (rule.value2 === undefined || rule.value2 === '' || !Number.isFinite(b)) return false
        return n >= Math.min(a, b) && n <= Math.max(a, b)
      }
      return false
    }
    case 'date': {
      const d = isoDatePart(cell)
      const a = isoDatePart(target)
      if (!d || !a) return false
      if (rule.operator === 'eq') return d === a
      if (rule.operator === 'before') return d < a
      if (rule.operator === 'after') return d > a
      if (rule.operator === 'between') {
        const b = rule.value2 === undefined ? null : isoDatePart(rule.value2)
        if (!b) return false
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        return d >= lo && d <= hi
      }
      return false
    }
  }
}
