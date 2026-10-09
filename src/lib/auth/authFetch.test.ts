import { describe, expect, it, vi } from 'vitest'
import { createAuthFetch } from './authFetch'

const res = (status: number) => new Response('{}', { status })
const hdr = (init?: RequestInit) => new Headers(init?.headers).get('Authorization')

describe('createAuthFetch', () => {
  it('passes a successful response straight through without touching the session', async () => {
    const base = vi.fn(async () => res(200)); const session = { forceRefresh: vi.fn() }
    await createAuthFetch(session, base as unknown as typeof fetch)('https://x/api/trpc/a', { headers: { Authorization: 'Bearer OLD' } })
    expect(session.forceRefresh).not.toHaveBeenCalled(); expect(base).toHaveBeenCalledTimes(1)
  })
  it('on a 401 refreshes ONCE and retries once with the new token, same method and body', async () => {
    const base = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200))
    const session = { forceRefresh: vi.fn(async () => 'NEW') }
    const r = await createAuthFetch(session, base as unknown as typeof fetch)('https://x/api/trpc/a', { method: 'POST', body: '{"batch":1}', headers: { Authorization: 'Bearer OLD', 'Content-Type': 'application/json' } })
    expect(r.status).toBe(200)
    expect(session.forceRefresh).toHaveBeenCalledTimes(1)
    const retry = base.mock.calls[1][1] as RequestInit
    expect(hdr(retry)).toBe('Bearer NEW'); expect(retry.method).toBe('POST'); expect(retry.body).toBe('{"batch":1}')
    expect(new Headers(retry.headers).get('Content-Type')).toBe('application/json')
  })
  it('returns the original 401 when the refresh fails (so the sign-in prompt appears) — and does not loop', async () => {
    const base = vi.fn(async () => res(401))
    const session = { forceRefresh: vi.fn(async () => null) }
    expect((await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})).status).toBe(401)
    expect(base).toHaveBeenCalledTimes(1)
  })
  it('a second 401 after a successful refresh is returned, not retried again', async () => {
    const base = vi.fn(async () => res(401)); const session = { forceRefresh: vi.fn(async () => 'NEW') }
    expect((await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})).status).toBe(401)
    expect(base).toHaveBeenCalledTimes(2)
  })
  it('only 401 triggers a refresh (403 / RBAC denials do not)', async () => {
    const base = vi.fn(async () => res(403)); const session = { forceRefresh: vi.fn() }
    await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})
    expect(session.forceRefresh).not.toHaveBeenCalled()
  })
})
