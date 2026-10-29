// Short-lived signed links for Document maker downloads. A browser download cannot carry the GOMS sign-in, so
// `downloadUrl` / `versionDownloadUrl` hand out a 5-minute token instead. The key is derived from
// AUTH_SESSION_SECRET for this purpose only, so a download token can never pass as a sign-in token or vice versa.
import { createHmac } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { sessionKey } from '../auth/oauth/config.js'

const AUDIENCE = 'goms:maker-download'
const LIFETIME = '5m'

function downloadKey(): Uint8Array {
  return createHmac('sha256', sessionKey()).update(AUDIENCE).digest()
}

export function signDownloadToken(claims: { id: string; version?: number }): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setAudience(AUDIENCE).setIssuedAt()
    .setExpirationTime(LIFETIME).sign(downloadKey())
}

/** The token's claims when it is valid, unexpired and issued for this document; otherwise null. */
export async function readDownloadToken(token: unknown, id: string): Promise<{ id: string; version?: number } | null> {
  if (typeof token !== 'string' || !token || token.length > 4096) return null
  try {
    const { payload } = await jwtVerify(token, downloadKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    if (payload.id !== id) return null
    return { id, version: typeof payload.version === 'number' ? payload.version : undefined }
  } catch { return null }
}
