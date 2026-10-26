import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn(), release: vi.fn(), admin: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: mocks.query, connect: async () => ({ query: mocks.query, release: mocks.release }) } }))
vi.mock('../auth/identity.js', () => ({ verifyIdentity: mocks.verify, isAmnexAccount: (value: string) => value.endsWith('@amnex.com') }))
vi.mock('../auth/rbac/systemAdminOnly.js', async original => ({ ...await original<typeof import('../auth/rbac/systemAdminOnly.js')>(), requireSystemAdmin: mocks.admin }))
import { bidCommunicationsRouter } from './bidCommunications.js'
const bidId = '00000000-0000-4000-8000-000000000001'
const personId = '00000000-0000-4000-8000-000000000002'
const caller = () => bidCommunicationsRouter.createCaller({ authHeader: 'Bearer identity-token' })
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({ uid: 'user-a', email: 'me@amnex.com' }); mocks.query.mockResolvedValue({ rows: [{ id: bidId }] }) })
describe('private bid communication', () => {
  it('requires explicit confirmation and refuses to overwrite an employee’s populated email', async () => {
    await expect(caller().bindInternalEmail({ id: personId, email: 'new@amnex.com', confirmed: false } as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT email FROM org_people') ? [{ email: 'existing@amnex.com' }] : [] }))
    await expect(caller().bindInternalEmail({ id: personId, email: 'new@amnex.com', confirmed: true })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.admin).toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.query.mock.calls.every(([sql]) => !sql.startsWith('UPDATE'))).toBe(true)
  })
  it('rolls back a duplicate external contact instead of replacing any existing values', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes(') people WHERE') ? [{ email: 'person@vendor.com' }] : [] }))
    await expect(caller().createContact({ email: 'person@vendor.com', name: 'Person', party: 'oem', organization: 'Vendor', departmentId: null })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.query.mock.calls.every(([sql]) => !sql.startsWith('INSERT'))).toBe(true)
  })
  it('deletes only the address-book entry, and says so when it is already gone', async () => {
    const id = '00000000-0000-4000-8000-000000000003'
    mocks.query.mockResolvedValue({ rows: [{ id }] })
    await caller().deleteContact({ id })
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toEqual(['DELETE FROM communication_contacts WHERE id=$1 RETURNING id'])
    mocks.query.mockResolvedValue({ rows: [] })
    await expect(caller().deleteContact({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('accepts the Competitor and Consortium partner categories and nothing unknown', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: personId, email: 'c@rival.com', name: 'Rival', party: 'competitor', organization: 'Rival Ltd', department_id: null }] })
    await expect(caller().updateContact({ id: personId, name: 'Rival', party: 'competitor', organization: 'Rival Ltd', departmentId: null })).resolves.toMatchObject({ party: 'competitor' })
    await expect(caller().updateContact({ id: personId, name: 'JV', party: 'consortium', organization: 'JV Ltd', departmentId: null })).resolves.toBeTruthy()
    await expect(caller().updateContact({ id: personId, name: 'X', party: 'partner' as never, organization: 'X', departmentId: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('requires a real client department for a shared client mailbox', async () => {
    await expect(caller().createContact({ email: 'dept@client.com', name: 'Department', party: 'clientDepartment', organization: 'Client', departmentId: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('rolls back a missing-email binding if org mirroring would replace a populated team email', async () => {
    let memberRead = 0
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT email FROM org_people')) return { rows: [{ email: '' }] }
      if (sql === 'SELECT id,email FROM delivery_team_members') return { rows: [{ id: 'member', email: ++memberRead === 1 ? 'original@amnex.com' : 'new@amnex.com' }] }
      return { rows: [] }
    })
    await expect(caller().bindInternalEmail({ id: personId, email: 'new@amnex.com', confirmed: true })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.query).not.toHaveBeenCalledWith('COMMIT')
  })
})
