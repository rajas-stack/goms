import type { FastifyInstance } from 'fastify'
import { TRPCError } from '@trpc/server'
import { assertProfileMappingAccess, profileActor } from '../profileImages/access.js'
import { DriveError, profilePhoto, readProfileImage } from '../profileImages/service.js'

export function registerProfileImageRoutes(app: FastifyInstance) {
  app.get<{ Params: { userId: string }; Querystring: { v?: string } }>('/api/profile-images/:userId', { config: { rateLimit: { max: 1200, timeWindow: '5 minutes' } } }, async (req, reply) => {
    try {
      const user = await profileActor({ authHeader: req.headers.authorization })
      const state = await readProfileImage(req.params.userId); const mapping = state.mapping
      if (state.error || !mapping || req.query.v !== mapping.version) return reply.code(404).send()
      await assertProfileMappingAccess(user, mapping)
      const etag = `"${mapping.version}"`
      reply.header('Cache-Control', 'private, no-cache').header('Vary', 'Authorization').header('ETag', etag)
      if (req.headers['if-none-match'] === etag) return reply.code(304).send()
      const photo = await profilePhoto(state, mapping)
      // A folder switch during an upstream fetch cannot deliver a superseded image.
      const current = await readProfileImage(req.params.userId)
      if (current.error || current.mapping?.version !== mapping.version) return reply.header('Cache-Control', 'private, no-store').code(404).send()
      return reply.type(photo.mime).send(photo.body)
    } catch (error) {
      const status = error instanceof TRPCError ? error.code === 'UNAUTHORIZED' ? 401 : error.code === 'FORBIDDEN' ? 403 : 503 : error instanceof DriveError && [401, 403, 404].includes(error.status) ? 404 : 503
      return reply.header('Cache-Control', 'private, no-store').code(status).send()
    }
  })
}
