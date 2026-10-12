import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { historyFixture } from './testFixtures'
import { formatWhen } from './format'

vi.mock('@/data/repository', () => ({ repository: { listOverrideHistory: vi.fn(), getMyAccess: vi.fn() } }))
import { repository } from '@/data/repository'
import { OverrideHistory } from './OverrideHistory'

const renderHistory = (props: { email?: string; role?: string } = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OverrideHistory {...props} /></QueryClientProvider>,
)

describe('OverrideHistory', () => {
  it('lists who changed what and when, with the reason, in the order the server sent (newest first)', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue(historyFixture)
    renderHistory()
    const table = await screen.findByRole('table', { name: /override history/i })
    const rows = within(table).getAllByRole('row').slice(1) // minus the header
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Removed')
    expect(rows[0]).toHaveTextContent('root@amnex.com')
    expect(rows[0]).toHaveTextContent(formatWhen('2026-10-03T09:00:00.000Z'))
    expect(rows[0]).toHaveTextContent('No longer needed')
    expect(rows[0]).toHaveTextContent('effect: grant → —')
    expect(rows[1]).toHaveTextContent('Changed')
    expect(rows[1]).toHaveTextContent('effect: revoke → grant')
    expect(rows[2]).toHaveTextContent('Created')
    expect(rows[2]).toHaveTextContent('it@amnex.com')
    expect(rows[2]).toHaveTextContent('effect: — → revoke')
    expect(rows[3]).toHaveTextContent('reason: Initial hold → Covering for payroll')
    expect(repository.listOverrideHistory).toHaveBeenCalledWith({})
  })

  it('names the person and role on each row of the overall list', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue(historyFixture)
    renderHistory()
    const table = await screen.findByRole('table', { name: /override history/i })
    expect(within(table).getByRole('columnheader', { name: 'Person' })).toBeInTheDocument()
    expect(within(table).getAllByText('ghost@amnex.com')).toHaveLength(4)
    expect(within(table).getAllByText('Finance').length).toBeGreaterThan(0)
  })

  it('asks the server for one person only, and then does not repeat their email on every row', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue(historyFixture)
    renderHistory({ email: 'ghost@amnex.com' })
    const table = await screen.findByRole('table', { name: /override history/i })
    expect(repository.listOverrideHistory).toHaveBeenCalledWith({ email: 'ghost@amnex.com' })
    expect(within(table).queryByRole('columnheader', { name: 'Person' })).not.toBeInTheDocument()
    expect(within(table).queryByText('ghost@amnex.com')).not.toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(5)
  })

  it('has an explicit empty state', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue([])
    renderHistory()
    expect(await screen.findByText(/no override changes have been recorded/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /override history/i })).not.toBeInTheDocument()
  })

  it('shows a loading state, then surfaces a refusal as an alert', async () => {
    vi.mocked(repository.listOverrideHistory).mockRejectedValue(Object.assign(new Error('Your role cannot read this.'), { data: { code: 'FORBIDDEN' } }))
    renderHistory()
    expect(screen.getByText(/loading history/i)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot read this.')
  })
})
