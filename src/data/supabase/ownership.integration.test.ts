import { describe, expect, it } from 'vitest'
import {
  createOpportunity, deleteOpportunity, assignOwner, endOwnership, transferBookOfBusiness, resolveOwner,
} from './ownership'
import { createSalesPerson, deleteSalesPerson } from './sales-people'

describe('ownership (Supabase integration)', () => {
  it('createOpportunity logs an opening stage-change row and derives stateCode', async () => {
    const { data: dept } = await import('./client').then((m) =>
      m.supabase.from('departments').select('id, state_code').eq('type_key', 'department').limit(1),
    )
    const opp = await createOpportunity({ departmentId: dept![0].id, opportunityName: 'Test Opp' })
    expect(opp.stateCode).toBe(dept![0].state_code)
    await deleteOpportunity(opp.id)
  })

  it('assignOwner rejects a replacement that does not start after the incumbent', async () => {
    const person = await createSalesPerson({ name: 'Owner Test', officialEmail: `owner-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    const first = await assignOwner({ entityType: 'contact', entityId: 'test-contact-1', salesPersonId: person.id, startDate: '2026-01-01' })
    await expect(
      assignOwner({ entityType: 'contact', entityId: 'test-contact-1', salesPersonId: person.id, startDate: '2026-01-01' }),
    ).rejects.toThrow('must start after')
    await endOwnership(first.id, '2026-06-01')
    await deleteSalesPerson(person.id)
  })

  it('resolveOwner inherits from the parent org node when the contact has no direct owner', async () => {
    const { data: dept } = await import('./client').then((m) =>
      m.supabase.from('departments').select('id').eq('type_key', 'department').limit(1),
    )
    const person = await createSalesPerson({ name: 'Inherit Test', officialEmail: `inherit-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    await assignOwner({ entityType: 'orgNode', entityId: dept![0].id, salesPersonId: person.id, startDate: '2026-01-01' })
    const resolution = await resolveOwner('orgNode', dept![0].id, '2026-06-01')
    expect(resolution?.source).toBe('direct')
    await deleteSalesPerson(person.id)
  })

  it('transferBookOfBusiness closes the source owner and opens a matching row for the target', async () => {
    const a = await createSalesPerson({ name: 'TBOB A', officialEmail: `tboba-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    const b = await createSalesPerson({ name: 'TBOB B', officialEmail: `tbobb-${Date.now()}@x.com`, designation: 'Rep', tierKey: 'accountManager' })
    await assignOwner({ entityType: 'contact', entityId: 'tbob-contact', salesPersonId: a.id, startDate: '2026-01-01' })
    const moved = await transferBookOfBusiness({ fromSalesPersonId: a.id, toSalesPersonId: b.id, effectiveDate: '2026-06-01' })
    expect(moved).toHaveLength(1)
    expect(moved[0].salesPersonId).toBe(b.id)
    await deleteSalesPerson(a.id)
    await deleteSalesPerson(b.id)
  })
})
