import { beforeEach, describe, expect, it } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

describe('column type migrations in the local repository', () => {
  beforeEach(async () => { await resetLocalData() })
  async function fixture() {
    const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Type changes', submissionDate: '2099-01-15' })
    return repository.createBid(opportunity.id)
  }

  it('preserves a number as an amount and audits the type change', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Estimate', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, field.id, 4500)
    await repository.updateBidCustomField(field.id, { dataType: 'currency', expectedDataType: 'number' })
    expect((await repository.listBidCustomValues(bid.id)).estimate).toBe(4500)
    expect((await repository.listAuditLogs({ entityType: 'bidCustomField', entityId: field.id })).some(log => log.field === 'dataType' && log.newValue === 'currency')).toBe(true)
  })

  it('retains old choices while allowing options to be added and reduced', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Choices', dataType: 'select', options: ['Old', 'Keep'] })
    await repository.setBidCustomValue(bid.id, field.id, 'Old')
    await repository.updateBidCustomField(field.id, { dataType: 'multiselect', options: ['Keep', 'New'] })
    expect((await repository.listBidCustomValues(bid.id)).choices).toBe('["Old"]')
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)?.options).toEqual(['Keep', 'New'])
    await repository.setBidCustomValue(bid.id, field.id, '["Keep","New"]')
    await expect(repository.updateBidCustomField(field.id, { name: 'Should not rename', dataType: 'select' })).rejects.toThrow(/one selection/)
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)).toMatchObject({ name: 'Choices', dataType: 'multiselect' })
    expect((await repository.listBidCustomValues(bid.id)).choices).toBe('["Keep","New"]')
  })

  it('clears only the changed column, requires an explicit reset and preserves its audit', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Convertible', dataType: 'text' })
    const other = await repository.createBidCustomField({ name: 'Untouched', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, field.id, 'Original data')
    await repository.setBidCustomValue(bid.id, other.id, 'Keep me')
    await expect(repository.updateBidCustomField(field.id, { dataType: 'date' })).rejects.toThrow(/resetting/)
    await repository.updateBidCustomField(field.id, { dataType: 'date', resetValues: true })
    expect(await repository.listBidCustomValues(bid.id)).toEqual({ untouched: 'Keep me' })
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)).toMatchObject({ dataType: 'date', hasHeldValue: true, options: null })
    expect((await repository.listAuditLogs({ entityType: 'bidCustomFieldValue', entityId: bid.id })).some(log => log.oldValue === 'Original data' && log.newValue === '')).toBe(true)
    await repository.setBidCustomValue(bid.id, field.id, '2099-01-17')
    expect((await repository.listBidCustomValues(bid.id)).convertible).toBe('2099-01-17')
  })

  it('rejects a stale dialog and invalid target values before changing the column', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Contact', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, field.id, 'Invalid email')
    await expect(repository.updateBidCustomField(field.id, { dataType: 'email', name: 'Changed' })).rejects.toThrow()
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)).toMatchObject({ dataType: 'text', name: 'Contact' })
    await expect(repository.updateBidCustomField(field.id, { dataType: 'number', expectedDataType: 'date', resetValues: true })).rejects.toThrow(/another session/)
  })
})
