import { describe, expect, it } from 'vitest'
import { listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer } from './customers'

describe('customers (Supabase integration)', () => {
  it('createCustomer + getCustomer round-trips, defaults empty fields to \'\'', async () => {
    const customer = await createCustomer({ name: 'Acme Corp' })
    expect(customer.organization).toBe('')
    const fetched = await getCustomer(customer.id)
    expect(fetched?.name).toBe('Acme Corp')
    await deleteCustomer(customer.id)
  })

  it('updateCustomer patches only the given fields and bumps updatedAt', async () => {
    const customer = await createCustomer({ name: 'Acme Corp' })
    const before = customer.updatedAt
    const updated = await updateCustomer(customer.id, { gst: '27ABCDE1234F1Z5' })
    expect(updated.gst).toBe('27ABCDE1234F1Z5')
    expect(updated.name).toBe('Acme Corp')
    expect(updated.updatedAt >= before).toBe(true)
    await deleteCustomer(customer.id)
  })

  it('listCustomers returns name-sorted results', async () => {
    const b = await createCustomer({ name: 'Bravo Inc' })
    const a = await createCustomer({ name: 'Alpha LLC' })
    const all = await listCustomers()
    const ids = all.map((c) => c.id)
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id))
    await deleteCustomer(a.id)
    await deleteCustomer(b.id)
  })
})
