import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkFormDialog } from './WorkFormDialog'
import type { Opportunity } from '@/lib/types'

const work = {
  id: 'opp-1', departmentId: 'd', stateCode: 5, createdAt: '', createdBy: null, opportunityName: 'Smart Bus',
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
