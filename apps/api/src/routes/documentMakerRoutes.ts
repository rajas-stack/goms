// HTTP routes the ONLYOFFICE Document Server (and a browser download link) call. They sit outside tRPC and user
// sign-in: each request is authorised by JWTs signed with ONLYOFFICE_JWT_SECRET instead (see lib/onlyoffice.ts).
import type { FastifyInstance, FastifyReply } from 'fastify'
import { downloadName, hasZipMagic, keyBelongsTo, MAKER_LIMITS, MIME_FOR_FILE_TYPE, type MakerDocument } from '@goms/domain'
import {
  assertAllowedDownload, downloadFile, internalFetchUrl, onlyofficeSettings, readUrlToken, verifyToken, type OnlyofficeSettings,
} from '../lib/onlyoffice.js'
import { readContent, readVersionContent, saveVersion } from '../lib/makerStore.js'

export interface MakerFileStore {
  readContent(id: string): Promise<{ doc: MakerDocument; bytes: Uint8Array } | null>
  saveVersion(id: string, bytes: Uint8Array, changedBy: string | null, reason: string): Promise<MakerDocument | null>
  readVersionContent(id: string, version: number): Promise<Uint8Array | null>
}

export interface CallbackDeps {
  settings: OnlyofficeSettings
  store: MakerFileStore
  fetchImpl?: typeof fetch
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAVE_STATUSES = new Set([2, 6])

export class CallbackRejected extends Error {}

function bearer(header: unknown): string | null {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null
}

/** The callback body as signed by the Document Server: `token` in the body, or the Authorization header whose
 *  payload wraps the body as `payload`. An unsigned body is never trusted. */
async function signedBody(body: unknown, authorization: unknown, secret: Uint8Array): Promise<Record<string, unknown>> {
  const inBody = body && typeof body === 'object' ? (body as Record<string, unknown>).token : undefined
  if (inBody !== undefined) {
    const payload = await verifyToken(inBody, secret)
    if (!payload) throw new CallbackRejected('Invalid callback token.')
    return payload
  }
  const header = await verifyToken(bearer(authorization), secret)
  const wrapped = header?.payload
  if (!wrapped || typeof wrapped !== 'object') throw new CallbackRejected('Missing callback token.')
  return wrapped as Record<string, unknown>
}

/** Handles one Document Server callback; resolves to the JSON body to send back. */
export async function handleCallback(
  input: { id: string; queryToken: unknown; body: unknown; authorization: unknown }, deps: CallbackDeps,
): Promise<{ error: 0 | 1 }> {
  const { secret } = deps.settings
  if (!UUID.test(input.id) || !await readUrlToken(input.queryToken, ['callback'], input.id, secret)) throw new CallbackRejected('Invalid callback URL.')
  const body = await signedBody(input.body, input.authorization, secret)
  if (!keyBelongsTo(input.id, body.key)) throw new CallbackRejected('Callback is for another document.')
  if (!SAVE_STATUSES.has(Number(body.status))) return { error: 0 }
  const current = await deps.store.readContent(input.id)
  if (!current) return { error: 1 }
  const url = assertAllowedDownload(body.url, deps.settings.downloadOrigins)
  if (typeof body.filetype === 'string' && body.filetype !== current.doc.fileType) return { error: 1 }
  const bytes = await downloadFile(internalFetchUrl(url, deps.settings), MAKER_LIMITS.fileBytes, deps.fetchImpl)
  if (!hasZipMagic(bytes)) return { error: 1 }
  const users = Array.isArray(body.users) ? body.users.filter((u): u is string => typeof u === 'string') : []
  const reason = Number(body.status) === 6 ? 'Saved from the editor (force save)' : 'Saved from the editor'
  await deps.store.saveVersion(input.id, bytes, users[0] ?? null, reason)
  return { error: 0 }
}

function unavailable(reply: FastifyReply) {
  return reply.code(503).send({ error: 'The document editor is not configured.' })
}

export function registerDocumentMakerRoutes(app: FastifyInstance, store: MakerFileStore = { readContent, saveVersion, readVersionContent }) {
  /** File bytes for the Document Server (`file` token: that exact version) or a browser download (`download` token). */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/document-maker/files/:id', async (request, reply) => {
    let settings: OnlyofficeSettings
    try { settings = onlyofficeSettings() } catch { return unavailable(reply) }
    const { id } = request.params
    if (!UUID.test(id)) return reply.code(404).send({ error: 'Not found' })
    const token = await readUrlToken(request.query.token, ['file', 'download'], id, settings.secret)
    if (!token) return reply.code(403).send({ error: 'Forbidden' })
    // The Document Server also signs its own request when JWT is on; a header that is present must verify.
    const header = bearer(request.headers.authorization)
    if (header && !await verifyToken(header, settings.secret)) return reply.code(403).send({ error: 'Forbidden' })
    const found = await store.readContent(id)
    if (!found) return reply.code(404).send({ error: 'Not found' })
    if (token.purpose === 'file' && token.key !== found.doc.documentKey) return reply.code(409).send({ error: 'This version has been replaced.' })
    let bytes: Uint8Array = found.bytes
    let name = downloadName(found.doc)
    if (token.purpose === 'download' && typeof token.version === 'number' && token.version !== found.doc.version) {
      const old = await store.readVersionContent(id, token.version)
      if (!old) return reply.code(404).send({ error: 'Not found' })
      bytes = old
      name = downloadName({ title: `${found.doc.title} (v${token.version})`, fileType: found.doc.fileType })
    }
    return reply
      .header('Content-Type', MIME_FOR_FILE_TYPE[found.doc.fileType])
      .header('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(Buffer.from(bytes))
  })

  /** Save notifications. ONLYOFFICE expects HTTP 200 with {"error":0} once the version is stored. */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>('/api/document-maker/callback/:id', async (request, reply) => {
    let settings: OnlyofficeSettings
    try { settings = onlyofficeSettings() } catch { return unavailable(reply) }
    try {
      const result = await handleCallback({ id: request.params.id, queryToken: request.query.token, body: request.body, authorization: request.headers.authorization }, { settings, store })
      return reply.send(result)
    } catch (error) {
      if (error instanceof CallbackRejected) return reply.code(403).send({ error: 1 })
      request.log.warn({ event: 'document_maker.callback_failed' }, 'ONLYOFFICE callback could not be saved')
      return reply.send({ error: 1 })
    }
  })
}
