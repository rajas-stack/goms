import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
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

/** AuthPromptDialog reads the ambient QueryClient (to refetch failed reads
 *  once a real user signs in) — every render needs a real provider, not a
 *  mock, since react-query's own query-state machinery is exactly what the
 *  refetch-on-sign-in behavior relies on. Returns the client so tests that
 *  need to seed/inspect query state can reach it. */
function renderDialog(client: QueryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AuthPromptDialog />
    </QueryClientProvider>,
  )
  return client
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
    renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a "sign in required" prompt on an unauthorized notification', () => {
    renderDialog()
    act(() => notifyAuthRequired('unauthorized'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/sign in required/i)).toBeInTheDocument()
  })

  it('shows a "not authorized" message on a forbidden notification', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone@gmail.com' }); return () => {} })
    renderDialog()
    act(() => notifyAuthRequired('forbidden'))
    expect(screen.getByText(/isn't authorized/i)).toBeInTheDocument()
    expect(screen.getByText(/someone@gmail\.com/)).toBeInTheDocument()
  })

  it('calls signInWithPopup with the Google provider when the sign-in button is clicked', () => {
    renderDialog()
    act(() => notifyAuthRequired('unauthorized'))
    act(() => { screen.getByRole('button', { name: /sign in with google/i }).click() })
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
  })

  it('closes itself once sign-in succeeds when the reason was "unauthorized"', async () => {
    signInWithPopup.mockResolvedValue({ user: { email: 'someone@amnex.com' } })
    renderDialog()
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
    renderDialog()
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
    renderDialog()
    act(() => notifyAuthRequired('unauthorized'))

    await act(async () => {
      screen.getByRole('button', { name: /sign in with google/i }).click()
      await Promise.resolve()
    })

    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument()
    // Still open — a failed sign-in must not silently dismiss the prompt.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  describe('post-sign-in read recovery', () => {
    // A protected read failing (401/403) leaves its query cached in an error
    // state — regression coverage for the full loop this component now
    // closes: unauthenticated read -> auth prompt -> successful @amnex.com
    // sign-in -> the failed query is refetched -> data loads, with no
    // manual page refresh.
    function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
      const { data, error } = useQuery({ queryKey: ['probe'], queryFn, retry: false })
      return <div data-testid="probe">{data ?? (error ? 'error' : 'loading')}</div>
    }

    it('refetches a previously-failed query once a real user signs in, without a page refresh', async () => {
      const client = new QueryClient()
      const queryFn = vi.fn()
        .mockRejectedValueOnce({ data: { code: 'UNAUTHORIZED' } })
        .mockResolvedValueOnce('secret-data')

      render(
        <QueryClientProvider client={client}>
          <Probe queryFn={queryFn} />
          <AuthPromptDialog />
        </QueryClientProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('error'))
      expect(queryFn).toHaveBeenCalledTimes(1)

      act(() => notifyAuthRequired('unauthorized'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      act(() => authStateCallback()({ email: 'someone@amnex.com' }))

      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('secret-data'))
      expect(queryFn).toHaveBeenCalledTimes(2)
    })

    it('does not touch a query that never failed', async () => {
      const client = new QueryClient()
      const queryFn = vi.fn().mockResolvedValue('already-fine')

      render(
        <QueryClientProvider client={client}>
          <Probe queryFn={queryFn} />
          <AuthPromptDialog />
        </QueryClientProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('already-fine'))
      expect(queryFn).toHaveBeenCalledTimes(1)

      act(() => authStateCallback()({ email: 'someone@amnex.com' }))
      // No pending state change to await — assert the call count stays put
      // rather than racing a refetch that should never be scheduled.
      expect(queryFn).toHaveBeenCalledTimes(1)
    })
  })
})
