import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

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

  describe('auth enforcement', () => {
    afterEach(() => {
      delete process.env.AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated caller when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.customers.create({ name: 'Acme' })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated mutation once enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.customers.create({ name: 'Acme' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('still allows reads with no auth even when enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.customers.list()).resolves.toBeDefined()
    })

    it('allows the same mutation once enforcement is on, for a verified @amnex.com caller', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.customers.create({ name: 'Acme' })).resolves.toBeDefined()
    })
  })
})
