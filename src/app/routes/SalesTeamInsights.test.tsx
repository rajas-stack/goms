import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { SalesTeamInsights } from './SalesTeamInsights'
import type { SalesPerson } from '@/lib/types'

const ALICE: SalesPerson = {
  id: 'a', employeeCode: 'E1', name: 'Alice', officialEmail: 'a@amnex.com', personalEmail: '',
  mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
  notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function stub(people: SalesPerson[]) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useOwnershipAssignments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOwnershipAssignments>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useOpenFollowUps').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpenFollowUps>)
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllTimelineEvents>)
}

describe('SalesTeamInsights', () => {
  it('shows an empty state instead of misleading zeroes when there is no sales team data', () => {
    stub([])
    render(<SalesTeamInsights />)
    expect(screen.getByText(/No sales team data yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Total sales-team members')).not.toBeInTheDocument()
  })

  it('renders the summary stat and flags the two partial panels', () => {
    stub([ALICE])
    render(<SalesTeamInsights />)
    expect(screen.getByText('Total sales-team members')).toBeInTheDocument()
    expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(2)
  })
})
