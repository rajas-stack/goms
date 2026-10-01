import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { loadEntityIndex, resolveImportCell } from '../lib/customFieldEntities.js'

// Master Grid refinement: the structured and entity-backed column types, grouped
// AND/OR filters (also persisted in saved views), and inline-edit history.
describe('custom column types, grouped filters and inline-edit history', () => {
  let departmentId: string
  const caller = () => appRouter.createCaller({ user: { email: 'rajas@amnex.com' } } as any)

  async function newBid(name: string) {
    const opp = await caller().opportunities.create({ departmentId, opportunityName: name, submissionDate: '2026-10-10' })
    return { bidId: (await caller().bids.create({ opportunityId: opp.id })).id, opportunityId: opp.id }
  }

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_custom_field_values')
    await pool.query('DELETE FROM bid_custom_fields')
    await pool.query('DELETE FROM bid_saved_views')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type IN ('bid','bidCustomField','bidCustomFieldValue')`)
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM ownership_assignments')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')
    await pool.query('DELETE FROM hierarchy_nodes')
    departmentId = (await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Health Dept' })).id
  })

  const salesPerson = (name: string, email: string) =>
    caller().sales.create({ name, officialEmail: email, designation: 'RM', tierKey: 'rm' }).then((p: any) => p.id as string)

  it('creates every new type; only select and multiselect take options', async () => {
    for (const dataType of ['currency', 'url', 'email', 'phone', 'person', 'department', 'state'] as const) {
      const f = await caller().bidCustomFields.create({ name: `col ${dataType}`, dataType })
      expect(f).toMatchObject({ dataType, options: null })
    }
    const regions = await caller().bidCustomFields.create({ name: 'Regions', dataType: 'multiselect', options: ['West', 'North'] })
    expect(regions.options).toEqual(['West', 'North'])
    await expect(caller().bidCustomFields.create({ name: 'Bad', dataType: 'multiselect' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.create({ name: 'Bad2', dataType: 'currency', options: ['x'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('stores and reads back currency, url, email, phone and multiselect in the right typed shape', async () => {
    const { bidId } = await newBid('Alpha')
    const make = (name: string, dataType: any, options?: string[]) => caller().bidCustomFields.create({ name, dataType, ...(options ? { options } : {}) })
    const budget = await make('Budget', 'currency'); const site = await make('Site', 'url'); const mail = await make('Mail', 'email')
    const phone = await make('Phone', 'phone'); const regions = await make('Regions', 'multiselect', ['West', 'North', 'South'])
    await caller().bidCustomFields.setValue({ bidId, fieldId: budget.id, value: '₹5,00,000' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: site.id, value: 'gem.gov.in/b/1' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: mail.id, value: 'A@B.CO' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: phone.id, value: '+91 98765 43210' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: regions.id, value: JSON.stringify(['South', 'West']) })
    const row = (await caller().bids.listForGrid({})).find((r: any) => r.id === bidId)!
    expect(row.customValues).toEqual({
      budget: 500000, site: 'https://gem.gov.in/b/1', mail: 'a@b.co', phone: '+919876543210', regions: '["West","South"]',
    })
    expect(typeof row.customValues.budget).toBe('number')
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: mail.id, value: 'nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: regions.id, value: '["East"]' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Clearing an empty multi-select deletes the value.
    await caller().bidCustomFields.setValue({ bidId, fieldId: regions.id, value: '[]' })
    expect((await caller().bidCustomFields.valuesForBid({ bidId })).regions).toBeUndefined()
  })

  it('person / department / state store the record reference, reject a dangling one, and audit the NAME', async () => {
    const { bidId } = await newBid('Alpha')
    const personId = await salesPerson('Asha Rao', 'asha@amnex.com')
    const lead = await caller().bidCustomFields.create({ name: 'Lead', dataType: 'person' })
    const dept = await caller().bidCustomFields.create({ name: 'Nodal Dept', dataType: 'department' })
    const where = await caller().bidCustomFields.create({ name: 'Where', dataType: 'state' })
    await pool.query(`INSERT INTO hierarchy_nodes (domain, type_key, state_code, name) VALUES ('geo','state',27,'Maharashtra')`)

    await caller().bidCustomFields.setValue({ bidId, fieldId: lead.id, value: personId })
    await caller().bidCustomFields.setValue({ bidId, fieldId: dept.id, value: departmentId })
    await caller().bidCustomFields.setValue({ bidId, fieldId: where.id, value: 27 })
    expect(await caller().bidCustomFields.valuesForBid({ bidId })).toEqual({ lead: personId, nodal_dept: departmentId, where: 27 })

    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: lead.id, value: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: lead.id, value: 'not-a-uuid' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: where.id, value: 99 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bidCustomFields.setValue({ bidId, fieldId: dept.id, value: personId })).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    const log = await caller().auditLogs.list({ entityType: 'bidCustomFieldValue', entityId: bidId })
    const newValue = (key: string) => log.find((l: any) => l.field === key)!.newValue
    expect(newValue('lead')).toBe('Asha Rao')
    expect(newValue('nodal_dept')).toBe('Health Dept')
    expect(newValue('where')).toBe('Maharashtra')
  })

  it('filters grouped AND / OR across standard, custom and entity columns', async () => {
    const [a, b, c] = [await newBid('Alpha'), await newBid('Beta'), await newBid('Gamma')]
    const personId = await salesPerson('Asha Rao', 'asha2@amnex.com')
    const tier = await caller().bidCustomFields.create({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
    const lead = await caller().bidCustomFields.create({ name: 'Lead', dataType: 'person' })
    const regions = await caller().bidCustomFields.create({ name: 'Regions', dataType: 'multiselect', options: ['West', 'North'] })
    await caller().bidCustomFields.setValue({ bidId: a.bidId, fieldId: tier.id, value: 'Gold' })
    await caller().bidCustomFields.setValue({ bidId: b.bidId, fieldId: lead.id, value: personId })
    await caller().bidCustomFields.setValue({ bidId: c.bidId, fieldId: regions.id, value: '["North"]' })
    const names = async (filterRules: any[]) => (await caller().bids.listForGrid({ filterRules })).map((r: any) => r.opportunityName).sort()

    // Tier = Gold OR Lead is Asha  → Alpha, Beta
    expect(await names([{ logic: 'or', rules: [
      { field: 'custom:tier', operator: 'eq', value: 'Gold' }, { field: 'custom:lead', operator: 'eq', value: personId },
    ] }])).toEqual(['Alpha', 'Beta'])
    // Opportunity name contains 'a' AND (Tier = Gold OR Regions includes North) → Alpha, Gamma
    expect(await names([
      { field: 'opportunityName', operator: 'contains', value: 'a' },
      { logic: 'or', rules: [
        { field: 'custom:tier', operator: 'eq', value: 'Gold' }, { field: 'custom:regions', operator: 'eq', value: 'North' },
      ] },
    ])).toEqual(['Alpha', 'Gamma'])
    // A flat list is still AND.
    expect(await names([{ field: 'custom:tier', operator: 'eq', value: 'Gold' }, { field: 'custom:lead', operator: 'eq', value: personId }])).toEqual([])
    // State is a first-class 'state' column: filter by its code.
    expect(await names([{ field: 'stateCode', operator: 'in', value: '', values: ['27'] }])).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(await names([{ field: 'stateCode', operator: 'eq', value: '12' }])).toEqual([])
  })

  it('rejects a malformed group or an operator that does not fit a standard column', async () => {
    await expect(caller().bids.listForGrid({ filterRules: [{ logic: 'xor', rules: [] } as any] })).rejects.toBeTruthy()
    await expect(caller().bidSavedViews.create({
      name: 'bad', scope: 'personal', filterRules: [{ logic: 'or', rules: [{ field: 'stageKey', operator: 'gt', value: '1' }] }],
    })).rejects.toBeTruthy()
  })

  it('persists a grouped filter in a saved view and returns it unchanged', async () => {
    const rules = [
      { field: 'opportunityName', operator: 'contains', value: 'a' },
      { logic: 'or', rules: [
        { field: 'custom:tier', operator: 'eq', value: 'Gold' },
        { field: 'custom:regions', operator: 'in', value: '', values: ['West', 'North'] },
      ] },
    ]
    const view = await caller().bidSavedViews.create({ name: 'Grouped', scope: 'personal', filterRules: rules as any })
    expect(view.filterRules).toEqual(rules)
    const listed = (await caller().bidSavedViews.list()).find((v: any) => v.id === view.id)!
    expect(listed.filterRules).toEqual(rules)
    const next = [{ logic: 'or', rules: [{ field: 'city', operator: 'eq', value: 'Pune' }, { field: 'city', operator: 'eq', value: 'Goa' }] }]
    const updated = await caller().bidSavedViews.update({ id: view.id, patch: { filterRules: next as any } })
    expect(updated.filterRules).toEqual(next)
    // Saved view rules on an archived custom column still load (never validated against current columns).
    expect((await caller().bidSavedViews.list()).find((v: any) => v.id === view.id)!.filterRules).toEqual(next)
  })

  it('logs inline City / Sector / name edits against the bid and marks it updated', async () => {
    const { bidId, opportunityId } = await newBid('Alpha')
    const before = (await pool.query('SELECT updated_at FROM bids WHERE id=$1', [bidId])).rows[0].updated_at
    await new Promise((r) => setTimeout(r, 15))
    await caller().opportunities.update({ id: opportunityId, patch: { city: 'Pune', vertical: 'Smart City' } })
    await caller().opportunities.update({ id: opportunityId, patch: { city: 'Pune' } }) // unchanged → no entry
    await caller().opportunities.update({ id: opportunityId, patch: { opportunityName: 'Alpha Prime' } })
    const log = await caller().auditLogs.list({ entityType: 'bid', entityId: bidId })
    expect(log.map((l: any) => [l.field, l.oldValue, l.newValue, l.changedBy]).sort()).toEqual([
      ['city', '', 'Pune', 'rajas@amnex.com'],
      ['opportunityName', 'Alpha', 'Alpha Prime', 'rajas@amnex.com'],
      ['vertical', '', 'Smart City', 'rajas@amnex.com'],
    ])
    const after = (await pool.query('SELECT updated_at FROM bids WHERE id=$1', [bidId])).rows[0].updated_at
    expect(after.getTime()).toBeGreaterThan(before.getTime())
    const row = (await caller().bids.listForGrid({})).find((r: any) => r.id === bidId)!
    expect(row).toMatchObject({ city: 'Pune', vertical: 'Smart City', opportunityName: 'Alpha Prime', updatedBy: 'rajas@amnex.com' })
  })

  it('an opportunity with no bid is edited without any bid history', async () => {
    const opp = await caller().opportunities.create({ departmentId, opportunityName: 'Lone', submissionDate: '2026-10-10' })
    await caller().opportunities.update({ id: opp.id, patch: { city: 'Pune' } })
    expect(await caller().auditLogs.list({ entityType: 'bid' })).toEqual([])
  })

  it('deleting a column that holds values needs withValues, then removes the values and logs it', async () => {
    const { bidId } = await newBid('Alpha')
    const f = await caller().bidCustomFields.create({ name: 'Note', dataType: 'text' })
    await caller().bidCustomFields.setValue({ bidId, fieldId: f.id, value: 'x' })
    await expect(caller().bidCustomFields.delete({ id: f.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    await caller().bidCustomFields.delete({ id: f.id, withValues: true })
    expect(await caller().bidCustomFields.list({ includeArchived: true })).toEqual([])
    expect((await pool.query('SELECT 1 FROM bid_custom_field_values')).rows).toEqual([])
    const log = await caller().auditLogs.list({ entityType: 'bidCustomField' })
    expect(log.find((l: any) => l.action === 'custom_field_deleted')?.reason).toBe('Deleted with 1 value')
  })

  it('a custom column belongs to the sheet it was added on (default Bid Tracker)', async () => {
    const a = await caller().bidCustomFields.create({ name: 'On tracker', dataType: 'text' })
    const b = await caller().bidCustomFields.create({ name: 'On pipeline', dataType: 'text', sheet: 'pipeline' })
    const c = await caller().bidCustomFields.create({ name: 'On campaign', dataType: 'text', sheet: 'campaign' })
    expect([a.sheet, b.sheet, c.sheet]).toEqual(['bidTracker', 'pipeline', 'campaign'])
    const listed = await caller().bidCustomFields.list()
    expect(Object.fromEntries(listed.map((f: any) => [f.name, f.sheet]))).toEqual({
      'On tracker': 'bidTracker', 'On pipeline': 'pipeline', 'On campaign': 'campaign',
    })
    await expect(caller().bidCustomFields.create({ name: 'Bad', dataType: 'text', sheet: 'nope' as any })).rejects.toBeTruthy()
  })

  describe('bulk import resolves names to references', () => {
    it('maps names / emails to ids, errors on unknown or ambiguous names, splits multi-selects', async () => {
      const personId = await salesPerson('Asha Rao', 'asha3@amnex.com')
      await pool.query(`INSERT INTO hierarchy_nodes (domain, type_key, state_code, name) VALUES ('geo','state',24,'Gujarat')`)
      await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 24, name: 'Health Dept' })
      const index = await loadEntityIndex(pool as any)
      expect(resolveImportCell('person', 'asha rao', index)).toBe(personId)
      expect(resolveImportCell('person', 'ASHA3@amnex.com', index)).toBe(personId)
      expect(resolveImportCell('state', 'gujarat', index)).toBe(24)
      expect(resolveImportCell('state', '24', index)).toBe(24)
      expect(() => resolveImportCell('person', 'Nobody', index)).toThrow(/No person named/)
      expect(() => resolveImportCell('state', 'Atlantis', index)).toThrow(/No state named/)
      // "Health Dept" exists under two states: ambiguous by name.
      expect(() => resolveImportCell('department', 'Health Dept', index)).toThrow(/more than one department/)
      expect(resolveImportCell('multiselect', 'West; North', index)).toBe('["West","North"]')
      expect(resolveImportCell('multiselect', 'West, North', index)).toBe('["West","North"]')
      expect(resolveImportCell('text', 'x', index)).toBe('x')
    })
  })
})
