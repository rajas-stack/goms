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
  // The Gmail connection authenticates itself (identity + system administrator), including with RBAC off.
  'emailCenter.status': { requirements: [], kind: 'self' },
  'emailCenter.connect': { requirements: [], kind: 'self' },
  'profileImages.status': { requirements: [read('admin.access')] },
  'profileImages.folders': { requirements: [read('admin.access')] },
  'profileImages.connect': { requirements: [write('admin.access')] },
  'profileImages.test': { requirements: [write('admin.access')] },
  'profileImages.save': { requirements: [write('admin.access')] },
  'profileImages.sync': { requirements: [write('admin.access')] },
  'profileImages.index': { requirements: [read('am.contacts')] },
  'access.listOverrides': { requirements: [read('admin.access')] },
  'access.readiness': { requirements: [read('admin.access')] },
  'access.unmatchedOverrides': { requirements: [read('admin.access')] },
  'access.overrideHistory': { requirements: [read('admin.access')] },
  'access.permissionMatrix': { requirements: [read('admin.access')] },
  'access.effectivePermissions': { requirements: [read('admin.access')] },
  'access.setOverride': { requirements: [write('admin.access')] },
  'access.removeOverride': { requirements: [remove('admin.access')] },
  /** Shared encryption keys affect every connected portal: administration only. */
  'credentialPassphrases.create': { requirements: [write('admin.access')] },
  'credentialPassphrases.update': { requirements: [write('admin.access')] },
  'credentialPassphrases.remove': { requirements: [remove('admin.access')] },
}
