// WebDAV for desktop and phone Office apps: GOMS hands Word/Excel/PowerPoint an `ms-word:ofe|u|<this URL>` link,
// the app reads the file here, PUTs every save back (each one becomes a version) and UNLOCKs when the file closes.
// Office cannot send a GOMS sign-in, so the URL carries a short random session id (see maker_dav_sessions); every
// request re-checks that the session's user still owns the file or holds a share, so revoking a share takes effect
// mid-session. Office's URL length limits are why this is not a JWT.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { downloadName, hasZipMagic, MAKER_LIMITS, makerRights, MIME_FOR_FILE_TYPE, type MakerDocument } from '@goms/domain'
import { pool } from '../db.js'
import { getAccessible, readContent, saveVersion } from '../lib/makerStore.js'

export const DAV_SESSION_HOURS = 12
// @fastify/cors reads a route's `config.cors` but does not declare it.
declare module 'fastify' { interface FastifyContextConfig { cors?: false } }

const SESSION_ID = /^[A-Za-z0-9_-]{22}$/
const LOCK_SECONDS = 3600
const DAV_METHODS = ['PROPFIND', 'PROPPATCH', 'LOCK', 'UNLOCK'] as const

export interface DavSession { documentId: string; email: string }

export interface DavStore {
  findSession(id: string): Promise<DavSession | null>
  getAccessible(id: string, email: string): Promise<MakerDocument | null>
  readContent(id: string): Promise<{ doc: MakerDocument; bytes: Uint8Array } | null>
  saveVersion(id: string, bytes: Uint8Array, changedBy: string | null, reason: string): Promise<MakerDocument | null>
}

const hash = (id: string) => createHash('sha256').update(id).digest('hex')

export async function createDavSession(documentId: string, email: string): Promise<string> {
  const id = randomBytes(16).toString('base64url')
  await pool.query('DELETE FROM maker_dav_sessions WHERE expires_at<now()')
  await pool.query(`INSERT INTO maker_dav_sessions (token_hash, document_id, email, expires_at) VALUES ($1,$2,$3,now()+make_interval(hours => $4))`,
    [hash(id), documentId, email, DAV_SESSION_HOURS])
  return id
}

const dbStore: DavStore = {
  async findSession(id) {
    const { rows } = await pool.query('SELECT document_id, email FROM maker_dav_sessions WHERE token_hash=$1 AND expires_at>now()', [hash(id)])
    return rows[0] ? { documentId: rows[0].document_id, email: rows[0].email } : null
  },
  getAccessible, readContent, saveVersion,
}

// shortcut: locks live in this process's memory, so they are lost on restart and not shared between instances
// (Office simply re-locks). Move to a table if the API runs on more than one instance.
const locks = new Map<string, { token: string; email: string; expires: number }>()

function activeLock(id: string) {
  const lock = locks.get(id)
  if (lock && lock.expires < Date.now()) { locks.delete(id); return undefined }
  return lock
}

const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)

function lockXml(token: string, email: string) {
  return `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth><D:owner>${xmlEscape(email)}</D:owner><D:timeout>Second-${LOCK_SECONDS}</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`
}

function propXml(href: string, doc: MakerDocument | null) {
  const props = doc
    ? `<D:displayname>${xmlEscape(downloadName(doc))}</D:displayname><D:resourcetype/><D:getcontentlength>${doc.size}</D:getcontentlength><D:getcontenttype>${MIME_FOR_FILE_TYPE[doc.fileType]}</D:getcontenttype><D:getetag>"${doc.documentKey}"</D:getetag><D:getlastmodified>${new Date(doc.updatedAt).toUTCString()}</D:getlastmodified><D:creationdate>${doc.createdAt}</D:creationdate><D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>`
    : '<D:resourcetype><D:collection/></D:resourcetype>'
  return `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
}

/** The lock token from `Lock-Token: <x>` or `If: (<x>)`. */
function submittedLock(request: FastifyRequest): string | null {
  const raw = String(request.headers['lock-token'] ?? request.headers.if ?? '')
  return raw.match(/<(opaquelocktoken:[0-9a-f-]{36})>/i)?.[1] ?? null
}

export function registerMakerDavRoutes(app: FastifyInstance, store: DavStore = dbStore) {
  for (const method of DAV_METHODS) if (!app.supportedMethods.includes(method)) app.addHttpMethod(method, { hasBody: true })

  app.register(async (dav) => {
    // Office sends raw file bytes (PUT) and small XML bodies (PROPFIND/LOCK) with assorted content types.
    dav.removeAllContentTypeParsers()
    dav.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAKER_LIMITS.fileBytes }, (_req, body, done) => done(null, body))

    /** The session's file and the caller's rights, or a reply already sent. */
    async function resolve(request: FastifyRequest<{ Params: { session: string } }>, reply: FastifyReply) {
      const { session } = request.params
      const found = SESSION_ID.test(session) ? await store.findSession(session) : null
      const doc = found ? await store.getAccessible(found.documentId, found.email) : null
      if (!found || !doc) { reply.code(404).send(); return null }
      return { doc, email: found.email, rights: makerRights(doc) }
    }

    const allow = 'OPTIONS, GET, HEAD, PUT, PROPFIND, PROPPATCH, LOCK, UNLOCK'
    // Office probes the session folder both with and without a trailing slash. CORS is off: Office is not a browser,
    // and the CORS plugin would answer Office's OPTIONS probe with 400, which makes Office open the file read-only.
    for (const url of ['/api/dav/:session', '/api/dav/:session/*']) dav.route<{ Params: { session: string; '*'?: string } }>({
      method: ['OPTIONS', 'GET', 'HEAD', 'PUT', ...DAV_METHODS], url, config: { cors: false },
      handler: async (request, reply) => {
        reply.header('DAV', '1, 2').header('MS-Author-Via', 'DAV').header('Allow', allow)
        if (request.method === 'OPTIONS') return reply.code(200).send()
        const ctx = await resolve(request, reply)
        if (!ctx) return reply
        const { doc, email, rights } = ctx
        const isFile = (request.params['*'] ?? '') !== ''
        const href = request.url.split('?')[0]

        switch (request.method) {
          case 'PROPFIND': {
            const depth = String(request.headers.depth ?? '1')
            const body = isFile ? propXml(href, doc)
              : propXml(href, null) + (depth === '0' ? '' : propXml(`${href.replace(/\/?$/, '/')}${encodeURIComponent(downloadName(doc))}`, doc))
            return reply.code(207).header('Content-Type', 'application/xml; charset=utf-8')
              .send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`)
          }
          case 'PROPPATCH':
            // Office sets Windows file times here; they are not stored. Answer success so saving continues.
            return reply.code(207).header('Content-Type', 'application/xml; charset=utf-8')
              .send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`)
          case 'GET': case 'HEAD': {
            if (!isFile) return reply.code(405).send()
            const content = await store.readContent(doc.id)
            if (!content) return reply.code(404).send()
            reply.header('Content-Type', MIME_FOR_FILE_TYPE[doc.fileType]).header('ETag', `"${content.doc.documentKey}"`)
              .header('Last-Modified', new Date(content.doc.updatedAt).toUTCString()).header('Content-Length', content.bytes.length)
            return request.method === 'HEAD' ? reply.send() : reply.send(Buffer.from(content.bytes))
          }
          case 'LOCK': {
            // A read-only lock refusal is how Office learns to open the file read-only.
            if (!rights.write) return reply.code(403).send()
            const held = activeLock(doc.id)
            const presented = submittedLock(request)
            if (held && held.email !== email && held.token !== presented) return reply.code(423).send()
            const token = held && (held.token === presented || held.email === email) ? held.token : `opaquelocktoken:${randomUUID()}`
            locks.set(doc.id, { token, email, expires: Date.now() + LOCK_SECONDS * 1000 })
            return reply.code(200).header('Lock-Token', `<${token}>`).header('Content-Type', 'application/xml; charset=utf-8').send(lockXml(token, email))
          }
          case 'UNLOCK': {
            const held = activeLock(doc.id)
            if (held && held.token === submittedLock(request)) locks.delete(doc.id)
            return reply.code(204).send()
          }
          case 'PUT': {
            if (!isFile) return reply.code(405).send()
            if (!rights.write) return reply.code(403).send()
            const held = activeLock(doc.id)
            if (held && held.email !== email) return reply.code(423).send()
            const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0)
            // Some clients create the file with an empty PUT before writing it; the stored file already exists.
            if (!bytes.length) return reply.code(204).send()
            if (!hasZipMagic(bytes)) return reply.code(415).send()
            await store.saveVersion(doc.id, new Uint8Array(bytes), email, 'Saved from the desktop app')
            return reply.code(204).send()
          }
          default:
            return reply.code(405).send()
        }
      },
    })
  })
}
