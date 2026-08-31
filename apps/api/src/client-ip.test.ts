import { describe, expect, it } from 'vitest'
import { NO_PROXY_TRUST, resolveClientIp, resolveProxyTrust } from './client-ip.js'

describe('resolveProxyTrust', () => {
  it('trusts nothing when TRUST_PROXY is unset — the safe default for local dev and tests', () => {
    expect(resolveProxyTrust(undefined)).toEqual(NO_PROXY_TRUST)
  })

  it('trusts nothing for an empty or whitespace-only value', () => {
    expect(resolveProxyTrust('')).toEqual(NO_PROXY_TRUST)
    expect(resolveProxyTrust('   ')).toEqual(NO_PROXY_TRUST)
  })

  it('trusts nothing for an explicit false/off', () => {
    expect(resolveProxyTrust('false')).toEqual(NO_PROXY_TRUST)
    expect(resolveProxyTrust('OFF')).toEqual(NO_PROXY_TRUST)
  })

  it('maps firebase-hosting to proxy awareness plus the Fastly-Client-IP header', () => {
    // Firebase Hosting's `/api/**` rewrite does NOT put the caller in
    // X-Forwarded-For — that header carries Google/Fastly CDN addresses. The
    // real client is in Fastly-Client-IP.
    expect(resolveProxyTrust('firebase-hosting')).toEqual({
      trustProxy: true,
      clientIpHeader: 'fastly-client-ip',
    })
  })

  it('accepts firebase-hosting case- and whitespace-insensitively', () => {
    expect(resolveProxyTrust('  Firebase-Hosting ')).toEqual({
      trustProxy: true,
      clientIpHeader: 'fastly-client-ip',
    })
  })

  it('maps true to plain X-Forwarded-For trust with no client-IP header', () => {
    expect(resolveProxyTrust('true')).toEqual({ trustProxy: true })
  })

  it('does not offer a numeric hop-count mode — Fastify 5 fails closed on a bare number', () => {
    // See resolveProxyTrust's ProxyTrust.trustProxy doc comment: Fastify's own
    // getTrustProxyFn always returns false for typeof number, so a numeric
    // TRUST_PROXY value must not be interpreted as meaningful hop-count trust.
    // It falls through to the IP/CIDR-allowlist branch instead — inert, but
    // at least not silently untrusted while looking configured.
    expect(resolveProxyTrust('2')).toEqual({ trustProxy: '2' })
  })

  it('passes anything else through as a proxy address/CIDR list', () => {
    expect(resolveProxyTrust('10.0.0.0/8,127.0.0.1')).toEqual({ trustProxy: '10.0.0.0/8,127.0.0.1' })
  })
})

describe('resolveClientIp', () => {
  const firebase = resolveProxyTrust('firebase-hosting')

  it('returns the request IP untouched when no client-IP header is configured', () => {
    expect(resolveClientIp({ 'fastly-client-ip': '203.0.113.7' }, '35.192.2.154', NO_PROXY_TRUST)).toBe('35.192.2.154')
  })

  it('prefers the configured client-IP header over the request IP', () => {
    expect(resolveClientIp({ 'fastly-client-ip': '203.0.113.7' }, '35.192.2.154', firebase)).toBe('203.0.113.7')
  })

  it('falls back to the request IP when the header is absent', () => {
    expect(resolveClientIp({}, '35.192.2.154', firebase)).toBe('35.192.2.154')
  })

  it('falls back to the request IP when the header is blank', () => {
    expect(resolveClientIp({ 'fastly-client-ip': '  ' }, '35.192.2.154', firebase)).toBe('35.192.2.154')
  })

  it('takes the first address when the header somehow carries a list', () => {
    expect(resolveClientIp({ 'fastly-client-ip': '203.0.113.7, 70.41.3.18' }, '35.192.2.154', firebase)).toBe(
      '203.0.113.7',
    )
  })

  it('handles a repeated header arriving as an array', () => {
    expect(resolveClientIp({ 'fastly-client-ip': ['203.0.113.7', '70.41.3.18'] }, '35.192.2.154', firebase)).toBe(
      '203.0.113.7',
    )
  })

  it('accepts IPv6', () => {
    expect(resolveClientIp({ 'fastly-client-ip': '2001:db8::1' }, '35.192.2.154', firebase)).toBe('2001:db8::1')
  })

  it('rejects a non-IP header value rather than keying the rate limiter on it', () => {
    // Anything reaching the Cloud Run URL directly can set this header to
    // arbitrary text. An unvalidated value becomes an unbounded-cardinality
    // key in the in-memory rate-limit store — a memory-exhaustion vector.
    expect(resolveClientIp({ 'fastly-client-ip': 'not-an-ip' }, '35.192.2.154', firebase)).toBe('35.192.2.154')
    expect(resolveClientIp({ 'fastly-client-ip': 'x'.repeat(10_000) }, '35.192.2.154', firebase)).toBe('35.192.2.154')
  })
})
