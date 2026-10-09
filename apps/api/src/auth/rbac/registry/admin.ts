import { read, remove, write } from './helpers.js'
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
  /** The caller's own identity: authenticates itself (see routers/auth.ts). */
  'auth.me': { requirements: [], kind: 'self' },
  'googleIntegrations.get': { requirements: [], kind: 'self' },
  'googleIntegrations.save': { requirements: [], kind: 'self' },
  'access.listOverrides': { requirements: [read('admin.access')] },
  'access.readiness': { requirements: [read('admin.access')] },
  'access.setOverride': { requirements: [write('admin.access')] },
  'access.removeOverride': { requirements: [remove('admin.access')] },
  /** Shared encryption keys affect every connected portal: administration only. */
  'credentialPassphrases.create': { requirements: [write('admin.access')] },
  'credentialPassphrases.update': { requirements: [write('admin.access')] },
  'credentialPassphrases.remove': { requirements: [remove('admin.access')] },
}
