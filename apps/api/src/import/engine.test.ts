import { describe, it, expect } from 'vitest'
import { classifyRows, resolveTreeReferences, summarize, computeCommitToken, verifyCommitToken, MAX_IMPORT_ROWS, findFuzzyCandidates, MIN_FUZZY_SIMILARITY, caseInsensitiveEnum, cascadeRejectOnRejectedReference } from './engine.js'
import type { ImportRowResult } from './types.js'

// 2026-09: a realistic export using "Active" (or "ACTIVE") for a status
// column that only accepted the lowercase literal was rejected purely on
// capitalization — ordinary Excel formatting variance, not a real business
// error. This is the shared building block every affected domain schema
// (organizationHierarchy, employees, salesRoster, skus, commercialMastersCatalog)
// now uses for its enum-like fields.
describe('caseInsensitiveEnum', () => {
  const schema = caseInsensitiveEnum(['active', 'archived'] as const)

  it('accepts the canonical lowercase value unchanged', () => {
    expect(schema.parse('active')).toBe('active')
  })

  it('coerces any capitalization to the canonical value', () => {
    expect(schema.parse('Active')).toBe('active')
    expect(schema.parse('ACTIVE')).toBe('active')
    expect(schema.parse('aCtIvE')).toBe('active')
  })

  it('trims surrounding whitespace before matching', () => {
    expect(schema.parse('  Active  ')).toBe('active')
  })

  it('still rejects a value that matches nothing, case-insensitively or otherwise', () => {
    expect(schema.safeParse('Suspended').success).toBe(false)
  })

  it('still rejects a non-string value the same way plain z.enum would', () => {
    expect(schema.safeParse(42).success).toBe(false)
  })

  it('preserves a custom errorMap for the underlying enum', () => {
    const withMessage = caseInsensitiveEnum(['active', 'archived'] as const, {
      errorMap: () => ({ message: 'custom message' }),
    })
    const result = withMessage.safeParse('bogus')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe('custom message')
  })
})

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

  // 2026-09: resolveTreeReferences only checks that a parent's CODE appears
  // somewhere (existing DB rows, or any row in this file) — it has no idea
  // whether that row will itself survive validation. A child row resolving
  // against a parent whose OWN row gets rejected used to reach
  // 'create'/'update' anyway, then crash the throwaway validate-time commit
  // when the never-actually-inserted parent had no id to resolve against.
  // cascadeRejectOnRejectedReference (below) is the fix, applied as a
  // post-pass after classifyRows in every domain using this pattern
  // (organizationHierarchy, employees).
  it('demonstrates the exact production crash this leaves open: a rejected parent still "resolves" its child', () => {
    const out = resolveTreeReferences({
      // Row 0 ("PARENT") is schema-invalid and will be rejected — but it's
      // still present in the file, so its code counts as "existing" here.
      rows: [{ code: 'PARENT', parentCode: null }, { code: 'CHILD', parentCode: 'PARENT' }],
      getOwnKey: (r) => r.code,
      getParentKey: (r) => r.parentCode,
      existingKeys: new Set(),
    })
    // Nothing is unresolved — CHILD's reference to PARENT looks perfectly
    // fine from resolveTreeReferences' point of view alone.
    expect(out.unresolved).toEqual([])
  })
})

describe('cascadeRejectOnRejectedReference', () => {
  it('rejects a row whose reference names another row in this file that itself got rejected', () => {
    const rows = [{ code: 'PARENT' }, { code: 'CHILD', parentCode: 'PARENT' }]
    const preview: ImportRowResult[] = [
      { rowNumber: 1, businessKey: 'PARENT', action: 'reject', errors: ['bad data'] },
      { rowNumber: 2, businessKey: 'CHILD', action: 'create', errors: [] },
    ]
    const out = cascadeRejectOnRejectedReference(preview, rows, (r) => r.parentCode ?? null, new Set())
    expect(out[0]).toEqual(preview[0]) // the original rejection is untouched
    expect(out[1].action).toBe('reject')
    expect(out[1].errors[0]).toContain('PARENT')
  })

  it('cascades through a multi-level chain to a fixed point (grandparent -> parent -> child)', () => {
    const rows = [{ code: 'GP' }, { code: 'P', parentCode: 'GP' }, { code: 'C', parentCode: 'P' }]
    const preview: ImportRowResult[] = [
      { rowNumber: 1, businessKey: 'GP', action: 'reject', errors: ['bad data'] },
      { rowNumber: 2, businessKey: 'P', action: 'create', errors: [] },
      { rowNumber: 3, businessKey: 'C', action: 'create', errors: [] },
    ]
    const out = cascadeRejectOnRejectedReference(preview, rows, (r) => r.parentCode ?? null, new Set())
    expect(out[1].action).toBe('reject') // P cascades from GP
    expect(out[2].action).toBe('reject') // C cascades from P, which just cascaded
  })

  it('does NOT reject a row referencing an existing, already-committed DB row of the same key', () => {
    // A rejected row can share a business key with an existing DB row only
    // in pathological cases, but existingKeys must still exempt real DB rows
    // from ever being treated as "failed in this file".
    const rows = [{ code: 'CHILD', parentCode: 'REAL-DB-ROW' }]
    const preview: ImportRowResult[] = [{ rowNumber: 1, businessKey: 'CHILD', action: 'create', errors: [] }]
    const out = cascadeRejectOnRejectedReference(preview, rows, (r) => r.parentCode ?? null, new Set(['REAL-DB-ROW']))
    expect(out[0].action).toBe('create')
  })

  it('leaves unrelated create/update rows untouched', () => {
    const rows = [{ code: 'A' }, { code: 'B' }]
    const preview: ImportRowResult[] = [
      { rowNumber: 1, businessKey: 'A', action: 'reject', errors: ['bad'] },
      { rowNumber: 2, businessKey: 'B', action: 'create', errors: [] },
    ]
    const out = cascadeRejectOnRejectedReference(preview, rows, () => null, new Set())
    expect(out[1].action).toBe('create')
  })
})
