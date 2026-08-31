import { isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'

/** How much of the request's forwarding metadata this deployment may believe. */
export interface ProxyTrust {
  /** Value handed to Fastify's `trustProxy` option. `false` means forwarding
   *  headers are ignored entirely and `request.ip` stays the socket address.
   *  Deliberately never a bare number: Fastify 5's own trustProxy resolver
   *  (`getTrustProxyFn` in fastify/lib/request.js) treats any `number` as
   *  untrusted and always returns `false` from the proxy check — a numeric
   *  "trust N hops" mode does not actually exist at runtime, so offering one
   *  here would silently fail closed while looking configured. */
  trustProxy: boolean | string
  /** Lower-cased name of a header carrying the *real* client address, for
   *  proxies that do not put it in `X-Forwarded-For`. Undefined = consult no
   *  header, use `request.ip`. */
  clientIpHeader?: string
}

/** Believe nothing: `request.ip` is the socket peer. The default. */
export const NO_PROXY_TRUST: ProxyTrust = { trustProxy: false }

/** Firebase Hosting's `/api/**` -> Cloud Run rewrite does not preserve the
 *  caller in `X-Forwarded-For`: that header arrives holding Google/Fastly CDN
 *  addresses (observed shape: `35.192.2.154, 35.192.2.154`), identical for
 *  every visitor. The original caller is in `Fastly-Client-IP` instead. Keying
 *  a per-IP rate limit off `X-Forwarded-For` behind this rewrite therefore
 *  still produces one shared bucket for the entire internet - enabling
 *  `trustProxy` alone does *not* fix that. */
const FIREBASE_HOSTING_TRUST: ProxyTrust = { trustProxy: true, clientIpHeader: 'fastly-client-ip' }

const DISABLED_VALUES = new Set(['false', 'off', 'no', 'none', 'disabled'])

/** Parses the `TRUST_PROXY` environment variable.
 *
 *  | Value                   | Meaning                                                 |
 *  |-------------------------|---------------------------------------------------------|
 *  | unset / `false` / `off` | Trust nothing (default - local dev, tests, direct runs)  |
 *  | `firebase-hosting`      | Behind the Firebase Hosting -> Cloud Run rewrite         |
 *  | `true`                  | Trust `X-Forwarded-For` as-is                            |
 *  | a number                | Trust that many proxy hops                               |
 *  | anything else           | An IP/CIDR allow-list, passed through to Fastify         |
 */
export function resolveProxyTrust(raw: string | undefined): ProxyTrust {
  const value = raw?.trim()
  if (!value) return NO_PROXY_TRUST

  const normalized = value.toLowerCase()
  if (DISABLED_VALUES.has(normalized)) return NO_PROXY_TRUST
  if (normalized === 'firebase-hosting') return FIREBASE_HOSTING_TRUST
  if (normalized === 'true' || normalized === 'on' || normalized === 'yes') return { trustProxy: true }

  return { trustProxy: value }
}

/** The address the rate limiter should count against.
 *
 *  `requestIp` is Fastify's own `request.ip`, already resolved according to
 *  `trustProxy`. The configured `clientIpHeader`, when present and a valid IP,
 *  takes precedence - that's the only place the real caller appears behind
 *  Firebase Hosting.
 *
 *  The value is validated as an IP before being used, because it is
 *  attacker-controllable on any request path that reaches the origin without
 *  passing through the proxy. Validation bounds the key space of the
 *  rate-limit store; it does not make the value trustworthy. See
 *  `apps/api/.env.example` and the temporary drift register (DRIFT-001). */
export function resolveClientIp(
  headers: IncomingHttpHeaders,
  requestIp: string,
  trust: ProxyTrust,
): string {
  if (!trust.clientIpHeader) return requestIp

  const header = headers[trust.clientIpHeader]
  const rawValue = Array.isArray(header) ? header[0] : header
  if (!rawValue) return requestIp

  const candidate = rawValue.split(',')[0]?.trim()
  if (!candidate || isIP(candidate) === 0) return requestIp

  return candidate
}
