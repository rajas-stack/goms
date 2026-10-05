import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkFormDialog } from './WorkFormDialog'
import type { Opportunity } from '@/lib/types'

const work = {
  id: 'opp-1', opportunityCode: 'FY27-Q3-NA-NORTH-UK-NA-NA-NA-1', opportunityType: '', departmentId: 'd', stateCode: 5, createdAt: '', createdBy: null, opportunityName: 'Smart Bus',
  gemTenderId: '', publishDate: '', submissionDate: '2026-10-10', vertical: '', component: [], quantity: '',
  currency: 'INR', valueAmount: '', valueUnit: 'lakh', budgetKnown: '', emdAmount: '', emdUnit: 'lakh',
  salesPersonEmail: '', stageKey: 'lead', closedOn: null,
} as Opportunity

function renderDialog(managedInBidTracker?: boolean) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WorkFormDialog open work={work} managedInBidTracker={managedInBidTracker} onClose={vi.fn()} onSave={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('WorkFormDialog — Bid Tracker lock', () => {
  it('locks Stage and Submission date and explains why when the opportunity has a bid', () => {
    renderDialog(true)
    expect(screen.getByLabelText('Stage')).toBeDisabled()
    expect(screen.getByLabelText('Submission date')).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent(/Managed in Bid Tracker/)
    expect(screen.getByLabelText('Publish date')).toBeEnabled() // everything else stays editable
  })

  it('leaves them editable, with no note, otherwise', () => {
    renderDialog()
    expect(screen.getByLabelText('Stage')).toBeEnabled()
    expect(screen.getByLabelText('Submission date')).toBeEnabled()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('WorkFormDialog — Opportunity ID', () => {
  const renderWith = (props: Partial<Parameters<typeof WorkFormDialog>[0]>) => render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkFormDialog open work={null} onClose={vi.fn()} onSave={vi.fn()} {...props} />
    </QueryClientProvider>,
  )

  it('previews the code live while creating, with # for the number assigned on save', async () => {
    renderWith({})
    const preview = screen.getByTestId('opportunity-code-preview')
    expect(preview.textContent).toMatch(/^FY\d{2}-Q[1-4]-TRF-NA-NA-NA-NA-NA-#$/)
    await userEvent.selectOptions(screen.getByLabelText('Opportunity type'), 'GeM')
    await userEvent.type(screen.getByLabelText('Submission date'), '2026-08-15')
    expect(preview).toHaveTextContent('FY27-Q2-TRF-NA-NA-NA-GEM-NA-#')
    expect(screen.getByText(/Number assigned on save/)).toBeInTheDocument()
  })

  it('shows the locked code (no preview, no editor) when editing, and never sends it back', async () => {
    const onSave = vi.fn()
    renderWith({ work, onSave })
    expect(screen.queryByTestId('opportunity-code-preview')).not.toBeInTheDocument()
    expect(screen.getByText(work.opportunityCode)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('opportunityCode')
  })
})
