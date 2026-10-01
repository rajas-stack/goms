import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

// Task 27d: custom values in the Master Grid query, archive-safe saved views,
// and Activity History. (Definition/value CRUD is in bidCustomFieldsRouter.test.ts.)
describe('custom fields × Master Grid / saved views / Activity History', () => {
  let departmentId: string
  const caller = () => appRouter.createCaller({})

  async function newBid(name: string) {
    const opp = await caller().opportunities.create({ departmentId, opportunityName: name, submissionDate: '2026-10-10' })
    return (await caller().bids.create({ opportunityId: opp.id })).id
  }

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_custom_field_values')
    await pool.query('DELETE FROM bid_custom_fields')
    await pool.query('DELETE FROM bid_saved_views')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type IN ('bidCustomField','bidCustomFieldValue')`)
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    departmentId = (await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
  })

  async function seed() {
    const score = await caller().bidCustomFields.create({ name: 'Score', dataType: 'number' })
    const note = await caller().bidCustomFields.create({ name: 'Note', dataType: 'text' })
    const tier = await caller().bidCustomFields.create({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
    const a = await newBid('Alpha')
    const b = await newBid('Beta')
    const c = await newBid('Gamma')
    await caller().bidCustomFields.setValue({ bidId: a, fieldId: score.id, value: 9 })
    await caller().bidCustomFields.setValue({ bidId: b, fieldId: score.id, value: 10 })
    await caller().bidCustomFields.setValue({ bidId: c, fieldId: score.id, value: 100 })
    await caller().bidCustomFields.setValue({ bidId: a, fieldId: note.id, value: 'Fast track' })
    await caller().bidCustomFields.setValue({ bidId: a, fieldId: tier.id, value: 'Gold' })
    await caller().bidCustomFields.setValue({ bidId: b, fieldId: tier.id, value: 'Silver' })
    return { score, note, tier, a, b, c }
  }

  const names = (rows: any[]) => rows.map((r) => r.opportunityName).sort()

  it('listForGrid returns typed customValues keyed by field key, for active fields only', async () => {
    const { a, score, note } = await seed()
    const rows = await caller().bids.listForGrid({})
    const rowA = rows.find((r: any) => r.id === a)!
    expect(rowA.customValues).toEqual({ score: 9, note: 'Fast track', tier: 'Gold' })
    expect(typeof rowA.customValues.score).toBe('number')
    expect(rows.find((r: any) => r.opportunityName === 'Gamma')!.customValues).toEqual({ score: 100 })

    await caller().bidCustomFields.archive({ id: note.id })
    const after = await caller().bids.listForGrid({})
    expect(after.find((r: any) => r.id === a)!.customValues).toEqual({ score: 9, tier: 'Gold' })
    void score
  })

  it('filters numerically, by text, by select and combines rules', async () => {
    await seed()
    const run = async (filterRules: any[]) => names(await caller().bids.listForGrid({ filterRules }))
    expect(await run([{ field: 'custom:score', operator: 'gt', value: '9' }])).toEqual(['Beta', 'Gamma'])
    expect(await run([{ field: 'custom:score', operator: 'between', value: '9', value2: '10' }])).toEqual(['Alpha', 'Beta'])
    expect(await run([{ field: 'custom:note', operator: 'contains', value: 'FAST' }])).toEqual(['Alpha'])
    expect(await run([{ field: 'custom:tier', operator: 'in', value: '', values: ['Gold', 'Silver'] }])).toEqual(['Alpha', 'Beta'])
    expect(await run([
      { field: 'custom:tier', operator: 'eq', value: 'Silver' },
      { field: 'custom:score', operator: 'lt', value: '50' },
    ])).toEqual(['Beta'])
  })

  it('a rule on an archived custom field is skipped while standard rules still apply', async () => {
    const { note } = await seed()
    await caller().bidCustomFields.archive({ id: note.id })
    const rules: any[] = [{ field: 'custom:note', operator: 'contains', value: 'zzz' }]
    expect(await caller().bids.listForGrid({ filterRules: rules })).toHaveLength(3)
    const mixed = [...rules, { field: 'custom:score', operator: 'gt', value: '50' }]
    expect(names(await caller().bids.listForGrid({ filterRules: mixed }))).toEqual(['Gamma'])
  })

  it('a saved view with a custom rule and ordered columns keeps working across archive / unarchive', async () => {
    const { note } = await seed()
    const asAlice = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    const view = await asAlice.bidSavedViews.create({
      name: 'Fast', scope: 'personal',
      filterRules: [{ field: 'custom:note', operator: 'contains', value: 'fast' }],
      visibleColumns: ['bidCode', 'custom:tier', 'custom:note', 'opportunityName'],
    })
    expect(view.visibleColumns).toEqual(['bidCode', 'custom:tier', 'custom:note', 'opportunityName']) // order preserved

    const load = async () => {
      const v = (await asAlice.bidSavedViews.list()).find((x: any) => x.id === view.id)!
      return names(await caller().bids.listForGrid({ filterRules: v.filterRules }))
    }
    expect(await load()).toEqual(['Alpha'])
    await caller().bidCustomFields.archive({ id: note.id })
    expect(await load()).toEqual(['Alpha', 'Beta', 'Gamma']) // rule ignored, nothing breaks
    const stored = (await asAlice.bidSavedViews.list()).find((x: any) => x.id === view.id)!
    expect(stored.filterRules).toHaveLength(1) // stored view NOT rewritten
    expect(stored.visibleColumns).toContain('custom:note')
    await caller().bidCustomFields.unarchive({ id: note.id })
    expect(await load()).toEqual(['Alpha'])
  })

  it('saved views accept typed operators and reject one that does not fit a known standard column', async () => {
    const asAlice = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    await expect(asAlice.bidSavedViews.create({
      name: 'Big', scope: 'personal', filterRules: [{ field: 'valueAmount', operator: 'between', value: '1', value2: '5' }],
    })).resolves.toBeTruthy()
    await expect(asAlice.bidSavedViews.create({
      name: 'Bad', scope: 'personal', filterRules: [{ field: 'stageKey', operator: 'gt', value: '1' }],
    })).rejects.toBeTruthy()
    await expect(asAlice.bidSavedViews.create({
      name: 'Unknown custom', scope: 'personal', filterRules: [{ field: 'custom:whatever', operator: 'gt', value: '1' }],
    })).resolves.toBeTruthy()
  })

  it('custom value edits appear in that bid\'s Activity History; definition changes in the top-level history', async () => {
    const { a, score } = await seed()
    await caller().bidCustomFields.setValue({ bidId: a, fieldId: score.id, value: 11 })
    const bidHistory = await caller().auditLogs.list({ entityType: 'bidCustomFieldValue', entityId: a })
    expect(bidHistory.map((r: any) => [r.field, r.oldValue, r.newValue, r.action])).toContainEqual(['score', '9', '11', 'custom_value_set'])
    const definitions = await caller().auditLogs.list({ entityType: 'bidCustomField' })
    expect(definitions.map((r: any) => r.action)).toContain('custom_field_created')
  })
})
