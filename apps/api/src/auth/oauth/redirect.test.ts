import { describe, expect, it } from 'vitest'
import { parseClient, safeReturnTo, webRedirectUrl } from './redirect.js'

describe('safeReturnTo', () => {
  it.each(['/', '/sales/roster', '/bid-tracker?sheet=pipeline#top', '/a%2Fb'])('keeps %s', (p) => expect(safeReturnTo(p)).toBe(p))
  it.each([
    undefined, null, '', 'sales', '//evil.example', '///evil', 'https://evil.example', 'javascript:alert(1)',
    '/\\evil', '/a\\b', '/path\u0000x', '/path\nx', '/\t/evil', 'x'.repeat(600), 7,
  ])('falls back to / for %j', (p) => expect(safeReturnTo(p as unknown)).toBe('/'))
})

describe('parseClient', () => {
  it('accepts only web and app', () => {
    expect(parseClient('web')).toBe('web'); expect(parseClient('app')).toBe('app')
    for (const v of ['', 'WEB', 'tablet', undefined, null, 1]) expect(parseClient(v as unknown)).toBeNull()
  })
})

describe('webRedirectUrl', () => {
  const origin = 'https://goms-dev.firebaseapp.com'
  it('appends params to the path, preserving existing query and hash', () => {
    expect(webRedirectUrl(origin, '/bid-tracker?sheet=x#top', { auth_code: 'C1' }))
      .toBe('https://goms-dev.firebaseapp.com/bid-tracker?sheet=x&auth_code=C1#top')
  })
  it('replaces an auth_code already in return_to instead of stacking two', () => {
    expect(webRedirectUrl(origin, '/?auth_code=OLD', { auth_code: 'NEW' })).toBe('https://goms-dev.firebaseapp.com/?auth_code=NEW')
  })
  it('can never leave the configured origin', () => {
    expect(new URL(webRedirectUrl(origin, '//evil.example/x', { auth_code: 'C' })).origin).toBe(origin)
  })
})
