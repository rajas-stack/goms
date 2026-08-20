import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard } from './Dashboard'
import * as api from '../api'
import type { CommercialBoq } from '../types'

function boq(overrides: Partial<CommercialBoq> = {}): CommercialBoq {
  return {
    id: 'b1', boqNumber: 'BOQ-2026-000001', opportunityName: 'Test Opp', departmentId: '', customerName: '',
    customerOrganization: '', customerAddress: '', customerContact: '', verticalId: '',
    budgetAmount: '', budgetUnit: '', budgetKnown: '', emdAmount: '', emdUnit: '',
    salesPersonId: '', buSalesPersonId: null, preSalesId: null,
    status: 'draft', boqVersion: 1, revisionNumber: 0, parentBoqId: null,
    currency: 'INR', grandTotal: 1000,
    createdAt: '', createdBy: null, lastModifiedAt: '2026-08-19T00:00:00Z', lastModifiedBy: null,
    ...overrides,
  }
}

function renderDashboard(boqs: CommercialBoq[]) {
  vi.spyOn(api, 'useBoqs').mockReturnValue({ data: boqs } as never)
  vi.spyOn(api, 'useDashboardMetrics').mockReturnValue({
    data: {
      draft: boqs.filter((b) => b.status === 'draft').length,
      pendingApproval: boqs.filter((b) => b.status === 'submitted' || b.status === 'under_review').length,
      approved: boqs.filter((b) => b.status === 'approved').length,
      rejected: boqs.filter((b) => b.status === 'rejected').length,
    },
  } as never)
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard onCreateBoq={() => {}} onNavigate={() => {}} />
    </QueryClientProvider>,
  )
}

describe('Dashboard KPI cards', () => {
  it('does not show any BOQ list until a card is clicked', () => {
    renderDashboard([boq({ status: 'draft' })])
    expect(screen.queryByText('Test Opp')).not.toBeInTheDocument()
  })

  it('shows the matching list after clicking a card, and switches lists on a different card', async () => {
    const user = userEvent.setup()
    renderDashboard([
      boq({ id: 'b1', opportunityName: 'Draft Opp', status: 'draft' }),
      boq({ id: 'b2', opportunityName: 'Approved Opp', status: 'approved' }),
    ])
    await user.click(screen.getByRole('button', { name: /draft/i }))
    expect(screen.getByText('Draft Opp')).toBeInTheDocument()
    expect(screen.queryByText('Approved Opp')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /approved/i }))
    expect(screen.getByText('Approved Opp')).toBeInTheDocument()
    expect(screen.queryByText('Draft Opp')).not.toBeInTheDocument()
  })

  it('shows an explicit empty state for a zero-count status', async () => {
    const user = userEvent.setup()
    renderDashboard([])
    await user.click(screen.getByRole('button', { name: /rejected/i }))
    expect(screen.getByText(/no rejected/i)).toBeInTheDocument()
  })

  it('does not render Commercial Value or Average Margin cards', () => {
    renderDashboard([])
    expect(screen.queryByText(/commercial value/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/average margin/i)).not.toBeInTheDocument()
  })
})
