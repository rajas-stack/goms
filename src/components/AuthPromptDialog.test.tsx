import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { AuthPromptDialog } from './AuthPromptDialog'
import { notifyAuthRequired, setPendingAuthReason } from '@/lib/authPrompt'
import { ShellUpdateRequiredError } from '@/lib/auth/errors'
import { bootstrapNativeAuth } from '@/lib/auth/bootstrap'

const { onAuthStateChanged, signInWithPopup } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged, signInWithPopup, GoogleAuthProvider: class {} }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))
// The Android deep-link listener is faked so the test can deliver links; bootstrapNativeAuth and authPrompt are the real ones.
const { deepLink } = vi.hoisted(() => ({ deepLink: { handler: null as null | ((r: { code?: string; error?: string }) => Promise<void>) } }))
vi.mock('@/lib/auth/native', () => ({
  listenForAuthDeepLinks: async (_scheme: string, h: (r: { code?: string; error?: string }) => Promise<void>) => { deepLink.handler = h },
}))

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

  it('an old Android shell (ShellUpdateRequiredError) is told to update the app, not shown the generic failure', async () => {
    signInWithPopup.mockRejectedValue(new ShellUpdateRequiredError())
    renderDialog()
    act(() => notifyAuthRequired('unauthorized'))

    await act(async () => {
      screen.getByRole('button', { name: /sign in with google/i }).click()
      await Promise.resolve()
    })

    expect(await screen.findByText("This version of the GOMS app can't sign you in. Update the app and try again.")).toBeInTheDocument()
    expect(screen.queryByText(/sign-in failed/i)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('any other rejection still shows the generic text, and a later notification clears the previous error', async () => {
    signInWithPopup.mockRejectedValue(new Error('network'))
    renderDialog()
    act(() => notifyAuthRequired('unauthorized'))

    await act(async () => {
      screen.getByRole('button', { name: /sign in with google/i }).click()
      await Promise.resolve()
    })

    expect(await screen.findByText('Sign-in failed. Try again.')).toBeInTheDocument()
    expect(screen.queryByText(/update the app/i)).not.toBeInTheDocument()
    act(() => notifyAuthRequired('unauthorized'))
    expect(screen.queryByText(/sign-in failed/i)).not.toBeInTheDocument()
  })

  describe('a reason raised before the dialog mounted (failed sign-in redirect)', () => {
    it("shows the 'forbidden' prompt on mount, with no signed-in user and no blank email", async () => {
      setPendingAuthReason('forbidden')
      renderDialog()
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(await screen.findByText(/isn't authorized/i)).toBeInTheDocument()
      expect(screen.getByText(/@amnex\.com Google account/i)).toBeInTheDocument()
      expect(screen.getByText(/sign in with a different one/i)).toBeInTheDocument()
      // The signed-in sentence ("<email> is signed in, but ...") must NOT be rendered without a user...
      expect(screen.queryByText(/is signed in/i)).not.toBeInTheDocument()
    })

    it("sibling: with a signed-in user the 'is signed in' sentence IS rendered (proves the negative above can match)", async () => {
      onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'someone@gmail.com' }); return () => {} })
      setPendingAuthReason('forbidden')
      renderDialog()
      expect(await screen.findByText(/someone@gmail\.com is signed in/i)).toBeInTheDocument()
      expect(screen.queryByText(/sign in with a different one/i)).not.toBeInTheDocument()
    })

    it("shows the 'sign in required' prompt for a pending 'unauthorized' reason", async () => {
      setPendingAuthReason('unauthorized')
      renderDialog()
      expect(await screen.findByText(/sign in required/i)).toBeInTheDocument()
      expect(screen.queryByText(/isn't authorized/i)).not.toBeInTheDocument()
    })

    it('shows a pending reason only once: a later mount starts closed', async () => {
      setPendingAuthReason('forbidden')
      const { unmount } = render(<QueryClientProvider client={new QueryClient()}><AuthPromptDialog /></QueryClientProvider>)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      unmount()
      renderDialog()
      await Promise.resolve()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Android deep-link failures reach an already-mounted dialog (R19, warm path)', () => {
    async function mountThenBoot(redeem: () => Promise<void> = async () => {}) {
      renderDialog() // the dialog subscribes ONCE, at mount - before any link arrives
      await bootstrapNativeAuth({ redeem, init: async () => {}, trackHandoff: () => {}, isSignedIn: () => false }, 'com.gorms.app')
    }

    it('?error=domain shows the "isn\'t authorized" copy', async () => {
      await mountThenBoot()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await act(async () => { await deepLink.handler!({ error: 'domain' }) })
      expect(await screen.findByText(/isn't authorized/i)).toBeInTheDocument()
      expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument()
    })

    it('sibling: ?error=state shows "sign in required" and NOT the "isn\'t authorized" copy (proves the negative above can match)', async () => {
      await mountThenBoot()
      await act(async () => { await deepLink.handler!({ error: 'state' }) })
      expect(await screen.findByText(/sign in required/i)).toBeInTheDocument()
      expect(screen.queryByText(/isn't authorized/i)).not.toBeInTheDocument()
    })

    it('a failed redeem shows "sign in required"', async () => {
      await mountThenBoot(async () => { throw new Error('expired') })
      await act(async () => { await deepLink.handler!({ code: 'Q'.repeat(43) }) })
      expect(await screen.findByText(/sign in required/i)).toBeInTheDocument()
    })

    it('sibling: a successful redeem leaves the dialog closed', async () => {
      await mountThenBoot()
      await act(async () => { await deepLink.handler!({ code: 'Q'.repeat(43) }) })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
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

  describe('unauthenticated protected reads render gracefully, not as a generic error', () => {
    // Mirrors the real pattern every business-router page uses (SalesWorkspace's
    // Roster, Directory, etc.): `const { data = [] } = useQuery(...)`, with no
    // `isError` branch at all. A 401/403 collapses into the exact same
    // empty-state render as "no data yet" — this component's global dialog is
    // the ONLY thing that ever surfaces the auth failure to the user. Regression
    // coverage for the 2026-09-15 goms-prod investigation, which confirmed this
    // is what already happens (a genuinely different crash — a stale post-deploy
    // JS chunk reference, unrelated to this data-fetch path — was mistaken for
    // an auth-race bug; see staleChunkRecovery.ts for that fix).
    function ListProbe({ queryFn }: { queryFn: () => Promise<string[]> }) {
      const { data = [] } = useQuery({ queryKey: ['list-probe'], queryFn, retry: false })
      return <div data-testid="list-probe">{data.length === 0 ? 'No items yet.' : data.join(',')}</div>
    }

    it('shows the normal empty state, never error text, while a protected read 401s and the prompt is up', async () => {
      const client = new QueryClient()
      const queryFn = vi.fn().mockRejectedValue({ data: { code: 'UNAUTHORIZED' } })

      render(
        <QueryClientProvider client={client}>
          <ListProbe queryFn={queryFn} />
          <AuthPromptDialog />
        </QueryClientProvider>,
      )
      // The real app's authPromptLink (a separate, already-tested tRPC link)
      // is what actually calls this on a 401 — invoked directly here since
      // this test's ListProbe talks to a bare useQuery, not the real client.
      act(() => notifyAuthRequired('unauthorized'))

      await waitFor(() => expect(queryFn).toHaveBeenCalled())

      expect(screen.getByTestId('list-probe')).toHaveTextContent('No items yet.')
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/sign in required/i)).toBeInTheDocument()
    })

    it('behaves identically for a genuine, non-auth query failure — this pattern was never auth-specific', async () => {
      const client = new QueryClient()
      const queryFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

      render(
        <QueryClientProvider client={client}>
          <ListProbe queryFn={queryFn} />
        </QueryClientProvider>,
      )

      await waitFor(() => expect(queryFn).toHaveBeenCalled())

      expect(screen.getByTestId('list-probe')).toHaveTextContent('No items yet.')
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })
  })
})
