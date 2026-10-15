import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: state.query, connect: async () => ({ query: state.query, release: () => {} }) } }))
vi.mock('../auth/identity.js', () => ({ verifyLinkedIdentity: state.verify, isAmnexAccount: (email: string) => email.endsWith('@amnex.com') }))
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { googleIntegrationsRouter } from './googleIntegrations.js'
const caller = () => googleIntegrationsRouter.createCaller({ authHeader: 'Bearer verified-user-token' })
describe('per-user Google integration settings', () => {
  beforeEach(() => { vi.clearAllMocks(); state.verify.mockResolvedValue({ uid: 'user-a', email: 'a@amnex.com' }); state.query.mockResolvedValue({ rows: [] }) })
  it('loads only the current verified user, even with staged authentication off', async () => {
    expect(await caller().get({ accountUid: 'user-a' })).toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(state.verify).toHaveBeenCalledWith('Bearer verified-user-token')
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('FROM google_integration_settings'), ['user-a', null])
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
    const insert = state.query.mock.calls.find((c) => /INSERT INTO google_integration_settings/.test(String(c[0])))
    expect(insert?.[1]).toEqual(['user-a', 'a@amnex.com', settings, null])
    await expect(caller().save({ accountUid: 'user-a', settings: { ...settings, accessToken: 'do-not-store' } as any })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().save({ accountUid: 'user-a', settings: { ...settings, disabledPages: { gmail: ['../bad'] } } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('persists master activation and Maps browser configuration, rejecting unknown services', async () => {
    const settings = { ...DEFAULT_GOOGLE_INTEGRATIONS, disabledServices: ['gmail' as const], mapsEmbedKey: 'restricted-browser-key' }
    expect(await caller().save({ accountUid: 'user-a', settings })).toEqual(settings)
    await expect(caller().save({ accountUid: 'user-a', settings: { ...settings, disabledServices: ['unknown' as any] } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
