import { describe, expect, it } from 'vitest'
import {
  OPERATORS_BY_TYPE, applyFilterRules, coerceCustomValue, flattenRules, matchesTypedRule, pruneFilterNodes, storageKind,
  type CustomFieldType, type FilterNode,
} from '@goms/domain'
import { fromRoot, removeAt, toRoot } from './filterTree'
import { isRuleComplete } from './gridColumns'

// The domain package has no runner of its own; its pure logic is exercised
// through the app's unit suite (the API's router tests cover the DB-backed side).

describe('new custom column types — validation', () => {
  it('currency: accepts rupee-formatted input, rounds to paise, rejects negatives and junk', () => {
    expect(coerceCustomValue('currency', '₹5,00,000')).toBe(500000)
    expect(coerceCustomValue('currency', 1234.567)).toBe(1234.57)
    expect(() => coerceCustomValue('currency', '-5')).toThrow(/negative/)
    expect(() => coerceCustomValue('currency', 'lots')).toThrow(/valid amount/)
  })

  it('url: needs a real http(s) address, and adds https:// when the scheme is missing', () => {
    expect(coerceCustomValue('url', 'gem.gov.in/bid/1')).toBe('https://gem.gov.in/bid/1')
    expect(coerceCustomValue('url', 'http://example.com')).toBe('http://example.com')
    expect(() => coerceCustomValue('url', 'ftp://example.com')).toThrow(/valid web address/)
    expect(() => coerceCustomValue('url', 'not a url')).toThrow(/valid web address/)
  })

  it('email: normalises case, rejects malformed addresses', () => {
    expect(coerceCustomValue('email', '  Asha@Amnex.COM ')).toBe('asha@amnex.com')
    expect(() => coerceCustomValue('email', 'asha@')).toThrow(/valid email/)
  })

  it('phone: strips separators, keeps a leading +, needs 7–15 digits', () => {
    expect(coerceCustomValue('phone', '+91 (98765) 43210')).toBe('+919876543210')
    expect(() => coerceCustomValue('phone', '12345')).toThrow(/valid phone/)
    expect(() => coerceCustomValue('phone', 'call me')).toThrow(/valid phone/)
  })

  it('state: a numeric code only', () => {
    expect(coerceCustomValue('state', '27')).toBe(27)
    expect(coerceCustomValue('state', 24)).toBe(24)
    expect(() => coerceCustomValue('state', 'Gujarat')).toThrow(/Choose a state/)
  })

  it('person / department keep the id as given; blank clears', () => {
    expect(coerceCustomValue('person', ' 5b1f ')).toBe('5b1f')
    expect(coerceCustomValue('department', '')).toBeNull()
  })

  it('multiselect: only listed options, stored in option order as a JSON array; empty clears', () => {
    const options = ['West', 'North', 'South']
    expect(coerceCustomValue('multiselect', JSON.stringify(['South', 'West']), options)).toBe('["West","South"]')
    expect(coerceCustomValue('multiselect', ['North'], options)).toBe('["North"]')
    expect(coerceCustomValue('multiselect', '[]', options)).toBeNull()
    expect(() => coerceCustomValue('multiselect', '["East"]', options)).toThrow(/not one of/)
  })

  it('every type has operators and a storage column', () => {
    const types: CustomFieldType[] = ['text', 'number', 'date', 'select', 'boolean', 'currency', 'url', 'email', 'phone', 'person', 'department', 'state', 'multiselect']
    for (const t of types) {
      expect(OPERATORS_BY_TYPE[t].length).toBeGreaterThan(0)
      expect(['text', 'number', 'date', 'boolean']).toContain(storageKind(t))
    }
    expect(storageKind('currency')).toBe('number')
    expect(storageKind('state')).toBe('number')
    expect(storageKind('multiselect')).toBe('text')
  })
})

describe('new custom column types — filtering', () => {
  it('currency filters numerically', () => {
    expect(matchesTypedRule('currency', 750000, { operator: 'gt' }, '500000')).toBe(true)
    expect(matchesTypedRule('currency', 750000, { operator: 'between', value2: '900000' }, '500000')).toBe(true)
    expect(matchesTypedRule('currency', 100, { operator: 'gt' }, '500000')).toBe(false)
  })

  it('person / department / state match by id (is / is one of)', () => {
    expect(matchesTypedRule('state', 24, { operator: 'eq' }, '24')).toBe(true)
    expect(matchesTypedRule('state', 24, { operator: 'in', values: ['27', '24'] }, '')).toBe(true)
    expect(matchesTypedRule('state', 24, { operator: 'in', values: ['27'] }, '')).toBe(false)
    expect(matchesTypedRule('person', 'p-1', { operator: 'eq' }, 'p-1')).toBe(true)
    expect(matchesTypedRule('department', 'd-9', { operator: 'in', values: ['d-1'] }, '')).toBe(false)
  })

  it('multiselect: "includes" and "includes any of"', () => {
    const cell = '["West","South"]'
    expect(matchesTypedRule('multiselect', cell, { operator: 'eq' }, 'West')).toBe(true)
    expect(matchesTypedRule('multiselect', cell, { operator: 'eq' }, 'North')).toBe(false)
    expect(matchesTypedRule('multiselect', cell, { operator: 'in', values: ['North', 'South'] }, '')).toBe(true)
    expect(matchesTypedRule('multiselect', cell, { operator: 'in', values: ['North'] }, '')).toBe(false)
  })

  it('url / email / phone filter as text', () => {
    expect(matchesTypedRule('email', 'asha@amnex.com', { operator: 'contains' }, 'AMNEX')).toBe(true)
    expect(matchesTypedRule('phone', '+919876543210', { operator: 'startsWith' }, '+9198')).toBe(true)
  })
})

describe('AND / OR filter groups', () => {
  const rows = [
    { id: 1, stateCode: 24, vertical: 'West', departmentName: 'MeitY', stageKey: 'qualification' },
    { id: 2, stateCode: 24, vertical: 'North', departmentName: 'DRDO', stageKey: 'solutioning' },
    { id: 3, stateCode: 24, vertical: 'East', departmentName: 'MeitY', stageKey: 'qualification' },
    { id: 4, stateCode: 27, vertical: 'West', departmentName: 'DRDO', stageKey: 'qualification' },
  ]
  const ids = (nodes: FilterNode[]) => applyFilterRules(rows, nodes, null).map((r) => r.id)
  const eq = (field: string, value: string): FilterNode => ({ field, operator: 'eq', value })

  it('a flat list still means AND', () => {
    expect(ids([eq('stateCode', '24'), eq('vertical', 'West')])).toEqual([1])
  })

  it('State = Gujarat AND (Region = West OR Region = North)', () => {
    const nodes: FilterNode[] = [eq('stateCode', '24'), { logic: 'or', rules: [eq('vertical', 'West'), eq('vertical', 'North')] }]
    expect(ids(nodes)).toEqual([1, 2])
  })

  it('(Department = MeitY OR Department = DRDO) AND Bid Stage = Qualification', () => {
    const nodes: FilterNode[] = [
      { logic: 'or', rules: [eq('departmentName', 'MeitY'), eq('departmentName', 'DRDO')] },
      eq('stageKey', 'qualification'),
    ]
    expect(ids(nodes)).toEqual([1, 3, 4])
  })

  it('a top-level OR (a single wrapping group)', () => {
    expect(ids([{ logic: 'or', rules: [eq('stateCode', '27'), eq('vertical', 'North')] }])).toEqual([2, 4])
  })

  it('an AND group inside an OR group', () => {
    const nodes: FilterNode[] = [{ logic: 'or', rules: [
      { logic: 'and', rules: [eq('stateCode', '24'), eq('vertical', 'East')] },
      eq('stateCode', '27'),
    ] }]
    expect(ids(nodes)).toEqual([3, 4])
  })

  it('a rule on an archived custom column is skipped, and an all-skipped group is ignored', () => {
    const nodes: FilterNode[] = [eq('stateCode', '24'), { logic: 'or', rules: [eq('custom:gone', 'x'), eq('custom:also_gone', 'y')] }]
    expect(ids(nodes)).toEqual([1, 2, 3])
  })

  it('custom-column rules work inside a group', () => {
    const custom = [
      { id: 1, customValues: { tier: 'Gold', tags: '["a","b"]' } },
      { id: 2, customValues: { tier: 'Silver', tags: '["c"]' } },
      { id: 3, customValues: { tier: 'Bronze' } },
    ]
    const out = applyFilterRules(custom, [{ logic: 'or', rules: [
      { field: 'custom:tier', operator: 'eq', value: 'Gold' },
      { field: 'custom:tags', operator: 'eq', value: 'c' },
    ] }], null, { 'custom:tier': 'select', 'custom:tags': 'multiselect' })
    expect(out.map((r) => r.id)).toEqual([1, 2])
  })

  it('prune drops incomplete rules, empty groups, and collapses a group of one', () => {
    const half: FilterNode = { field: 'city', operator: 'eq', value: '' }
    const nodes: FilterNode[] = [
      eq('stateCode', '24'),
      { logic: 'or', rules: [eq('vertical', 'West'), half] },
      { logic: 'and', rules: [half] },
    ]
    const pruned = pruneFilterNodes(nodes, isRuleComplete)
    expect(pruned).toEqual([eq('stateCode', '24'), eq('vertical', 'West')])
    expect(flattenRules(nodes)).toHaveLength(4)
  })

  it('survives a JSON round trip (this is what a saved view stores)', () => {
    const nodes: FilterNode[] = [eq('stateCode', '24'), { logic: 'or', rules: [eq('vertical', 'West'), eq('vertical', 'North')] }]
    expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes)
  })
})

describe('filter tree helpers', () => {
  const a: FilterNode = { field: 'city', operator: 'eq', value: 'A' }
  const b: FilterNode = { field: 'city', operator: 'eq', value: 'B' }

  it('"match any" is one OR group wrapping the list, and reads back as any', () => {
    const stored = fromRoot({ logic: 'or', items: [a, b] })
    expect(stored).toEqual([{ logic: 'or', rules: [a, b] }])
    expect(toRoot(stored)).toEqual({ logic: 'or', items: [a, b] })
    expect(fromRoot({ logic: 'and', items: [a, b] })).toEqual([a, b])
    expect(toRoot([a, b]).logic).toBe('and')
  })

  it('removing the last rule of a group removes the group', () => {
    const items: FilterNode[] = [a, { logic: 'or', rules: [b] }]
    expect(removeAt(items, [1, 0])).toEqual([a])
    expect(removeAt(items, [0])).toEqual([{ logic: 'or', rules: [b] }])
  })
})
