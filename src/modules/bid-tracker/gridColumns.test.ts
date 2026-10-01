import { describe, expect, it } from 'vitest'
import { OPERATORS_BY_TYPE } from '@goms/domain'
import type { BidCustomField, BidGridRow } from '@/lib/types'
import {
  CUSTOM_GROUP, GRID_GROUPS, STANDARD_COLUMNS, buildLookups, compareTyped, customColumnMeta, formatValueText, ignoredRules,
  isRuleComplete, operatorLabel, optionsOf, resolveColumns, resolveVisibleColumns, rowMatchesSearch, sortKeyOf,
} from './gridColumns'

const field = (over: Partial<BidCustomField> & Pick<BidCustomField, 'key' | 'name' | 'dataType'>): BidCustomField => ({
  id: `id-${over.key}`, options: null, hasHeldValue: false, position: 0, status: 'active', createdBy: null, updatedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})

// The guard against a future edit silently dropping a required column (spec §8).
describe('grid column registry — completeness', () => {
  it('has exactly the seven required groups, in spec order', () => {
    expect(GRID_GROUPS.map((g) => g.label)).toEqual(['Identity', 'Client', 'Ownership', 'Decision', 'Dates', 'Documents', 'System'])
    // The Custom group is separate: it follows the seven and only exists with custom columns.
    expect(GRID_GROUPS.some((g) => g.id === CUSTOM_GROUP.id)).toBe(false)
  })

  it('names every required leaf column under its own group', () => {
    const byGroup = (id: string) => STANDARD_COLUMNS.filter((c) => c.group === id).map((c) => c.header)
    expect(byGroup('identity')).toEqual(['Opportunity ID', 'Opportunity / Mission', 'Bid ID', 'Tender ID', 'Tender Link'])
    expect(byGroup('client')).toEqual(['Department / Client', 'State', 'City', 'Sector'])
    expect(byGroup('ownership')).toEqual(['Bid Owner', 'Sales Lead / Solution Lead'])
    expect(byGroup('decision')).toEqual(['Bid Stage', 'Next Action', 'Action Owner', 'Action Due', 'Attention', 'Decision'])
    expect(byGroup('dates')).toEqual(['Next Milestone', 'Days Remaining', 'Submission Deadline'])
    expect(byGroup('documents')).toEqual(['Tender Files', 'Latest Corrigendum'])
    expect(byGroup('system')).toEqual(['Last Updated', 'Updated By', 'Data Confidence', 'Manage'])
    expect(STANDARD_COLUMNS).toHaveLength(26)
  })

  it('binds City and Action Owner to the row fields the API provides', () => {
    const ids = STANDARD_COLUMNS.map((c) => c.id)
    expect(ids).toContain('city')
    expect(ids).toContain('nextActionAssigneeEmail')
    expect(new Set(ids).size).toBe(ids.length) // ids are unique (they double as filter fields)
  })

  it('every data column has a type whose operators exist; only Manage has none', () => {
    for (const c of STANDARD_COLUMNS) {
      if (c.id === 'manage') expect(c.type).toBeNull()
      else expect(OPERATORS_BY_TYPE[c.type!]).toBeDefined()
      if (c.type === 'select') expect(c.options?.length).toBeGreaterThan(0)
    }
  })

  it('only plain opportunity attributes are inline-editable among the standard columns', () => {
    expect(STANDARD_COLUMNS.filter((c) => c.editable).map((c) => c.id)).toEqual(['opportunityName', 'tenderLink', 'city', 'vertical', 'ownerEmail', 'stageKey', 'decision'])
  })

  // The explicit editable matrix: no standard column is left unclassified.
  it('classifies every standard column as editable or read-only-with-a-reason', () => {
    for (const c of STANDARD_COLUMNS) {
      if (c.editable) expect(c.readOnlyReason, c.id).toBeUndefined()
      else expect(c.readOnlyReason, c.id).toBeTruthy()
    }
  })

  it('keeps ids, protected deadline, derived and system columns read-only', () => {
    const readOnly = (id: string) => !STANDARD_COLUMNS.find((c) => c.id === id)!.editable
    for (const id of [
      'opportunityId', 'bidCode', 'gemTenderId', 'submissionDate',
      'solutionLeadEmail', 'departmentName', 'stateCode', 'nextActionNote', 'nextMilestoneLabel', 'daysRemaining',
      'documentCount', 'latestCorrigendumStatus', 'updatedAt', 'updatedBy', 'dataConfidence', 'attentionFlag', 'manage',
    ]) expect(readOnly(id), id).toBe(true)
  })

  it('makes the Opportunity / Mission name required when edited', () => {
    expect(STANDARD_COLUMNS.find((c) => c.id === 'opportunityName')).toMatchObject({ editable: 'opportunity', required: true })
  })
})

describe('custom columns', () => {
  it('build dynamically from active definitions, by position, after the standard columns', () => {
    const cols = resolveColumns([
      field({ key: 'b', name: 'B', dataType: 'text', position: 1 }),
      field({ key: 'a', name: 'A', dataType: 'number', position: 0 }),
      field({ key: 'gone', name: 'Gone', dataType: 'text', position: 2, status: 'archived' }),
    ])
    expect(cols.slice(0, STANDARD_COLUMNS.length)).toEqual(STANDARD_COLUMNS)
    const custom = cols.slice(STANDARD_COLUMNS.length)
    expect(custom.map((c) => c.id)).toEqual(['custom:a', 'custom:b'])
    expect(custom.every((c) => c.group === 'custom' && c.editable === 'custom')).toBe(true)
  })

  it('a select column carries the definition options; a rename changes the header but not the id', () => {
    const f = field({ key: 'tier', name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
    expect(customColumnMeta(f).options).toEqual([{ value: 'Gold', label: 'Gold' }, { value: 'Silver', label: 'Silver' }])
    const renamed = customColumnMeta({ ...f, name: 'Level' })
    expect([renamed.id, renamed.header]).toEqual(['custom:tier', 'Level'])
  })
})

describe('visible columns (ordered list)', () => {
  const all = resolveColumns([field({ key: 'score', name: 'Score', dataType: 'number' })])
  it('undefined or empty means everything, in canonical order', () => {
    expect(resolveVisibleColumns(all, undefined)).toEqual(all)
    expect(resolveVisibleColumns(all, [])).toEqual(all)
  })
  it('array order is display order, absence is hidden, unknown and duplicate ids are dropped', () => {
    const out = resolveVisibleColumns(all, ['custom:score', 'bidCode', 'custom:gone', 'bidCode'])
    expect(out.map((c) => c.id)).toEqual(['custom:score', 'bidCode'])
  })
})

describe('filter rules and search helpers', () => {
  it('a rule is complete only when its operator has what it needs', () => {
    expect(isRuleComplete({ field: 'a', operator: 'eq', value: '' })).toBe(false)
    expect(isRuleComplete({ field: 'a', operator: 'eq', value: 'x' })).toBe(true)
    expect(isRuleComplete({ field: 'a', operator: 'between', value: '1' })).toBe(false)
    expect(isRuleComplete({ field: 'a', operator: 'between', value: '1', value2: '2' })).toBe(true)
    expect(isRuleComplete({ field: 'a', operator: 'in', value: '' })).toBe(false)
    expect(isRuleComplete({ field: 'a', operator: 'in', value: '', values: ['x'] })).toBe(true)
  })

  it('flags only rules on archived/unknown custom columns as ignored', () => {
    const cols = resolveColumns([field({ key: 'score', name: 'Score', dataType: 'number' })])
    const rules = [
      { field: 'custom:score', operator: 'gt' as const, value: '1' },
      { field: 'custom:gone', operator: 'eq' as const, value: 'x' },
      { field: 'stageKey', operator: 'eq' as const, value: 'solutioning' },
    ]
    expect(ignoredRules(rules, cols)).toEqual([rules[1]])
  })

  it('quick search covers text and select columns only, and only the given (visible) columns', () => {
    const cols = resolveColumns([field({ key: 'note', name: 'Note', dataType: 'text' })])
    const row = { opportunityName: 'Smart Bus', valueAmount: '999', stageKey: 'qualification', customValues: { note: 'Fast Track' } } as unknown as BidGridRow
    expect(rowMatchesSearch(row, cols, 'smart')).toBe(true)
    expect(rowMatchesSearch(row, cols, 'fast')).toBe(true)
    expect(rowMatchesSearch(row, cols, 'Qualification')).toBe(true) // select: matches its label
    expect(rowMatchesSearch(row, cols, '999')).toBe(false) // numbers are not searched
    expect(rowMatchesSearch(row, cols.filter((c) => c.id === 'opportunityName'), 'fast')).toBe(false) // hidden column
    expect(rowMatchesSearch(row, cols, '   ')).toBe(true)
  })
})

describe('typed columns — entity lookups, display, sort, search', () => {
  const lookups = buildLookups({
    persons: [{ id: 'p-1', name: 'Shubham' }, { id: 'p-2', name: 'Asha Rao' }],
    departments: [
      { id: 'd-1', name: 'Health', stateCode: 24 }, { id: 'd-2', name: 'Health', stateCode: 27 }, { id: 'd-3', name: 'MeitY', stateCode: 0 },
    ],
    states: [{ code: 24, name: 'Gujarat' }, { code: 27, name: 'Maharashtra' }],
  })
  const col = (dataType: BidCustomField['dataType'], options?: string[]) => customColumnMeta(field({ key: 'x', name: 'X', dataType, options: options ?? null }))
  const row = (v: unknown) => ({ customValues: { x: v } }) as unknown as BidGridRow

  it('lists people and departments by name; a repeated department name carries its state', () => {
    expect(lookups.persons.map((o) => o.label)).toEqual(['Asha Rao', 'Shubham'])
    expect(lookups.departments.map((o) => o.label)).toEqual(['Health (Gujarat)', 'Health (Maharashtra)', 'MeitY'])
    expect(optionsOf(col('state'), lookups).map((o) => o.label)).toEqual(['Gujarat', 'Maharashtra'])
  })

  it('shows entity cells by name, never the stored id', () => {
    expect(formatValueText(col('person'), 'p-1', lookups)).toBe('Shubham')
    expect(formatValueText(col('state'), 27, lookups)).toBe('Maharashtra')
    expect(formatValueText(col('department'), 'd-9', lookups)).toBe('d-9') // unknown record: id, not blank
  })

  it('formats amounts in rupees and multi-selects as a list', () => {
    expect(formatValueText(col('currency'), 500000)).toBe('₹5,00,000')
    expect(formatValueText(col('multiselect', ['A', 'B']), '["A","B"]')).toBe('A, B')
    expect(formatValueText(col('boolean'), true)).toBe('Yes')
  })

  it('sorts entity columns by NAME and amounts numerically', () => {
    expect(sortKeyOf(row('p-1'), col('person'), lookups)).toBe('Shubham')
    expect(sortKeyOf(row(undefined), col('person'), lookups)).toBeUndefined()
    expect(compareTyped('currency', 9, 100)).toBeLessThan(0)
    expect(compareTyped('person', 'Asha Rao', 'Shubham')).toBeLessThan(0)
  })

  it('quick search matches entity names, multi-selects and emails — not amounts', () => {
    expect(rowMatchesSearch(row('p-2'), [col('person')], 'asha', lookups)).toBe(true)
    expect(rowMatchesSearch(row('["West","North"]'), [col('multiselect', ['West', 'North'])], 'north', lookups)).toBe(true)
    expect(rowMatchesSearch(row('a@b.co'), [col('email')], 'b.co', lookups)).toBe(true)
    expect(rowMatchesSearch(row(500000), [col('currency')], '500000', lookups)).toBe(false)
  })

  it('operator wording: entities read "is", multi-select reads "includes"', () => {
    expect(operatorLabel('state', 'eq')).toBe('is')
    expect(operatorLabel('person', 'in')).toBe('is one of')
    expect(operatorLabel('multiselect', 'eq')).toBe('includes')
    expect(operatorLabel('multiselect', 'in')).toBe('includes any of')
    expect(operatorLabel('select', 'eq')).toBe('equals')
  })
})
