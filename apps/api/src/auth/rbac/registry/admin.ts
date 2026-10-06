import type { PolicyEntry } from './types.js'

const outside: PolicyEntry = { requirements: [], kind: 'outside' }

/** Admin Data Import keeps its own allow-list + ADMIN_IMPORT_ENABLED flag (spec §4, "Outside RBAC"). */
export const adminPolicy: Record<string, PolicyEntry> = {
  ...Object.fromEntries([
    'adminImport.commitGeographyLoad', 'adminImport.history', 'adminImport.listDomains', 'adminImport.previewGeographyLoad',
    'adminImport.session.commit', 'adminImport.session.history', 'adminImport.session.validate',
  ].map((p) => [p, outside])),
  /** Liveness probe: public, returns no data. */
  'health.check': { requirements: [], kind: 'public' },
}
