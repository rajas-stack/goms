import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './AppLayout'

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
            <Route path="/admin/data-import" element={<div>Admin Data Import route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("TopBar Import button routing", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('navigates to the gated Admin Data Import route when the flag is on, instead of opening the old unauthenticated dialog', async () => {
    // Root-caused 2026-09-03: this button used to open ImportDialog directly
    // regardless of sign-in state, giving a signed-out visitor a second,
    // un-gated door into data Admin Data Import was built to put behind
    // Google Sign-In + the server-side allow-list. Navigating here instead
    // means the click lands on a route wrapped in AdminImportAuthGate.
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    renderAppLayoutAt('/directory')

    fireEvent.click(screen.getByRole('button', { name: 'Import records' }))

    expect(await screen.findByText('Admin Data Import route')).toBeInTheDocument()
    expect(screen.queryByText('Bring in a batch of org records or people from a CSV or Excel file.', { exact: false })).not.toBeInTheDocument()
  })

  it('still opens the old unauthenticated ImportDialog when the flag is off (unchanged goms-prod behavior)', () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', '')
    renderAppLayoutAt('/directory')

    fireEvent.click(screen.getByRole('button', { name: 'Import records' }))

    expect(screen.getByText('Bring in a batch of org records or people from a CSV or Excel file.', { exact: false })).toBeInTheDocument()
  })
})
