import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'

let auth: Auth | undefined

/** Verifying an ID token needs only the Firebase project id (to check the
 *  token's `aud`/`iss` claims) — it validates the signature against Google's
 *  public certs over plain HTTPS, with no service-account credential
 *  required. That's why this never calls `credential.applicationDefault()`:
 *  this module's only job is ID token verification, on Cloud Run and in
 *  local dev alike, with zero credential files to manage. */
export function getFirebaseAuth(): Auth {
  if (!auth) {
    if (getApps().length === 0) {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
    }
    auth = getAuth()
  }
  return auth
}
