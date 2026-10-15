import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
import { buildApp } from '../app.js'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false')
  vi.stubEnv('AUTH_PROVIDER', 'firebase')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function boundaryApp() {
  const app = await buildApp({ rateLimit: { max: 1, timeWindow: '1 minute' } })
  const messages: string[] = []
  app.addHook('onRequest', async request => {
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(request.log, level).mockImplementation((...args: unknown[]) => {
        for (const value of args) {
          if (typeof value === 'string') messages.push(value)
          else if (value && typeof value === 'object' && 'err' in value && value.err instanceof Error) messages.push(value.err.message)
        }
      })
    }
  })
  return { app, messages }
}

it('does not echo or log query credentials on unknown routes', async () => {
  const { app, messages } = await boundaryApp()
  try {
    const marker = 'private-query-marker'
    const response = await app.inject({ method: 'GET', url: `/missing?code=${marker}` })
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain(marker)
    expect(messages.join('\n')).not.toContain(marker)
  } finally { await app.close() }
})

it('does not return or log raw non-tRPC handler errors', async () => {
  const { app, messages } = await boundaryApp()
  const marker = 'private-driver-marker'
  app.get('/failure', async () => { throw new Error(marker) })
  try {
    const response = await app.inject({ method: 'GET', url: '/failure' })
    expect(response.statusCode).toBe(500)
    expect(response.json().message).toBe('Internal server error')
    expect(response.body).not.toContain(marker)
    expect(messages.join('\n')).not.toContain(marker)
  } finally { await app.close() }
})

it('does not echo malformed JSON payload fragments in responses or logs', async () => {
  const { app, messages } = await boundaryApp()
  app.post('/json', async () => ({ ok: true }))
  try {
    const marker = 'private-payload-marker'
    const response = await app.inject({ method: 'POST', url: '/json', headers: { 'content-type': 'application/json' }, payload: marker })
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain(marker)
    expect(messages.join('\n')).not.toContain(marker)
  } finally { await app.close() }
})

it('preserves the rate-limit status, error category and retry header', async () => {
  const { app } = await boundaryApp()
  app.get('/limited', async () => ({ ok: true }))
  try {
    expect((await app.inject('/limited')).statusCode).toBe(200)
    const response = await app.inject('/limited')
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' })
    expect(response.headers['retry-after']).toBeDefined()
  } finally { await app.close() }
})
