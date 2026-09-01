export const AUTHORIZED_TEST_EMAIL = 'admin-import-test@amnex.com'

/** Encodes a fake decoded-token payload as `fake.<base64url json>` — decoded
 *  by setupFirebaseAdminMock.ts's mocked verifyIdToken. Never a real signed
 *  JWT: nothing here talks to Google, so tests never depend on network
 *  access or real Firebase project credentials. */
export function fakeIdToken(overrides: { uid?: string; email?: string; email_verified?: boolean } = {}): string {
  const payload = { uid: 'test-uid', email: AUTHORIZED_TEST_EMAIL, email_verified: true, ...overrides }
  return `fake.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

export function authorizedContext(email: string = AUTHORIZED_TEST_EMAIL): { authHeader: string } {
  return { authHeader: `Bearer ${fakeIdToken({ email })}` }
}
