import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { AuthPromptDialog } from './AuthPromptDialog'
import { notifyAuthRequired } from '@/lib/authPrompt'

const { onAuthStateChanged, signInWithPopup } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, GoogleAuthProvider: class {} }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

/** onAuthStateChanged is subscribed once on mount (`useEffect(..., [])`) and
 *  its callback is captured here so tests can simulate Firebase pushing a
 *  new user asynchronously, independent of whatever `signInWithPopup`
 *  resolves/rejects with. */
function authStateCallback(): (user: { email: string } | null) => void {
  return onAuthStateChanged.mock.calls[0][1]
}

describe('AuthPromptDialog', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset().mockImplementation((_auth, cb) => { cb(null); return () => {} })
    // Default to a resolved promise, matching real signInWithPopup's return
    // type — the component always chains `.catch()` onto it, so a bare
    // `vi.fn()` (which returns `undefined`) would throw on click unless a
    // test explicitly overrides this.
    signInWithPopup.mockReset().mockResolvedValue({ user: null })
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
    act(() => { screen.getByRole('button', { name: /sign in with google/i }).click() })
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
  })

  it('closes itself once sign-in succeeds when the reason was "unauthorized"', async () => {
    signInWithPopup.mockResolvedValue({ user: { email: 'someone@amnex.com' } })
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('unauthorized'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => { screen.getByRole('button', { name: /sign in with google/i }).click() })
    // onAuthStateChanged is what actually updates local `user` state in the
    // real app (signInWithPopup itself doesn't) — simulate Firebase pushing
    // the newly-signed-in user through that listener.
    act(() => authStateCallback()({ email: 'someone@amnex.com' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does NOT auto-close when the reason is "forbidden", even once a (still-unauthorized) user is signed in', async () => {
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('forbidden'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // A non-amnex account signs in — still not authorized; the fix for
    // 'forbidden' is signing in with a DIFFERENT account, not just any
    // sign-in, so the dialog must stay open showing the "not authorized"
    // message rather than silently closing.
    act(() => authStateCallback()({ email: 'someone@gmail.com' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/isn't authorized/i)).toBeInTheDocument()
  })

  it('shows an inline error instead of crashing when signInWithPopup rejects', async () => {
    signInWithPopup.mockRejectedValue(new Error('popup-blocked'))
    render(<AuthPromptDialog />)
    act(() => notifyAuthRequired('unauthorized'))

    await act(async () => {
      screen.getByRole('button', { name: /sign in with google/i }).click()
      await Promise.resolve()
    })

    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument()
    // Still open — a failed sign-in must not silently dismiss the prompt.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
