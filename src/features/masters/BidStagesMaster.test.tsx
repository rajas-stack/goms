import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { BidStagesMaster } from './BidStagesMaster'

function renderMaster() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><BidStagesMaster /></QueryClientProvider>)
}
const stored = async () => (await repository.listMaster('bidStages')).map(s => `${s.code}=${s.name}`)
const row = (name: string) => screen.getByText(name).closest('li')!

describe('Settings > Masters > Live Bids > Bid Stages', () => {
  beforeEach(async () => { await resetLocalData() })

  it('adds a stage before the closing stages, moves it, and keeps built-in stages', async () => {
    renderMaster()
    await screen.findByText('Go Approved')
    expect(within(row('Submitted')).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(within(row('Submitted')).queryByRole('button', { name: 'Deactivate' })).toBeNull()

    await userEvent.type(screen.getByLabelText('New stage name'), 'Under Evaluation')
    await userEvent.click(screen.getByRole('button', { name: 'Add stage' }))
    await waitFor(async () => expect((await stored()).slice(4, 7)).toEqual(['submitted=Submitted', 'Under Evaluation=Under Evaluation', 'goApproved=Go Approved']))

    await userEvent.click(await screen.findByRole('button', { name: 'Move Under Evaluation up' }))
    await waitFor(async () => expect((await stored()).slice(3, 6)).toEqual(['commercialProposal=Commercial Proposal', 'Under Evaluation=Under Evaluation', 'submitted=Submitted']))
    expect(within(row('Under Evaluation')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('renames a built-in stage without changing its code, and refuses a duplicate name', async () => {
    renderMaster()
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Submitted' }))
    const input = screen.getByLabelText('New name for Submitted')
    await userEvent.clear(input)
    await userEvent.type(input, 'Bid Submitted{Enter}')
    await waitFor(async () => expect(await stored()).toContain('submitted=Bid Submitted'))

    await userEvent.type(screen.getByLabelText('New stage name'), 'dropped')
    await userEvent.type(screen.getByLabelText('New stage name'), '{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})
