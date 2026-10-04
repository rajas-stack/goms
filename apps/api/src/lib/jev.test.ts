import { describe, expect, it, vi } from 'vitest'
import { callJev, getJevConfig, isJevConfigured, JEV_DEFAULT_BASE_URL } from './jev.js'

describe('getJevConfig', () => {
  it('returns the trimmed key and base URL, without a trailing slash', () => {
    expect(getJevConfig({ JEV_API_KEY: '  abc123  ', JEV_API_BASE_URL: 'https://jev.example/' }))
      .toEqual({ apiKey: 'abc123', baseUrl: 'https://jev.example' })
  })

  it('defaults the base URL to jevai.org', () => {
    expect(getJevConfig({ JEV_API_KEY: 'abc123' }).baseUrl).toBe(JEV_DEFAULT_BASE_URL)
  })

  it('throws a clear error when the key is missing or blank', () => {
    expect(() => getJevConfig({})).toThrow('JEV_API_KEY is not set')
    expect(() => getJevConfig({ JEV_API_KEY: '   ' })).toThrow('JEV_API_KEY is not set')
  })
})

describe('isJevConfigured', () => {
  it('reports whether a non-blank key is present', () => {
    expect(isJevConfigured({ JEV_API_KEY: 'abc123' })).toBe(true)
    expect(isJevConfigured({ JEV_API_KEY: '' })).toBe(false)
    expect(isJevConfigured({})).toBe(false)
  })
})

describe('callJev', () => {
  const config = { apiKey: 'secret-key', baseUrl: 'https://jev.example' }
  const reply = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }))

  it('POSTs JSON with a Bearer key to the endpoint and returns data', async () => {
    const fetchImpl = reply(200, { code: 0, message: 'ok', data: { decision: 'confirm', confidence: 0.86 } })
    const data = await callJev('toolGuard', { tool: 'refund' }, { config, fetchImpl })
    expect(data).toEqual({ decision: 'confirm', confidence: 0.86 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://jev.example/api/v1/decisions/tool-guard')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    expect(init.body).toBe(JSON.stringify({ tool: 'refund' }))
  })

  it('throws on an HTTP error without leaking the key', async () => {
    const err = await callJev('decisions', {}, { config, fetchImpl: reply(401, {}) }).catch((e: Error) => e)
    expect((err as Error).message).toBe('Jev decisions failed: HTTP 401')
    expect((err as Error).message).not.toContain('secret-key')
  })

  it('throws on a non-zero code', async () => {
    await expect(callJev('route', {}, { config, fetchImpl: reply(200, { code: 7, message: 'bad input', data: null }) }))
      .rejects.toThrow('Jev route failed: bad input')
  })
})
