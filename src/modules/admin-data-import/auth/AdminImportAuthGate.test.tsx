import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdminImportAuthGate } from './AdminImportAuthGate'

const { onAuthStateChanged, signInWithPopup, signOut } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))
const { useAdminImportDomains } = vi.hoisted(() => ({ useAdminImportDomains: vi.fn() }))

vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider: class { setCustomParameters() {} } }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))
vi.mock('../api', () => ({ useAdminImportDomains }))

/** Default: the allow-list probe (listDomains) has already succeeded — most
 *  tests care about the sign-in/forbidden branches, not this one, so this
 *  keeps them from having to restate it. */
const AUTHORIZED = { isPending: false, isError: false, error: null }

describe('AdminImportAuthGate', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset()
    signInWithPopup.mockReset()
    useAdminImportDomains.mockReset()
    useAdminImportDomains.mockReturnValue(AUTHORIZED)
  })

  it('shows a sign-in button when no user is signed in', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('calls signInWithPopup with the Google provider when the sign-in button is clicked', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
  })

  it('does not probe the allow-list at all while signed out', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return () => {} })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(useAdminImportDomains).toHaveBeenCalledWith({ enabled: false })
  })

  it('renders nothing yet while the allow-list check is still pending', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    useAdminImportDomains.mockReturnValue({ isPending: true, isError: false, error: null })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('renders the protected content and the signed-in email once authenticated and allow-listed', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.getByText('Protected content')).toBeInTheDocument()
    expect(screen.getByText(/admin@amnex\.com/)).toBeInTheDocument()
  })

  it('shows a not-authorized screen (not the protected content) for a signed-in but non-allow-listed account', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone-else@gmail.com' }); return () => {} })
    useAdminImportDomains.mockReturnValue({ isPending: false, isError: true, error: { data: { code: 'FORBIDDEN' } } })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByText(/not authorized for this/i)).toBeInTheDocument()
    expect(screen.getByText(/someone-else@gmail\.com/)).toBeInTheDocument()
  })

  it('gives the not-authorized screen a mailto request-access link addressed to the maintainer, not the importer itself', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone-else@gmail.com' }); return () => {} })
    useAdminImportDomains.mockReturnValue({ isPending: false, isError: true, error: { data: { code: 'FORBIDDEN' } } })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    const link = screen.getByRole('link', { name: /request access/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('mailto:'))
    expect(link).toHaveAttribute('href', expect.stringContaining('someone-else%40gmail.com'))
  })

  it('falls through to the protected content for a non-FORBIDDEN error (e.g. a transient network failure)', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    useAdminImportDomains.mockReturnValue({ isPending: false, isError: true, error: { data: { code: 'INTERNAL_SERVER_ERROR' } } })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })
})
