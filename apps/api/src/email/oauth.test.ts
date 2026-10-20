import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ query: vi.fn(), event: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: m.query } }))
vi.mock('./store.js', () => ({ emailEvent: m.event, inTransaction: async (fn: any) => fn({ query: m.query }) }))
import { beginMailConnection, completeMailConnection, type MailOAuthGateway } from './oauth.js'
import { openEmailCredentials, GMAIL_SCOPE } from './config.js'
import type { EmailActor } from './access.js'
const actor = { uid: 'u', email: 'me@amnex.com' } as EmailActor
let saved: any
const gateway: MailOAuthGateway = { exchange: vi.fn(), verify: vi.fn(), profile: vi.fn() }
const response = () => { const reply: any = { header: vi.fn(() => reply), code: vi.fn(() => reply), send: vi.fn(() => reply) }; return reply }
beforeEach(() => {
  vi.clearAllMocks(); saved = undefined
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client'); vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret'); vi.stubEnv('AUTH_SESSION_SECRET', 'x'.repeat(40)); vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:8088/api/oauth/google/callback')
  m.query.mockImplementation(async (sql: string, values?: any[]) => {
    if (sql.startsWith('INSERT INTO email_oauth_flows')) saved = { state_hash: values![0], cookie_hash: values![1], verifier: values![2], nonce: values![3], user_uid: values![4], email: values![5], return_to: values![6] }
    if (sql.startsWith('DELETE FROM email_oauth_flows WHERE state_hash')) { if (saved && values![0] === saved.state_hash && values![1] === saved.cookie_hash) { const flow = saved; saved = undefined; return { rows: [flow] } } }
    return { rows: [] }
  })
  vi.mocked(gateway.exchange).mockResolvedValue({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, scope: GMAIL_SCOPE, id_token: 'signed-token' })
  vi.mocked(gateway.verify).mockResolvedValue({ email: actor.email, sub: 'google-subject' }); vi.mocked(gateway.profile).mockResolvedValue(actor.email)
})
afterEach(() => vi.unstubAllEnvs())
async function connect() { let cookie = ''; const result = await beginMailConnection(actor, '/bid-tracker/bid/123?tab=communication&view=all', value => { cookie = value }); return { result, cookie: cookie.split(';')[0], state: new URL(result.url).searchParams.get('state')! } }
describe('server Gmail OAuth', () => {
  it('binds PKCE and one-use state to an HttpOnly browser cookie, without returning credentials', async () => {
    const { result, cookie, state } = await connect(); const reply = response()
    expect(new URL(result.url).searchParams.get('code_challenge_method')).toBe('S256')
    expect(JSON.stringify(result)).not.toMatch(/private-access|private-refresh|client_secret/)
    await completeMailConnection({ query: { state, code: 'code' }, headers: { cookie } }, reply, gateway)
    expect(reply.code).toHaveBeenCalledWith(302)
    expect(reply.header).toHaveBeenCalledWith('Location', expect.stringContaining('tab=communication'))
    const insert = m.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO email_mailboxes'))!
    const values = insert[1] as any[]
    expect(values[4]).not.toMatch(/private-access|private-refresh/)
    expect(openEmailCredentials(JSON.parse(values[4]), `${values[0]}:${actor.email}`).refreshToken).toBe('private-refresh')
    await completeMailConnection({ query: { state, code: 'code' }, headers: { cookie } }, response(), gateway)
    expect(gateway.exchange).toHaveBeenCalledOnce()
  })
  it('rejects a callback from another browser before contacting Google', async () => {
    const { state } = await connect(); const reply = response()
    await completeMailConnection({ query: { state, code: 'code' }, headers: {} }, reply, gateway)
    expect(reply.code).toHaveBeenCalledWith(400); expect(gateway.exchange).not.toHaveBeenCalled()
  })
  it('refuses an account switch or missing Gmail scope without saving a mailbox', async () => {
    const { state, cookie } = await connect(); vi.mocked(gateway.verify).mockResolvedValue({ email: 'other@amnex.com', sub: 'other' })
    await completeMailConnection({ query: { state, code: 'code' }, headers: { cookie } }, response(), gateway)
    expect(m.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO email_mailboxes'))).toBe(false)
    expect(m.event).not.toHaveBeenCalled()
  })
})


it.each(['synthetic-sensitive-marker', 'SDK Authorization: Bearer synthetic-token'])('redacts arbitrary error text: %s', async marker => {
  const {state,cookie}=await connect();vi.mocked(gateway.exchange).mockRejectedValueOnce(new Error(marker))
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
  try { await completeMailConnection({query:{state,code:'code'},headers:{cookie}},response(),gateway);expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);expect(JSON.stringify(warn.mock.calls)).toContain('unexpected_failure') } finally {warn.mockRestore()}
})
it('retains an allowlisted setup diagnostic without provider payloads', async () => {
  const {state,cookie}=await connect();vi.mocked(gateway.exchange).mockRejectedValueOnce(new Error('Google authorization failed (HTTP 403).'))
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
  try {await completeMailConnection({query:{state,code:'code'},headers:{cookie}},response(),gateway);expect(JSON.stringify(warn.mock.calls)).toContain('HTTP 403')} finally {warn.mockRestore()}
})
