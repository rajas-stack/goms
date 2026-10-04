// Jev AI (https://www.jevai.org/docs) — decision API by TypeSafe AI.
// The key is a secret: it is read from the server's environment only
// (apps/api/.env.local locally, Secret Manager in Cloud Run — see
// apps/api/.env.example) and must never be logged, returned to a client,
// or exposed through a frontend `VITE_*` variable.

export const JEV_DEFAULT_BASE_URL = 'https://www.jevai.org'
const JEV_TIMEOUT_MS = 30_000

/** Jev's documented decision workflows (POST, JSON body). */
export const JEV_ENDPOINTS = {
  decisions: '/api/v1/decisions',
  toolGuard: '/api/v1/decisions/tool-guard',
  modelRoute: '/api/v1/decisions/model-route',
  route: '/api/v1/decisions/route',
  research: '/api/v1/decisions/research',
  completion: '/api/v1/decisions/completion',
} as const
export type JevEndpoint = keyof typeof JEV_ENDPOINTS

export interface JevConfig {
  apiKey: string
  baseUrl: string
}

/** Jev's response envelope: `code` 0 = ok. */
export interface JevResponse<T = unknown> {
  code: number
  message: string
  data: T
}

/** Reads the JEV config, failing fast with a clear message when the key is missing.
 *  The error never includes the key's value. */
export function getJevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const apiKey = env.JEV_API_KEY?.trim()
  if (!apiKey) throw new Error('JEV_API_KEY is not set. Add it to apps/api/.env.local (local) or Secret Manager (deployed).')
  return { apiKey, baseUrl: (env.JEV_API_BASE_URL?.trim() || JEV_DEFAULT_BASE_URL).replace(/\/+$/, '') }
}

/** True when a JEV key is configured, without throwing — for feature checks. */
export const isJevConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!env.JEV_API_KEY?.trim()

/** POSTs `body` to a Jev decision endpoint and returns its `data`.
 *  Throws on HTTP errors, timeouts and non-zero `code` — never with the key in the message. */
export async function callJev<T = unknown>(
  endpoint: JevEndpoint,
  body: unknown,
  { config = getJevConfig(), fetchImpl = fetch }: { config?: JevConfig; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const res = await fetchImpl(`${config.baseUrl}${JEV_ENDPOINTS[endpoint]}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => null)) as JevResponse<T> | null
  if (!res.ok) throw new Error(`Jev ${endpoint} failed: HTTP ${res.status}${json?.message ? ` — ${json.message}` : ''}`)
  if (!json) throw new Error(`Jev ${endpoint} failed: response was not JSON`)
  if (json.code !== 0) throw new Error(`Jev ${endpoint} failed: ${json.message || `code ${json.code}`}`)
  return json.data
}
