import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { RelationshipAnalytics } from './RelationshipAnalytics'

function stub(overrides: Partial<ReturnType<typeof api.useRelationshipAnalytics>['data']> = {}) {
  // Interaction rows look up each person's photo from the employee directory.
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useRelationshipAnalytics').mockReturnValue({
    data: {
      total: 10, connected: 6, notConnected: 4, vacant: 1, highPriority: 2,
      qualityDist: { excellent: 1, good: 2, neutral: 1, weak: 1, poor: 1 },
      statusDist: { engaged: 2, developing: 2, new: 1, dormant: 1 },
      upcomingMeetings: [], recentInteractions: [],
      ...overrides,
    },
  } as unknown as ReturnType<typeof api.useRelationshipAnalytics>)
}

describe('RelationshipAnalytics', () => {
  it('renders its stat cards using the extracted shared primitives', () => {
    stub()
    render(<MemoryRouter><RelationshipAnalytics /></MemoryRouter>)
    expect(screen.getByText('Relationship Analytics')).toBeInTheDocument()
    expect(screen.getByText(/Connected officials/)).toBeInTheDocument()
  })
})
