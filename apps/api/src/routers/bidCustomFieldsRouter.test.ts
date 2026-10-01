import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

// Router-level cases for Task 27c. (The pure domain helpers are covered in
// bidCustomFields.test.ts, per the "domain has no runner" Global Constraint.)
describe('bidCustomFields router', () => {
  let bidId: string
  const caller = () => appRouter.createCaller({})

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_custom_field_values')
    await pool.query('DELETE FROM bid_custom_fields')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type IN ('bidCustomField','bidCustomFieldValue')`)
    await pool.query('DELETE FROM protected_values')
    await pool.query('DELETE FROM bid_corrigendum_changes')
    await pool.query('DELETE FROM bid_corrigenda')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const c = caller()
    const dept = (await c.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    const opportunityId = (await c.opportunities.create({ departmentId: dept, opportunityName: 'Tender', submissionDate: '2026-10-10' })).id
    bidId = (await c.bids.create({ opportunityId })).id
  })

  const audits = async (entityType: string) =>
    (await pool.query('SELECT * FROM commercial_audit_logs WHERE entity_type=$1 ORDER BY changed_at, id', [entityType])).rows

  it('creates columns in order with deduped immutable keys', async () => {
    const a = await caller().bidCustomFields.create({ name: 'Client Contact', dataType: 'text' })
    await caller().bidCustomFields.archive({ id: a.id })
    const b = await caller().bidCustomFields.create({ name: 'Client Contact', dataType: 'text' })
    expect(a.key).toBe('client_contact')
    expect(b.key).toBe('client_contact_2')
    expect(b.position).toBeGreaterThan(a.position)
    expect((await caller().bidCustomFields.list()).map((f) => f.id)).toEqual([b.id])
    expect((await caller().bidCustomFields.list({ includeArchived: true })).map((f) => f.id)).toEqual([a.id, b.id])
  })

  it('rejects a duplicate active name (case-insensitive) but allows reuse after archive', async () => {
    const a = await caller().bidCustomFields.create({ name: 'Region', dataType: 'text' })
    await expect(caller().bidCustomFields.create({ name: ' region ', dataType: 'text' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await caller().bidCustomFields.archive({ id: a.id })
    await expect(caller().bidCustomFields.create({ name: 'Region', dataType: 'number' })).resolves.toBeTruthy()
    await expect(caller().bidCustomFields.unarchive({ id: a.id })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('validates select options at creation', async () => {
    await expect(caller().bidCustomFields.create({ name: 'Tier', dataType: 'select' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.create({ name: 'Tier', dataType: 'select', options: [' ', ''] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.create({ name: 'Note', dataType: 'text', options: ['x'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const tier = await caller().bidCustomFields.create({ name: 'Tier', dataType: 'select', options: ['Gold', ' gold ', 'Silver'] })
    expect(tier.options).toEqual(['Gold', 'Silver'])
  })

  it('rename changes the name only — key and type are immutable', async () => {
    const f = await caller().bidCustomFields.create({ name: 'Old Name', dataType: 'number' })
    const renamed = await caller().bidCustomFields.update({ id: f.id, patch: { name: 'New Name' } })
    expect(renamed.name).toBe('New Name')
    expect(renamed.key).toBe(f.key)
    expect(renamed.dataType).toBe('number')
    // Unknown patch keys (key/dataType) are stripped by zod, never applied.
    const sneaky = await caller().bidCustomFields.update({ id: f.id, patch: { name: 'New Name', dataType: 'text', key: 'x' } as any })
    expect(sneaky.dataType).toBe('number')
    expect(sneaky.key).toBe(f.key)
    await expect(caller().bidCustomFields.update({ id: f.id, patch: { options: ['a'] } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('removing an option keeps existing values, and a removed option can no longer be set', async () => {
    const tier = await caller().bidCustomFields.create({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
    await caller().bidCustomFields.setValue({ bidId, fieldId: tier.id, value: 'Silver' })
    await caller().bidCustomFields.update({ id: tier.id, patch: { options: ['Gold'] } })
    expect((await caller().bidCustomFields.valuesForBid({ bidId })).tier).toBe('Silver')
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: tier.id, value: 'Silver' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const log = (await audits('bidCustomField')).find((r) => r.action === 'custom_field_options_changed')
    expect(log.reason).toContain('Removed: Silver')
  })

  it('reorder requires exactly the active ids and rewrites positions', async () => {
    const a = await caller().bidCustomFields.create({ name: 'A', dataType: 'text' })
    const b = await caller().bidCustomFields.create({ name: 'B', dataType: 'text' })
    const c = await caller().bidCustomFields.create({ name: 'C', dataType: 'text' })
    await expect(caller().bidCustomFields.reorder({ ids: [a.id, b.id] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.reorder({ ids: [a.id, a.id, b.id] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const reordered = await caller().bidCustomFields.reorder({ ids: [c.id, a.id, b.id] })
    expect(reordered.map((f) => f.name)).toEqual(['C', 'A', 'B'])
    expect((await caller().bidCustomFields.list()).map((f) => f.name)).toEqual(['C', 'A', 'B'])
  })

  it('archive hides the column but keeps values; unarchive restores it', async () => {
    const f = await caller().bidCustomFields.create({ name: 'Score', dataType: 'number' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 42 })
    await caller().bidCustomFields.archive({ id: f.id })
    expect(await caller().bidCustomFields.list()).toHaveLength(0)
    expect(await caller().bidCustomFields.valuesForBid({ bidId })).toEqual({})
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await caller().bidCustomFields.unarchive({ id: f.id })
    expect((await caller().bidCustomFields.valuesForBid({ bidId })).score).toBe(42)
  })

  it('delete is allowed only for a column that has NEVER held a value — clearing a value does not make it deletable', async () => {
    const kept = await caller().bidCustomFields.create({ name: 'Kept', dataType: 'text' })
    expect(kept.hasHeldValue).toBe(false)
    await caller().bidCustomFields.setValue({ bidId, fieldId: kept.id, value: 'still here' })
    await expect(caller().bidCustomFields.delete({ id: kept.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await caller().bidCustomFields.list())[0].hasHeldValue).toBe(true)

    // Set, then cleared: the value row is gone, but the column HAS held a value.
    const cleared = await caller().bidCustomFields.create({ name: 'Cleared', dataType: 'text' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: cleared.id, value: 'x' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: cleared.id, value: null })
    expect((await pool.query('SELECT 1 FROM bid_custom_field_values WHERE field_id=$1', [cleared.id])).rows).toHaveLength(0)
    await expect(caller().bidCustomFields.delete({ id: cleared.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    // An invalid write never marks it.
    const rejected = await caller().bidCustomFields.create({ name: 'Rejected', dataType: 'number' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: rejected.id, value: 'abc' })).rejects.toBeTruthy()
    expect((await caller().bidCustomFields.list()).find((f) => f.id === rejected.id)!.hasHeldValue).toBe(false)
    await caller().bidCustomFields.delete({ id: rejected.id })
    // Archiving is always available, and it keeps the flag.
    await caller().bidCustomFields.archive({ id: cleared.id })
    expect((await caller().bidCustomFields.list({ includeArchived: true })).find((f) => f.id === cleared.id)!.hasHeldValue).toBe(true)

    const unused = await caller().bidCustomFields.create({ name: 'Unused', dataType: 'text' })
    await caller().bidCustomFields.delete({ id: unused.id })
    expect((await caller().bidCustomFields.list({ includeArchived: true })).map((f) => f.id).sort()).toEqual([kept.id, cleared.id].sort())
    expect((await audits('bidCustomField')).some((r) => r.action === 'custom_field_deleted')).toBe(true)
  })

  it('round-trips a typed value per type, in one row per bid+field', async () => {
    const num = await caller().bidCustomFields.create({ name: 'Score', dataType: 'number' })
    const date = await caller().bidCustomFields.create({ name: 'Review', dataType: 'date' })
    const flag = await caller().bidCustomFields.create({ name: 'Hot', dataType: 'boolean' })
    const txt = await caller().bidCustomFields.create({ name: 'Note', dataType: 'text' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: num.id, value: '12.5' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: date.id, value: '2026-10-31' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: flag.id, value: false })
    await caller().bidCustomFields.setValue({ bidId, fieldId: txt.id, value: 'hi' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: txt.id, value: 'hello' })
    expect(await caller().bidCustomFields.valuesForBid({ bidId })).toEqual({ score: 12.5, review: '2026-10-31', hot: false, note: 'hello' })
    const rows = (await pool.query('SELECT * FROM bid_custom_field_values WHERE field_id=$1', [txt.id])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].value_number).toBeNull()
  })

  it('rejects invalid values, and clearing removes the row', async () => {
    const num = await caller().bidCustomFields.create({ name: 'Score', dataType: 'number' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: num.id, value: 'abc' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: num.id, value: 5 })
    await caller().bidCustomFields.setValue({ bidId, fieldId: num.id, value: '' })
    expect((await pool.query('SELECT 1 FROM bid_custom_field_values')).rows).toHaveLength(0)
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(caller().bidCustomFields.setValue({ bidId: missing, fieldId: num.id, value: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: missing, value: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('audits definition changes and keys value edits to the bid', async () => {
    const f = await caller().bidCustomFields.create({ name: 'Score', dataType: 'number' })
    await caller().bidCustomFields.update({ id: f.id, patch: { name: 'Points' } })
    await caller().bidCustomFields.archive({ id: f.id })
    await caller().bidCustomFields.unarchive({ id: f.id })
    expect((await audits('bidCustomField')).map((r) => r.action)).toEqual([
      'custom_field_created', 'custom_field_renamed', 'custom_field_archived', 'custom_field_unarchived',
    ])

    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 1 })
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 2 })
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 2 }) // unchanged — no audit row
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: null })
    const rows = await audits('bidCustomFieldValue')
    expect(rows.map((r) => [r.action, r.old_value, r.new_value, r.entity_id, r.field])).toEqual([
      ['custom_value_set', '', '1', bidId, 'score'],
      ['custom_value_set', '1', '2', bidId, 'score'],
      ['custom_value_cleared', '2', '', bidId, 'score'],
    ])
  })

  it('custom values are ordinary: a frozen bid field does not block them, and they are not corrigendum targets', async () => {
    const f = await caller().bidCustomFields.create({ name: 'Note', dataType: 'text' })
    await caller().protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'tenderLink' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 'ok' })).resolves.toBeTruthy()
    await expect(caller().bidCorrigenda.create({
      bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'note', currentValue: '', proposedValue: 'x' }],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('deleting a bid cascades its custom values', async () => {
    const f = await caller().bidCustomFields.create({ name: 'Note', dataType: 'text' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 'x' })
    await caller().bids.delete({ id: bidId })
    expect((await pool.query('SELECT 1 FROM bid_custom_field_values')).rows).toHaveLength(0)
  })
})
