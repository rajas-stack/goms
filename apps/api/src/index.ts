import { router } from './trpc.js'
import { healthRouter } from './routers/health.js'
import { customersRouter } from './routers/customers.js'
import { hierarchyRouter } from './routers/hierarchy.js'

export const appRouter = router({ health: healthRouter, customers: customersRouter, hierarchy: hierarchyRouter })
export type AppRouter = typeof appRouter
