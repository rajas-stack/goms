/** The backend the app is currently pointed at, for display in the UI. */
export interface ApiEnvironment {
  /** Short name for the badge, e.g. `goms-prod`. Never a guess — see below. */
  label: string
  /** Full base URL, shown in the badge's tooltip. Trimmed. */
  baseUrl: string
}

/** Firebase Hosting's default domains, where the first hostname label is
 *  guaranteed to be the Firebase/GCP project id (`goms-prod.web.app` →
 *  `goms-prod`). This is the only case where an environment name can be
 *  *derived* rather than guessed. */
const FIREBASE_HOSTING_SUFFIXES = ['.web.app', '.firebaseapp.com']

/** Resolves the environment badge shown by `TopBar` from the configured API
 *  base URL.
 *
 *  Returns `null` when no base URL is configured — that's the default local
 *  (in-memory + IndexedDB) mode, which shows no badge at all.
 *
 *  Label precedence:
 *   1. `labelOverride` (`VITE_API_ENV_LABEL`), for backends whose URL carries
 *      no project name — e.g. a direct Cloud Run host.
 *   2. The Firebase project id, for a `*.web.app`/`*.firebaseapp.com` origin.
 *   3. The hostname itself.
 *
 *  It deliberately never pattern-matches an environment name out of an
 *  arbitrary host: BUG-001 (a hardcoded "Connected to goms-dev" shipped to
 *  production on 2026-08-27) was a label that claimed more than it knew, and
 *  a heuristic that can be wrong would be the same bug with extra steps. When
 *  the environment can't be derived, the honest host is shown instead. */
export function resolveApiEnvironment(
  baseUrl: string | undefined,
  labelOverride?: string,
): ApiEnvironment | null {
  const trimmedBaseUrl = baseUrl?.trim()
  if (!trimmedBaseUrl) return null

  const trimmedOverride = labelOverride?.trim()
  if (trimmedOverride) return { label: trimmedOverride, baseUrl: trimmedBaseUrl }

  return { label: deriveLabel(trimmedBaseUrl), baseUrl: trimmedBaseUrl }
}

function deriveLabel(baseUrl: string): string {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname
  } catch {
    // Not an absolute URL (a relative path, or simply malformed). Nothing to
    // derive from — show what was configured.
    return baseUrl
  }

  const firebaseSuffix = FIREBASE_HOSTING_SUFFIXES.find((suffix) => hostname.endsWith(suffix))
  if (firebaseSuffix) {
    const projectId = hostname.slice(0, -firebaseSuffix.length)
    // Only a bare project id, never `foo.bar.web.app` — a preview/multi-label
    // host isn't a project name.
    if (projectId && !projectId.includes('.')) return projectId
  }

  return hostname
}
