import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { adminImportApi } from './api'
import { AdminImportDashboard } from './AdminImportDashboard'

function renderDashboard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminImportDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminImportDashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders one row per domain with its current count and dependency status', async () => {
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([
      { domain: 'taxClasses', label: 'Tax Classes', currentRowCount: 5, dependencyStatus: 'ready' },
      { domain: 'employees', label: 'Employees', currentRowCount: 0, dependencyStatus: { blockedOn: ['organizationHierarchy'] } },
      { domain: 'organizationHierarchy', label: 'Organization Hierarchy', currentRowCount: 0, dependencyStatus: 'ready' },
    ] as any)

    renderDashboard()

    expect(await screen.findByText('Tax Classes')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText(/blocked on Organization Hierarchy/i)).toBeInTheDocument()
  })

  it('links Download Template / Upload & Review to /admin/data-import/:domain', async () => {
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([
      { domain: 'taxClasses', label: 'Tax Classes', currentRowCount: 5, dependencyStatus: 'ready' },
    ] as any)

    renderDashboard()

    expect(await screen.findByRole('link', { name: /upload & review/i })).toHaveAttribute('href', '/admin/data-import/taxClasses')
  })

  it('links Geography to its own one-click route instead of the generic wizard', async () => {
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([
      { domain: 'geography', label: 'Geography', currentRowCount: 7178, dependencyStatus: 'ready' },
    ] as any)

    renderDashboard()

    expect(await screen.findByRole('link', { name: /load\/update/i })).toHaveAttribute('href', '/admin/data-import/geography')
  })
})
