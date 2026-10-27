import { defineNode } from '@/lib/rbacTree/registry'
import '@/lib/rbacTree/appModules'

const page = (parent: string, key: string, label: string) => defineNode(parent, key, label, { kind: 'page' })

/** The permission-tree node of every route (router.tsx `handle.rbac`). Pages that are also a tab elsewhere reference that
 *  tab's node (declared where the tab bar is); the rest are declared here. Unconditional on purpose: the manifest must not
 *  depend on build flags (Live Bids, Admin Data Import). manifest.test.tsx checks every id exists. */
export const ROUTE_NODES = {
  home: 'home',
  map: page('accountMapping', 'map', 'Map'),
  state: page('accountMapping.map', 'state', 'State workspace'),
  directory: page('accountMapping', 'directory', 'Directory'),
  insights: page('accountMapping', 'insights', 'Insights'),
  insightsStudioVisuals: page('accountMapping.insights', 'studioVisuals', 'Insights studio: visualization components'),
  insightsStudioReports: page('accountMapping.insights', 'studioReports', 'Insights studio: templates and reports'),
  insightsDataSources: page('accountMapping.insights', 'dataSources', 'Insights data sources'),
  meetings: page('accountMapping', 'meetings', 'Meetings'),
  meeting: page('accountMapping.meetings', 'detail', 'Meeting details'),
  sales: page('teams', 'sales', 'Sales'),
  teams: 'teams',
  commercial: 'commercial',
  boq: page('commercial', 'boq', 'BOQ detail'),
  bidTracker: 'opportunity.bid-tracker',
  pipeline: 'opportunity.pipeline',
  campaign: 'opportunity.campaign',
  master: 'opportunity.master',
  dashboard: 'opportunity.dashboard',
  bid: page('opportunity', 'bid', 'Individual Opportunity'),
  settings: 'settings',
  integrations: 'settings.system.integrations',
  dms: 'settings.system.storage',
  credentials: 'settings.system.credentials',
  access: 'settings.system.access',
  tenderWebsites: 'settings.bid-team.tender',
  verifications: 'settings.bid-team.verification',
  competitors: 'settings.pre-sales.competitors',
  employeeMaster: 'settings.masters.employees',
  documents: 'documents',
  documentMaker: 'documentMaker',
  email: 'email',
  whatsapp: 'whatsapp',
  marketing: 'marketing',
  documentEditor: page('documentMaker', 'editor', 'Document editor'),
  dataImport: page('settings', 'dataImport', 'Admin data import'),
} as const

export type RouteNodeHandle = { rbac: { id: string } }
export const rbacHandle = (id: string): RouteNodeHandle => ({ rbac: { id } })
