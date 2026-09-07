import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// @/lib/firebaseAuth calls getAuth() at module-load time, which throws
// "auth/invalid-api-key" without a real Firebase project configured — every
// component test transitively imports it via admin-data-import's api.ts
// (headers() reads auth.currentUser), even tests that have nothing to do
// with auth. Mocked globally so no individual test file needs to know this
// module exists; a file that specifically tests auth behavior (e.g.
// AdminImportAuthGate.test.tsx) can still override it with its own vi.mock.
vi.mock('@/lib/firebaseAuth', () => ({ auth: { currentUser: null }, googleProvider: {} }))

// AuthStatus.tsx (mounted in every screen via TopBar) calls the real
// onAuthStateChanged/signOut from 'firebase/auth' against the fake `auth`
// object above, which isn't a real Firebase Auth instance — every component
// test that renders TopBar/AppLayout needs this stubbed, not just tests that
// specifically exercise auth. Never invoking the callback leaves `user` null
// (signed-out), the correct default for every test that doesn't care about
// auth state; a file that does (e.g. AuthPromptDialog.test.tsx,
// AuthStatus.test.tsx) overrides this with its own vi.mock.
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => {},
  signOut: () => Promise.resolve(),
  signInWithPopup: () => Promise.resolve({ user: null }),
  GoogleAuthProvider: class {},
}))

// jsdom has no scrollIntoView implementation at all — every sticky
// section-jump nav button (CreateBoq.tsx, ProposalDetail.tsx,
// BoqWorkspaceHeader's Preview button) calls it directly, and clicking one
// in a test throws a hard TypeError without this stub.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

// jsdom has no matchMedia implementation at all (unlike scrollTo, which it
// stubs with a console warning) — anything using useMediaQuery (Dialog,
// ConfirmDeleteDialog) throws a hard TypeError on mount without this.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}
