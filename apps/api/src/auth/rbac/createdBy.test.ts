import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { addEmployee, addNode, cleanupRbacFixtures, trackOpportunity } from '../../testHelpers/rbacFixtures.js'

beforeEach(cleanupRbacFixtures)
afterEach(cleanupRbacFixtures)

const as = (email: string) => appRouter.createCaller({ user: { email } } as any) // RBAC off: ctx.user is passed straight through

describe('created_by (gap A1)', () => {
  it('opportunities.create records the creator, lower-cased', async () => {
    const department = await addNode('org', 'dept')
    const opp = await as('RBAC-Maker@Amnex.com').opportunities.create({ departmentId: department, opportunityName: 'RBAC creator' })
    trackOpportunity(opp.id)
    expect((await pool.query('SELECT created_by FROM opportunities WHERE id=$1', [opp.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
  it('stays null when nobody is signed in (auth off)', async () => {
    const department = await addNode('org', 'dept')
    const opp = await appRouter.createCaller({}).opportunities.create({ departmentId: department, opportunityName: 'RBAC anon' })
    trackOpportunity(opp.id)
    expect((await pool.query('SELECT created_by FROM opportunities WHERE id=$1', [opp.id])).rows[0].created_by).toBeNull()
  })
  it('followUps.create records the creator', async () => {
    const created = await as('rbac-maker@amnex.com').followUps.create({ entityType: 'contact', entityId: randomUUID(), dueDate: '2030-01-01' })
    expect((await pool.query('SELECT created_by FROM follow_ups WHERE id=$1', [created.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
  it('employees.timeline.add records the creator', async () => {
    const employeeId = await addEmployee(await addNode('org', 'dept'))
    const event = await as('RBAC-Maker@Amnex.com').employees.timeline.add({ employeeId, type: 'meeting', title: 'RBAC meeting', date: '2026-01-01' })
    expect((await pool.query('SELECT created_by FROM timeline_events WHERE id=$1', [event.id])).rows[0].created_by).toBe('rbac-maker@amnex.com')
  })
})
