import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
const authChange = vi.hoisted(() => ({ callback: undefined as undefined | ((user: any) => void) }))
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: any) => void) => { authChange.callback = callback; return () => {} } }))
vi.mock('@/lib/firebaseAuth', () => ({ auth: {} }))
vi.mock('./settings', () => ({ loadGoogleSettings: vi.fn(async () => undefined) }))
import { GoogleAccountBinder, googleAccountFromUser } from './GoogleAccountBinder'
import { setGoogleAccount } from './session'
afterEach(() => { cleanup(); setGoogleAccount(null) })
const user = { uid: 'signed', email: 'signed@amnex.com', emailVerified: true, providerData: [{ providerId: 'google.com', uid: 'google-signed' }] }
describe('account privacy boundary', () => {
  it('accepts only verified Amnex Google users', () => {
    expect(googleAccountFromUser(user as any)?.uid).toBe('signed')
    for (const candidate of [{ ...user, emailVerified: false }, { ...user, email: 'signed@notamnex.com' }, { ...user, providerData: [{ providerId: 'password', uid: 'signed' }] }]) expect(googleAccountFromUser(candidate as any)).toBeNull()
  })
  it('removes the previous user data from mounted observers on account changes', async () => {
    // Linked Google accounts can change while the Firebase UID remains unchanged.
    setGoogleAccount({ uid: user.uid, email: user.email, googleId: 'previous-google-account' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['private'], 'old user private data')
    function Viewer() { const { data } = useQuery({ queryKey: ['private'], queryFn: async () => null, enabled: false }); return <span>{data ? String(data) : 'No private data'}</span> }
    render(<QueryClientProvider client={client}><GoogleAccountBinder /><Viewer /></QueryClientProvider>)
    expect(screen.getByText('old user private data')).toBeInTheDocument()
    act(() => authChange.callback!(user))
    await waitFor(() => expect(screen.queryByText('old user private data')).not.toBeInTheDocument())
    expect(client.getQueryData(['private'])).toBeUndefined()
  })
})
