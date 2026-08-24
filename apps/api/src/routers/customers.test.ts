import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('customers router', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM customers')
  })

  it('creates and lists a customer', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    expect(created.name).toBe('Acme')
    expect(created.organization).toBe('')
    const list = await caller.customers.list()
    expect(list.map((c) => c.id)).toContain(created.id)
  })

  it('gets a customer by id, and null for a missing one', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    const fetched = await caller.customers.get({ id: created.id })
    expect(fetched?.name).toBe('Acme')
    const missing = await caller.customers.get({ id: '00000000-0000-0000-0000-000000000000' })
    expect(missing).toBeNull()
  })

  it('updates a customer without a concurrency token (last-write-wins)', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    const updated = await caller.customers.update({ id: created.id, patch: { name: 'Acme Corp' } })
    expect(updated.name).toBe('Acme Corp')
  })

  it('updates a customer with a matching expectedUpdatedAt', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    const updated = await caller.customers.update({
      id: created.id,
      patch: { name: 'Acme Corp' },
      expectedUpdatedAt: created.updatedAt,
    })
    expect(updated.name).toBe('Acme Corp')
  })

  it('rejects an update with a stale expectedUpdatedAt', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    await caller.customers.update({
      id: created.id,
      patch: { name: 'Acme Corp' },
      expectedUpdatedAt: created.updatedAt,
    })
    await expect(
      caller.customers.update({
        id: created.id,
        patch: { name: 'Acme Inc' },
        expectedUpdatedAt: created.updatedAt,
      })
    ).rejects.toThrow('CONFLICT')
  })

  it('deletes a customer', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    await caller.customers.delete({ id: created.id })
    const list = await caller.customers.list()
    expect(list.map((c) => c.id)).not.toContain(created.id)
  })
})
