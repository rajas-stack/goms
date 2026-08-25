import { router } from './trpc.js'
import { healthRouter } from './routers/health.js'
import { customersRouter } from './routers/customers.js'
import { hierarchyRouter } from './routers/hierarchy.js'
import { employeesRouter } from './routers/employees.js'

export const appRouter = router({ health: healthRouter, customers: customersRouter, hierarchy: hierarchyRouter, employees: employeesRouter })
export type AppRouter = typeof appRouter
