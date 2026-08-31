import { describe, it, expect } from 'vitest'
import { classifyRows, resolveTreeReferences, summarize, computeCommitToken, verifyCommitToken, MAX_IMPORT_ROWS, findFuzzyCandidates, MIN_FUZZY_SIMILARITY } from './engine.js'
import type { ImportRowResult } from './types.js'

describe('classifyRows', () => {
  type Row = { code: string; name: string }
  type Existing = { name: string }

  function run(rows: Row[], existingByKey: Map<string, Existing>) {
    return classifyRows({
      rows,
      getBusinessKey: (r) => (r.code ? r.code.trim().toUpperCase() : null),
      existingByKey,
      diffFields: (r, e) => (r.name !== e.name ? [{ field: 'name', oldValue: e.name, newValue: r.name }] : []),
      validateRow: (r) => (r.name ? { errors: [] } : { errors: ['name is required'] }),
    })
  }

  it('classifies a row with no existing match as create', () => {
    const out = run([{ code: 'A', name: 'Alpha' }], new Map())
    expect(out).toEqual([{ rowNumber: 1, businessKey: 'A', action: 'create', errors: [] }])
  })

  it('classifies an identical existing row as unchanged', () => {
    const out = run([{ code: 'A', name: 'Alpha' }], new Map([['A', { name: 'Alpha' }]]))
    expect(out[0].action).toBe('unchanged')
  })

  it('classifies a changed existing row as update with a field diff', () => {
    const out = run([{ code: 'A', name: 'Alpha 2' }], new Map([['A', { name: 'Alpha' }]]))
    expect(out[0].action).toBe('update')
    expect(out[0].diff).toEqual([{ field: 'name', oldValue: 'Alpha', newValue: 'Alpha 2' }])
  })

  it('rejects a row that fails validateRow, with the returned reasons', () => {
    const out = run([{ code: 'A', name: '' }], new Map())
    expect(out[0].action).toBe('reject')
    expect(out[0].errors).toEqual(['name is required'])
  })

  it('rejects every occurrence after the first when a business key repeats in the file', () => {
    const out = run([{ code: 'A', name: 'One' }, { code: 'a', name: 'Two' }], new Map())
    expect(out[0].action).toBe('create')
    expect(out[1].action).toBe('reject')
    expect(out[1].errors).toEqual(['duplicate of row 1 in this file'])
  })

  it('rejects a row with no resolvable business key without throwing', () => {
    const out = run([{ code: '', name: 'X' }], new Map())
    expect(out[0].action).toBe('reject')
    expect(out[0].errors).toContain('business key could not be determined for this row')
  })
})

describe('summarize', () => {
  it('counts each action and the total', () => {
    const rows = [
      { rowNumber: 1, businessKey: 'a', action: 'create' as const, errors: [] },
      { rowNumber: 2, businessKey: 'b', action: 'update' as const, errors: [] },
      { rowNumber: 3, businessKey: 'c', action: 'unchanged' as const, errors: [] },
      { rowNumber: 4, businessKey: 'd', action: 'reject' as const, errors: ['bad'] },
    ]
    expect(summarize(rows)).toEqual({ toCreate: 1, toUpdate: 1, unchanged: 1, needsReview: 0, rejected: 1, total: 4 })
  })

  it('counts needs-review rows separately from rejected', () => {
    const rows: ImportRowResult[] = [
      { rowNumber: 1, businessKey: 'A', action: 'needs-review', candidates: [{ key: 'A1', score: 0.8 }], errors: ['ambiguous'] },
      { rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['no such code'] },
    ]
    const summary = summarize(rows)
    expect(summary.needsReview).toBe(1)
    expect(summary.rejected).toBe(1)
    expect(summary.total).toBe(2)
  })
})

describe('findFuzzyCandidates', () => {
  it('finds a close match above the similarity floor', () => {
    const candidates = findFuzzyCandidates('SALSE DEPT', ['SALES DEPT', 'FINANCE DEPT', 'HR DEPT'])
    expect(candidates[0].key).toBe('SALES DEPT')
    expect(candidates[0].score).toBeGreaterThanOrEqual(MIN_FUZZY_SIMILARITY)
  })

  it('caps candidates at 3, ranked by score descending', () => {
    const candidates = findFuzzyCandidates('SALES', ['SALEX', 'SALEZ', 'SALEY', 'SALEW', 'FINANCE'])
    expect(candidates.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < candidates.length; i++) expect(candidates[i].score).toBeLessThanOrEqual(candidates[i - 1].score)
  })

  it('returns nothing below the similarity floor', () => {
    expect(findFuzzyCandidates('SALES', ['ZZZZZ QQQQQ'])).toEqual([])
  })

  it('is case- and whitespace-insensitive', () => {
    const candidates = findFuzzyCandidates('  sales dept  ', ['SALES DEPT'])
    expect(candidates[0]?.score).toBe(1)
  })
})

describe('classifyRows validateRow contract', () => {
  it('marks a row needs-review (not reject) when validateRow sets needsReview with candidates', () => {
    const rows = classifyRows<{ code: string }, never>({
      rows: [{ code: 'X' }],
      getBusinessKey: (r) => r.code,
      existingByKey: new Map<string, never>(),
      diffFields: () => [],
      validateRow: () => ({ errors: ['no such code: X'], needsReview: true, candidates: [{ key: 'X1', score: 0.7 }] }),
    })
    expect(rows[0].action).toBe('needs-review')
    expect(rows[0].candidates).toEqual([{ key: 'X1', score: 0.7 }])
  })

  it('still rejects when validateRow returns errors with no needsReview flag', () => {
    const rows = classifyRows<{ code: string }, never>({
      rows: [{ code: 'X' }],
      getBusinessKey: (r) => r.code,
      existingByKey: new Map<string, never>(),
      diffFields: () => [],
      validateRow: () => ({ errors: ['bad row'] }),
    })
    expect(rows[0].action).toBe('reject')
    expect(rows[0].candidates).toBeUndefined()
  })
})

describe('commit token', () => {
  it('verifies a token computed from the same domain+rows', () => {
    const rows = [{ code: 'A' }]
    const token = computeCommitToken('taxClasses', rows)
    expect(verifyCommitToken('taxClasses', rows, token)).toBe(true)
  })

  it('rejects a token when the rows changed since preview', () => {
    const token = computeCommitToken('taxClasses', [{ code: 'A' }])
    expect(verifyCommitToken('taxClasses', [{ code: 'B' }], token)).toBe(false)
  })

  it('rejects a token computed for a different domain', () => {
    const rows = [{ code: 'A' }]
    const token = computeCommitToken('taxClasses', rows)
    expect(verifyCommitToken('currencies', rows, token)).toBe(false)
  })
})

describe('MAX_IMPORT_ROWS', () => {
  it('is a bounded, positive limit', () => {
    expect(MAX_IMPORT_ROWS).toBe(5000)
  })
})

describe('resolveTreeReferences', () => {
  it('resolves a reference to a row already in the database', () => {
    const out = resolveTreeReferences({
      rows: [{ code: 'B', parentCode: 'A' }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(['A']),
    })
    expect(out.unresolved).toEqual([])
  })

  it('resolves a forward reference to a row later in the same file', () => {
    const out = resolveTreeReferences({
      rows: [{ code: 'B', parentCode: 'A' }, { code: 'A', parentCode: null }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(),
    })
    expect(out.unresolved).toEqual([])
  })

  it('leaves a row unresolved when its named parent exists nowhere', () => {
    const out = resolveTreeReferences({
      rows: [{ code: 'B', parentCode: 'GHOST' }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(),
    })
    expect(out.unresolved).toEqual([0])
  })

  it('leaves a genuine cycle unresolved on both sides rather than looping forever', () => {
    const out = resolveTreeReferences({
      rows: [{ code: 'A', parentCode: 'B' }, { code: 'B', parentCode: 'A' }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(),
    })
    expect(out.unresolved.sort()).toEqual([0, 1])
  })

  it('resolves a multi-level chain (grandparent -> parent -> child) regardless of file order', () => {
    const out = resolveTreeReferences({
      rows: [{ code: 'C', parentCode: 'B' }, { code: 'A', parentCode: null }, { code: 'B', parentCode: 'A' }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(),
    })
    expect(out.unresolved).toEqual([])
  })
})
