/** Encodes a fake decoded-token payload as `fake.<base64url json>` — decoded
 *  by setupFirebaseAdminMock.ts's mocked verifyIdToken. Never a real signed
 *  JWT: nothing here talks to Google, so tests never depend on network
 *  access or real Firebase project credentials. Shared by every auth test in
 *  this workspace (identity.test.ts, trpc.test.ts, every router's auth
 *  enforcement tests, and adminImportTestAuth.ts). */
export function fakeIdToken(overrides: {
  uid?: string; email?: string; email_verified?: boolean
  /** Firebase's own claim: the linked sign-in identities (for Google, the Google subject id). */
  firebase?: { identities?: Record<string, string[]>; sign_in_provider?: string }
} = {}): string {
  const payload = { uid: 'test-uid', email: 'test@amnex.com', email_verified: true, ...overrides }
  return `fake.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

export function contextForEmail(email: string): { authHeader: string } {
  return { authHeader: `Bearer ${fakeIdToken({ email })}` }
}
