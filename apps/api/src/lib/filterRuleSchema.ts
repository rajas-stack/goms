// Zod shape for a persisted/transient Master Grid filter (spec §8.1), shared by
// bids.listForGrid and bidSavedViews so the two can never drift. A filter is a
// list of nodes AND-ed together; a node is a rule, or a group of nodes joined by
// AND / OR (nesting is capped so a stored view can't be made pathologically deep).
import { z } from 'zod'
import { OPERATORS_BY_TYPE, STANDARD_BID_FIELD_TYPES, isFilterGroup, type FilterNode, type TypedFilterRule } from '@goms/domain'

export const filterRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'contains', 'startsWith', 'gt', 'lt', 'between', 'before', 'after', 'in']),
  value: z.string(),
  value2: z.string().optional(),
  values: z.array(z.string()).optional(),
})

const MAX_DEPTH = 4
const MAX_RULES = 200

function nodeSchema(depth: number): z.ZodType<FilterNode> {
  if (depth >= MAX_DEPTH) return filterRuleSchema as z.ZodType<FilterNode>
  return z.union([
    filterRuleSchema,
    z.object({ logic: z.enum(['and', 'or']), rules: z.array(z.lazy(() => nodeSchema(depth + 1))).max(MAX_RULES) }),
  ]) as z.ZodType<FilterNode>
}

/** Rules (and groups of rules) for the transient grid query. */
export const filterNodeSchema = nodeSchema(0)

const ruleIsValid = (rule: TypedFilterRule) => {
  const type = STANDARD_BID_FIELD_TYPES[rule.field]
  return !type || rule.operator === 'eq' || OPERATORS_BY_TYPE[type].includes(rule.operator)
}
const nodeIsValid = (n: FilterNode): boolean => (isFilterGroup(n) ? n.rules.every(nodeIsValid) : ruleIsValid(n))

/** A rule on a KNOWN standard column must use an operator valid for that
 *  column's type (`eq` is valid everywhere). Rules on `custom:<key>` fields are
 *  accepted as given — a saved view must be storable and loadable even after
 *  its custom column is archived, so custom rules are never validated against
 *  the current column list. */
export const savedViewRuleSchema = filterNodeSchema.refine(nodeIsValid, { message: 'That operator does not apply to this column.' })
