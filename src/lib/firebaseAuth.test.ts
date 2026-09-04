import { describe, it, expect } from 'vitest'

// This is deliberately the ONE test in the whole suite that exercises the
// REAL firebase/app + firebase/auth SDKs, not the global
// `vi.mock('@/lib/firebaseAuth', ...)` most other tests rely on
// (src/test/setup-component-tests.ts). That global mock only applies to
// `.tsx` files run through vitest.component.config.ts; this file is a
// plain `.ts` file matched by the default `npm test` config (vite.config.ts,
// environment: 'node', no setupFiles), so it imports firebaseAuth.ts
// unmocked, with no VITE_FIREBASE_* env vars set (none exist in this
// worktree's .env files) — reproducing exactly the "GitLab Pages build /
// goms-prod frontend build / local dev with no .env.local" scenario the
// final-review Critical #1 finding described.
//
// The regression this guards: before the fix, firebaseAuth.ts called
// `getAuth(firebaseApp)` unconditionally at module scope, which throws
// synchronously ("auth/invalid-api-key") when the config is absent. Once
// src/main.tsx started eagerly importing this module (via AuthPromptDialog
// and via repository.ts -> authHeaders.ts), that throw white-screened the
// entire app before the router could even mount.
describe('firebaseAuth (real SDK, unconfigured env)', () => {
  it('does not throw on import, and exports auth === null, when no VITE_FIREBASE_* config is set', async () => {
    expect(import.meta.env.VITE_FIREBASE_API_KEY).toBeUndefined()
    expect(import.meta.env.VITE_FIREBASE_PROJECT_ID).toBeUndefined()

    const mod = await import('./firebaseAuth')

    expect(mod.auth).toBeNull()
    // googleProvider is safe to construct unconditionally (no config/network
    // touched by `new GoogleAuthProvider()`) — confirm it's still exported
    // even though `auth` is null.
    expect(mod.googleProvider).toBeDefined()
  })
})

// Direct unit coverage of the pure config-presence check itself, independent
// of the module-scope import-time behavior above — belt and suspenders in
// case the real-SDK import ever becomes awkward to keep unmocked (e.g. a
// future setupFiles change that starts applying to `.ts` files too).
describe('isFirebaseConfigured', () => {
  it('is false when apiKey and projectId are both absent', async () => {
    const { isFirebaseConfigured } = await import('./firebaseAuth')
    expect(isFirebaseConfigured({})).toBe(false)
  })

  it('is false when only one of apiKey/projectId is present', async () => {
    const { isFirebaseConfigured } = await import('./firebaseAuth')
    expect(isFirebaseConfigured({ apiKey: 'k' })).toBe(false)
    expect(isFirebaseConfigured({ projectId: 'p' })).toBe(false)
  })

  it('is true when both apiKey and projectId are present', async () => {
    const { isFirebaseConfigured } = await import('./firebaseAuth')
    expect(isFirebaseConfigured({ apiKey: 'k', projectId: 'p' })).toBe(true)
  })
})
