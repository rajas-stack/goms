import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyFirebaseToken, parseAllowList, isAllowListed, isAmnexAccount } from './identity.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'

describe('verifyFirebaseToken', () => {
  it('rejects a missing Authorization header', async () => {
    await expect(verifyFirebaseToken(undefined)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a malformed/expired token', async () => {
    await expect(verifyFirebaseToken('Bearer not-a-real-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a token with no verified email', async () => {
    const header = `Bearer ${fakeIdToken({ email: 'someone@amnex.com', email_verified: false })}`
    await expect(verifyFirebaseToken(header)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('resolves the uid/email for a verified token', async () => {
    const header = `Bearer ${fakeIdToken({ uid: 'abc123', email: 'someone@amnex.com' })}`
    await expect(verifyFirebaseToken(header)).resolves.toEqual({ uid: 'abc123', email: 'someone@amnex.com' })
  })
})

describe('parseAllowList / isAllowListed', () => {
  it('parses a comma-separated, whitespace/case-insensitive list', () => {
    expect(parseAllowList(' A@x.com, B@X.com ,,')).toEqual(['a@x.com', 'b@x.com'])
  })

  it('treats an unset list as empty', () => {
    expect(parseAllowList(undefined)).toEqual([])
  })

  it('matches case-insensitively', () => {
    expect(isAllowListed('A@X.COM', 'a@x.com')).toBe(true)
  })

  it('rejects an email not on the list', () => {
    expect(isAllowListed('nope@x.com', 'a@x.com')).toBe(false)
  })
})

describe('isAmnexAccount', () => {
  it('accepts any amnex.com address, case-insensitively', () => {
    expect(isAmnexAccount('Someone@Amnex.com')).toBe(true)
  })

  it('rejects a non-amnex address', () => {
    expect(isAmnexAccount('someone@gmail.com')).toBe(false)
  })

  it('rejects a lookalike domain', () => {
    expect(isAmnexAccount('someone@notamnex.com')).toBe(false)
  })
})
