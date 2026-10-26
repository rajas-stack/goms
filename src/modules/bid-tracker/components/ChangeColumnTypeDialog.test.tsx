import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import type { BidCustomField } from '@/lib/types'
import { ChangeColumnTypeDialog } from './ChangeColumnTypeDialog'

const mount = (field: BidCustomField) => {
  const onClose = vi.fn(), onChanged = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <ChangeColumnTypeDialog field={field} onClose={onClose} onChanged={onChanged} />
  </QueryClientProvider>)
  return { onClose, onChanged }
}
async function fixture() {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Column types', submissionDate: '2099-01-15' })
  return repository.createBid(opportunity.id)
}
describe('Change data type dialog', () => {
  beforeEach(async () => { await resetLocalData() })

  it('retains the selection and enables adding and reducing dropdown options', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Category', dataType: 'select', options: ['Old', 'Keep'] })
    await repository.setBidCustomValue(bid.id, field.id, 'Old')
    const { onClose, onChanged } = mount(field)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'multiselect')
    expect(screen.getByRole('status')).toHaveTextContent('existing values are retained')
    await userEvent.click(screen.getByRole('button', { name: 'Remove option 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Option 2' }), 'New')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onChanged).toHaveBeenCalledOnce()
    expect((await repository.listBidCustomValues(bid.id)).category).toBe('["Old"]')
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)?.options).toEqual(['Keep', 'New'])
  })

  it('clearly identifies unrelated changes and resets the values on save', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Estimate', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, field.id, 550)
    const { onClose } = mount(field)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'date')
    expect(screen.getByRole('status')).toHaveTextContent('cleared for every opportunity')
    await userEvent.click(screen.getByRole('button', { name: 'Change type and reset values' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect((await repository.listBidCustomValues(bid.id)).estimate).toBeUndefined()
  })

  it('keeps the dialog open when a compatible conversion would lose a selection', async () => {
    const bid = await fixture()
    const field = await repository.createBidCustomField({ name: 'Category', dataType: 'multiselect', options: ['One', 'Two'] })
    await repository.setBidCustomValue(bid.id, field.id, '["One","Two"]')
    const { onClose } = mount(field)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'select')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('one selection')
    expect(onClose).not.toHaveBeenCalled()
    expect((await repository.listBidCustomValues(bid.id)).category).toBe('["One","Two"]')
  })

  it('does not change values on cancel and disables saving an unchanged type', async () => {
    const field = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    const { onClose } = mount(field)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'number')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect((await repository.listBidCustomFields()).find(item => item.id === field.id)?.dataType).toBe('text')
  })
})
