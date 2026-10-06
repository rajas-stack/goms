import { salesPersonPatchAtom, type PolicyModuleKey } from '@goms/domain'
import { DenyCall } from '../denial.js'
import { domainOfNode, rowForSalesPerson, rowForTimelineEvent } from '../rows.js'
import { patchAtoms } from './builders.js'
import { ROW_MODULES, create, read, readAny, remove, write } from './helpers.js'
import { auditReadRequirement, filterSearchResults, maskAuditList, redactSalesRoster } from './masks.js'
import type { PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

/** hierarchy_nodes.domain → the module that governs it. */
function moduleForDomain(domain: unknown): PolicyModuleKey {
  if (domain === 'geo') return 'am.geography'
  if (domain === 'org') return 'am.departments'
  if (domain === 'sales') return 'team.sales'
  throw new DenyCall('Unknown hierarchy domain.')
}
const nodeAction = (action: 'read' | 'create' | 'update' | 'delete', pick: (raw: any) => unknown): Requirement =>
  async (raw) => ({ module: moduleForDomain(await domainOfNode(pick(raw))), action })

const meetingWrite = (action: 'update' | 'delete'): Requirement => async (raw) => ({
  module: 'am.meetings', action, row: (await rowForTimelineEvent(raw?.id)) ?? undefined,
})

const salesProfileWrite: Requirement = async (raw) => ({
  module: 'team.sales', action: 'update', atoms: patchAtoms(raw?.patch, salesPersonPatchAtom),
  row: (await rowForSalesPerson(raw?.id)) ?? undefined,
})

/** Row screens need salesperson names even where the Sales Team module itself is None (gap A4). */
const rosterRead = readAny('team.sales', ...ROW_MODULES, 'am.contacts')

export const accountMappingPolicy: Record<string, PolicyEntry> = {
  // ---- People & Contacts
  ...same([
    'employees.listUnder', 'employees.listDirect', 'employees.listByState', 'employees.listAll', 'employees.listDepartments',
    'employees.get', 'employees.directReports', 'employees.reportingChain', 'employees.listMergeAudit', 'employees.transfers.listForEmployee',
  ], read('am.contacts')),
  'employees.create': { requirements: [create('am.contacts')] },
  'employees.import': { requirements: [create('am.contacts')] },
  ...same(['employees.update', 'employees.setManager', 'employees.addCharge', 'employees.removeCharge'], write('am.contacts')),
  'employees.delete': { requirements: [remove('am.contacts')] },
  'employees.merge': { requirements: [write('am.contacts'), remove('am.contacts')] },
  'employees.transfers.transfer': { requirements: [write('am.contacts'), write('am.departments')] },

  // ---- Meetings
  ...same(['employees.timeline.listAll', 'employees.timeline.listForEmployee'], read('am.meetings')),
  'employees.timeline.add': { requirements: [create('am.meetings')] },
  ...same(['employees.timeline.update', 'employees.timeline.setAttended'], meetingWrite('update')),
  'employees.timeline.delete': { requirements: [meetingWrite('delete')] },

  // ---- hierarchy: geography / customer departments / (sales) by node domain
  ...same(['hierarchy.listStates', 'hierarchy.getState', 'hierarchy.geoRoot'], read('am.geography')),
  ...same(['hierarchy.listOrgRoots', 'hierarchy.listDepartments', 'hierarchy.listPostingNodes'], read('am.departments')),
  'hierarchy.getNode': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.listChildren': { requirements: [nodeAction('read', (r) => r?.parentId)] },
  'hierarchy.breadcrumb': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.childCount': { requirements: [nodeAction('read', (r) => r?.id)] },
  'hierarchy.childCounts': { requirements: [nodeAction('read', (r) => r?.parentId)] },
  'hierarchy.moveTargets': { requirements: [nodeAction('read', (r) => r?.nodeId)] },
  'hierarchy.createNode': { requirements: [(raw) => ({ module: moduleForDomain(raw?.domain), action: 'create' })] },
  'hierarchy.duplicateNode': { requirements: [nodeAction('create', (r) => r?.id)] },
  'hierarchy.importChildren': { requirements: [nodeAction('create', (r) => r?.parentId)] },
  ...same(['hierarchy.updateNode', 'hierarchy.setNodeStatus'], nodeAction('update', (r) => r?.id)),
  'hierarchy.moveNode': { requirements: [nodeAction('update', (r) => r?.id)] },
  'hierarchy.reorderNode': { requirements: [nodeAction('update', (r) => r?.id)] },
  'hierarchy.deleteNode': { requirements: [nodeAction('delete', (r) => r?.id)] },

  // ---- Customers (API only)
  ...same(['customers.list', 'customers.get'], read('am.customers')),
  'customers.create': { requirements: [create('am.customers')] },
  'customers.update': { requirements: [write('am.customers')] },
  'customers.delete': { requirements: [remove('am.customers')] },

  // ---- Sales Team
  ...Object.fromEntries(['sales.listPersons', 'sales.getPerson', 'sales.currentPostings'].map((p) => [p, { requirements: [rosterRead], mask: redactSalesRoster }])),
  'sales.listPostings': { requirements: [rosterRead] },
  'sales.create': { requirements: [create('team.sales')] },
  'sales.update': { requirements: [salesProfileWrite] },
  ...same(['sales.setStatus', 'sales.transfer', 'sales.updatePostingDates', 'sales.updatePostingManager'], write('team.sales', ['sales.roster'])),
  'sales.delete': { requirements: [remove('team.sales')] },

  // ---- Company Org Structure and the team rosters mirrored from it
  ...same(['orgPeople.list', 'deliveryTeams.list'], read('team.org')),
  ...same(['orgPeople.create', 'deliveryTeams.create'], create('team.org')),
  ...same(['orgPeople.update', 'deliveryTeams.update', 'deliveryTeams.setStatus'], write('team.org')),
  ...same(['orgPeople.delete', 'deliveryTeams.delete'], remove('team.org')),

  // ---- search: visible per category; relationship analytics is Operational analytics (gap A5)
  ...Object.fromEntries(['search.search', 'search.relatedRecords'].map((p) => [p, {
    requirements: [readAny('am.contacts', 'am.departments', 'am.geography', 'am.meetings', 'team.sales', ...ROW_MODULES)],
    mask: filterSearchResults,
  }])),
  'search.relationshipAnalytics': { requirements: [read('an.operational')] },

  // ---- audit logs
  'auditLogs.list': { requirements: [auditReadRequirement], mask: maskAuditList },
}
