import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AuthPromptDialog } from './AuthPromptDialog'
import { notifyAuthRequired } from '@/lib/authPrompt'

const { onAuthStateChanged, signInWithPopup } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, GoogleAuthProvider: class {} }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

describe('AuthPromptDialog', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset().mockImplementation((_auth, cb) => { cb(null); return () => {} })
    signInWithPopup.mockReset()
  })

  it('renders nothing until notifyAuthRequired fires', () => {
    render(<AuthPromptDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a "sign in required" prompt on an unauthorized notification', () => {
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('unauthorized'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/sign in required/i)).toBeInTheDocument()
  })

  it('shows a "not authorized" message on a forbidden notification', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone@gmail.com' }); return () => {} })
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('forbidden'))
    expect(screen.getByText(/isn't authorized/i)).toBeInTheDocument()
    expect(screen.getByText(/someone@gmail\.com/)).toBeInTheDocument()
  })

  it('calls signInWithPopup with the Google provider when the sign-in button is clicked', () => {
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('unauthorized'))
    screen.getByRole('button', { name: /sign in with google/i }).click()
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
  })
})
