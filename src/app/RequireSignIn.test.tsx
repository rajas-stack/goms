import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({
  auth: { configured: true, user: null as null | { email: string; emailVerified: boolean }, loading: false },
}))
vi.mock('@/lib/auth', () => ({
  authApi: { get configured() { return auth.configured } },
  useAuthUser: () => ({ user: auth.user, loading: auth.loading }),
}))
import { RequireSignIn } from './RequireSignIn'

function Where() {
  const l = useLocation()
  return <p>login page {l.pathname}{l.search}</p>
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Where />} />
        <Route path="*" element={<RequireSignIn><p>internal page</p></RequireSignIn>} />
      </Routes>
    </MemoryRouter>,
  )
}
const amnex = { email: 'a@amnex.com', emailVerified: true }

describe('RequireSignIn', () => {
  it('sends a signed-out visitor to /login, remembering the page they asked for', () => {
    Object.assign(auth, { configured: true, user: null, loading: false })
    renderAt('/bid-tracker?tab=x')
    expect(screen.getByText('login page /login?next=%2Fbid-tracker%3Ftab%3Dx')).toBeInTheDocument()
    expect(screen.queryByText('internal page')).toBeNull()
  })
  it('sends the bare home URL to a plain /login', () => {
    Object.assign(auth, { configured: true, user: null, loading: false })
    renderAt('/')
    expect(screen.getByText('login page /login')).toBeInTheDocument()
  })
  it('shows nothing internal while sign-in state is still loading', () => {
    Object.assign(auth, { configured: true, user: null, loading: true })
    renderAt('/map')
    expect(screen.queryByText('internal page')).toBeNull()
    expect(screen.queryByText(/login page/)).toBeNull()
  })
  it('rejects a signed-in account that is not a verified @amnex.com one', () => {
    Object.assign(auth, { configured: true, user: { email: 'me@gmail.com', emailVerified: true }, loading: false })
    renderAt('/map')
    expect(screen.getByText(/login page \/login/)).toBeInTheDocument()
    Object.assign(auth, { user: { email: 'a@amnex.com', emailVerified: false } })
    renderAt('/map')
    expect(screen.getAllByText(/login page \/login/).length).toBe(2)
  })
  it('renders the app for a verified @amnex.com account', () => {
    Object.assign(auth, { configured: true, user: amnex, loading: false })
    renderAt('/map')
    expect(screen.getByText('internal page')).toBeInTheDocument()
  })
  it('passes through when sign-in is not configured (local in-memory dev)', () => {
    Object.assign(auth, { configured: false, user: null, loading: false })
    renderAt('/map')
    expect(screen.getByText('internal page')).toBeInTheDocument()
  })
})
