import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: state.query } }))
vi.mock('../auth/identity.js', () => ({ verifyFirebaseToken: state.verify, isAmnexAccount: (email: string) => email.endsWith('@amnex.com') }))
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { googleIntegrationsRouter } from './googleIntegrations.js'
const caller = () => googleIntegrationsRouter.createCaller({ authHeader: 'Bearer verified-user-token' })
describe('per-user Google integration settings', () => {
  beforeEach(() => { vi.clearAllMocks(); state.verify.mockResolvedValue({ uid: 'user-a', email: 'a@amnex.com' }); state.query.mockResolvedValue({ rows: [] }) })
  it('loads only the current verified user, even with staged authentication off', async () => {
    expect(await caller().get({ accountUid: 'user-a' })).toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(state.verify).toHaveBeenCalledWith('Bearer verified-user-token')
    expect(state.query).toHaveBeenCalledWith('SELECT settings FROM google_integration_settings WHERE user_uid=$1', ['user-a'])
  })
  it('rejects cross-user writes and non-Amnex identities before accessing data', async () => {
    await expect(caller().save({ accountUid: 'user-b', settings: DEFAULT_GOOGLE_INTEGRATIONS })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller().get({ accountUid: 'user-b' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    state.verify.mockResolvedValue({ uid: 'user-a', email: 'a@example.com' })
    await expect(caller().get({ accountUid: 'user-a' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.query).not.toHaveBeenCalled()
  })
  it('persists configuration and page choices, rejecting token storage', async () => {
    const settings = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', disabledPages: { calendar: ['accounts'] } }
    expect(await caller().save({ accountUid: 'user-a', settings })).toEqual(settings)
    expect(state.query.mock.calls[0][1]).toEqual(['user-a', 'a@amnex.com', settings])
    await expect(caller().save({ accountUid: 'user-a', settings: { ...settings, accessToken: 'do-not-store' } as any })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().save({ accountUid: 'user-a', settings: { ...settings, disabledPages: { gmail: ['../bad'] } } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
