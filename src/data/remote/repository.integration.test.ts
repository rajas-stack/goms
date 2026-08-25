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
})
