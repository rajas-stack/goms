import { accountMappingPolicy } from './accountMapping.js'
import { adminPolicy } from './admin.js'
import { commercialPolicy } from './commercial.js'
import { opportunityPolicy } from './opportunity.js'
import type { PolicyEntry } from './types.js'

/** `'router.procedure'` → policy. Composed from the per-area modules; tests may add and remove keys. */
export const PROCEDURE_POLICY: Record<string, PolicyEntry> = {
  ...opportunityPolicy, ...accountMappingPolicy, ...commercialPolicy, ...adminPolicy,
}
