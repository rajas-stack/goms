import { maskGridRows } from './rowVisibility.js'
import { read } from './helpers.js'
import type { PolicyEntry } from './types.js'

/** Insights Studio (routers/insightsStudio.ts). Everyone with Operational analytics may build personal visuals and
 *  reports; the router itself scopes every row to its owner (or shared) and checks shared-row management. The data a
 *  visual shows is read through each source's own procedure and policy, never through these. */
const analytics: PolicyEntry = { requirements: [read('an.operational')] }

export const insightsStudioPolicy: Record<string, PolicyEntry> = {
  ...Object.fromEntries([
    'insightsStudio.listVisuals', 'insightsStudio.getVisual', 'insightsStudio.createVisual', 'insightsStudio.updateVisual', 'insightsStudio.deleteVisual',
    'insightsStudio.listReports', 'insightsStudio.getReport', 'insightsStudio.createReport', 'insightsStudio.updateReport', 'insightsStudio.deleteReport',
  ].map((path) => [path, analytics])),
  /** Same permission as bidCorrigenda.listForBid, with the bid grid's sheet mask over the rows. */
  'insightsStudio.corrigenda': { requirements: [read('bid.corrigenda')], mask: maskGridRows },
}
