// Zod shape for a persisted/transient Master Grid filter rule (spec §8.1),
// shared by bids.listForGrid and bidSavedViews so the two can never drift.
import { z } from 'zod'
import { OPERATORS_BY_TYPE, STANDARD_BID_FIELD_TYPES } from '@goms/domain'

export const filterRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'contains', 'startsWith', 'gt', 'lt', 'between', 'before', 'after', 'in']),
  value: z.string(),
  value2: z.string().optional(),
  values: z.array(z.string()).optional(),
})

/** A rule on a KNOWN standard column must use an operator valid for that
 *  column's type (`eq` is valid everywhere). Rules on `custom:<key>` fields are
 *  accepted as given — a saved view must be storable and loadable even after
 *  its custom column is archived, so custom rules are never validated against
 *  the current column list. */
export const savedViewRuleSchema = filterRuleSchema.refine((rule) => {
  const type = STANDARD_BID_FIELD_TYPES[rule.field]
  return !type || rule.operator === 'eq' || OPERATORS_BY_TYPE[type].includes(rule.operator)
}, { message: 'That operator does not apply to this column.' })
