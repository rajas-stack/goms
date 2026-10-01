import { TRPCError } from '@trpc/server'
import { NODE_TYPE_MAP, isValidChildType, type HierNode } from '@goms/domain'

/** Anything that can run a query: the shared pool, or a checked-out
 *  transaction client. */
export type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> }

// Maps the DB row (snake_case) onto the frontend's `HierNode` shape
// (camelCase) — see src/lib/types.ts (re-exported from packages/domain).
// Explicit return type avoids a circular-inference error where tRPC's
// procedure-output inference and ReturnType<typeof toNode> would otherwise
// depend on each other.
export function toNode(row: any): HierNode {
  return {
    id: row.id,
    domain: row.domain,
    typeKey: row.type_key,
    parentId: row.parent_id,
    stateCode: row.state_code,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order,
    metadata: row.metadata,
    status: row.status,
  }
}

export interface NewNodeInput {
  domain: 'geo' | 'org' | 'sales'
  typeKey: string
  parentId: string | null
  stateCode: number | null
  name: string
  metadata?: Record<string, string>
}

/** THE insert path for a hierarchy node — `hierarchy.createNode` and the Bid
 *  Tracker's "create the missing department" step both go through it, so a
 *  department made from either place obeys the same parent/child type rules and
 *  the same branch dedup.
 *
 *  Must run inside a transaction (`client` after BEGIN): the branch dedup's
 *  advisory lock is transaction-scoped, and a caller that creates several
 *  nodes (a parent and its child) relies on all-or-nothing. */
export async function insertHierarchyNode(client: Queryable, input: NewNodeInput): Promise<HierNode> {
  if (input.parentId) {
    const parentResult = await client.query(`SELECT type_key FROM hierarchy_nodes WHERE id=$1`, [input.parentId])
    const parentType = parentResult.rows[0]?.type_key
    if (parentType && !isValidChildType(parentType, input.typeKey)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A ${NODE_TYPE_MAP[input.typeKey]?.label ?? input.typeKey} cannot be created under a ${NODE_TYPE_MAP[parentType]?.label ?? parentType}`,
      })
    }
  }
  if (input.typeKey === 'branch' && input.parentId) {
    // Dedup check-then-insert isn't atomic on its own, and there's no unique
    // index backing "one branch per name per parent" (branch names aren't
    // unique across other type_keys, so a table-wide constraint isn't the
    // right fix). A Postgres advisory lock keyed on the exact dedup tuple
    // serializes concurrent creates for the *same* (parentId, 'branch', name)
    // without a schema change — pg_advisory_xact_lock auto-releases at
    // COMMIT/ROLLBACK. Without it, two concurrent creates could both pass
    // the dedup SELECT before either commits.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `branch:${input.parentId}:${input.name.trim().toLowerCase()}`,
    ])
    const dup = await client.query(
      `SELECT * FROM hierarchy_nodes WHERE parent_id=$1 AND type_key='branch' AND status='active' AND lower(trim(name))=lower(trim($2))`,
      [input.parentId, input.name],
    )
    if (dup.rows[0]) return toNode(dup.rows[0])
  }
  const siblingCount = input.parentId
    ? (await client.query(`SELECT COUNT(*)::int AS n FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [input.parentId])).rows[0].n
    : 0
  const result = await client.query(
    `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, sort_order, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.domain, input.typeKey, input.parentId, input.stateCode, input.name, siblingCount, input.metadata ?? {}],
  )
  return toNode(result.rows[0])
}
