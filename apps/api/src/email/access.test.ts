import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ query: vi.fn(), row: vi.fn(), facts: vi.fn(), tree: vi.fn(), identity: vi.fn(), admin: vi.fn(), allows: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: m.query } }))
vi.mock('../auth/identity.js', () => ({ verifyIdentity: m.identity, isAmnexAccount: (email: string) => email.endsWith('@amnex.com') }))
vi.mock('../auth/rbac/userFacts.js', () => ({ loadUserFacts: m.facts }))
vi.mock('../lib/rbacTreeStore.js', () => ({ resolveForEmail: m.tree }))
vi.mock('../auth/rbac/systemAdminOnly.js', () => ({ isSystemAdminEmail: m.admin }))
vi.mock('../auth/rbac/rows.js', () => ({ rowForOpportunity: m.row, rowForOwnedEntity: vi.fn(), rowForTimelineEvent: vi.fn() }))
vi.mock('@goms/domain', async original => ({ ...await original<typeof import('@goms/domain')>(), treeAllows: m.allows, accessFor: () => ({ level: 'W' }) }))
import { assertEmailEntity, emailActor, visibleEmailEntity, type EmailActor } from './access.js'
const actor = { uid: 'u', email: 'me@amnex.com', facts: { roles: ['bid'], salesPersonId: null, teamMemberIds: { presales: ['p1'], legal: [], bid: [] } }, tree: {} } as unknown as EmailActor
const ref = { type: 'opportunity', id: 'opp' }
const row = { module: 'opportunity.rfp', bidId: 'bid', facts: { createdBy: 'owner@amnex.com', salesOwnerIds: [], assigned: { presales: 'p1', legal: null, bid: null } } }
beforeEach(() => { vi.clearAllMocks(); m.row.mockResolvedValue(structuredClone(row)); m.query.mockResolvedValue({ rows: [] }); m.admin.mockReturnValue(false); m.allows.mockReturnValue(true); m.facts.mockResolvedValue(actor.facts); m.tree.mockResolvedValue({}); m.identity.mockResolvedValue({ uid: 'u', email: actor.email }) })
describe('fresh business-record involvement', () => {
  it('rechecks assignments and revokes contextual access as soon as an assignment is removed', async () => {
    m.query.mockResolvedValue({ rows: [{ opportunity_name: 'Allowed' }] })
    expect(await assertEmailEntity(actor, ref)).toMatchObject({ path: '/bid-tracker/bid/bid?tab=communication' })
    m.row.mockResolvedValue({ ...row, facts: { ...row.facts, assigned: { presales: null, legal: null, bid: null } } })
    m.query.mockResolvedValue({ rows: [] })
    expect(await visibleEmailEntity(actor, ref)).toBeNull()
  })
  it('does not treat a global bid or administrator role as Opportunity involvement', async () => {
    m.row.mockResolvedValue({ ...row, facts: { ...row.facts, assigned: {} } }); m.admin.mockReturnValue(true)
    await expect(assertEmailEntity(actor, ref)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("g.status='approved'"), [actor.email, 'opp', ['owner@amnex.com']])
  })
  it('bypasses ordinary identity permission caches on every mail request', async () => {
    await emailActor({ authHeader: 'Bearer app-session' })
    expect(m.facts).toHaveBeenCalledWith(actor.email, true)
    expect(m.tree).toHaveBeenCalledWith(actor.email, actor.facts.roles, true)
  })
  it('denies a disabled record permission before loading the record', async () => {
    m.allows.mockImplementation((_tree, node) => node !== 'opportunity.bid.communication')
    await expect(assertEmailEntity(actor, ref)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(m.row).not.toHaveBeenCalled()
  })
})
