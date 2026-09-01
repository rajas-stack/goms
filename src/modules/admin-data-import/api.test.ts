import { describe, it, expect, vi } from 'vitest'
import { adminImportApi, flattenSessionPreview } from './api'

// api.ts's httpBatchLink reads auth.currentUser to attach an ID token —
// mocked here (as AdminImportAuthGate.test.tsx also does) so this file's
// pure-logic tests don't depend on a real Firebase project/API key existing.
vi.mock('@/lib/firebaseAuth', () => ({ auth: { currentUser: null } }))

describe('flattenSessionPreview', () => {
  it('flattens multiple domains\' previews into one list, tagging each row with its domain', () => {
    const result = flattenSessionPreview([
      { domain: 'taxClasses', preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }] },
      { domain: 'employees', preview: [{ rowNumber: 1, businessKey: 'E1', action: 'create', errors: [] }] },
    ])
    expect(result.map((r) => r.domain)).toEqual(['taxClasses', 'employees'])
  })

  it('flattens a multi-sheet domain\'s dict-shaped preview too', () => {
    const result = flattenSessionPreview([
      { domain: 'salesRoster', preview: { persons: [{ rowNumber: 1, businessKey: 'a@b.com', action: 'create', errors: [], sheet: 'Sales Persons' }], postings: [] } },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].sheet).toBe('Sales Persons')
  })
})

describe('adminImportApi.session', () => {
  it('calls the session.validate tRPC procedure', async () => {
    const spy = vi.spyOn(adminImportApi, 'validateSession').mockResolvedValue({ domainOrder: [], previews: [], summary: {} as any, sessionCommitToken: 't' })
    await adminImportApi.validateSession({ domains: {} })
    expect(spy).toHaveBeenCalledWith({ domains: {} })
  })
})
