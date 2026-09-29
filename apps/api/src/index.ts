import { router } from './trpc.js'
import { healthRouter } from './routers/health.js'
import { customersRouter } from './routers/customers.js'
import { hierarchyRouter } from './routers/hierarchy.js'
import { employeesRouter } from './routers/employees.js'
import { salesRouter } from './routers/sales.js'
import { commercialRouter } from './routers/commercial.js'
import { ownershipRouter } from './routers/ownership.js'
import { opportunitiesRouter } from './routers/opportunities.js'
import { followUpsRouter } from './routers/follow-ups.js'
import { searchRouter } from './routers/search.js'
import { adminImportRouter } from './routers/adminImport.js'
import { bidsRouter } from './routers/bids.js'
import { bidMilestonesRouter } from './routers/bidMilestones.js'

export const appRouter = router({
  health: healthRouter, customers: customersRouter, hierarchy: hierarchyRouter,
  employees: employeesRouter, sales: salesRouter, commercial: commercialRouter,
  ownership: ownershipRouter, opportunities: opportunitiesRouter, followUps: followUpsRouter, search: searchRouter,
  adminImport: adminImportRouter, bids: bidsRouter, bidMilestones: bidMilestonesRouter,
})
export type AppRouter = typeof appRouter
