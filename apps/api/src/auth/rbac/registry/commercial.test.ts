import { SKU_COST_FIELDS } from '@goms/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { pool } from '../../../db.js'
import { contextForEmail } from '../../../testHelpers/authTestHelpers.js'
import { cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { commercialPolicy } from './commercial.js'

const facts = (label: string) => loadUserFacts(rbacEmail(label))
const denied = async (label: string, path: string, raw?: unknown) => (await decide(path, raw, await facts(label))).denial !== null

beforeEach(async () => {
  await cleanupRbacFixtures()
  for (const role of ['presales', 'finance', 'cxo', 'sales', 'bid', 'legal', 'delivery', 'it'] as const) await setRole(role, role)
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE
  await cleanupRbacFixtures()
})

describe('coverage', () => {
  it('registers 33 commercial procedures', () => { expect(Object.keys(commercialPolicy)).toHaveLength(33) })
})

describe('ownership of commercial data (decision 3)', () => {
  it('Pre-sales owns reference masters, SKUs and BOQs', async () => {
    expect(await denied('presales', 'commercial.masters.create', { key: 'verticals', input: {} })).toBe(false)
    expect(await denied('presales', 'commercial.skus.create', {})).toBe(false)
    expect(await denied('presales', 'commercial.boq.create', {})).toBe(false)
    expect(await denied('presales', 'commercial.boq.addLineItem', {})).toBe(false)
  })
  it('Finance controls tax classes and currencies — and only those masters', async () => {
    expect(await denied('finance', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(false)
    expect(await denied('finance', 'commercial.masters.setActive', { key: 'currencies', id: 'x', active: false })).toBe(false)
    expect(await denied('finance', 'commercial.masters.update', { key: 'verticals', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'verticals', id: 'x', patch: {} })).toBe(false)
  })
  it('CXO owns the Approval Matrix; Finance and Pre-sales only read it', async () => {
    expect(await denied('cxo', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(false)
    expect(await denied('finance', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(true)
    expect(await denied('presales', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(true)
    expect(await denied('finance', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(false)
    expect(await denied('presales', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(false)
    expect(await denied('sales', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(true)
  })
  it('Finance edits SKU cost / floor / tax fields and nothing else; Pre-sales cannot edit those after creation', async () => {
    expect(await denied('finance', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, floorPrice: 2, taxClassId: 'y' } })).toBe(false)
    expect(await denied('finance', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, listPrice: 5 } })).toBe(true)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { listPrice: 5, name: 'n' } })).toBe(false)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1 } })).toBe(true)
    expect(await denied('presales', 'commercial.skus.update', { id: 'x', patch: { internalPrice: 1 } })).toBe(true)
  })
  it('a role cannot edit a field it cannot read', async () => {
    expect(await denied('sales', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1 } })).toBe(true)
  })
  it('BOQ approve / reject is CXO-only; Pre-sales edits lines; Finance only reads', async () => {
    expect(await denied('cxo', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(false)
    expect(await denied('presales', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(true)
    expect(await denied('presales', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'submitted', changeReason: 'ok' })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'submitted', changeReason: 'ok' })).toBe(true)
    expect(await denied('cxo', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved' } })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.updateLineItem', { id: 'x', patch: { quantity: 3 } })).toBe(true)
    expect(await denied('presales', 'commercial.boq.updateLineItem', { id: 'x', patch: { quantity: 3 } })).toBe(false)
    expect(await denied('presales', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved' } })).toBe(true)
    expect(await denied('finance', 'commercial.boq.get', { id: 'x' })).toBe(false)
    expect(await denied('finance', 'commercial.boq.update', { id: 'x', patch: {} })).toBe(true)
  })
  it('reading BOQs implies read of SKUs and reference masters (gap A2), but not the approval matrix', async () => {
    expect(await denied('bid', 'commercial.skus.list')).toBe(false)
    expect(await denied('bid', 'commercial.masters.list', { key: 'currencies' })).toBe(false)
    expect(await denied('bid', 'commercial.masters.list', { key: 'approvalMatrix' })).toBe(true)
    expect(await denied('legal', 'commercial.skus.list')).toBe(true)
    expect(await denied('delivery', 'commercial.boq.list')).toBe(true)
  })
  it('tax classes and currencies are Finance-controlled all the way: Pre-sales cannot delete them (review finding 6)', async () => {
    expect(await denied('presales', 'commercial.masters.delete', { key: 'taxClasses', id: 'x' })).toBe(true)
    expect(await denied('presales', 'commercial.masters.delete', { key: 'currencies', id: 'x' })).toBe(true)
    expect(await denied('finance', 'commercial.masters.delete', { key: 'currencies', id: 'x' })).toBe(false)
    expect(await denied('presales', 'commercial.masters.delete', { key: 'verticals', id: 'x' })).toBe(false)
    expect(await denied('finance', 'commercial.masters.delete', { key: 'verticals', id: 'x' })).toBe(true)
  })
  it('only Pre-sales (and System Admin) delete commercial records', async () => {
    expect(await denied('presales', 'commercial.boq.delete', { id: 'x' })).toBe(false)
    expect(await denied('cxo', 'commercial.boq.delete', { id: 'x' })).toBe(true)
  })
})

describe('System Admin (spec §3.4)', () => {
  beforeEach(() => makeSystemAdmin('root'))

  it('administers every commercial area: masters (incl. Finance-controlled and the approval matrix), SKUs, BOQs', async () => {
    expect(await denied('root', 'commercial.masters.update', { key: 'taxClasses', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.update', { key: 'currencies', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.update', { key: 'approvalMatrix', id: 'x', patch: {} })).toBe(false)
    expect(await denied('root', 'commercial.masters.delete', { key: 'verticals', id: 'x' })).toBe(false)
    expect(await denied('root', 'commercial.skus.update', { id: 'x', patch: { hardwareCost: 1, floorPrice: 2, internalPrice: 3, taxClassId: 'y', listPrice: 5 } })).toBe(false)
    expect(await denied('root', 'commercial.skus.delete', { id: 'x' })).toBe(false)
    expect(await denied('root', 'commercial.boq.updateStatus', { id: 'x', nextStatus: 'approved', changeReason: 'ok' })).toBe(false)
    expect(await denied('root', 'commercial.boq.updateLineItem', { id: 'x', patch: { approvalStatus: 'approved', quantity: 3 } })).toBe(false)
    expect(await denied('root', 'commercial.boq.delete', { id: 'x' })).toBe(false)
  })
  it('still refuses a SKU patch key with no atom (not a bypass for malformed input)', async () => {
    expect(await denied('root', 'commercial.boq.updateLineItem', { id: 'x', patch: 'nonsense' })).toBe(true)
  })
})

describe('server-side read masking — sentinel golden test', () => {
  const COST = [7001, 7002, 7003, 7004, 7005, 7006, 7007, 7008]
  const FLOOR = { floorPrice: 7101, minimumAllowedPrice: 7102, internalPrice: 7103 }
  let skuId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    const off = appRouter.createCaller({}) // RBAC off: build the fixture
    const m = (key: string, input: any) => off.commercial.masters.create({ key: key as any, input })
    const vertical = await m('verticals', { code: 'GOV', name: 'Government', description: '' })
    const product = await m('products', { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id })
    const module_ = await m('modules', { code: 'ACCT', name: 'Accounts', description: '', productId: product.id })
    const feature = await m('features', { code: 'F1', name: 'F1', description: '', moduleId: module_.id, status: 'new' })
    const category = await m('skuCategories', { code: 'STD', name: 'Standard', description: '' })
    const uom = await m('unitsOfMeasure', { code: 'LIC', name: 'License', description: '' })
    const currency = await m('currencies', { code: 'INR', name: 'Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true })
    const taxClass = await m('taxClasses', { code: 'GST18', name: 'GST', description: '', ratePct: 18 })
    const billingType = await m('billingTypes', { code: 'OT', name: 'One-Time', description: '' })
    await m('productEditions', { code: 'STD', name: 'Standard', description: '' }) // skus.create resolves "the" standard edition by this code
    const sku = await off.commercial.skus.create({
      name: 'Sentinel', categoryId: category.id, featureId: feature.id, uomId: uom.id, currencyId: currency.id, taxClassId: taxClass.id,
      billingTypeId: billingType.id, activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: COST[0], implementationCostPerMM: COST[1], integrationCost: COST[2], thirdPartyCost: COST[3],
      hardwareCost: COST[4], cloudCost: COST[5], supportCost: COST[6], trainingCost: COST[7],
      ...FLOOR, partnerPrice: 90, governmentPrice: 91, enterprisePrice: 92, corporatePrice: 93, listPrice: 100,
    })
    skuId = sku.id
  })

  const SENTINELS = [...COST, ...Object.values(FLOOR)].map(String)
  const leaks = (value: unknown) => SENTINELS.filter((s) => JSON.stringify(value).includes(s))
  const as = (label: string) => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    return appRouter.createCaller(contextForEmail(rbacEmail(label)))
  }

  // Sales reads SKUs directly; Bid reads them through the BOQ → SKU implied read (gap A2). IT and Legal cannot call these at all.
  it.each(['sales', 'bid'])('%s never receives a cost or floor-price value from the SKU procedures', async (label) => {
    const caller = as(label)
    const list = await caller.commercial.skus.list()
    const one = await caller.commercial.skus.get({ id: skuId })
    expect(leaks(list)).toEqual([])
    expect(leaks(one)).toEqual([])
    expect((one as any).hardwareCost).toBeNull()
    expect((one as any).floorPrice).toBeNull()
    expect((one as any).listPrice).toBe(100)
    expect((one as any).maskedFields).toEqual(expect.arrayContaining([...SKU_COST_FIELDS, 'floorPrice', 'minimumAllowedPrice', 'internalPrice']))
  })

  it.each(['presales', 'finance', 'cxo'])('%s sees real cost and floor-price values', async (label) => {
    const one = await as(label).commercial.skus.get({ id: skuId })
    expect((one as any).hardwareCost).toBe(COST[4])
    expect((one as any).floorPrice).toBe(FLOOR.floorPrice)
    expect((one as any).maskedFields).toEqual([])
  })

  it('a System Admin sees real cost and floor-price values too', async () => {
    makeSystemAdmin('root')
    const one = await as('root').commercial.skus.get({ id: skuId })
    expect((one as any).hardwareCost).toBe(COST[4])
    expect((one as any).floorPrice).toBe(FLOOR.floorPrice)
    expect((one as any).maskedFields).toEqual([])
  })

  it('the audit log of a SKU cost change does not leak old/new values to a masked role', async () => {
    await as('finance').commercial.skus.update({ id: skuId, patch: { hardwareCost: 7777 }, changeReason: 'repricing' })
    const seen = await as('sales').commercial.auditLogs.list({ entityType: 'sku', entityId: skuId })
    expect(JSON.stringify(seen)).not.toContain('7777')
    expect(JSON.stringify(seen)).not.toContain(String(COST[4]))
    const realView = await as('finance').commercial.auditLogs.list({ entityType: 'sku', entityId: skuId })
    expect(JSON.stringify(realView)).toContain('7777')
  })

  it('nothing else a masked role can call returns a sentinel (BOM, masters, BOQ lists)', async () => {
    const caller = as('bid')
    expect(leaks(await caller.commercial.bom.listAll())).toEqual([])
    expect(leaks(await caller.commercial.boq.list())).toEqual([])
    expect(leaks(await caller.commercial.boq.listAllLineItems())).toEqual([])
  })
})
