import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

// Firebase's web SDK config is not a secret (unlike DATABASE_URL) — it
// identifies the project, not a credential; access is enforced server-side
// by verifyAdminImportToken's allow-list, not by keeping this config hidden.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** Extracted as a pure, dependency-free check so it's independently
 *  testable — see firebaseAuth.test.ts for why the module-level
 *  initializeApp/getAuth call below resists being exercised the same way
 *  (this file is deliberately NOT covered by the global
 *  `vi.mock('@/lib/firebaseAuth', ...)` in setup-component-tests.ts). Only
 *  apiKey/projectId are required — authDomain/appId are used by specific
 *  Firebase features (redirect sign-in, Analytics) this app doesn't rely on. */
export function isFirebaseConfigured(config: { apiKey?: string; projectId?: string }): boolean {
  return Boolean(config.apiKey && config.projectId)
}

// `getAuth(app)` throws synchronously ("auth/invalid-api-key") when the
// config is absent — true for the GitLab Pages build, goms-prod's frontend
// build, and local dev with no .env.local. This module is now imported
// EAGERLY from src/main.tsx (via AuthPromptDialog and via
// repository.ts -> authHeaders.ts), so that throw would white-screen the
// entire app before the router even mounts. Only initialize Firebase when
// it's actually configured; every consumer of `auth` must treat it as
// possibly null.
export const auth: Auth | null = isFirebaseConfigured(firebaseConfig)
  ? getAuth(initializeApp(firebaseConfig))
  : null

// Constructing a GoogleAuthProvider touches no config and makes no network
// call — it's a plain local object (its constructor just seeds default
// OAuth scopes/params) — so it's safe to create unconditionally even when
// Firebase itself isn't configured.
export const googleProvider = new GoogleAuthProvider()
