// Integration test — needs a running apps/api instance (VITE_API_BASE_URL)
// backed by a real Postgres. Excluded from the default `npm test` run (see
// vite.config.ts); run manually against a local `npm --workspace apps/api
// run dev` (or, later, the deployed dev Cloud Run URL).
import { describe, it, expect } from 'vitest'
import { RemoteRepository } from './repository'

describe.skipIf(!import.meta.env.VITE_API_BASE_URL)('RemoteRepository (integration)', () => {
  const repo = new RemoteRepository()

  it('round-trips a customer through create/get/update/delete', async () => {
    const created = await repo.createCustomer!({ name: 'Integration Test Co' })
    expect(created.name).toBe('Integration Test Co')

    const fetched = await repo.getCustomer!(created.id)
    expect(fetched?.id).toBe(created.id)

    const updated = await repo.updateCustomer!(created.id, { name: 'Renamed Co' })
    expect(updated.name).toBe('Renamed Co')

    await repo.deleteCustomer!(created.id)
    const afterDelete = await repo.getCustomer!(created.id)
    expect(afterDelete).toBeNull()
  })

  it('round-trips a hierarchy node through create/getNode/listChildren/deleteNode', async () => {
    const dept = await repo.createNode!({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Test Dept',
    })
    expect(dept.name).toBe('Integration Test Dept')

    const branch = await repo.createNode!({
      domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Integration Test Branch',
    })
    const children = await repo.listChildren!(dept.id)
    expect(children.map((c) => c.id)).toContain(branch.id)

    await repo.deleteNode!(dept.id)
    expect(await repo.getNode!(dept.id)).toBeUndefined()
    expect(await repo.getNode!(branch.id)).toBeUndefined()
  })

  it('round-trips an employee through create/get/transfer/timeline/delete', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Test Dept' })
    const officeA = await repo.createNode!({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office A' })
    const officeB = await repo.createNode!({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office B' })

    const emp = await repo.createEmployee!({
      name: 'Integration Employee', designation: 'Officer', email: 'test@example.com', phone: '9999999999',
      orgNodeId: officeA.id, managerId: null,
    })
    expect(emp.name).toBe('Integration Employee')

    const transfer = await repo.transferEmployee!({
      employeeId: emp.id, toOrgNodeId: officeB.id, toDesignation: 'Senior Officer',
      effectiveDate: '2026-02-01', reason: 'Promotion',
    })
    expect(transfer.toOrgNodeId).toBe(officeB.id)

    const timeline = await repo.listTimeline!(emp.id)
    expect(timeline.some((t) => t.type === 'transferred')).toBe(true)

    await repo.deleteEmployee!(emp.id)
    expect(await repo.getEmployee!(emp.id)).toBeNull()
    await repo.deleteNode!(dept.id)
  })

  it('round-trips a sales person through create/get/transfer/currentPostings/delete', async () => {
    const person = await repo.createSalesPerson!({
      name: 'Integration Sales', officialEmail: `integration-${Date.now()}@example.com`,
      designation: 'Account Manager', tierKey: 'accountManager',
    })
    expect(person.name).toBe('Integration Sales')

    const posting = await repo.transferSalesPerson!({
      salesPersonId: person.id, designation: 'Regional Manager', tierKey: 'rm', effectiveDate: '2099-01-01',
    })
    expect(posting.changeType).toBe('promotion')

    const current = await repo.currentPostings!()
    expect(current[person.id]?.tierKey).toBe('rm')

    await repo.deleteSalesPerson!(person.id)
    expect(await repo.getSalesPerson!(person.id)).toBeNull()
  })

  it('round-trips the Vertical -> Product -> Module -> Feature chain and edition features', async () => {
    const vertical = await repo.createMaster!('verticals', {
      code: `INT-V-${Date.now()}`, name: 'Integration Vertical', description: '',
    })
    const product = await repo.createMaster!('products', {
      code: `INT-P-${Date.now()}`, name: 'Integration Product', description: '', verticalId: vertical.id,
    })
    const module_ = await repo.createMaster!('modules', {
      code: `INT-M-${Date.now()}`, name: 'Integration Module', description: '', productId: product.id,
    })
    const feature = await repo.createMaster!('features', {
      code: `INT-F-${Date.now()}`, name: 'Integration Feature', description: '', moduleId: module_.id, status: 'new',
    })
    expect(product.verticalId).toBe(vertical.id)
    expect(feature.moduleId).toBe(module_.id)

    const products = await repo.listMaster!('products')
    expect(products.map((p) => p.id)).toContain(product.id)

    const edition = await repo.createMaster!('productEditions', {
      code: `INT-E-${Date.now()}`, name: 'Integration Edition', description: '',
    })
    await repo.setEditionFeatures!(edition.id, [{ featureId: feature.id, mandatory: true }])
    const editionFeatures = await repo.listEditionFeatures!(edition.id)
    expect(editionFeatures).toHaveLength(1)
    expect(editionFeatures[0].featureId).toBe(feature.id)

    await repo.deleteMaster!('features', feature.id)
    await repo.deleteMaster!('modules', module_.id)
    await repo.deleteMaster!('products', product.id)
    await repo.deleteMaster!('verticals', vertical.id)
    expect(await repo.getMaster!('verticals', vertical.id)).toBeNull()
  })

  it('round-trips a SKU + BOM component through create/update/delete, enforcing the delete guard', async () => {
    const vertical = await repo.createMaster!('verticals', { code: `INT-SKU-V-${Date.now()}`, name: 'Integration Vertical', description: '' })
    const product = await repo.createMaster!('products', { code: `INT-SKU-P-${Date.now()}`, name: 'Integration Product', description: '', verticalId: vertical.id })
    const module_ = await repo.createMaster!('modules', { code: `INT-SKU-M-${Date.now()}`, name: 'Integration Module', description: '', productId: product.id })
    const feature = await repo.createMaster!('features', { code: `INT-SKU-F-${Date.now()}`, name: 'Integration Feature', description: '', moduleId: module_.id, status: 'new' })
    const componentFeature = await repo.createMaster!('features', { code: `INT-SKU-F2-${Date.now()}`, name: 'Integration Component Feature', description: '', moduleId: module_.id, status: 'new' })

    const category = await repo.createMaster!('skuCategories', { code: `INT-CAT-${Date.now()}`, name: 'Integration Category', description: '' })
    const uom = await repo.createMaster!('unitsOfMeasure', { code: `INT-UOM-${Date.now()}`, name: 'Integration UoM', description: '' })
    const currency = await repo.createMaster!('currencies', { code: `INT-CUR-${Date.now()}`, name: 'Integration Currency', description: '', symbol: '$', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: false })
    const taxClass = await repo.createMaster!('taxClasses', { code: `INT-TAX-${Date.now()}`, name: 'Integration Tax', description: '', ratePct: 18 })
    const billingType = await repo.createMaster!('billingTypes', { code: `INT-BIL-${Date.now()}`, name: 'Integration Billing', description: '' })
    const editions = await repo.listMaster!('productEditions')
    if (!editions.some((e) => e.code.toLowerCase() === 'std')) {
      await repo.createMaster!('productEditions', { code: 'STD', name: 'Standard', description: '' })
    }

    const skuInput = {
      name: 'Integration SKU', categoryId: category.id, featureId: feature.id,
      uomId: uom.id, currencyId: currency.id, taxClassId: taxClass.id, billingTypeId: billingType.id,
      activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 5000, floorPrice: 6000, partnerPrice: 7000, governmentPrice: 8000,
      enterprisePrice: 9000, corporatePrice: 9500, listPrice: 10000,
    }
    const sku = await repo.createSku!(skuInput)
    expect(sku.skuCode).toContain(vertical.code)
    expect(sku.minimumAllowedPrice).toBe(6000)
    expect(sku.maximumDiscountPercent).toBe(90)

    const componentSku = await repo.createSku!({ ...skuInput, featureId: componentFeature.id, listPrice: 500 })
    const bom = await repo.createBomItem!({ parentSkuId: sku.id, componentSkuId: componentSku.id, mandatory: true, quantity: 2, notes: 'bundled' })
    expect((await repo.listBomItemsForSku!(sku.id)).map((b) => b.id)).toContain(bom.id)

    await expect(repo.deleteSku!(componentSku.id)).rejects.toThrow()

    const updated = await repo.updateSku!(sku.id, { listPrice: 11000 }, 'Integration price revision')
    expect(updated.listPrice).toBe(11000)

    await repo.deleteBomItem!(bom.id)
    await repo.deleteSku!(componentSku.id)
    await repo.deleteSku!(sku.id)
    expect(await repo.getSku!(sku.id)).toBeNull()

    await repo.deleteMaster!('features', feature.id)
    await repo.deleteMaster!('features', componentFeature.id)
    await repo.deleteMaster!('modules', module_.id)
    await repo.deleteMaster!('products', product.id)
    await repo.deleteMaster!('verticals', vertical.id)
  })

  it('round-trips a BOQ through create/addLineItem/updateStatus/revise/duplicate/delete', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration BOQ Dept' })
    const salesPerson = await repo.createSalesPerson!({
      name: 'Integration BOQ Sales', officialEmail: `integration-boq-${Date.now()}@example.com`,
      designation: 'Account Manager', tierKey: 'accountManager',
    })

    const vertical = await repo.createMaster!('verticals', { code: `INT-BOQ-V-${Date.now()}`, name: 'Integration Vertical', description: '' })
    const product = await repo.createMaster!('products', { code: `INT-BOQ-P-${Date.now()}`, name: 'Integration Product', description: '', verticalId: vertical.id })
    const module_ = await repo.createMaster!('modules', { code: `INT-BOQ-M-${Date.now()}`, name: 'Integration Module', description: '', productId: product.id })
    const feature = await repo.createMaster!('features', { code: `INT-BOQ-F-${Date.now()}`, name: 'Integration Feature', description: '', moduleId: module_.id, status: 'new' })
    const category = await repo.createMaster!('skuCategories', { code: `INT-BOQ-CAT-${Date.now()}`, name: 'Integration Category', description: '' })
    const uom = await repo.createMaster!('unitsOfMeasure', { code: `INT-BOQ-UOM-${Date.now()}`, name: 'Integration UoM', description: '' })
    const currency = await repo.createMaster!('currencies', { code: `INTBOQ${Date.now()}`.slice(0, 8), name: 'Integration Currency', description: '', symbol: '$', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: false })
    const taxClass = await repo.createMaster!('taxClasses', { code: `INT-BOQ-TAX-${Date.now()}`, name: 'Integration Tax', description: '', ratePct: 18 })
    const billingType = await repo.createMaster!('billingTypes', { code: `INT-BOQ-BIL-${Date.now()}`, name: 'Integration Billing', description: '' })

    const sku = await repo.createSku!({
      name: 'Integration BOQ SKU', categoryId: category.id, featureId: feature.id,
      uomId: uom.id, currencyId: currency.id, taxClassId: taxClass.id, billingTypeId: billingType.id,
      activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 5000, floorPrice: 6000, partnerPrice: 7000, governmentPrice: 8000,
      enterprisePrice: 9000, corporatePrice: 9500, listPrice: 10000,
    })

    const boq = await repo.createBoq!({
      opportunityName: `Integration Opportunity ${Date.now()}`, departmentId: dept.id,
      customerName: 'Integration Customer', customerOrganization: '', customerAddress: '', customerContact: '',
      verticalId: vertical.id, budgetAmount: '', budgetUnit: '', budgetKnown: 'yes', emdAmount: '', emdUnit: '',
      salesPersonId: salesPerson.id, buSalesPersonId: null, preSalesId: null, currency: currency.code,
    })
    expect(boq.status).toBe('draft')

    const line = await repo.addBoqLineItem!(boq.id, { skuId: sku.id, quantity: 1, unitPrice: 10000, discountPct: 5 })
    expect(line.approvalStatus).toBe('auto_approved')

    const submitted = await repo.updateBoqStatus!(boq.id, 'submitted', 'Submitted for integration test')
    expect(submitted.status).toBe('submitted')
    await repo.updateBoqStatus!(boq.id, 'under_review', 'Under review')
    const approved = await repo.updateBoqStatus!(boq.id, 'approved', 'Approved for integration test')
    expect(approved.status).toBe('approved')

    const revised = await repo.reviseBoq!(boq.id)
    expect(revised.boqNumber).toBe(boq.boqNumber)
    expect(revised.parentBoqId).toBe(boq.id)

    const duplicate = await repo.duplicateBoq!(boq.id)
    expect(duplicate.boqNumber).not.toBe(boq.boqNumber)

    const logs = await repo.listAuditLogs!({ entityType: 'boq', entityId: boq.id })
    expect(logs.length).toBeGreaterThan(0)

    await repo.removeBoqLineItem!(line.id)
    await repo.deleteBoq!(revised.id)
    await repo.deleteBoq!(duplicate.id)
    await repo.updateBoqStatus!(boq.id, 'archived', 'Archived for cleanup')
    await repo.deleteBoq!(boq.id)
    expect(await repo.getBoq!(boq.id)).toBeNull()

    await repo.deleteSku!(sku.id)
    await repo.deleteMaster!('features', feature.id)
    await repo.deleteMaster!('modules', module_.id)
    await repo.deleteMaster!('products', product.id)
    await repo.deleteMaster!('verticals', vertical.id)
    await repo.deleteMaster!('skuCategories', category.id)
    await repo.deleteMaster!('unitsOfMeasure', uom.id)
    await repo.deleteMaster!('currencies', currency.id)
    await repo.deleteMaster!('taxClasses', taxClass.id)
    await repo.deleteMaster!('billingTypes', billingType.id)
    await repo.deleteSalesPerson!(salesPerson.id)
    await repo.deleteNode!(dept.id)
  })

  it('round-trips an opportunity through create/update (stage change + closedOn)/delete', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Opp Dept' })

    const opp = await repo.createOpportunity!({ departmentId: dept.id, opportunityName: 'Integration Opportunity' })
    expect(opp.stageKey).toBe('pipeline')
    expect(opp.closedOn).toBeNull()

    const won = await repo.updateOpportunity!(opp.id, { stageKey: 'won' })
    expect(won.closedOn).not.toBeNull()

    const changes = await repo.listOpportunityStageChanges!(opp.id)
    expect(changes.map((c) => c.toStageKey)).toEqual(['pipeline', 'won'])

    await repo.deleteOpportunity!(opp.id)
    expect(await repo.getOpportunity!(opp.id)).toBeNull()
    await repo.deleteNode!(dept.id)
  })

  it('round-trips ownership through assign/resolveOwner (inherited)/transferBookOfBusiness/end', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Own Dept' })
    const branch = await repo.createNode!({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Integration Own Branch' })
    const personA = await repo.createSalesPerson!({
      name: 'Integration Owner A', officialEmail: `integration-own-a-${Date.now()}@example.com`,
      designation: 'RM', tierKey: 'rm',
    })
    const personB = await repo.createSalesPerson!({
      name: 'Integration Owner B', officialEmail: `integration-own-b-${Date.now()}@example.com`,
      designation: 'RM', tierKey: 'rm',
    })

    const assignment = await repo.assignOwner!({ entityType: 'orgNode', entityId: dept.id, salesPersonId: personA.id, startDate: '2025-01-01' })
    expect(assignment.role).toBe('owner')

    const inherited = await repo.resolveOwner!('orgNode', branch.id, '2025-06-01')
    expect(inherited).toMatchObject({ salesPersonId: personA.id, source: 'inherited' })

    const moved = await repo.transferBookOfBusiness!({ fromSalesPersonId: personA.id, toSalesPersonId: personB.id, effectiveDate: '2025-06-01' })
    expect(moved).toHaveLength(1)
    const afterTransfer = await repo.resolveOwner!('orgNode', dept.id, '2025-06-01')
    expect(afterTransfer?.salesPersonId).toBe(personB.id)

    const history = await repo.listOwnershipFor!('orgNode', dept.id)
    const openRow = history.find((h) => h.salesPersonId === personB.id)!
    await repo.endOwnership!(openRow.id, '2025-12-01')
    expect(await repo.resolveOwner!('orgNode', dept.id, '2025-12-01')).toBeNull()

    await repo.deleteSalesPerson!(personA.id)
    await repo.deleteSalesPerson!(personB.id)
    await repo.deleteNode!(dept.id)
  })

  it('round-trips a follow-up through create/listForEntity/setStatus/delete', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration FollowUp Dept' })
    const office = await repo.createNode!({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Integration FollowUp Office' })
    const emp = await repo.createEmployee!({
      name: 'Integration FollowUp Contact', designation: 'Officer', email: 'fu@example.com', phone: '9999999999',
      orgNodeId: office.id, managerId: null,
    })

    const followUp = await repo.createFollowUp!({ entityType: 'contact', entityId: emp.id, dueDate: '2026-01-01' })
    expect(followUp.status).toBe('open')

    const list = await repo.listFollowUps!('contact', emp.id)
    expect(list.map((f) => f.id)).toContain(followUp.id)

    await repo.setFollowUpStatus!(followUp.id, 'done')
    expect(await repo.listOpenFollowUps!()).not.toContainEqual(expect.objectContaining({ id: followUp.id }))

    await repo.deleteFollowUp!(followUp.id)
    await repo.deleteEmployee!(emp.id)
    await repo.deleteNode!(dept.id)
  })

  it('round-trips search across categories, relatedRecords, and relationshipAnalytics', async () => {
    const dept = await repo.createNode!({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: `Integration Search Dept ${Date.now()}`,
    })
    const emp = await repo.createEmployee!({
      name: `Integration Search Contact ${Date.now()}`, designation: 'Officer', email: 'search@example.com',
      phone: '9999999999', orgNodeId: dept.id, managerId: null,
    })

    const results = await repo.search!(emp.name.split(' ').pop()!)
    expect(results.some((r) => r.category === 'employee' && r.id === emp.id)).toBe(true)

    const related = await repo.relatedRecords!({
      kind: 'employee', category: 'employee', id: emp.id, title: emp.name, subtitle: emp.designation,
      code: emp.code, domain: null, stateCode: 27,
    })
    expect(related.some((r) => r.category === 'department' && r.id === dept.id)).toBe(true)

    const stats = await repo.relationshipAnalytics!()
    expect(typeof stats.total).toBe('number')

    await repo.deleteEmployee!(emp.id)
    await repo.deleteNode!(dept.id)
  })
})
