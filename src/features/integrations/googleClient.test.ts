import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { authorizeGoogle, googleApiRequest, testGoogleConnection } from './googleClient'
import { getGoogleSession, setGoogleAccount } from './session'
const account = { uid: 'user-a', email: 'a@amnex.com', googleId: 'google-a' }
const clientId = '123.apps.googleusercontent.com'
const calendarScope = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const fetchMock = vi.fn()
const initTokenClient = vi.fn()
describe('Google account-bound authorization', () => {
  beforeEach(() => {
    setGoogleAccount(null); setGoogleAccount(account); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } })
    initTokenClient.mockImplementation(config => ({ requestAccessToken: () => config.callback({ access_token: 'memory-only', expires_in: 3600, scope: config.scope }) }))
    fetchMock.mockImplementation(async url => Response.json(String(url).includes('/userinfo') ? { sub: account.googleId, email: account.email, email_verified: true, hd: 'amnex.com' } : {}))
  })
  afterEach(() => { setGoogleAccount(null); vi.unstubAllGlobals(); vi.useRealTimers() })
  it('uses the signed-in account hint and reuses existing grants without another popup', async () => {
    expect(await authorizeGoogle(account, [calendarScope], clientId)).toBe('memory-only')
    expect(initTokenClient.mock.calls[0][0]).toMatchObject({ client_id: clientId, login_hint: account.email, hd: 'amnex.com', include_granted_scopes: true })
    expect(await authorizeGoogle(account, [calendarScope], clientId)).toBe('memory-only')
    expect(initTokenClient).toHaveBeenCalledOnce()
    expect(await testGoogleConnection('calendar', account, { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId })).toMatchObject({ status: 'verified' })
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toContain('/calendar/v3/users/me/calendarList')
  })
  it('rejects another account, even on the same domain, and never stores its token', async () => {
    fetchMock.mockResolvedValue(Response.json({ sub: 'google-b', email: 'b@amnex.com', email_verified: true, hd: 'amnex.com' }))
    await expect(authorizeGoogle(account, [calendarScope], clientId)).rejects.toThrow('same Amnex Google account')
    expect(getGoogleSession([calendarScope])).toBeNull()
  })
  it('rejects missing grants and discards tokens when the signed-in user changes', async () => {
    initTokenClient.mockImplementationOnce(config => ({ requestAccessToken: () => config.callback({ access_token: 'bad-grant', scope: 'openid email' }) }))
    await expect(authorizeGoogle(account, [calendarScope], clientId)).rejects.toThrow('permission was not granted')
    expect(fetchMock).not.toHaveBeenCalled()
    await authorizeGoogle(account, [calendarScope], clientId)
    setGoogleAccount({ uid: 'user-b', email: 'b@amnex.com', googleId: 'google-b' })
    expect(getGoogleSession([calendarScope])).toBeNull()
    await expect(authorizeGoogle(account, [calendarScope], clientId)).rejects.toThrow('account changed')
  })
  it('does not claim a Docs API check when no test document exists', async () => {
    fetchMock.mockImplementation(async url => Response.json(String(url).includes('/userinfo') ? { sub: account.googleId, email: account.email, email_verified: true, hd: 'amnex.com' } : { files: [] }))
    expect(await testGoogleConnection('docs', account, { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId })).toMatchObject({ status: 'authorized' })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('docs.googleapis.com'))).toBe(false)
  })
  it('clearly identifies web-only and cloud setup requirements', async () => {
    expect(await testGoogleConnection('maps', account, DEFAULT_GOOGLE_INTEGRATIONS)).toMatchObject({ status: 'account' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(testGoogleConnection('notebooklm', account, DEFAULT_GOOGLE_INTEGRATIONS)).rejects.toThrow('NotebookLM Enterprise')
    await expect(testGoogleConnection('translate', account, DEFAULT_GOOGLE_INTEGRATIONS)).rejects.toThrow('Cloud Translation')
  })
  it('rejects token exfiltration to non-Google and insecure endpoints before making a request', async () => {
    for (const url of ['https://googleapis.com.evil.example/read', 'http://www.googleapis.com/read', 'https://user:pass@www.googleapis.com/read']) await expect(googleApiRequest(url, 'secret')).rejects.toThrow('approved Google API')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
