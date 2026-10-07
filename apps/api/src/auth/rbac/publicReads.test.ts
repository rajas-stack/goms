import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addNode, addSalesPerson, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'

let orgNode: string, geoNode: string
const FORMERLY_PUBLIC: [string, unknown][] = [
  ['hierarchy.listStates', undefined], ['hierarchy.getState', { code: 24 }], ['hierarchy.getNode', { id: '' }],
  ['hierarchy.listChildren', { parentId: '' }], ['hierarchy.listOrgRoots', { stateCode: 24 }], ['hierarchy.listDepartments', undefined],
  ['hierarchy.listPostingNodes', { stateCode: 24 }], ['hierarchy.breadcrumb', { id: '' }], ['hierarchy.childCount', { id: '' }],
  ['hierarchy.geoRoot', undefined], ['hierarchy.childCounts', { parentId: '' }], ['hierarchy.moveTargets', { nodeId: '' }],
  ['commercial.masters.list', { key: 'verticals' }], ['commercial.masters.get', { key: 'verticals', id: '00000000-0000-0000-0000-000000000000' }],
  ['commercial.masters.listEditionFeatures', { editionId: '00000000-0000-0000-0000-000000000000' }],
  ['commercial.bom.listForSku', { parentSkuId: '00000000-0000-0000-0000-000000000000' }], ['commercial.bom.listAll', undefined],
]
const call = (caller: any, path: string, input: unknown) => path.split('.').reduce((o, k) => o[k], caller)(input)
const withNodeIds = (path: string, input: any) => {
  if (!input || !('id' in input || 'parentId' in input || 'nodeId' in input)) return input
  const key = Object.keys(input)[0]
  return { [key]: orgNode }
}

beforeEach(async () => {
  await cleanupRbacFixtures()
  orgNode = await addNode('org', 'dept'); geoNode = await addNode('geo', 'state')
  await addSalesPerson('sales')
  await setRole('presales', 'presales')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('RBAC_MODE=off: the 17 stay exactly as public as they are today', () => {
  it.each(FORMERLY_PUBLIC)('%s answers an unauthenticated caller', async (path, input) => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true' // auth is on in prod; RBAC is what is off
    const err = await call(appRouter.createCaller({}), path, withNodeIds(path, input)).then(() => null, (e: unknown) => e)
    expect(err instanceof TRPCError && (err.code === 'UNAUTHORIZED' || err.cause instanceof RbacDenial)).toBe(false)
  })
  it('health.check is public in every mode', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    await expect(appRouter.createCaller({}).health.check()).resolves.toBeDefined()
  })
})

describe('RBAC_MODE=shadow: behavior unchanged, would-be denials logged', () => {
  it('lets a signed-out caller through and logs it', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(appRouter.createCaller({}).hierarchy.listStates()).resolves.toBeDefined()
    expect(log.mock.calls.some((c) => String(c[0]).includes('hierarchy.listStates') && String(c[0]).includes('unauthenticated'))).toBe(true)
  })
})

describe('RBAC_MODE=enforce', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })

  it.each(FORMERLY_PUBLIC)('%s: a signed-out caller gets UNAUTHORIZED — never an RBAC denial (Review Focus 4)', async (path, input) => {
    const err = await call(appRouter.createCaller({}), path, withNodeIds(path, input)).then(() => null, (e: unknown) => e) as TRPCError
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('a no-role user keeps Geography and loses departments and commercial masters', async () => {
    const nobody = appRouter.createCaller(contextForEmail(rbacEmail('nobody')))
    await expect(nobody.hierarchy.listStates()).resolves.toBeDefined()
    await expect(nobody.hierarchy.getNode({ id: geoNode })).resolves.toBeDefined()
    await expect(nobody.hierarchy.getNode({ id: orgNode })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(nobody.hierarchy.listDepartments()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(nobody.commercial.masters.list({ key: 'verticals' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('a role reads what its module allows: Pre-sales sees the approval matrix, Sales does not', async () => {
    const pre = appRouter.createCaller(contextForEmail(rbacEmail('presales')))
    const sales = appRouter.createCaller(contextForEmail(rbacEmail('sales')))
    await expect(pre.commercial.masters.list({ key: 'approvalMatrix' })).resolves.toBeDefined()
    await expect(sales.commercial.masters.list({ key: 'approvalMatrix' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(sales.commercial.masters.list({ key: 'verticals' })).resolves.toBeDefined()
    await expect(sales.hierarchy.getNode({ id: orgNode })).resolves.toBeDefined()
  })
  it('a System Admin reads all of it once signed in (spec §3.4)', async () => {
    makeSystemAdmin('root')
    const root = appRouter.createCaller(contextForEmail(rbacEmail('root')))
    await expect(root.hierarchy.getNode({ id: orgNode })).resolves.toBeDefined()
    await expect(root.hierarchy.listDepartments()).resolves.toBeDefined()
    await expect(root.commercial.masters.list({ key: 'approvalMatrix' })).resolves.toBeDefined()
  })
  it('a non-Amnex account is refused as before, not as an RBAC denial', async () => {
    const err = await appRouter.createCaller(contextForEmail('someone@gmail.com')).hierarchy.listStates().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
})
