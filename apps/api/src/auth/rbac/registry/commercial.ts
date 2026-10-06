import { lineItemPatchAtom, masterKeyAtom, skuPatchAtom, type PolicyModuleKey } from '@goms/domain'
import { patchAtoms } from './builders.js'
import { create, read, remove, write } from './helpers.js'
import { auditReadRequirement, maskAuditList, maskSkuResponse } from './masks.js'
import type { PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

/** The approval matrix is its own module; every other master is a reference master. */
const masterModule = (key: unknown): PolicyModuleKey => (key === 'approvalMatrix' ? 'com.approvalMatrix' : 'com.masters')

const masterRead: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'read' })
const masterCreate: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'create' })
const masterDelete: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'delete' })
const masterWrite: Requirement = (raw) => ({ module: masterModule(raw?.key), action: 'update', atoms: [masterKeyAtom(String(raw?.key))] })

const skuUpdate: Requirement = (raw) => ({ module: 'com.skus', action: 'update', atoms: patchAtoms(raw?.patch, skuPatchAtom) })
const lineItemUpdate: Requirement = (raw) => ({ module: 'com.boqs', action: 'update', atoms: patchAtoms(raw?.patch, lineItemPatchAtom) })
/** Approve / reject is its own (exclusive) atom; every other status move is an ordinary BOQ edit. */
const boqStatus: Requirement = (raw) => ({
  module: 'com.boqs', action: 'update',
  atoms: [raw?.nextStatus === 'approved' || raw?.nextStatus === 'rejected' ? 'boq.approve' : 'boq.lines'],
})

export const commercialPolicy: Record<string, PolicyEntry> = {
  // ---- masters (+ the approval matrix)
  ...same(['commercial.masters.list', 'commercial.masters.get'], masterRead),
  'commercial.masters.listEditionFeatures': { requirements: [read('com.masters')] },
  'commercial.masters.create': { requirements: [masterCreate] },
  ...same(['commercial.masters.update', 'commercial.masters.setActive'], masterWrite),
  'commercial.masters.delete': { requirements: [masterDelete] },
  'commercial.masters.setEditionFeatures': { requirements: [write('com.masters', ['master.other'])] },

  // ---- SKU catalog: every SKU-shaped response is masked for roles that cannot read cost / floor price
  'commercial.skus.list': { requirements: [read('com.skus')], mask: maskSkuResponse },
  'commercial.skus.get': { requirements: [read('com.skus')], mask: maskSkuResponse },
  'commercial.skus.create': { requirements: [create('com.skus')], mask: maskSkuResponse },
  'commercial.skus.update': { requirements: [skuUpdate], mask: maskSkuResponse },
  'commercial.skus.delete': { requirements: [remove('com.skus')] },
  ...same(['commercial.bom.listForSku', 'commercial.bom.listAll'], read('com.skus')),
  'commercial.bom.create': { requirements: [create('com.skus')] },
  'commercial.bom.update': { requirements: [write('com.skus', ['sku.other'])] },
  'commercial.bom.delete': { requirements: [remove('com.skus')] },

  // ---- BOQs & proposals
  ...same(['commercial.boq.list', 'commercial.boq.get', 'commercial.boq.listLineItems', 'commercial.boq.listAllLineItems'], read('com.boqs')),
  ...same(['commercial.boq.create', 'commercial.boq.revise', 'commercial.boq.duplicate'], create('com.boqs')),
  ...same(['commercial.boq.update', 'commercial.boq.addLineItem', 'commercial.boq.removeLineItem', 'commercial.boq.reorderLineItems'], write('com.boqs')),
  'commercial.boq.updateLineItem': { requirements: [lineItemUpdate] },
  'commercial.boq.updateStatus': { requirements: [boqStatus] },
  'commercial.boq.delete': { requirements: [remove('com.boqs')] },

  'commercial.auditLogs.list': { requirements: [auditReadRequirement], mask: maskAuditList },
}
