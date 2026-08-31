import { describe, expect, it } from 'vitest'
import { resolveApiEnvironment } from './api-environment'

describe('resolveApiEnvironment', () => {
  it('returns null when no API base URL is configured (default local/IndexedDB mode)', () => {
    expect(resolveApiEnvironment(undefined)).toBeNull()
  })

  it('returns null for an empty or whitespace-only API base URL', () => {
    expect(resolveApiEnvironment('')).toBeNull()
    expect(resolveApiEnvironment('   ')).toBeNull()
  })

  it('labels the production Firebase Hosting origin goms-prod', () => {
    // The exact value the 2026-08-27 hosted build was built with.
    expect(resolveApiEnvironment('https://goms-prod.web.app')?.label).toBe('goms-prod')
  })

  it('never labels a production origin goms-dev (BUG-001 regression)', () => {
    expect(resolveApiEnvironment('https://goms-prod.web.app')?.label).not.toBe('goms-dev')
  })

  it('labels a dev Firebase Hosting origin goms-dev', () => {
    expect(resolveApiEnvironment('https://goms-dev.web.app')?.label).toBe('goms-dev')
  })

  it('reads the project id from a .firebaseapp.com origin too', () => {
    expect(resolveApiEnvironment('https://goms-prod.firebaseapp.com')?.label).toBe('goms-prod')
  })

  it('tolerates a trailing slash and a path on the base URL', () => {
    expect(resolveApiEnvironment('https://goms-prod.web.app/')?.label).toBe('goms-prod')
  })

  it('falls back to the hostname for a direct Cloud Run URL, which encodes no project name', () => {
    // goms-dev's real Cloud Run host. Its first label is `goms-api-<hash>-<region>`,
    // which names the *service*, not the project — guessing "goms-dev" from it
    // would be inventing information, so the honest label is the host itself.
    expect(resolveApiEnvironment('https://goms-api-ckskxj3iza-el.a.run.app')?.label).toBe(
      'goms-api-ckskxj3iza-el.a.run.app',
    )
  })

  it('does not mistake a hostname that merely starts with the project name for that project', () => {
    expect(resolveApiEnvironment('https://goms-production-mirror.example.com')?.label).toBe(
      'goms-production-mirror.example.com',
    )
  })

  it('uses the explicit label override when one is set', () => {
    expect(resolveApiEnvironment('https://goms-api-ckskxj3iza-el.a.run.app', 'goms-dev')?.label).toBe('goms-dev')
  })

  it('ignores a blank label override', () => {
    expect(resolveApiEnvironment('https://goms-prod.web.app', '  ')?.label).toBe('goms-prod')
  })

  it('never returns an environment for a blank base URL, even with a label override set', () => {
    expect(resolveApiEnvironment('', 'goms-prod')).toBeNull()
  })

  it('falls back to the raw value when the base URL is not parseable as an absolute URL', () => {
    expect(resolveApiEnvironment('not a url')?.label).toBe('not a url')
  })

  it('returns the trimmed base URL alongside the label, for the tooltip', () => {
    expect(resolveApiEnvironment('  https://goms-prod.web.app  ')).toEqual({
      label: 'goms-prod',
      baseUrl: 'https://goms-prod.web.app',
    })
  })
})
