import { firebaseProvider } from './firebaseProvider'
import { oauthProvider } from './oauthProvider'
import { localGoogleProvider } from './localGoogleProvider'
import type { AuthProviderApi } from './types'

/** Chosen at build time. Only 'oauth' switches it on; anything else (including unset) is Firebase — the default and a no-op. */
export const AUTH_KIND: 'firebase' | 'oauth' = import.meta.env.VITE_AUTH_PROVIDER === 'oauth' ? 'oauth' : 'firebase'
/** A Firebase build without Firebase config (local mode) can still offer an optional Google sign-in when a Google client ID is set. */
export const authApi: AuthProviderApi = AUTH_KIND === 'oauth' ? oauthProvider
  : !firebaseProvider.configured && import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ? localGoogleProvider : firebaseProvider
