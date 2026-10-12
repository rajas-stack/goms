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

vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider: class { setCustomParameters() {} } }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

// Wrapped in an outer MemoryRouter deliberately, matching how AdminImportModal
// really lives in the app (AppLayout, nested inside router.tsx's
// createBrowserRouter) — ImportDialog's own content doesn't route, but this
// keeps the render environment realistic.
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

// By explicit request (2026-09-04), once authorized this modal shows the
// existing ImportDialog experience, not the multi-domain session wizard —
// see AdminImportModal.tsx's design note. These tests cover the gate states
// (unchanged from before) and confirm the swap to ImportDialog happens once
// AdminImportAuthGate reports 'authorized'; ImportDialog's own internals
// (Departments/People tabs, upload, submit) aren't re-tested here.
describe('AdminImportModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    onAuthStateChanged.mockReset()
  })

  it('shows the Google sign-in gate inside the modal when signed out', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    renderModal()
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Admin Data Import' })).toBeInTheDocument()
  })

  it('shows the not-authorized screen inside the modal for a signed-in, non-allow-listed account', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone-else@gmail.com' }); return () => {} })
    vi.spyOn(adminImportApi, 'listDomains').mockRejectedValue(Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }))
    renderModal()
    expect(await screen.findByText(/not authorized for this/i)).toBeInTheDocument()
  })

  it('swaps to the ImportDialog experience once authorized', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([])

    renderModal()

    expect(await screen.findByRole('heading', { name: 'Import records' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Departments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'People' })).toBeInTheDocument()
    // The gate's own "Admin Data Import" title is gone — ImportDialog owns
    // the dialog end to end once swapped in — but its "Signed in as X /
    // Sign out" strip is preserved via ImportDialog's signedInAs/onSignOut
    // props, so that affordance isn't lost in the swap.
    expect(screen.queryByRole('heading', { name: 'Admin Data Import' })).not.toBeInTheDocument()
    expect(screen.getByText('Signed in as admin@amnex.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('signing out from inside ImportDialog signs out and closes the modal', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    vi.spyOn(adminImportApi, 'listDomains').mockResolvedValue([])
    const onClose = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AdminImportModal open onClose={onClose} />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    // Waits for ImportDialog's OWN title first — AdminImportAuthGate briefly
    // renders its own "Sign out" button too (its authorized branch, for the
    // one commit before AdminImportModal swaps to <ImportDialog>), so a bare
    // findByRole('button', { name: 'Sign out' }) can race and grab a node
    // that's already unmounted by the time this fires the click.
    await screen.findByRole('heading', { name: 'Import records' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders no dialog while closed', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    renderModal(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
