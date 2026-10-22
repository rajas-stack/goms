import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TenderWebsite } from '@goms/domain'
import { authApi, type AuthUser } from '@/lib/auth'

vi.mock('./credentialLock', () => ({
  unlockCredentials: vi.fn(async (_lock: unknown, passphrase: string) => {
    if (passphrase !== 'portal-lock') throw new Error('Could not unlock credentials. Check the passphrase.')
    return { userId: 'portal-user', password: 'portal-secret' }
  }),
}))
import { TenderCredentialsDialog } from './TenderCredentialsDialog'

const site: TenderWebsite = {
  id: 'site-1', name: 'Portal', url: 'https://portal.test', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  credentials: { version: 1, salt: 's', iv: 'i', ciphertext: 'c' },
}
const person = (uid: string, email = 'asha@amnex.com'): AuthUser => ({ email, displayName: null, photoUrl: null, emailVerified: true, uid, googleId: uid.replace('g:', '') })

let emit: (user: AuthUser | null, loading: boolean) => void
const unsubscribe = vi.fn()
beforeEach(() => {
  unsubscribe.mockReset()
  // The dialog follows the shared auth facade (Firebase or direct Google OAuth), so drive the facade itself.
  vi.spyOn(authApi, 'subscribe').mockImplementation((cb) => { emit = cb; return unsubscribe })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function unlock() {
  const user = userEvent.setup()
  render(<TenderCredentialsDialog site={site} onClose={vi.fn()} />)
  act(() => emit(person('g:1'), false)) // the provider's first answer: who is signed in
  await user.type(screen.getByLabelText('Credential passphrase'), 'portal-lock')
  await user.click(screen.getByRole('button', { name: 'Unlock credentials' }))
  expect(await screen.findByLabelText('User ID')).toHaveValue('portal-user')
  expect(screen.getByLabelText('Password')).toHaveValue('portal-secret')
}

describe('TenderCredentialsDialog clears unlocked credentials when the signed-in person changes', () => {
  it('stays unlocked across a session refresh that re-emits the same person (an OAuth access-token refresh does this about every 15 minutes)', async () => {
    await unlock()
    act(() => emit(person('g:1'), false))
    act(() => emit(person('g:1', 'ASHA@amnex.com'), false))
    expect(screen.getByLabelText('Password')).toHaveValue('portal-secret')
  })

  it('locks again and forgets the passphrase on sign-out', async () => {
    await unlock()
    act(() => emit(null, false))
    await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Credential passphrase')).toHaveValue('')
    expect(screen.queryByDisplayValue('portal-secret')).not.toBeInTheDocument()
  })

  it('locks again when a different person signs in', async () => {
    await unlock()
    act(() => emit(person('g:2', 'ravi@amnex.com'), false))
    await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Credential passphrase')).toHaveValue('')
  })

  it('does not apply an unlock that finishes after the person changed', async () => {
    const user = userEvent.setup()
    const { unlockCredentials } = await import('./credentialLock')
    let release: (value: { userId: string; password: string }) => void = () => {}
    vi.mocked(unlockCredentials).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    render(<TenderCredentialsDialog site={site} onClose={vi.fn()} />)
    act(() => emit(person('g:1'), false))
    await user.type(screen.getByLabelText('Credential passphrase'), 'portal-lock')
    await user.click(screen.getByRole('button', { name: 'Unlock credentials' }))
    act(() => emit(null, false)) // signed out while the unlock was still running
    await act(async () => { release({ userId: 'late-user', password: 'late-secret' }); await Promise.resolve() })
    expect(screen.queryByDisplayValue('late-secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('stops listening to the auth facade when it closes', () => {
    const view = render(<TenderCredentialsDialog site={site} onClose={vi.fn()} />)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
