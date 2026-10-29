/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: string
  /** Browser key for Maps JavaScript + Places (New) + Routes (Finance reimbursement routes). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
}
