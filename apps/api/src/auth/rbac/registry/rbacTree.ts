import { read, remove, write } from './helpers.js'
import type { PolicyEntry } from './types.js'

/** Settings > Roles & Access (the UI permission tree, routers/rbacTree.ts). Reads: whoever can read Role & Access; writes:
 *  the matrix requirement plus `systemAdminProcedure`, so only System Admins change it. `myAccess` is the caller's own tree. */
export const rbacTreePolicy: Record<string, PolicyEntry> = {
  'rbacTree.myAccess': { requirements: [], kind: 'self' },
  ...Object.fromEntries(['rbacTree.nodes', 'rbacTree.subjects', 'rbacTree.getConfig'].map((p) => [p, { requirements: [read('admin.access')] }])),
  ...Object.fromEntries([
    'rbacTree.sync', 'rbacTree.setConfig', 'rbacTree.createRole', 'rbacTree.updateRole', 'rbacTree.createTemplate', 'rbacTree.updateTemplate',
    'rbacTree.duplicateTemplate', 'rbacTree.applyTemplate', 'rbacTree.unlinkTemplate',
  ].map((p) => [p, { requirements: [write('admin.access')] }])),
  'rbacTree.deleteRole': { requirements: [remove('admin.access')] },
  'rbacTree.deleteTemplate': { requirements: [remove('admin.access')] },
}
