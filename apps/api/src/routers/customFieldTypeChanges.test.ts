import { beforeAll, describe, expect, it } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('custom column type changes through the API', () => {
  const caller = appRouter.createCaller({ user: { email: 'types@example.com' } } as any)
  let departmentId: string
  beforeAll(async () => {
    departmentId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Type change test department' })).id
  })
  async function bid(name: string) {
    const opportunity = await caller.opportunities.create({ departmentId, opportunityName: name, submissionDate: '2099-01-15' })
    return caller.bids.create({ opportunityId: opportunity.id })
  }

  it('retains compatible numeric values in the correct SQL storage column', async () => {
    const row = await bid('Numeric type change')
    const field = await caller.bidCustomFields.create({ name: 'Type estimate', dataType: 'number' })
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: field.id, value: 1250.5 })
    await caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'currency', expectedDataType: 'number' } })
    expect((await caller.bidCustomFields.valuesForBid({ bidId: row.id })).type_estimate).toBe(1250.5)
    expect((await pool.query('SELECT value_number::float8, value_text FROM bid_custom_field_values WHERE field_id=$1', [field.id])).rows[0]).toEqual({ value_number: 1250.5, value_text: null })
  })

  it('preserves dropdown values when choices are removed and converts to multi-select', async () => {
    const row = await bid('Dropdown type change')
    const field = await caller.bidCustomFields.create({ name: 'Type choice', dataType: 'select', options: ['Old', 'Keep'] })
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: field.id, value: 'Old' })
    const next = await caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'multiselect', options: ['Keep', 'New'] } })
    expect(next).toMatchObject({ dataType: 'multiselect', options: ['Keep', 'New'] })
    expect((await caller.bidCustomFields.valuesForBid({ bidId: row.id })).type_choice).toBe('["Old"]')
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: field.id, value: '["Keep","New"]' })
    await expect(caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'select' } })).rejects.toThrow(/one selection/)
    expect((await caller.bidCustomFields.valuesForBid({ bidId: row.id })).type_choice).toBe('["Keep","New"]')
  })

  it('resets unrelated values, preserves other columns and audits the old data', async () => {
    const row = await bid('Reset type change')
    const field = await caller.bidCustomFields.create({ name: 'Type reset', dataType: 'text' })
    const other = await caller.bidCustomFields.create({ name: 'Type intact', dataType: 'text' })
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: field.id, value: 'Before reset' })
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: other.id, value: 'Still here' })
    await expect(caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'date' } })).rejects.toThrow(/resetting/)
    await caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'date', resetValues: true } })
    expect(await caller.bidCustomFields.valuesForBid({ bidId: row.id })).toEqual({ type_intact: 'Still here' })
    const audit = await caller.auditLogs.list({ entityType: 'bidCustomFieldValue', entityId: row.id })
    expect(audit.some(entry => entry.oldValue === 'Before reset' && entry.newValue === '')).toBe(true)
    await caller.bidCustomFields.setValue({ bidId: row.id, fieldId: field.id, value: '2099-02-03' })
    expect((await caller.bidCustomFields.valuesForBid({ bidId: row.id })).type_reset).toBe('2099-02-03')
  })

  it('rolls back all row changes when a later row cannot be converted', async () => {
    const first = await bid('Atomic first'), second = await bid('Atomic second')
    const field = await caller.bidCustomFields.create({ name: 'Type atomic', dataType: 'text' })
    await caller.bidCustomFields.setValue({ bidId: first.id, fieldId: field.id, value: 'VALID@EXAMPLE.COM' })
    await caller.bidCustomFields.setValue({ bidId: second.id, fieldId: field.id, value: 'invalid' })
    await expect(caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'email', name: 'Should roll back' } })).rejects.toThrow()
    expect((await caller.bidCustomFields.list()).find(item => item.id === field.id)).toMatchObject({ name: 'Type atomic', dataType: 'text' })
    expect((await caller.bidCustomFields.valuesForBid({ bidId: first.id })).type_atomic).toBe('VALID@EXAMPLE.COM')
    await expect(caller.bidCustomFields.update({ id: field.id, patch: { dataType: 'number', expectedDataType: 'date', resetValues: true } })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
