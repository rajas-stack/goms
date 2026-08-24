import { router } from './trpc.js'
import { healthRouter } from './routers/health.js'
import { customersRouter } from './routers/customers.js'

export const appRouter = router({ health: healthRouter, customers: customersRouter })
export type AppRouter = typeof appRouter
