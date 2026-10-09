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
import { protectedValuesRouter } from './routers/protectedValues.js'
import { bidCorrigendaRouter } from './routers/bidCorrigenda.js'
import { documentsRouter } from './routers/documents.js'
import { bidSavedViewsRouter } from './routers/bidSavedViews.js'
import { bidCustomFieldsRouter } from './routers/bidCustomFields.js'
import { auditLogsRouter } from './routers/auditLogs.js'
import { deliveryTeamsRouter } from './routers/deliveryTeams.js'
import { bidSynopsisRouter } from './routers/bidSynopsis.js'
import { orgPeopleRouter } from './routers/orgPeople.js'
import { authRouter } from './routers/auth.js'
import { accessRouter } from './routers/access.js'
import { tenderWebsitesRouter } from './routers/tenderWebsites.js'
import { credentialPassphrasesRouter } from './routers/credentialPassphrases.js'
import { googleIntegrationsRouter } from './routers/googleIntegrations.js'

export const appRouter = router({
  health: healthRouter, customers: customersRouter, hierarchy: hierarchyRouter,
  employees: employeesRouter, sales: salesRouter, commercial: commercialRouter,
  ownership: ownershipRouter, opportunities: opportunitiesRouter, followUps: followUpsRouter, search: searchRouter,
  adminImport: adminImportRouter, bids: bidsRouter, bidMilestones: bidMilestonesRouter,
  protectedValues: protectedValuesRouter, bidCorrigenda: bidCorrigendaRouter,
  documents: documentsRouter, bidSavedViews: bidSavedViewsRouter, auditLogs: auditLogsRouter,
  bidCustomFields: bidCustomFieldsRouter,
  deliveryTeams: deliveryTeamsRouter,
  bidSynopsis: bidSynopsisRouter,
  orgPeople: orgPeopleRouter,
  auth: authRouter, access: accessRouter,
  tenderWebsites: tenderWebsitesRouter,
  credentialPassphrases: credentialPassphrasesRouter,
  googleIntegrations: googleIntegrationsRouter,
})
export type AppRouter = typeof appRouter
