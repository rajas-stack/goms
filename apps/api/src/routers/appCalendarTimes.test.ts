import { describe, expect, it } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('optional times outside Opportunity', () => {
  it('retains contact, charge, posting and ownership clocks through their real APIs', async () => {
    const caller = appRouter.createCaller({})
    const department = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Calendar integration department' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: department.id, stateCode: 27, name: 'Calendar branch' })
    const office = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Calendar office' })
    const employee = await caller.employees.create({ name: 'Calendar contact', designation: 'Officer', email: 'calendar-contact@example.com', phone: '9999999999', orgNodeId: office.id, managerId: null,
      lastInteractionAt: '2026-10-09T15:45', followUpDate: '2026-10-10T00:00' })
    expect(employee).toMatchObject({ lastInteractionAt: '2026-10-09T15:45', followUpDate: '2026-10-10T00:00' })
    await caller.employees.addCharge({ employeeId: employee.id, charge: { kind: 'acting', title: 'Acting officer', orgNodeId: office.id, startDate: '2026-10-09T09:30', endDate: '2026-10-20T18:00', reason: 'Temporary assignment' } })
    const charge = (await pool.query('SELECT start_date,end_date FROM employee_charges WHERE employee_id=$1', [employee.id])).rows[0]
    expect(charge).toEqual({ start_date: '2026-10-09T09:30', end_date: '2026-10-20T18:00' })
    const person = await caller.sales.create({ name: 'Calendar sales', officialEmail: 'calendar-sales@example.com', designation: 'RM', tierKey: 'rm' })
    const posting = (await caller.sales.listPostings({ salesPersonId: person.id }))[0]
    await caller.sales.updatePostingDates({ postingId: posting.id, startDate: '2026-10-01T09:30', lastDayHeld: '2026-10-20T18:00' })
    expect((await caller.sales.listPostings({ salesPersonId: person.id }))[0]).toMatchObject({ startDate: '2026-10-01T09:30', endDate: '2026-10-21T18:00' })
    await caller.ownership.assign({ entityType: 'orgNode', entityId: department.id, salesPersonId: person.id, startDate: '2026-10-09T15:45' })
    expect((await pool.query('SELECT start_date FROM ownership_assignments WHERE entity_id=$1', [department.id])).rows[0].start_date).toBe('2026-10-09T15:45')
  })

  it('keeps database validation of impossible dates and times', async () => {
    const values = ['2026-10-09', '2026-10-09T00:00', '2026-10-09T23:59', '2026-02-30', '2026-10-09T24:00']
    const result = await pool.query('SELECT value, goms_valid_calendar_value(value) AS valid FROM unnest($1::text[]) AS value', [values])
    expect(result.rows.map(row => row.valid)).toEqual([true, true, true, false, false])
  })
})
