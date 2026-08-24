import Fastify from 'fastify'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './index.js'

const app = Fastify()
app.register(fastifyTRPCPlugin, { prefix: '/api/trpc', trpcOptions: { router: appRouter } })
app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })
