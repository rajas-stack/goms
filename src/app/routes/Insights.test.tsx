import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Insights } from './Insights'
import type { SalesPerson } from '@/lib/types'
vi.mock('@/app/AppLayout', () => ({ useShell: () => ({ openImport: vi.fn() }) }))
vi.mock('@/lib/rbacTree/access', () => ({ useNodeFilter: () => () => true }))

function stubAll() {
  vi.spyOn(api, 'useInsights').mockReturnValue({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof api.useInsights>)
  const people: SalesPerson[] = []
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useOwnershipAssignments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOwnershipAssignments>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useOpenFollowUps').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpenFollowUps>)
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllTimelineEvents>)
  vi.spyOn(api, 'useRelationshipAnalytics').mockReturnValue({ data: undefined } as unknown as ReturnType<typeof api.useRelationshipAnalytics>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
}

describe('Insights', () => {
  it('defaults to Overview while preserving the Sales Team Insights entry', () => {
    stubAll()
    localStorage.removeItem('goms.insights.sampleData')
    render(<MemoryRouter><Insights /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('region', { name: 'Opportunity Pipeline by Stage' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sales Team Insights' })).not.toBeInTheDocument()
  })

  it('switches to Relationship Analytics on tab click, without losing it on switch back', async () => {
    stubAll()
    render(<MemoryRouter><Insights /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Relationship Analytics' }))
    expect(screen.getByText('Loading analytics…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByRole('region', { name: 'Opportunity Pipeline by Stage' })).toBeVisible()
  })
})
