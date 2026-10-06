import { opportunityPolicy } from './opportunity.js'
import type { PolicyEntry } from './types.js'

/** `'router.procedure'` → policy. Composed from the per-area modules (tasks 8–11); tests may add and remove keys. */
export const PROCEDURE_POLICY: Record<string, PolicyEntry> = { ...opportunityPolicy }
