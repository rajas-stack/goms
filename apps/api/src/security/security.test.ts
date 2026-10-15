import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }))
vi.mock('../auth/firebaseAdmin.js', () => ({ getFirebaseAuth: () => ({ verifyIdToken: mocks.verify }) }))
import { buildApp } from '../app.js'
import { publicProcedure, router, formatError } from '../trpc.js'
import { verifyFirebaseToken } from '../auth/identity.js'
import { assertSecurityConfiguration } from './config.js'
import { rbacMode } from '../auth/rbac/mode.js'
import { OperationBudget } from './operationLimit.js'
const action = vi.fn(() => 'changed')
const api = router({ read: publicProcedure.query(() => 'private'), write: publicProcedure.mutation(action) })
const sensitiveApi = router({ credentialPassphrases: router({ update: publicProcedure.mutation(action) }) })
beforeEach(() => {
  vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('FIREBASE_PROJECT_ID', 'test-project')
  vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('READ_AUTH_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('RBAC_MODE', 'enforce')
  vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://goms.example.com')
  vi.stubEnv('ADMIN_ALLOWED_EMAILS', 'security@amnex.com')
  vi.clearAllMocks()
  mocks.verify.mockResolvedValue({ uid: 'security-user', email: 'security@amnex.com', email_verified: true, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'google.com' } })
  mocks.query.mockResolvedValue({ rows: [{ id: 'audit-id' }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('production security', () => {
  it('requires secure configuration and enforces permissions independently of rollout defaults', () => {
    expect(rbacMode()).toBe('enforce')
    vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'false')
    expect(assertSecurityConfiguration).toThrow('must be true')
    vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'true'); vi.stubEnv('RBAC_MODE', 'shadow')
    expect(assertSecurityConfiguration).toThrow('must be enforce')
    vi.stubEnv('RBAC_MODE', 'enforce'); vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:5173')
    expect(assertSecurityConfiguration).toThrow('HTTPS')
  })
  it('blocks missing, non-Google and non-Amnex identities and requests revocation checks', async () => {
    await expect(api.createCaller({}).read()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(api.createCaller({ authHeader: 'Bearer token' }).read()).resolves.toBe('private')
    expect(mocks.verify).toHaveBeenCalledWith('token', true)
    mocks.verify.mockResolvedValueOnce({ uid: 'bad', email: 'someone@amnex.com', email_verified: true, firebase: { sign_in_provider: 'password' } })
    await expect(verifyFirebaseToken('Bearer token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    mocks.verify.mockResolvedValueOnce({ uid: 'bad', email: 'someone@gmail.com', email_verified: true, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'google.com' } })
    await expect(api.createCaller({ authHeader: 'Bearer token' }).read()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    mocks.verify.mockRejectedValueOnce(new Error('auth/id-token-revoked'))
    await expect(api.createCaller({ authHeader: 'Bearer token' }).read()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('requires an audit intent before mutations and records their result without inputs', async () => {
    const caller = api.createCaller({ authHeader: 'Bearer token' })
    mocks.query.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(caller.write()).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
    await expect(caller.write()).resolves.toBe('changed')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO security_events'), ['security-user', 'security@amnex.com', 'write'])
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE security_events'), ['succeeded', 'audit-id'])
  })
  it('blocks emergency writes before creating an audit or executing the action', async () => {
    vi.stubEnv('EMERGENCY_READ_ONLY', 'true')
    await expect(api.createCaller({ authHeader: 'Bearer token' }).write()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.query).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled()
  })
  it('expires old sessions and requires fresh sign-in for shared key changes', async () => {
    const identity = { uid: 'security-user', email: 'security@amnex.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }
    mocks.verify.mockResolvedValueOnce({ ...identity, auth_time: Math.floor(Date.now() / 1000) - 43201 })
    await expect(api.createCaller({ authHeader: 'Bearer token' }).read()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    mocks.verify.mockResolvedValueOnce({ ...identity, auth_time: Math.floor(Date.now() / 1000) - 901 })
    await expect(sensitiveApi.createCaller({ authHeader: 'Bearer token' }).credentialPassphrases.update()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(action).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled()
  })
  it('rejects disallowed browser origins and excessive batches before router execution', async () => {
    const app = await buildApp()
    try {
      const blocked = await app.inject({ method: 'GET', url: '/api/trpc/health.check', headers: { origin: 'https://evil.example' } })
      expect(blocked.statusCode).toBe(403)
      const batch = await app.inject({ method: 'GET', url: '/api/trpc/' + Array(26).fill('health.check').join(',') })
      expect(batch.statusCode).toBe(413)
      const health = await app.inject({ method: 'GET', url: '/api/trpc/health.check', headers: { origin: 'https://goms.example.com' } })
      expect(health.statusCode).toBe(200)
      expect(health.headers['cache-control']).toBe('private, no-store')
      expect(health.headers['x-content-type-options']).toBe('nosniff')
      expect(health.headers['strict-transport-security']).toBeDefined()
      expect(mocks.query).toHaveBeenCalledTimes(1)
    } finally { await app.close() }
  }, 20000)
  it('removes driver details and stack traces from internal errors', () => {
    const result = formatError({ shape: { message: 'raw secret', data: { stack: 'raw secret stack' } }, error: { code: 'INTERNAL_SERVER_ERROR' } as any })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
describe('operation budgets', () => {
  it('counts batched work, separates callers, resets expired windows and bounds memory', () => {
    const budget = new OperationBudget(5, 100, 2)
    expect(budget.consume('a', 4, 0)).toBe(true)
    expect(budget.consume('a', 2, 1)).toBe(false)
    expect(budget.consume('b', 5, 1)).toBe(true)
    expect(budget.consume('c', 1, 2)).toBe(false)
    expect(budget.consume('a', 5, 101)).toBe(true)
    expect(budget.consume('c', 1, 101)).toBe(true)
  })
})
