import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyAdminImportToken } from './verifyAdminImportToken.js'
import { fakeIdToken, AUTHORIZED_TEST_EMAIL } from '../testHelpers/adminImportTestAuth.js'

describe('verifyAdminImportToken', () => {
  beforeEach(() => {
    process.env.ADMIN_IMPORT_ALLOWED_EMAILS = AUTHORIZED_TEST_EMAIL
  })
  afterEach(() => {
    delete process.env.ADMIN_IMPORT_ALLOWED_EMAILS
  })

  it('rejects an unauthenticated request (no Authorization header)', async () => {
    await expect(verifyAdminImportToken(undefined)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a malformed/expired token', async () => {
    await expect(verifyAdminImportToken('Bearer not-a-real-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a verified token whose email is not on the allow-list', async () => {
    const header = `Bearer ${fakeIdToken({ email: 'someone-else@gmail.com' })}`
    await expect(verifyAdminImportToken(header)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a token whose email is on the allow-list but not verified', async () => {
    const header = `Bearer ${fakeIdToken({ email: AUTHORIZED_TEST_EMAIL, email_verified: false })}`
    await expect(verifyAdminImportToken(header)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('accepts a verified, allow-listed token and returns the identity', async () => {
    const header = `Bearer ${fakeIdToken({ uid: 'abc123', email: AUTHORIZED_TEST_EMAIL })}`
    await expect(verifyAdminImportToken(header)).resolves.toEqual({ uid: 'abc123', email: AUTHORIZED_TEST_EMAIL })
  })

  it('matches allow-list emails case-insensitively', async () => {
    const header = `Bearer ${fakeIdToken({ email: AUTHORIZED_TEST_EMAIL.toUpperCase() })}`
    await expect(verifyAdminImportToken(header)).resolves.toMatchObject({ email: AUTHORIZED_TEST_EMAIL.toUpperCase() })
  })
})
