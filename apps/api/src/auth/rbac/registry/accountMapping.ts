import { NODE_TYPE_MAP, salesPersonPatchAtom, type PolicyModuleKey } from '@goms/domain'
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

/** A node is created in the domain its TYPE belongs to, under a parent of that same domain. The client-supplied `domain`
 *  alone is never trusted: otherwise a role that may create departments could create geography by claiming `org` (review finding 4). */
const nodeCreate: Requirement = async (raw) => {
  const domain = raw?.domain
  const module = moduleForDomain(domain)
  if (raw?.typeKey !== undefined) {
    const type = typeof raw.typeKey === 'string' ? NODE_TYPE_MAP[raw.typeKey] : undefined
    if (!type || type.domain !== domain) throw new DenyCall('That node type does not belong to this part of the hierarchy.')
  }
  if (raw?.parentId) {
    const parentDomain = await domainOfNode(raw.parentId)
    if (parentDomain !== null && parentDomain !== domain) throw new DenyCall('A node cannot be created under a parent in a different part of the hierarchy.')
  }
  return { module, action: 'create' }
}

/** Moving a node keeps it inside its own domain (review finding 4). */
const nodeMove: Requirement = async (raw) => {
  const domain = await domainOfNode(raw?.id)
  if (raw?.newParentId) {
    const target = await domainOfNode(raw.newParentId)
    if (target !== null && domain !== null && target !== domain) throw new DenyCall('A node cannot be moved into a different part of the hierarchy.')
  }
  return { module: moduleForDomain(domain), action: 'update' }
}

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
  // A merge counts as a delete (spec §14.13): IT holds contact delete but only reads contacts, so it must not also need write.
  'employees.merge': { requirements: [remove('am.contacts')] },
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
  'hierarchy.createNode': { requirements: [nodeCreate] },
  'hierarchy.duplicateNode': { requirements: [nodeAction('create', (r) => r?.id)] },
  'hierarchy.importChildren': { requirements: [nodeAction('create', (r) => r?.parentId)] },
  ...same(['hierarchy.updateNode', 'hierarchy.setNodeStatus'], nodeAction('update', (r) => r?.id)),
  'hierarchy.moveNode': { requirements: [nodeMove] },
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
