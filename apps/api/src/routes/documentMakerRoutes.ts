// Browser download link for Document maker files. It sits outside tRPC and sign-in: each request is authorised by
// a 5-minute token from `makerDocuments.downloadUrl` / `versionDownloadUrl` (see lib/makerDownloadToken.ts).
import type { FastifyInstance } from 'fastify'
import { downloadName, MIME_FOR_FILE_TYPE, type MakerDocument } from '@goms/domain'
import { readDownloadToken } from '../lib/makerDownloadToken.js'
import { readContent, readVersionContent } from '../lib/makerStore.js'

export interface MakerFileStore {
  readContent(id: string): Promise<{ doc: MakerDocument; bytes: Uint8Array } | null>
  readVersionContent(id: string, version: number): Promise<Uint8Array | null>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerDocumentMakerRoutes(app: FastifyInstance, store: MakerFileStore = { readContent, readVersionContent }) {
  /** The current version, or the earlier version named in the token. */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/document-maker/files/:id', async (request, reply) => {
    const { id } = request.params
    if (!UUID.test(id)) return reply.code(404).send({ error: 'Not found' })
    const token = await readDownloadToken(request.query.token, id)
    if (!token) return reply.code(403).send({ error: 'This download link is invalid or has expired.' })
    const found = await store.readContent(id)
    if (!found) return reply.code(404).send({ error: 'Not found' })
    let bytes: Uint8Array = found.bytes
    let name = downloadName(found.doc)
    if (token.version !== undefined && token.version !== found.doc.version) {
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
}
