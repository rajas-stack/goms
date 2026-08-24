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
    const list = await caller.customers.list()
    expect(list.map((c) => c.id)).toContain(created.id)
  })

  it('gets a customer by id', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    const fetched = await caller.customers.get({ id: created.id })
    expect(fetched.name).toBe('Acme')
  })

  it('updates a customer with a matching expectedUpdatedAt', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    const updated = await caller.customers.update({
      id: created.id,
      name: 'Acme Corp',
      expectedUpdatedAt: created.updated_at,
    })
    expect(updated.name).toBe('Acme Corp')
  })

  it('rejects an update with a stale updatedAt', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.customers.create({ name: 'Acme' })
    await caller.customers.update({
      id: created.id,
      name: 'Acme Corp',
      expectedUpdatedAt: created.updated_at,
    })
    await expect(
      caller.customers.update({
        id: created.id,
        name: 'Acme Inc',
        expectedUpdatedAt: created.updated_at,
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
