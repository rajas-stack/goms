import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from './types'

const h = vi.hoisted(() => ({
  user: null as AuthUser | null,
  listeners: new Set<(user: AuthUser | null, loading: boolean) => void>(),
}))
vi.mock('./authApi', () => ({
  authApi: {
    currentUser: () => h.user,
    subscribe: (cb: (user: AuthUser | null, loading: boolean) => void) => { h.listeners.add(cb); return () => { h.listeners.delete(cb) } },
  },
}))
import { currentAuthUid, onAuthIdentityChange } from './currentUser'

const person = (uid: string | undefined, email = 'a@amnex.com'): AuthUser => ({ email, displayName: null, photoUrl: null, emailVerified: true, uid })
const emit = (user: AuthUser | null, loading = false) => h.listeners.forEach((l) => l(user, loading))

beforeEach(() => { h.user = null; h.listeners.clear() })

describe('currentAuthUid', () => {
  it('is the signed-in uid, whichever provider produced it, and null when nobody is signed in or the provider has no uid', () => {
    expect(currentAuthUid()).toBeNull()
    h.user = person('g:1029384756'); expect(currentAuthUid()).toBe('g:1029384756')
    h.user = person('fb-uid-1'); expect(currentAuthUid()).toBe('fb-uid-1')
    h.user = person(undefined); expect(currentAuthUid()).toBeNull()
  })
})

describe('onAuthIdentityChange', () => {
  it('stays quiet for the initial loading report and the first answer', () => {
    const onChange = vi.fn()
    onAuthIdentityChange(onChange)
    emit(null, true)
    emit(person('g:1'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores re-emits of the same person (an OAuth access-token refresh does this about every 15 minutes)', () => {
    const onChange = vi.fn()
    onAuthIdentityChange(onChange)
    emit(person('g:1'))
    emit(person('g:1'))
    emit(person('g:1', 'A@Amnex.com'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('fires on sign-out, and when someone else signs in', () => {
    const onChange = vi.fn()
    onAuthIdentityChange(onChange)
    emit(person('g:1'))
    emit(null)
    expect(onChange).toHaveBeenCalledTimes(1)
    emit(person('g:2'))
    expect(onChange).toHaveBeenCalledTimes(2)
    emit(person('g:3'))
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('falls back to the email as the identity when a provider reports no uid', () => {
    const onChange = vi.fn()
    onAuthIdentityChange(onChange)
    emit(person(undefined, 'a@amnex.com'))
    emit(person(undefined, 'a@amnex.com'))
    expect(onChange).not.toHaveBeenCalled()
    emit(person(undefined, 'b@amnex.com'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stops listening once unsubscribed', () => {
    const onChange = vi.fn()
    const stop = onAuthIdentityChange(onChange)
    emit(person('g:1'))
    stop()
    emit(null)
    expect(onChange).not.toHaveBeenCalled()
  })
})
