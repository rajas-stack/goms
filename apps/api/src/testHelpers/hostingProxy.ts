import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A stand-in for the Firebase Hosting `/api/** -> Cloud Run` rewrite, enforcing the two cookie rules that matter for OAuth:
 *
 *  1. REQUEST: only the specially named `__session` cookie is forwarded to the backend; every other cookie is dropped.
 *     Source: https://firebase.google.com/docs/hosting/manage-cache ("Only the specially-named __session cookie is permitted to pass through").
 *     (The Firebase CLI's local Hosting emulator does NOT enforce this: its proxy builds a `__session`-only Cookie header and then overwrites
 *     it with the browser's full one when copying headers, so it would have hidden the bug this harness exists to catch.)
 *  2. RESPONSE (a deliberately STRICT model): `Set-Cookie` is removed unless the response's Cache-Control contains `private`; no
 *     Cache-Control counts as `private`. Source: firebase-tools lib/hosting/proxy.js (the CLI emulator). REAL Hosting is more lenient: on a
 *     preview channel it passed Set-Cookie through even without `private` (and rewrote `public` to `private`). Keeping the strict rule
 *     means the tests prove the design under the worst case. Hosting also adds `Cookie` and `Authorization` to Vary.
 *
 * Rule 1 was CONFIRMED on a real Hosting preview (cookie-probe, 2026-10-21); rule 2 was found to be stricter than reality. This harness is
 * for fast local regression; the preview run is the authority.
 */
export interface HostingProxy {
  origin: string
  /** The Cookie header the backend received for the most recent request. */
  lastBackendCookie(): string | undefined
  strippedSetCookies(): number
  close(): Promise<void>
}

export function startHostingProxy(backendPort: number): Promise<HostingProxy> {
  let lastCookie: string | undefined
  let stripped = 0
  const server: Server = createServer((req, res) => {
    const headers: IncomingHttpHeaders = { ...req.headers, host: `127.0.0.1:${backendPort}`, 'x-forwarded-host': req.headers.host }
    const session = (req.headers.cookie ?? '').split(/; ?/).find(pair => pair.trim().startsWith('__session='))
    if (session) headers.cookie = session.trim(); else delete headers.cookie
    lastCookie = headers.cookie as string | undefined
    const upstream = httpRequest({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers }, upstreamRes => {
      const out: IncomingHttpHeaders = { ...upstreamRes.headers }
      const cacheControl = String(out['cache-control'] ?? 'private')
      if (!/private/i.test(cacheControl) && out['set-cookie']) { delete out['set-cookie']; stripped++ }
      const vary = String(out.vary ?? '').split(/, ?/).filter(Boolean)
      for (const needed of ['Cookie', 'Authorization']) if (!vary.some(v => v.toLowerCase() === needed.toLowerCase())) vary.push(needed)
      out.vary = vary.join(', ')
      res.writeHead(upstreamRes.statusCode ?? 502, out as Record<string, string | string[]>)
      upstreamRes.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    lastBackendCookie: () => lastCookie,
    strippedSetCookies: () => stripped,
    close: () => new Promise<void>(done => server.close(() => done())),
  })))
}

/** A browser stand-in: a cookie jar that honours Path and Max-Age=0, sends no cookie to a path outside the cookie's Path, and never follows redirects. */
export class Browser {
  readonly jar = new Map<string, { value: string; path: string }>()
  constructor(readonly origin: string) {}

  cookieHeader(path: string): string | undefined {
    const pairs = [...this.jar].filter(([, cookie]) => path.startsWith(cookie.path)).map(([name, cookie]) => `${name}=${cookie.value}`)
    return pairs.length ? pairs.join('; ') : undefined
  }
  /** Plants a cookie the way another site or an older GOMS build might have (used to prove only `__session` reaches the API). */
  plant(name: string, value: string, path = '/') { this.jar.set(name, { value, path }) }

  async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const cookie = this.cookieHeader(path.split('?')[0])
    const response = await fetch(this.origin + path, {
      method: init.method ?? 'GET', redirect: 'manual',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(';').map(part => part.trim())
      const name = pair.slice(0, pair.indexOf('=')), value = pair.slice(pair.indexOf('=') + 1)
      const maxAge = attributes.find(a => /^max-age=/i.test(a))?.split('=')[1]
      const cookiePath = attributes.find(a => /^path=/i.test(a))?.split('=')[1] ?? '/'
      if (maxAge === '0' || value === '') this.jar.delete(name); else this.jar.set(name, { value, path: cookiePath })
    }
    return response
  }
}
