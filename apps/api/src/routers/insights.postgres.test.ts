import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { addNode, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail } from '../testHelpers/rbacFixtures.js'
import { fakeIdToken } from '../testHelpers/adminImportTestAuth.js'

beforeEach(async () => { await cleanupRbacFixtures(); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('READ_AUTH_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('RBAC_MODE', 'enforce'); vi.stubEnv('ADMIN_ALLOWED_EMAILS', ''); makeSystemAdmin('insights') })
afterEach(async () => { await cleanupRbacFixtures(); vi.unstubAllEnvs() })
it('reads authorized real SQL data through the complete registered grid policy', async () => {
  const departmentId = await addNode('org', 'insights')
  const { opportunityId, bidId } = await makeBid()
  await pool.query("UPDATE opportunities SET department_id=$1, state_code=24, value_amount='250', value_unit='lakh', currency='INR', vertical='GIS', stage_key='qualified' WHERE id=$2", [departmentId, opportunityId])
  const caller = appRouter.createCaller({ authHeader: `Bearer ${fakeIdToken({ email: rbacEmail('insights') })}` })
  const result = await caller.insights.dashboard({ months: 12, search: 'RBAC fixture' })
  const record = result.records.find(r => r.id === bidId)
  expect(record).toMatchObject({ valueCr: 2.5, opportunityStageKey: 'qualified', stateCode: 24, vertical: 'GIS', department: 'RBAC insights' })
  expect(result.metrics.pipeline).toBeGreaterThanOrEqual(2.5)
  const grid = await caller.bids.listForGrid()
  expect(record?.attentionFlag).toBe(grid.find(r => r.id === bidId)?.attentionFlag)
})
it('denies an unauthenticated caller and a real caller with no roles', async () => {
  await expect(appRouter.createCaller({}).insights.dashboard({ months: 12 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  await expect(appRouter.createCaller({ authHeader: `Bearer ${fakeIdToken({ email: 'insights-no-role@amnex.com' })}` }).insights.dashboard({ months: 12 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
