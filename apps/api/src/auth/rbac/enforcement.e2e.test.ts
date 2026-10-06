import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addNode, addSalesPerson, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
const refused = async (p: Promise<unknown>) => { try { await p; return false } catch (e) { return e instanceof TRPCError && e.cause instanceof RbacDenial } }

beforeEach(async () => {
  await cleanupRbacFixtures()
  await addSalesPerson('sales')
  for (const role of ['bid', 'legal', 'it'] as const) await setRole(role, role)
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE
  vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('the real router, RBAC_MODE=enforce', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })

  it('lets a role read and refuses a user with no role', async () => {
    await expect(as('sales').bids.listForGrid()).resolves.toBeDefined()
    expect(await refused(as('nobody').bids.listForGrid())).toBe(true)
  })
  it('refuses a write outside the role and lets one inside it through to the handler', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    expect(await refused(as('legal').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } }))).toBe(true)
    await expect(as('bid').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
  })
  it('refuses a cross-module write that only one of the two modules would allow', async () => {
    const department = await addNode('org', 'dept')
    expect(await refused(as('it').employees.transfers.transfer({ employeeId: department, toNodeId: department, effectiveDate: '2026-01-01' } as any))).toBe(true)
  })
  it('lets a System Admin through the real router — Solution Lead write included — and still refuses a signed-out call (spec §3.4)', async () => {
    makeSystemAdmin('root')
    const { opportunityId, bidId } = await makeBid({ withBid: true })
    await expect(as('root').opportunities.update({ id: opportunityId, patch: { city: 'Pune', gemTenderId: 'T-1' } })).resolves.toBeDefined()
    const lead = await addSalesPerson('lead')
    const args = { entityType: 'bid', entityId: bidId!, salesPersonId: lead, role: 'solutionLead', startDate: '2026-01-01' } as any
    expect(await refused(as('bid').ownership.assign(args))).toBe(true) // an ordinary W role is still refused
    await expect(as('root').ownership.assign(args)).resolves.toBeDefined()
    await expect(appRouter.createCaller({}).bids.listForGrid()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('RBAC_MODE=shadow', () => {
  it('lets the call through and logs what enforce would have refused', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { opportunityId } = await makeBid({ withBid: false })
    await expect(as('legal').opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
    expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes('rbac.would_deny') && l.includes('opportunities.update'))).toBe(true)
  })
})

describe('RBAC_MODE=off (the deployed default)', () => {
  it('changes nothing: the same call a role would be refused succeeds', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    await expect(appRouter.createCaller({}).opportunities.update({ id: opportunityId, patch: { city: 'Pune' } })).resolves.toBeDefined()
  })
})
