import { useAuthUser } from '@/lib/auth'

/** Is someone signed in right now, whichever provider this build uses (Firebase, or the GOMS Google OAuth session)? False while signed out,
 *  before the provider has reported, and when the build has no usable provider (there is nothing to sign in to). Navigation uses it to decide
 *  which links to offer a visitor; it is not an authorization signal: every call is verified by the server. */
export function useSignedIn(): boolean {
  return useAuthUser().user !== null
}
