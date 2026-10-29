import { afterEach, describe, expect, it, vi } from 'vitest'

const load = async (stored: unknown) => {
  localStorage.setItem('goms.localGoogleUser', JSON.stringify(stored))
  vi.resetModules()
  return (await import('./localGoogleProvider')).localGoogleAccount()
}

describe('local Google sign-in → Google apps account', () => {
  afterEach(() => localStorage.clear())

  it('binds a verified Amnex account by its Google id', async () => {
    expect(await load({ email: 'Shubham16@amnex.com', emailVerified: true, googleId: '123', displayName: null, photoUrl: null }))
      .toEqual({ uid: '123', email: 'shubham16@amnex.com', googleId: '123' })
  })

  it('binds nothing for other domains, unverified emails or sign-ins saved before the Google id was kept', async () => {
    expect(await load({ email: 'someone@gmail.com', emailVerified: true, googleId: '1' })).toBeNull()
    expect(await load({ email: 'shubham16@amnex.com', emailVerified: false, googleId: '1' })).toBeNull()
    expect(await load({ email: 'shubham16@amnex.com', emailVerified: true })).toBeNull()
  })
})
