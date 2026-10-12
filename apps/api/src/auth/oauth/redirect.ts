export type ClientKind = 'web' | 'app'

export const parseClient = (raw: unknown): ClientKind | null => (raw === 'web' || raw === 'app' ? raw : null)

/** Same-origin relative path only; anything else becomes '/'. */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/'
  try {
    if (new URL(raw, 'https://origin.invalid').origin !== 'https://origin.invalid') return '/'
  } catch {
    return '/'
  }
  return raw
}

/** `webOrigin` + `returnTo` with `params` set on the query. The result can never leave `webOrigin`. */
export function webRedirectUrl(webOrigin: string, returnTo: string, params: Record<string, string>): string {
  const base = new URL(webOrigin)
  const url = new URL(safeReturnTo(returnTo), base)
  if (url.origin !== base.origin) return new URL('/', base).toString()
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}
