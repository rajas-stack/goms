import { firebaseProvider } from './firebaseProvider'
import { oauthProvider } from './oauthProvider'
import type { AuthProviderApi } from './types'

/** Chosen at build time. Only 'oauth' switches it on; anything else (including unset) is Firebase — the default and a no-op. */
export const AUTH_KIND: 'firebase' | 'oauth' = import.meta.env.VITE_AUTH_PROVIDER === 'oauth' ? 'oauth' : 'firebase'
export const authApi: AuthProviderApi = AUTH_KIND === 'oauth' ? oauthProvider : firebaseProvider
