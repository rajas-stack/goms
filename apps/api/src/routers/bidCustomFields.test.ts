import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import {
  applyFilterRules, coerceCustomValue, normalizeOptions, slugifyFieldKey, OPERATORS_BY_TYPE,
  type CustomFieldType, type SystemBidViewFilterRule,
} from '@goms/domain'

// Domain has no standalone runner (Global Constraints), so its pure logic is
// exercised here, the same way PIPELINE_STAGE_MAP is through router tests.
describe('custom field domain helpers', () => {
  describe('slugifyFieldKey', () => {
    it('lowercases and underscores, and dedupes against taken keys', () => {
      const taken = new Set<string>()
      const a = slugifyFieldKey('Client Contact!', taken)
      taken.add(a)
      const b = slugifyFieldKey('client   contact', taken)
      taken.add(b)
      expect(a).toBe('client_contact')
      expect(b).toBe('client_contact_2')
      expect(slugifyFieldKey('Client Contact', taken)).toBe('client_contact_3')
    })

    it('prefixes a leading digit, falls back for an empty slug, and caps the length', () => {
      expect(slugifyFieldKey('2026 target', new Set())).toBe('f_2026_target')
      expect(slugifyFieldKey('!!!', new Set())).toBe('field')
      expect(slugifyFieldKey('x'.repeat(200), new Set()).length).toBeLessThanOrEqual(48)
      expect(slugifyFieldKey('x'.repeat(200), new Set(['x'.repeat(44)]))).toMatch(/^x+_2$/)
    })
  })

  describe('normalizeOptions', () => {
    it('trims, drops blanks and case-insensitive duplicates, keeping the first spelling', () => {
      expect(normalizeOptions([' Hot ', 'hot', '', 'Cold'])).toEqual(['Hot', 'Cold'])
    })
    it('rejects an empty result', () => {
      expect(() => normalizeOptions(['  ', ''])).toThrow(/at least one option/)
    })
  })

  describe('coerceCustomValue', () => {
    it('treats null/undefined/blank as a clear for every type', () => {
      for (const t of ['text', 'number', 'date', 'select', 'boolean'] as CustomFieldType[]) {
        expect(coerceCustomValue(t, null, ['a'])).toBeNull()
        expect(coerceCustomValue(t, undefined, ['a'])).toBeNull()
        expect(coerceCustomValue(t, '  ', ['a'])).toBeNull()
      }
    })
    it('coerces each type', () => {
      expect(coerceCustomValue('text', '  hi ')).toBe('hi')
      expect(coerceCustomValue('number', '12.5')).toBe(12.5)
      expect(coerceCustomValue('number', 7)).toBe(7)
      expect(coerceCustomValue('date', '2026-10-31')).toBe('2026-10-31')
      expect(coerceCustomValue('boolean', 'false')).toBe(false)
      expect(coerceCustomValue('boolean', true)).toBe(true)
      expect(coerceCustomValue('select', 'Hot', ['Hot', 'Cold'])).toBe('Hot')
    })
    it('rejects invalid input with a message', () => {
      expect(() => coerceCustomValue('number', 'abc')).toThrow(/valid number/)
      expect(() => coerceCustomValue('number', Infinity)).toThrow(/valid number/)
      expect(() => coerceCustomValue('number', '0x10')).toThrow(/valid number/)
      expect(() => coerceCustomValue('date', '2026-02-30')).toThrow(/valid date/)
      expect(() => coerceCustomValue('date', '31/10/2026')).toThrow(/valid date/)
      expect(() => coerceCustomValue('boolean', 'yes')).toThrow(/true or false/)
      expect(() => coerceCustomValue('select', 'Warm', ['Hot', 'Cold'])).toThrow(/not one of/)
      expect(() => coerceCustomValue('text', 'x'.repeat(2001))).toThrow(/at most/)
    })
  })

  describe('applyFilterRules — typed operators', () => {
    const fieldTypes: Record<string, CustomFieldType> = {
      'custom:score': 'number', 'custom:note': 'text', 'custom:tier': 'select',
      'custom:review': 'date', 'custom:hot': 'boolean',
    }
    const rows = [
      { id: 'a', stageKey: 'solutioning', customValues: { score: 9, note: 'Alpha Bid', tier: 'Gold', review: '2026-10-05', hot: true } },
      { id: 'b', stageKey: 'qualification', customValues: { score: 10, note: 'beta', tier: 'Silver', review: '2026-11-01', hot: false } },
      { id: 'c', stageKey: 'solutioning', customValues: { score: 100, note: 'Gamma', tier: 'Gold', review: '2026-12-25', hot: true } },
      { id: 'd', stageKey: 'solutioning', customValues: {} },
    ]
    const run = (rule: SystemBidViewFilterRule) => applyFilterRules(rows, [rule], null, fieldTypes).map((r) => r.id)

    it('number: eq / gt / lt compare numerically, not lexically', () => {
      expect(run({ field: 'custom:score', operator: 'eq', value: '10' })).toEqual(['b'])
      expect(run({ field: 'custom:score', operator: 'gt', value: '9' })).toEqual(['b', 'c'])
      expect(run({ field: 'custom:score', operator: 'lt', value: '10' })).toEqual(['a'])
    })
    it('number: between is inclusive at both ends and order-independent', () => {
      expect(run({ field: 'custom:score', operator: 'between', value: '9', value2: '10' })).toEqual(['a', 'b'])
      expect(run({ field: 'custom:score', operator: 'between', value: '10', value2: '9' })).toEqual(['a', 'b'])
      expect(run({ field: 'custom:score', operator: 'between', value: '9' })).toEqual([])
    })
    it('text: contains and startsWith are case-insensitive, eq is exact', () => {
      expect(run({ field: 'custom:note', operator: 'contains', value: 'AMM' })).toEqual(['c'])
      expect(run({ field: 'custom:note', operator: 'startsWith', value: 'alpha' })).toEqual(['a'])
      expect(run({ field: 'custom:note', operator: 'eq', value: 'beta' })).toEqual(['b'])
      expect(run({ field: 'custom:note', operator: 'eq', value: 'Beta' })).toEqual([])
    })
    it('select: eq and in', () => {
      expect(run({ field: 'custom:tier', operator: 'eq', value: 'Silver' })).toEqual(['b'])
      expect(run({ field: 'custom:tier', operator: 'in', value: '', values: ['Gold', 'Silver'] })).toEqual(['a', 'b', 'c'])
      expect(run({ field: 'custom:tier', operator: 'in', value: '' })).toEqual([])
    })
    it('date: before / after / between (inclusive)', () => {
      expect(run({ field: 'custom:review', operator: 'before', value: '2026-11-01' })).toEqual(['a'])
      expect(run({ field: 'custom:review', operator: 'after', value: '2026-11-01' })).toEqual(['c'])
      expect(run({ field: 'custom:review', operator: 'between', value: '2026-10-05', value2: '2026-11-01' })).toEqual(['a', 'b'])
    })
    it('boolean: eq true / false', () => {
      expect(run({ field: 'custom:hot', operator: 'eq', value: 'true' })).toEqual(['a', 'c'])
      expect(run({ field: 'custom:hot', operator: 'eq', value: 'false' })).toEqual(['b'])
    })
    it('an operator invalid for the field type never matches', () => {
      expect(run({ field: 'custom:tier', operator: 'contains', value: 'Gold' })).toEqual([])
      expect(run({ field: 'custom:hot', operator: 'gt', value: '1' })).toEqual([])
    })
    it('a row with no value never matches any operator', () => {
      expect(run({ field: 'custom:score', operator: 'lt', value: '1000' })).not.toContain('d')
    })
    it('multiple rules AND together, across standard and custom fields', () => {
      const ids = applyFilterRules(rows, [
        { field: 'stageKey', operator: 'eq', value: 'solutioning' },
        { field: 'custom:tier', operator: 'eq', value: 'Gold' },
        { field: 'custom:score', operator: 'gt', value: '50' },
      ], null, fieldTypes).map((r) => r.id)
      expect(ids).toEqual(['c'])
    })
    it('a rule on an unknown/archived custom field is skipped, not match-nothing', () => {
      const ids = applyFilterRules(rows, [
        { field: 'custom:gone', operator: 'eq', value: 'x' },
        { field: 'stageKey', operator: 'eq', value: 'qualification' },
      ], null, fieldTypes).map((r) => r.id)
      expect(ids).toEqual(['b'])
      expect(applyFilterRules(rows, [{ field: 'custom:gone', operator: 'eq', value: 'x' }], null, fieldTypes)).toHaveLength(4)
    })
    it('legacy eq rules and $currentUser behave as before (3-arg call)', () => {
      const bids = [{ id: 'x', ownerEmail: 'a@x.com', attentionFlag: 'overdue' }, { id: 'y', ownerEmail: null, attentionFlag: 'onTrack' }]
      expect(applyFilterRules(bids, [{ field: 'attentionFlag', operator: 'eq', value: 'overdue' }], null).map((r) => r.id)).toEqual(['x'])
      expect(applyFilterRules(bids, [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }], 'a@x.com').map((r) => r.id)).toEqual(['x'])
      expect(applyFilterRules(bids, [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }], null)).toEqual([])
    })
    it('standard numeric/date columns get typed operators too', () => {
      const bids = [
        { id: 'p', valueAmount: '9', submissionDate: '2026-10-01' },
        { id: 'q', valueAmount: '10', submissionDate: '2026-11-01' },
        { id: 'r', valueAmount: '', submissionDate: 'TBD' },
      ]
      expect(applyFilterRules(bids, [{ field: 'valueAmount', operator: 'gt', value: '9' }], null).map((r) => r.id)).toEqual(['q'])
      expect(applyFilterRules(bids, [{ field: 'submissionDate', operator: 'after', value: '2026-10-15' }], null).map((r) => r.id)).toEqual(['q'])
    })
  })

  it('OPERATORS_BY_TYPE matches the documented table', () => {
    expect(OPERATORS_BY_TYPE).toEqual({
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
    })
  })
})
