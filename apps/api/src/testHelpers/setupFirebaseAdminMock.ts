import { vi } from 'vitest'

// Every test in this workspace runs against this fake decoder, never real
// Firebase/Google servers — see adminImportTestAuth.ts's fakeIdToken for the
// matching encoder. A malformed token throws, exactly like a real expired/
// tampered token would from firebase-admin's real verifyIdToken.
vi.mock('../auth/firebaseAdmin.js', () => ({
  getFirebaseAuth: () => ({
    verifyIdToken: async (idToken: string) => {
      if (!idToken.startsWith('fake.')) throw new Error('invalid test token')
      return JSON.parse(Buffer.from(idToken.slice('fake.'.length), 'base64url').toString('utf8'))
    },
  }),
}))
