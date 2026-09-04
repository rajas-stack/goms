import { fakeIdToken as sharedFakeIdToken } from './authTestHelpers.js'

export const AUTHORIZED_TEST_EMAIL = 'admin-import-test@amnex.com'

export function fakeIdToken(overrides: { uid?: string; email?: string; email_verified?: boolean } = {}): string {
  return sharedFakeIdToken({ email: AUTHORIZED_TEST_EMAIL, ...overrides })
}

export function authorizedContext(email: string = AUTHORIZED_TEST_EMAIL): { authHeader: string } {
  return { authHeader: `Bearer ${fakeIdToken({ email })}` }
}
