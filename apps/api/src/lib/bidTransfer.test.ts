import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), insert: vi.fn(), facts: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { connect: mocks.connect, query: mocks.query } }))
vi.mock('../routers/opportunities.js', () => ({ insertOpportunity: mocks.insert, applyStageChange: vi.fn() }))
vi.mock('../auth/rbac/userFacts.js', () => ({ loadUserFacts: mocks.facts }))
vi.mock('./auditLog.js', () => ({ writeAuditLog: vi.fn() }))
import { bidTransferSchema, commitBidTransfer, previewBidTransfer } from './bidTransfer.js'

describe('bid import transaction (isolated SQL client)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.facts.mockResolvedValue({ email: 'admin@example.com', roles: ['system_admin'], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } })
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT opportunity_name')) return { rows: [{ opportunity_name: 'Existing', gem_tender_id: 'GEM/1' }] }
      if (sql.includes('RETURNING next_value')) return { rows: [{ allocated: 7 }] }
      if (sql.includes('INSERT INTO bids')) return { rows: [{ id: 'new-bid' }] }
      return { rows: [] }
    })
    mocks.insert.mockResolvedValue({ id: 'new-opportunity' })
  })
  it('preview performs reads only', async () => {
    expect((await previewBidTransfer({ headers: ['Opportunity Name'], rows: [['New']] }, 'admin@example.com')).valid).toBe(true)
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
  })
  it('revalidates against live duplicates before writing anything', async () => {
    const result = await commitBidTransfer({ headers: ['Opportunity Name'], rows: [['New'], ['Existing']] }, 'admin@example.com')
    expect(result.status).toBe('rejected'); expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK'); expect(mocks.query).not.toHaveBeenCalledWith('COMMIT')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('commits only new opportunities and bids, together, without a department', async () => {
    expect(await commitBidTransfer({ headers: ['Opportunity Name'], rows: [['New']] }, 'admin@example.com')).toEqual({ status: 'imported', count: 1 })
    expect(mocks.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ departmentId: null, opportunityName: 'New' }), expect.objectContaining({ deferCode: true }))
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE opportunities/.test(sql))).toBe(false)
  })
  it('rolls back the complete transaction if a later write fails', async () => {
    mocks.insert.mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(new Error('DB failure'))
    await expect(commitBidTransfer({ headers: ['Opportunity Name'], rows: [['First'], ['Second']] }, 'admin@example.com')).rejects.toThrow('DB failure')
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK'); expect(mocks.query).not.toHaveBeenCalledWith('COMMIT')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('cannot bypass existing decision permissions through import', async () => {
    mocks.facts.mockResolvedValue({ email: 'sales@example.com', roles: ['sales'], salesPersonId: 'sales', teamMemberIds: { presales: [], legal: [], bid: [] } })
    const result = await previewBidTransfer({ headers: ['Opportunity Name', 'Tender Stage', 'Go/No Go'], rows: [['New', 'Submitted', 'Go']] }, 'sales@example.com')
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ row: 2, column: 2, message: expect.stringContaining('permissions') }))
    expect(result.prepared).toEqual([])
  })
  it('rejects malformed oversized API inputs', () => {
    expect(bidTransferSchema.safeParse({ table: { headers: ['Opportunity Name'], rows: [['New']], overwrite: true } }).success).toBe(false)
    expect(bidTransferSchema.safeParse({ table: { headers: Array(101).fill('Name'), rows: [] } }).success).toBe(false)
  })
})
