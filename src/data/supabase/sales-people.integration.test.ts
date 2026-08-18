import { describe, expect, it } from 'vitest'
import {
  createSalesPerson, deleteSalesPerson, transferSalesPerson, listSalesPostings, currentPostings, getSalesPerson,
} from './sales-people'

describe('salesPeople (Supabase integration)', () => {
  it('createSalesPerson creates exactly one initial posting', async () => {
    const person = await createSalesPerson({ name: 'Test SP', officialEmail: `test-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    const postings = await listSalesPostings(person.id)
    expect(postings).toHaveLength(1)
    expect(postings[0].changeType).toBe('initial')
    await deleteSalesPerson(person.id)
  })

  it('transferSalesPerson rejects a transfer that does not start after the current posting', async () => {
    const person = await createSalesPerson({ name: 'Test SP2', officialEmail: `test2-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    const [posting] = await listSalesPostings(person.id)
    await expect(
      transferSalesPerson({ salesPersonId: person.id, designation: 'Lead', tierKey: 'accountManager', effectiveDate: posting.startDate }),
    ).rejects.toThrow('must take effect after')
    await deleteSalesPerson(person.id)
  })

  it('deleteSalesPerson cascades to postings, currentPostings reflects removal', async () => {
    const person = await createSalesPerson({ name: 'Test SP3', officialEmail: `test3-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    await deleteSalesPerson(person.id)
    expect(await getSalesPerson(person.id)).toBeNull()
    const current = await currentPostings()
    expect(current[person.id]).toBeUndefined()
  })
})
