// ONLYOFFICE Docs integration (Document maker). The Document Server and this API share one HS256 secret:
// the editor config the browser hands to DocsAPI is signed with it, the Document Server signs every callback
// with it, and the file / callback URLs we give the Document Server carry short tokens signed with it.
// See docs/ONLYOFFICE_SETUP.md.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import {
  DOCUMENT_TYPE_FOR_FILE_TYPE, makerRights, type MakerDocument,
} from '@goms/domain'

export interface OnlyofficeSettings {
  secret: Uint8Array
  /** Browser-reachable Document Server, e.g. http://localhost:8082 (api.js is loaded from here). */
  publicUrl: string
  /** How the Document Server reaches THIS API, e.g. http://host.docker.internal:8787. */
  internalApiUrl: string
  /** Origins the API may download edited files from (the Document Server only). */
  downloadOrigins: string[]
  /** The Document Server as reachable from this API, when that differs from publicUrl (e.g. http://onlyoffice in Compose). */
  internalUrl?: string
}

export class OnlyofficeNotConfigured extends Error {}

const MIN_SECRET_LENGTH = 32

function origin(raw: string | undefined, name: string): string {
  if (!raw) throw new OnlyofficeNotConfigured(`${name} is not set.`)
  let url: URL
  try { url = new URL(raw) } catch { throw new OnlyofficeNotConfigured(`${name} is not a valid URL.`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new OnlyofficeNotConfigured(`${name} must be http(s).`)
  return url.origin
}

/** Reads and validates the environment on every call (so a fixed .env needs no restart); throws when incomplete. */
export function onlyofficeSettings(env: NodeJS.ProcessEnv = process.env): OnlyofficeSettings {
  const secret = env.ONLYOFFICE_JWT_SECRET
  if (!secret) throw new OnlyofficeNotConfigured('ONLYOFFICE_JWT_SECRET is not set.')
  if (secret.length < MIN_SECRET_LENGTH) throw new OnlyofficeNotConfigured(`ONLYOFFICE_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`)
  const publicUrl = origin(env.ONLYOFFICE_URL, 'ONLYOFFICE_URL')
  const internalApiUrl = origin(env.ONLYOFFICE_INTERNAL_API_URL, 'ONLYOFFICE_INTERNAL_API_URL')
  const extra = env.ONLYOFFICE_INTERNAL_URL ? [origin(env.ONLYOFFICE_INTERNAL_URL, 'ONLYOFFICE_INTERNAL_URL')] : []
  return { secret: new TextEncoder().encode(secret), publicUrl, internalApiUrl, downloadOrigins: [...new Set([publicUrl, ...extra])], internalUrl: extra[0] }
}

export async function signToken(payload: JWTPayload, secret: Uint8Array, expiresIn?: string): Promise<string> {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt()
  return (expiresIn ? jwt.setExpirationTime(expiresIn) : jwt).sign(secret)
}

/** Verified payload, or null for a missing / forged / expired token. */
export async function verifyToken(token: unknown, secret: Uint8Array): Promise<JWTPayload | null> {
  if (typeof token !== 'string' || !token || token.length > 16_384) return null
  try { return (await jwtVerify(token, secret, { algorithms: ['HS256'] })).payload } catch { return null }
}

export type UrlTokenPurpose = 'file' | 'download' | 'callback'

const TOKEN_LIFETIME: Record<UrlTokenPurpose, string> = {
  file: '12h', download: '5m',
  // The Document Server calls back up to ~10 s after the last editor closes; long sessions must still save.
  callback: '30d',
}

export function urlToken(purpose: UrlTokenPurpose, claims: { id: string; key?: string; version?: number }, secret: Uint8Array): Promise<string> {
  return signToken({ purpose, ...claims }, secret, TOKEN_LIFETIME[purpose])
}

/** The URL token for this document and purpose, or null. */
export async function readUrlToken(token: unknown, purposes: UrlTokenPurpose[], id: string, secret: Uint8Array) {
  const payload = await verifyToken(token, secret)
  if (!payload || payload.id !== id || !purposes.includes(payload.purpose as UrlTokenPurpose)) return null
  return payload as JWTPayload & { purpose: UrlTokenPurpose; id: string; key?: string; version?: number }
}

export interface EditorUser { id: string; name: string }

/** The full DocsAPI.DocEditor config for one document version, signed (`token`) as the Document Server requires. */
export async function buildEditorConfig(
  doc: MakerDocument, user: EditorUser, theme: 'light' | 'dark', settings: OnlyofficeSettings,
) {
  const rights = makerRights(doc)
  const fileToken = await urlToken('file', { id: doc.id, key: doc.documentKey }, settings.secret)
  const callbackToken = await urlToken('callback', { id: doc.id }, settings.secret)
  const base = `${settings.internalApiUrl}/api/document-maker`
  const config = {
    document: {
      fileType: doc.fileType,
      key: doc.documentKey,
      title: `${doc.title}.${doc.fileType}`,
      url: `${base}/files/${doc.id}?token=${encodeURIComponent(fileToken)}`,
      // A share without write still opens in edit mode so comment-only works; ONLYOFFICE enforces these flags.
      permissions: { edit: rights.write, download: rights.read, print: rights.read, copy: rights.read, comment: rights.comment || rights.write, review: rights.write },
    },
    documentType: DOCUMENT_TYPE_FOR_FILE_TYPE[doc.fileType],
    editorConfig: {
      mode: rights.write || rights.comment ? 'edit' : 'view',
      lang: 'en',
      callbackUrl: `${base}/callback/${doc.id}?token=${encodeURIComponent(callbackToken)}`,
      user: { id: user.id, name: user.name },
      customization: { autosave: true, forcesave: true, compactHeader: false, uiTheme: theme === 'dark' ? 'theme-dark' : 'theme-light' },
    },
    height: '100%',
    width: '100%',
    type: 'desktop',
  }
  return { documentServerUrl: settings.publicUrl, config: { ...config, token: await signToken(config, settings.secret, '12h') } }
}

/** SSRF guard: edited files may only be downloaded from the configured Document Server. */
export function assertAllowedDownload(raw: unknown, allowedOrigins: readonly string[]): URL {
  if (typeof raw !== 'string') throw new Error('Missing file URL.')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Invalid file URL.') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('Invalid file URL.')
  if (!allowedOrigins.includes(url.origin)) throw new Error('File URL is not on the Document Server.')
  return url
}

/** The Document Server builds file URLs from the browser-facing host; fetch those through the internal URL when set. */
export function internalFetchUrl(url: URL, settings: Pick<OnlyofficeSettings, 'publicUrl' | 'internalUrl'>): URL {
  if (!settings.internalUrl || url.origin !== settings.publicUrl) return url
  const internal = new URL(settings.internalUrl)
  // Set components directly: a pathname beginning with // must never replace the host.
  internal.pathname = url.pathname
  internal.search = url.search
  return internal
}

/** Downloads at most `maxBytes`, refusing redirects (a redirect could point anywhere). */
export async function downloadFile(url: URL, maxBytes: number, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok || !response.body) throw new Error(`Document Server returned ${response.status}.`)
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Edited file is too large.')
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) { await reader.cancel(); throw new Error('Edited file is too large.') }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}
