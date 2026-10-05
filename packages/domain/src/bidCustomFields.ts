// User-defined Master Grid columns (spec §8.1): field types, key/option/value
// normalization, and the type-aware filter operators shared by the API, the
// in-memory repository and the grid, so all three filter identically.

export type CustomFieldType =
  | 'text' | 'number' | 'date' | 'select' | 'boolean'
  | 'currency' | 'url' | 'email' | 'phone' | 'person' | 'department' | 'state' | 'multiselect'
/** What a cell holds on the wire. `person` / `department` hold the entity's id,
 *  `state` its numeric code (never a duplicated name); `multiselect` holds a
 *  JSON array string (see `parseMultiValue`). */
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

/** A parenthesised set of conditions joined by one connective. Nesting is
 *  evaluated recursively; the Master Grid UI builds one level (a group of
 *  rules inside the top-level list). */
export interface FilterGroup {
  logic: 'and' | 'or'
  rules: FilterNode[]
}
export type FilterNode = TypedFilterRule | FilterGroup

export const isFilterGroup = (node: FilterNode): node is FilterGroup =>
  'logic' in node && Array.isArray((node as FilterGroup).rules)

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  'text', 'number', 'date', 'select', 'boolean',
  'currency', 'url', 'email', 'phone', 'person', 'department', 'state', 'multiselect',
]

/** Entity-backed types: the value is a reference to an existing GOMS record. */
export const ENTITY_FIELD_TYPES: CustomFieldType[] = ['person', 'department', 'state']
/** Types whose column needs a fixed option list. */
export const hasOptions = (type: CustomFieldType) => type === 'select' || type === 'multiselect'

/** Which of the four typed storage columns a type lives in. */
export type StorageKind = 'text' | 'number' | 'date' | 'boolean'
export function storageKind(type: CustomFieldType): StorageKind {
  switch (type) {
    case 'number': case 'currency': case 'state': return 'number'
    case 'date': return 'date'
    case 'boolean': return 'boolean'
    default: return 'text'
  }
}

/** Multi-select values are stored as a JSON array string; tolerant of junk. */
export function parseMultiValue(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return [] }
}

/** Operators offered per type. `eq` is "equals" for text/number/select and
 *  the true/false test for boolean (value `'true'`/`'false'`). */
export const OPERATORS_BY_TYPE: Record<CustomFieldType, FilterOperator[]> = {
  text: ['contains', 'eq', 'startsWith'],
  number: ['eq', 'gt', 'lt', 'between'],
  date: ['before', 'after', 'between'],
  select: ['eq', 'in'],
  boolean: ['eq'],
  currency: ['eq', 'gt', 'lt', 'between'],
  url: ['contains', 'eq', 'startsWith'],
  email: ['contains', 'eq', 'startsWith'],
  phone: ['contains', 'eq', 'startsWith'],
  person: ['eq', 'in'],
  department: ['eq', 'in'],
  state: ['eq', 'in'],
  multiselect: ['eq', 'in'],
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
  valueAmount: 'currency',
  emdAmount: 'currency',
  opportunityId: 'text',
  opportunityType: 'select',
  bidCode: 'text',
  tenderLink: 'text',
  departmentName: 'text',
  city: 'text',
  stateCode: 'state',
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
  sheet: 'select',
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
    case 'currency': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim().replace(/[,₹\s]/g, '')) : NaN
      if (!Number.isFinite(n)) throw new Error('Enter a valid amount.')
      if (n < 0) throw new Error('An amount cannot be negative.')
      if (n > 1e15) throw new Error('That amount is too large.')
      return Math.round(n * 100) / 100
    }
    case 'url': {
      let text = String(raw).trim()
      if (text.length > MAX_TEXT_LENGTH) throw new Error(`A URL can be at most ${MAX_TEXT_LENGTH} characters.`)
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`
      let ok = false
      try {
        const u = new URL(text)
        ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
      } catch { ok = false }
      if (!ok) throw new Error('Enter a valid web address (https://…).')
      return text
    }
    case 'email': {
      const text = String(raw).trim().toLowerCase()
      if (text.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) throw new Error('Enter a valid email address.')
      return text
    }
    case 'phone': {
      const text = String(raw).trim().replace(/[\s().-]/g, '')
      if (!/^\+?\d{7,15}$/.test(text)) throw new Error('Enter a valid phone number (7–15 digits, optional +).')
      return text
    }
    case 'person':
    case 'department': {
      const id = String(raw).trim()
      if (id.length > 64) throw new Error('Choose a value from the list.')
      return id
    }
    case 'state': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN
      if (!Number.isInteger(n) || n < 0) throw new Error('Choose a state from the list.')
      return n
    }
    case 'multiselect': {
      const chosen = parseMultiValue(raw)
      const bad = chosen.find((v) => !options?.includes(v))
      if (bad !== undefined) throw new Error(`"${bad}" is not one of this column's options.`)
      const ordered = (options ?? []).filter((o) => chosen.includes(o))
      return ordered.length ? JSON.stringify(ordered) : null
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
    case 'multiselect': {
      const have = parseMultiValue(cell)
      if (rule.operator === 'eq') return have.includes(target)
      if (rule.operator === 'in') return !!rule.values?.some((v) => have.includes(v))
      return false
    }
    case 'person':
    case 'department':
    case 'state': {
      const s = String(cell)
      if (rule.operator === 'eq') return s === target
      if (rule.operator === 'in') return !!rule.values?.includes(s)
      return false
    }
    case 'url':
    case 'email':
    case 'phone':
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
    case 'currency':
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

// --- filter tree helpers ----------------------------------------------------

/** Every rule in the tree, depth-first. */
export function flattenRules(nodes: FilterNode[]): TypedFilterRule[] {
  return nodes.flatMap((n) => (isFilterGroup(n) ? flattenRules(n.rules) : [n]))
}

/** Keeps the rules `keep` accepts; a group that ends up empty is dropped, and a
 *  group of one collapses into that rule (same meaning, simpler to read). */
export function pruneFilterNodes(nodes: FilterNode[], keep: (rule: TypedFilterRule) => boolean): FilterNode[] {
  const out: FilterNode[] = []
  for (const n of nodes) {
    if (!isFilterGroup(n)) { if (keep(n)) out.push(n); continue }
    const rules = pruneFilterNodes(n.rules, keep)
    if (rules.length === 1) out.push(rules[0])
    else if (rules.length > 1) out.push({ logic: n.logic, rules })
  }
  return out
}

/** Applies `fn` to every rule, keeping the tree's shape. */
export function mapFilterRules(nodes: FilterNode[], fn: (rule: TypedFilterRule) => TypedFilterRule): FilterNode[] {
  return nodes.map((n) => (isFilterGroup(n) ? { logic: n.logic, rules: mapFilterRules(n.rules, fn) } : fn(n)))
}
