import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdminImportAuthGate } from './AdminImportAuthGate'

const { onAuthStateChanged, signInWithPopup, signOut } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider: class {} }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

describe('AdminImportAuthGate', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset()
    signInWithPopup.mockReset()
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

  it('renders the protected content and the signed-in email once authenticated', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'admin@amnex.com' }); return () => {} })
    render(<AdminImportAuthGate><div>Protected content</div></AdminImportAuthGate>)
    expect(screen.getByText('Protected content')).toBeInTheDocument()
    expect(screen.getByText(/admin@amnex\.com/)).toBeInTheDocument()
  })
})
