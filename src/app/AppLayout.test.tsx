import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './AppLayout'

// AdminImportModal's own behavior (auth gate, wizard content) is covered by
// AdminImportAuthGate.test.tsx and the individual admin-data-import
// component tests — this file only exercises the AppLayout wiring: does the
// Import button open it, and does it leave the current page mounted behind.
vi.mock('@/modules/admin-data-import/AdminImportModal', () => ({
  AdminImportModal: ({ open }: { open: boolean }) => (open ? <div>Admin Data Import modal</div> : null),
}))

/** Mirrors router.tsx's real nesting (AppLayout as the parent route element,
 *  with real children) just enough to exercise TopBar's "Import" button —
 *  full route lazy-loading isn't needed for this. Needs a real
 *  QueryClientProvider: AppLayout always mounts GlobalFab/CommandPalette,
 *  which reach hooks that call useQueryClient(). Uses the plain
 *  MemoryRouter/Routes API rather than createMemoryRouter/RouterProvider —
 *  the data-router path's internal fetch/Request plumbing doesn't play
 *  nicely with this project's Vitest/Node environment. */
function renderAppLayoutAt(initialPath: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/directory" element={<div>Directory page</div>} />
            <Route path="/bid-tracker" element={<div>Bid Tracker page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TopBar Import button', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('opens AdminImportModal as an overlay, without navigating away, when the flag is on', async () => {
    // Root-caused 2026-09-03: this button briefly navigate()'d to
    // /admin/data-import, replacing whatever page the user was on with a
    // full page. Restored 2026-09-04 to the pre-existing modal/popup UX —
    // AdminImportModal opens over the current page (AppLayout.tsx's
    // openImport no longer calls navigate() at all), and the page behind it
    // stays mounted.
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    renderAppLayoutAt('/directory')

    fireEvent.click(screen.getByRole('button', { name: 'Import records' }))

    expect(await screen.findByText('Admin Data Import modal')).toBeInTheDocument()
    expect(screen.getByText('Directory page')).toBeInTheDocument()
  })

  it('still opens the old unauthenticated ImportDialog when the flag is off (unchanged goms-prod behavior)', () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', '')
    renderAppLayoutAt('/directory')

    fireEvent.click(screen.getByRole('button', { name: 'Import records' }))

    expect(screen.getByText('Bring in a batch of org records or people from a CSV or Excel file.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Directory page')).toBeInTheDocument()
  })

  it('does not offer the Account Mapping Search / Import / Export inside the Bid Tracker', () => {
    renderAppLayoutAt('/bid-tracker')

    expect(screen.getByText('Bid Tracker page')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export records' })).not.toBeInTheDocument()
    expect(screen.queryByText('Search…')).not.toBeInTheDocument()
  })
})
