import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { MilestonesTab } from './MilestonesTab'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}
function renderTab(bidId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MilestonesTab bidId={bidId} /></QueryClientProvider>)
}
const card = (label: string) => screen.getAllByTestId('milestone-card').find((c) => c.textContent?.includes(label))!

describe('MilestonesTab', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('renders each milestone with its date, venue and notes, soonest first', async () => {
    const bid = await makeBid()
    await repository.createBidMilestone({
      bidId: bid.id, milestoneType: 'preBidConference', key: 'preBidConference', label: 'Pre-Bid Conference',
      dueAt: '2098-10-01T14:30:00.000Z', venue: 'SAG Lab Auditorium, Delhi', notes: 'In-person attendance required.',
    })
    renderTab(bid.id)
    expect(await screen.findByText('Pre-Bid Conference')).toBeInTheDocument()
    expect(screen.getByText(/SAG Lab Auditorium/)).toBeInTheDocument()
    expect(screen.getByText(/In-person attendance required/)).toBeInTheDocument()
    expect(screen.getByText('Submission Deadline')).toBeInTheDocument()
    expect(screen.getAllByTestId('milestone-card')[0]).toHaveTextContent('Pre-Bid Conference')
  })

  it('says "No record" for a milestone without a date', async () => {
    const bid = await makeBid()
    await repository.createBidMilestone({ bidId: bid.id, milestoneType: 'x', key: 'x', label: 'Undated' })
    renderTab(bid.id)
    await screen.findByText('Undated')
    expect(within(card('Undated')).getByText('No record')).toBeInTheDocument()
  })

  it('adds a milestone with a generated unique key', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Add milestone' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Label' }), 'Site Visit')
    await userEvent.type(screen.getByRole('textbox', { name: 'Venue' }), 'Pune office')
    await userEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    await screen.findByText('Site Visit')
    const added = (await repository.listBidMilestones(bid.id)).find((m) => m.label === 'Site Visit')!
    expect(added).toMatchObject({ key: 'site_visit', venue: 'Pune office', status: 'open' })
  })

  it('edits date, venue and notes in place; the submission deadline label is fixed', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Submission Deadline' }))
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Venue' }), 'GeM portal')
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2099-02-01T10:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => {
      const m = (await repository.listBidMilestones(bid.id))[0]
      expect(m.venue).toBe('GeM portal')
      expect(new Date(m.dueAt!).getFullYear()).toBe(2099)
      expect(new Date(m.dueAt!).getMonth()).toBe(1)
    })
    expect(await within(card('Submission Deadline')).findByText(/Venue: GeM portal/)).toBeInTheDocument()
  })

  it('marks a milestone complete and reopens it', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Mark Submission Deadline complete' }))
    await waitFor(async () => expect((await repository.listBidMilestones(bid.id))[0].status).toBe('completed'))
    await userEvent.click(await screen.findByRole('button', { name: 'Reopen Submission Deadline' }))
    await waitFor(async () => expect((await repository.listBidMilestones(bid.id))[0].status).toBe('open'))
  })

  it('never offers Delete on the submission deadline, and deletes others after confirmation', async () => {
    const bid = await makeBid()
    await repository.createBidMilestone({ bidId: bid.id, milestoneType: 'x', key: 'x', label: 'Extra' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab(bid.id)
    await screen.findByText('Extra')
    expect(screen.queryByRole('button', { name: 'Delete Submission Deadline' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Extra' }))
    await waitFor(() => expect(screen.queryByText('Extra')).not.toBeInTheDocument())
  })

  it('shows a server rejection inline on the milestone and stays in edit mode', async () => {
    const bid = await makeBid()
    vi.spyOn(repository, 'updateBidMilestone').mockRejectedValueOnce(new Error('submissionDeadline is frozen.'))
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Submission Deadline' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Venue' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is frozen')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})
