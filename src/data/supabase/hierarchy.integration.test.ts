import { describe, expect, it } from 'vitest'
import {
  createNode, getNode, listChildren, breadcrumb, moveNode, duplicateNode, deleteNode, moveTargets,
} from './hierarchy'

describe('hierarchy (Supabase integration)', () => {
  it('createNode + getNode round-trips an org node', async () => {
    const created = await createNode({ domain: 'org', typeKey: 'unit', parentId: null, stateCode: 0, name: 'Test Unit' })
    expect(created.id).toMatch(/^org_/)
    const fetched = await getNode(created.id)
    expect(fetched?.name).toBe('Test Unit')
    await deleteNode(created.id)
  })

  it('createNode + getNode round-trips a geo node', async () => {
    const created = await createNode({ domain: 'geo', typeKey: 'village', parentId: null, stateCode: 1, name: 'Test Village' })
    expect(created.id).toMatch(/^geo_/)
    await deleteNode(created.id)
  })

  it('breadcrumb walks from a real district up to the country root', async () => {
    const { data } = await import('./client').then((m) =>
      m.supabase.from('geo_nodes').select('id').eq('type_key', 'district').limit(1),
    )
    const districtId = data![0].id
    const chain = await breadcrumb(districtId)
    expect(chain[0].typeKey).toBe('country')
    expect(chain[chain.length - 1].id).toBe(districtId)
  })

  it('deleteNode cascades to the whole subtree', async () => {
    const parent = await createNode({ domain: 'org', typeKey: 'office', parentId: null, stateCode: 0, name: 'Cascade Parent' })
    const child = await createNode({ domain: 'org', typeKey: 'unit', parentId: parent.id, stateCode: 0, name: 'Cascade Child' })
    await deleteNode(parent.id)
    expect(await getNode(parent.id)).toBeUndefined()
    expect(await getNode(child.id)).toBeUndefined()
  })

  it('moveNode rejects moving a node into its own subtree', async () => {
    const parent = await createNode({ domain: 'org', typeKey: 'office', parentId: null, stateCode: 0, name: 'Cycle Parent' })
    const child = await createNode({ domain: 'org', typeKey: 'unit', parentId: parent.id, stateCode: 0, name: 'Cycle Child' })
    await expect(moveNode(parent.id, child.id)).rejects.toThrow('own subtree')
    await deleteNode(parent.id)
  })

  it('duplicateNode deep-clones the subtree with new ids', async () => {
    const parent = await createNode({ domain: 'org', typeKey: 'office', parentId: null, stateCode: 0, name: 'Dup Parent' })
    await createNode({ domain: 'org', typeKey: 'unit', parentId: parent.id, stateCode: 0, name: 'Dup Child' })
    const clone = await duplicateNode(parent.id)
    expect(clone.id).not.toBe(parent.id)
    expect(clone.name).toBe('Dup Parent (Copy)')
    const cloneChildren = await listChildren(clone.id)
    expect(cloneChildren).toHaveLength(1)
    await deleteNode(parent.id)
    await deleteNode(clone.id)
  })
})
