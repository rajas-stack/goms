import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Login } from './Login'

const hook = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  signIn: vi.fn(),
  switchAccount: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/useGoogleSignIn', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/useGoogleSignIn')>()),
  useGoogleSignIn: () => ({ signIn: hook.signIn, switchAccount: hook.switchAccount, ...hook.state }),
}))

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const signedOut = { configured: true, user: null, resolved: true, status: 'idle' }

describe('Login', () => {
  beforeEach(() => {
    hook.signIn.mockReset()
    hook.switchAccount.mockReset().mockResolvedValue(undefined)
    hook.state = { ...signedOut }
  })

  it('shows the sign-in card and starts Google sign-in on click', async () => {
    renderAt('/login')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByAltText('Amnex')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(hook.signIn).toHaveBeenCalledTimes(1)
  })

  it('disables the button and explains when sign-in is not configured', () => {
    hook.state = { ...signedOut, configured: false }
    renderAt('/login')
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled()
    expect(screen.getByText(/not configured for this deployment/i)).toBeInTheDocument()
  })

  it('disables the button while signing in', () => {
    hook.state = { ...signedOut, status: 'signing-in' }
    renderAt('/login')
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
  })

  it('disables the button until the persisted session has been resolved', () => {
    hook.state = { ...signedOut, resolved: false }
    renderAt('/login')
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled()
  })

  it('shows a failure message after a failed sign-in', () => {
    hook.state = { ...signedOut, status: 'error' }
    renderAt('/login')
    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in failed/i)
  })

  it('redirects an already signed-in @amnex.com account to ?next', () => {
    hook.state = { ...signedOut, user: { email: 'a@amnex.com', emailVerified: true } }
    renderAt('/login?next=%2Fsales%3Ftab%3D1')
    expect(screen.getByTestId('where')).toHaveTextContent('/sales?tab=1')
  })

  it('redirects to / when there is no ?next', () => {
    hook.state = { ...signedOut, user: { email: 'a@amnex.com', emailVerified: true } }
    renderAt('/login')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example', '/\\/evil.example', 'javascript:alert(1)', '/a\u0000b', '/a\nb', '/login'])(
    'redirects to / for an unsafe ?next (%s)',
    (bad) => {
      hook.state = { ...signedOut, user: { email: 'a@amnex.com', emailVerified: true } }
      renderAt(`/login?next=${encodeURIComponent(bad)}`)
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
    },
  )

  it('shows "not authorized" for a non-amnex account and offers to switch', async () => {
    hook.state = { ...signedOut, user: { email: 'someone@gmail.com', emailVerified: true } }
    renderAt('/login')
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't authorized/i)
    expect(screen.getByRole('alert')).toHaveTextContent('someone@gmail.com')
    expect(screen.queryByTestId('where')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /use a different account/i }))
    expect(hook.switchAccount).toHaveBeenCalledTimes(1)
  })

  it('treats an unverified @amnex.com address as not authorized', () => {
    hook.state = { ...signedOut, user: { email: 'a@amnex.com', emailVerified: false } }
    renderAt('/login')
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't authorized/i)
  })
})
