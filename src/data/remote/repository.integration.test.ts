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
})
