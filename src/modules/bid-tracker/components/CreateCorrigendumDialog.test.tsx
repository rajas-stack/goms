import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { CreateCorrigendumDialog } from './CreateCorrigendumDialog'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Tender', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

function renderDialog(bidId: string, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><CreateCorrigendumDialog bidId={bidId} onClose={onClose} /></QueryClientProvider>)
  return onClose
}

describe('CreateCorrigendumDialog', () => {
  beforeEach(async () => { await resetLocalData() })

  it('creates a corrigendum whose change carries the bid\'s real current value, and flags the bid for review', async () => {
    const bid = await makeBid()
    const before = (await repository.listBidMilestones(bid.id))[0]
    const onClose = renderDialog(bid.id)

    expect(screen.getByRole('button', { name: 'Create Corrigendum' })).toBeDisabled()
    await screen.findByRole('option', { name: 'Submission Deadline' }) // milestones load asynchronously
    await userEvent.selectOptions(screen.getByLabelText('Field 1'), 'submissionDeadline')
    await userEvent.type(screen.getByLabelText('Proposed value 1'), '2099-02-01T10:30')
    await userEvent.click(screen.getByRole('button', { name: 'Create Corrigendum' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const [created] = await repository.listBidCorrigenda(bid.id)
    expect(created.corrigendumNumber).toBe(1)
    expect(created.changes).toHaveLength(1)
    expect(created.changes[0]).toMatchObject({
      fieldKey: 'submissionDeadline', currentValue: before.dueAt, decision: 'pending',
      proposedValue: new Date('2099-02-01T10:30').toISOString(),
    })
    expect((await repository.getBid(bid.id))!.dataConfidence).toBe('needs_review')
  })

  it('suggests the next corrigendum number and refuses a duplicate', async () => {
    const bid = await makeBid()
    await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://a.example' }],
    })
    renderDialog(bid.id)
    const number = await screen.findByLabelText('Corrigendum Number')
    await waitFor(() => expect(number).toHaveValue(2))
    await userEvent.clear(number)
    await userEvent.type(number, '1')
    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Field 1'), 'tenderLink')
    await userEvent.type(screen.getByLabelText('Proposed value 1'), 'https://b.example')
    expect(screen.getByRole('button', { name: 'Create Corrigendum' })).toBeDisabled()
  })

  it('records several changes in one corrigendum, and never offers the same field twice', async () => {
    const bid = await makeBid()
    renderDialog(bid.id)
    await userEvent.selectOptions(await screen.findByLabelText('Field 1'), 'tenderLink')
    await userEvent.type(screen.getByLabelText('Proposed value 1'), 'https://new.example')
    await userEvent.click(screen.getByRole('button', { name: 'Add another change' }))
    const second = await screen.findByLabelText('Field 2')
    const dup = Array.from(second.querySelectorAll('option')).find((o) => o.value === 'tenderLink')!
    expect(dup.disabled).toBe(true)
    await screen.findAllByRole('option', { name: 'Submission Deadline' })
    await userEvent.selectOptions(second, 'submissionDeadline')
    await userEvent.type(screen.getByLabelText('Proposed value 2'), '2099-03-01T09:00')
    await userEvent.click(screen.getByRole('button', { name: 'Create Corrigendum' }))
    await waitFor(async () => expect((await repository.listBidCorrigenda(bid.id))[0]?.changes).toHaveLength(2))
  })

  it('shows the server error inline and stays open when creation fails', async () => {
    const bid = await makeBid()
    const spy = vi.spyOn(repository, 'createBidCorrigendum').mockRejectedValue(new Error('Corrigendum 1 already exists for this bid.'))
    const onClose = renderDialog(bid.id)
    await userEvent.selectOptions(await screen.findByLabelText('Field 1'), 'tenderLink')
    await userEvent.type(screen.getByLabelText('Proposed value 1'), 'https://x.example')
    await userEvent.click(screen.getByRole('button', { name: 'Create Corrigendum' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
    expect(onClose).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
