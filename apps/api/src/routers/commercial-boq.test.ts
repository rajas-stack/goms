import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('commercial.boq + commercial.auditLogs routers', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_boq_number_sequences')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
  })

  type Caller = ReturnType<typeof appRouter.createCaller>

  async function makeDepartment(caller: Caller, name = 'Dept') {
    return caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name })
  }

  async function makeSalesPerson(caller: Caller, name = 'Alex Sales') {
    return caller.sales.create({
      name, officialEmail: `${name.replace(/\s+/g, '.').toLowerCase()}-${Math.random()}@example.com`,
      designation: 'Account Manager', tierKey: 'accountManager',
    })
  }

  async function makeApprover(caller: Caller, orgNodeId: string, name = 'Approver One') {
    return caller.employees.create({ name, designation: 'Manager', email: '', phone: '', orgNodeId, managerId: null })
  }

  async function makeMastersForSku(caller: Caller) {
    const vertical = await caller.commercial.masters.create({ key: 'verticals', input: { code: 'GOV', name: 'Government', description: '' } })
    const product = await caller.commercial.masters.create({ key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id } })
    const module_ = await caller.commercial.masters.create({ key: 'modules', input: { code: 'ACCT', name: 'Account Mapping', description: '', productId: product.id } })
    const feature = await caller.commercial.masters.create({
      key: 'features', input: { code: 'F1', name: 'Feature 1', description: '', moduleId: module_.id, status: 'new' },
    })
    const category = await caller.commercial.masters.create({ key: 'skuCategories', input: { code: 'STD', name: 'Standard', description: '' } })
    const uom = await caller.commercial.masters.create({ key: 'unitsOfMeasure', input: { code: 'LIC', name: 'License', description: '' } })
    const currency = await caller.commercial.masters.create({
      key: 'currencies', input: { code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true },
    })
    const taxClass = await caller.commercial.masters.create({ key: 'taxClasses', input: { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18 } })
    const billingType = await caller.commercial.masters.create({ key: 'billingTypes', input: { code: 'OT', name: 'One-Time', description: '' } })
    const edition = await caller.commercial.masters.create({ key: 'productEditions', input: { code: 'STD', name: 'Standard', description: '' } })
    await caller.commercial.masters.create({
      key: 'approvalMatrix',
      input: { code: 'B0', name: 'Auto', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: 'Auto', allowAutoApproval: true },
    })
    await caller.commercial.masters.create({
      key: 'approvalMatrix',
      input: { code: 'B1', name: 'Sales Head', description: '', minDiscountPct: 10, maxDiscountPct: 25, approvalLevelLabel: 'Sales Head', allowAutoApproval: false },
    })
    await caller.commercial.masters.create({
      key: 'approvalMatrix',
      input: { code: 'B2', name: 'CEO', description: '', minDiscountPct: 25, maxDiscountPct: 90, approvalLevelLabel: 'CEO', allowAutoApproval: false },
    })
    return { vertical, product, module: module_, feature, category, uom, currency, taxClass, billingType, edition }
  }

  async function makeSku(caller: Caller, masters: Awaited<ReturnType<typeof makeMastersForSku>>, overrides: Record<string, any> = {}) {
    return caller.commercial.skus.create({
      name: 'Standard License', categoryId: masters.category.id, featureId: masters.feature.id,
      uomId: masters.uom.id, currencyId: masters.currency.id, taxClassId: masters.taxClass.id, billingTypeId: masters.billingType.id,
      activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 5000, floorPrice: 6000, partnerPrice: 7000, governmentPrice: 8000,
      enterprisePrice: 9000, corporatePrice: 9500, listPrice: 10000,
      minimumAllowedPrice: 6000, maximumDiscountPercent: 40,
      ...overrides,
    })
  }

  async function makeBoq(caller: Caller, dept: { id: string }, salesPerson: { id: string }, overrides: Record<string, any> = {}) {
    return caller.commercial.boq.create({
      opportunityName: overrides.opportunityName ?? `Opportunity ${Math.random()}`,
      departmentId: dept.id, customerName: 'Acme Corp', customerOrganization: '', customerAddress: '', customerContact: '',
      verticalId: overrides.verticalId, budgetAmount: '', budgetUnit: '', budgetKnown: 'yes', emdAmount: '', emdUnit: '',
      salesPersonId: salesPerson.id, buSalesPersonId: null, preSalesId: null, currency: 'INR',
      ...overrides,
    })
  }

  async function setup(caller: Caller) {
    const dept = await makeDepartment(caller)
    const salesPerson = await makeSalesPerson(caller)
    const masters = await makeMastersForSku(caller)
    const sku = await makeSku(caller, masters)
    return { dept, salesPerson, masters, sku }
  }

  it('numbers a BOQ as BOQ-{year}-{6-digit sequence} and never reuses a number across creates', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const year = new Date().getFullYear()
    const a = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const b = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    expect(a.boqNumber).toMatch(new RegExp(`^BOQ-${year}-\\d{6}$`))
    expect(b.boqNumber).not.toBe(a.boqNumber)
  })

  it('rejects a second BOQ with the same (trimmed, case-insensitive) opportunity name', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const first = await makeBoq(caller, dept, salesPerson, { opportunityName: 'Big Deal', verticalId: masters.vertical.id })
    await expect(makeBoq(caller, dept, salesPerson, { opportunityName: '  big deal  ', verticalId: masters.vertical.id }))
      .rejects.toThrow(new RegExp(first.boqNumber))
  })

  it('allows two BOQs with a blank opportunity name (blanks never clash)', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    await expect(makeBoq(caller, dept, salesPerson, { opportunityName: '', verticalId: masters.vertical.id })).resolves.toBeTruthy()
    await expect(makeBoq(caller, dept, salesPerson, { opportunityName: '', verticalId: masters.vertical.id })).resolves.toBeTruthy()
  })

  it('logs a create audit entry on the new BOQ, readable via commercial.auditLogs.list', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const logs = await caller.commercial.auditLogs.list({ entityType: 'boq', entityId: boq.id })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ field: 'boqNumber', action: 'create', newValue: boq.boqNumber })
  })

  it('rejects editing metadata once the BOQ has left draft', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'go' })
    await expect(caller.commercial.boq.update({ id: boq.id, patch: { customerName: 'New Name' } })).rejects.toThrow(/draft/i)
  })

  it('rejects a line quantity below 1', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await expect(caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 0, unitPrice: 10000, discountPct: 0 }))
      .rejects.toThrow(/at least 1/i)
  })

  it('rejects a discount above the SKU maximum', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await expect(caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 50 }))
      .rejects.toThrow(/exceeds/i)
  })

  it('rejects a unit price whose post-discount price is below the SKU minimum', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    // listPrice 10000, 40% max discount -> 6000 floor; a price of 6500 at 10% discount = 5850, below the 6000 minimum
    await expect(caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 6500, discountPct: 10 }))
      .rejects.toThrow(/minimum allowed price/i)
  })

  it('auto-approves a line in the 0-10% band and sets grand total, recomputed after add/update/remove', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const line = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 2, unitPrice: 10000, discountPct: 5 })
    expect(line.approvalStatus).toBe('auto_approved')
    // 2 * (10000 * 0.95) * 1.18 = 22420
    expect(line.lineTotal).toBeCloseTo(22420, 2)
    let refreshed = await caller.commercial.boq.get({ id: boq.id })
    expect(refreshed!.grandTotal).toBeCloseTo(22420, 2)

    await caller.commercial.boq.updateLineItem({ id: line.id, patch: { quantity: 3 } })
    refreshed = await caller.commercial.boq.get({ id: boq.id })
    expect(refreshed!.grandTotal).toBeCloseTo(33630, 2)

    await caller.commercial.boq.removeLineItem({ id: line.id })
    refreshed = await caller.commercial.boq.get({ id: boq.id })
    expect(refreshed!.grandTotal).toBe(0)
  })

  it('resets a line to pending and clears the approver when its discount moves into a non-auto band', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const line = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 5 })
    expect(line.approvalStatus).toBe('auto_approved')
    const approver = await makeApprover(caller, dept.id)
    await caller.commercial.boq.updateLineItem({
      id: line.id, patch: { approvalStatus: 'approved', approverId: approver.id, approvalDate: '2026-08-25', approvalRemarks: 'ok' },
    })
    const updated = await caller.commercial.boq.updateLineItem({ id: line.id, patch: { discountPct: 20 } })
    expect(updated.approvalStatus).toBe('pending')
    expect(updated.approverId).toBeNull()
    expect(updated.approvalDate).toBeNull()
    const logs = await caller.commercial.auditLogs.list({ entityType: 'boqLineItem', entityId: line.id })
    expect(logs.some((l) => l.field === 'discountPct')).toBe(true)
  })

  it('bidirectional pricing: a Selling Price implies the same Discount % that Selling-Price-for-Discount-% would produce', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    // listPrice 10000; a floor-level selling price of 8000 implies a 20% discount
    const line = await caller.commercial.boq.addLineItem({
      boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 8000, discountPct: 20,
      pricingLevels: [{ level: 'floor', sellingPrice: 8000 }], activePricingLevel: 'floor',
    })
    expect(line.discountPct).toBe(20)
    const lines = await caller.commercial.boq.listLineItems({ boqId: boq.id })
    expect(lines[0].unitPrice).toBe(8000)
  })

  it('recomputes a draft BOQ line live off the SKU current price, but freezes it once submitted', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 0 })
    await caller.commercial.skus.update({ id: sku.id, patch: { listPrice: 12000 }, changeReason: 'price update' })

    const draftLines = await caller.commercial.boq.listLineItems({ boqId: boq.id })
    expect(draftLines[0].unitPrice).toBe(12000)
    const draftBoq = await caller.commercial.boq.get({ id: boq.id })
    expect(draftBoq!.grandTotal).toBeCloseTo(12000 * 1.18, 2)

    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'go' })
    await caller.commercial.skus.update({ id: sku.id, patch: { listPrice: 15000 }, changeReason: 'price update again' })
    const frozenLines = await caller.commercial.boq.listLineItems({ boqId: boq.id })
    // Frozen reverts to the STORED snapshot from creation time (the caller-
    // supplied unitPrice, 10000) — the live "12000" view above was never
    // written back to the row, only shown while still draft.
    expect(frozenLines[0].unitPrice).toBe(10000)
  })

  it('walks the full status lifecycle and blocks approval while a line is unresolved, then allows it once resolved', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const line = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 20 })
    expect(line.approvalStatus).toBe('pending')

    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'submit' })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'under_review', changeReason: 'review' })
    await expect(caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'approved', changeReason: 'approve' }))
      .rejects.toThrow(/do not have an approved discount status/i)

    const approver = await makeApprover(caller, dept.id)
    await caller.commercial.boq.updateLineItem({
      id: line.id, patch: { approvalStatus: 'approved', approverId: approver.id, approvalDate: '2026-08-25', approvalRemarks: 'ok' },
    })
    const approved = await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'approved', changeReason: 'approve' })
    expect(approved.status).toBe('approved')

    await expect(caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'cancelled', changeReason: 'x' })).rejects.toThrow(/cannot transition/i)
    const archived = await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'archived', changeReason: 'done' })
    expect(archived.status).toBe('archived')

    const logs = await caller.commercial.auditLogs.list({ entityType: 'boq', entityId: boq.id })
    expect(logs.filter((l) => l.action === 'status_change')).toHaveLength(4)
  })

  it('rejects transitions not in BOQ_TRANSITIONS', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await expect(caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'approved', changeReason: 'x' })).rejects.toThrow(/cannot transition/i)
  })

  it('revise keeps the same boqNumber, links parentBoqId, and copies lines with a fresh approval state', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const line = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 20 })
    const approver = await makeApprover(caller, dept.id)
    await caller.commercial.boq.updateLineItem({ id: line.id, patch: { approvalStatus: 'rejected', approverId: approver.id, approvalDate: '2026-08-25' } })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'x' })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'under_review', changeReason: 'x' })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'rejected', changeReason: 'no' })

    const revised = await caller.commercial.boq.revise({ id: boq.id })
    expect(revised.boqNumber).toBe(boq.boqNumber)
    expect(revised.parentBoqId).toBe(boq.id)
    expect(revised.boqVersion).toBe(2)
    expect(revised.status).toBe('draft')

    const revisedLines = await caller.commercial.boq.listLineItems({ boqId: revised.id })
    expect(revisedLines).toHaveLength(1)
    expect(revisedLines[0].approvalStatus).toBe('pending') // 20% discount -> not auto-approved
    expect(revisedLines[0].approverId).toBeNull()
  })

  it('duplicate mints a fresh boqNumber with no parentBoqId', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 5 })
    const duplicate = await caller.commercial.boq.duplicate({ id: boq.id })
    expect(duplicate.boqNumber).not.toBe(boq.boqNumber)
    expect(duplicate.parentBoqId).toBeNull()
    expect(duplicate.boqVersion).toBe(1)
    const lines = await caller.commercial.boq.listLineItems({ boqId: duplicate.id })
    expect(lines).toHaveLength(1)
  })

  it('reorders line items within a draft BOQ only', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const a = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 0 })
    const b = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 0 })
    await caller.commercial.boq.reorderLineItems({ boqId: boq.id, orderedIds: [b.id, a.id] })
    const lines = await caller.commercial.boq.listLineItems({ boqId: boq.id })
    expect(lines.map((l) => l.id)).toEqual([b.id, a.id])

    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'x' })
    await expect(caller.commercial.boq.reorderLineItems({ boqId: boq.id, orderedIds: [a.id, b.id] })).rejects.toThrow(/draft/i)
  })

  it('delete is gated by status — must cancel an active BOQ first', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'submitted', changeReason: 'x' })
    await expect(caller.commercial.boq.delete({ id: boq.id })).rejects.toThrow(/cancel it first/i)
    await caller.commercial.boq.updateStatus({ id: boq.id, nextStatus: 'cancelled', changeReason: 'x' })
    await caller.commercial.boq.delete({ id: boq.id })
    expect(await caller.commercial.boq.get({ id: boq.id })).toBeNull()
  })

  it('deleting a BOQ cascades its line items', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    const line = await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 0 })
    await caller.commercial.boq.delete({ id: boq.id })
    const remaining = await caller.commercial.boq.listAllLineItems()
    expect(remaining.find((l) => l.id === line.id)).toBeUndefined()
  })

  it('PCS-038 (BOQ half): rejects deleting a SKU still referenced by a BOQ line item', async () => {
    const caller = appRouter.createCaller({})
    const { dept, salesPerson, masters, sku } = await setup(caller)
    const boq = await makeBoq(caller, dept, salesPerson, { verticalId: masters.vertical.id })
    await caller.commercial.boq.addLineItem({ boqId: boq.id, skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 0 })
    await expect(caller.commercial.skus.delete({ id: sku.id })).rejects.toThrow(/still referenced/i)
  })
})
