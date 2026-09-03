import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adminImportApi } from './api'
import { AdminImportModal } from './AdminImportModal'

const { onAuthStateChanged, signInWithPopup, signOut } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider: class {} }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

// Wrapped in an outer MemoryRouter deliberately — matches how AdminImportModal
// really lives in the app (AppLayout, nested inside router.tsx's
// createBrowserRouter). An earlier version of this modal rendered its own
// nested MemoryRouter for internal navigation, which React Router only
// rejects ("You cannot render a <Router> inside another <Router>") once
// there's an outer Router to conflict with — a bare `render()` with no outer
// Router (this file's original version) can't catch that class of bug.
function renderModal(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminImportModal open={open} onClose={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

// Covers the three auth states inside the restored modal (see AppLayout.tsx's
// openImport / AdminImportModal.tsx): the modal reuses AdminImportAuthGate
// unmodified, so the server-side allow-list check is exercised exactly the
// same way it always was — this only confirms the modal wrapper doesn't
// bypass or short-circuit that gate.
describe('AdminImportModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    onAuthStateChanged.mockReset()
  })

  it('shows the Google sign-in gate inside the modal when signed out', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    renderModal()
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('shows the not-authorized screen inside the modal for a signed-in, non-allow-listed account', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone-else@gmail.com' }); return () => {} })
    vi.spyOn(adminImportApi, 'listDomains').mockRejectedValue(Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }))
    renderModal()
    expect(await screen.findByText(/not authorized for this/i)).toBeInTheDocument()
  })

  it('shows the real Admin Data Import dashboard for an allow-listed admin, and lets them navigate to the session wizard and back inside the modal', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([
      { domain: 'taxClasses', label: 'Tax Classes', currentRowCount: 5, dependencyStatus: 'ready' },
    ] as any)

    renderModal()

    // `level: 1` disambiguates from Dialog's own "Admin Data Import" title,
    // which renders as an h2 alongside AdminImportDashboard's h1 of the same text.
    expect(await screen.findByRole('heading', { name: 'Admin Data Import', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Tax Classes')).toBeInTheDocument()

    // Buttons, not links, inside the modal — ImportNavLink swaps real
    // `<Link>` navigation for local step state here (see AdminImportModal.tsx's
    // design note on why: nesting a second Router to let real `<Link>`s work
    // throws the moment that subtree mounts, since the whole app already
    // lives inside one Router).
    fireEvent.click(screen.getByRole('button', { name: /start import session/i }))
    expect(await screen.findByRole('heading', { name: 'Import Session' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to data import/i }))
    expect(await screen.findByRole('heading', { name: 'Admin Data Import', level: 1 })).toBeInTheDocument()
  })

  it('renders no dialog while closed', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    renderModal(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
