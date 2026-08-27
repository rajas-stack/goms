import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation } from '../db-errors.js'
import { NODE_TYPE_MAP, POSTING_TYPES, childTypesOf, type HierNode } from '@goms/domain'

// Maps the DB row (snake_case) onto the frontend's `HierNode` shape
// (camelCase) — see src/lib/types.ts (re-exported from packages/domain).
// Explicit return type avoids a circular-inference error where tRPC's
// procedure-output inference and ReturnType<typeof toNode> (used by
// `breadcrumb` below) would otherwise depend on each other.
function toNode(row: any): HierNode {
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

const domainSchema = z.enum(['geo', 'org', 'sales'])

// `executor` defaults to the shared pool but accepts a checked-out
// transaction `client` too — moveNode (below) needs subtree lookups to run
// inside its own transaction, after locking the rows involved, rather than
// as a separate un-transacted round trip.
export async function subtreeIds(id: string, executor: { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> } = pool): Promise<string[]> {
  const result = await executor.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM hierarchy_nodes WHERE id = $1
       UNION ALL
       SELECT n.id FROM hierarchy_nodes n JOIN subtree s ON n.parent_id = s.id
     )
     SELECT id FROM subtree`,
    [id],
  )
  return result.rows.map((r) => r.id)
}

async function activeChildren(parentId: string) {
  const result = await pool.query(
    `SELECT * FROM hierarchy_nodes WHERE parent_id = $1 AND status = 'active' ORDER BY sort_order`,
    [parentId],
  )
  return result.rows.map(toNode)
}

async function fetchBreadcrumb(id: string): Promise<HierNode[]> {
  const chain: HierNode[] = []
  let curId: string | null = id
  while (curId) {
    const lookupId: string = curId
    const result: { rows: any[] } = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id = $1`, [lookupId])
    const row: any = result.rows[0]
    if (!row) break
    chain.unshift(toNode(row))
    curId = row.parent_id as string | null
  }
  return chain
}

export const hierarchyRouter = router({
  listStates: publicProcedure.query(async () => {
    const states = (await pool.query(`SELECT * FROM hierarchy_nodes WHERE type_key = 'state'`)).rows.map(toNode)
    const out = []
    for (const s of states) {
      const orgUnder = (await pool.query(
        `SELECT * FROM hierarchy_nodes WHERE domain = 'org' AND state_code = $1`,
        [s.stateCode],
      )).rows.map(toNode)
      const employeeCount = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM employees e JOIN hierarchy_nodes n ON n.id = e.org_node_id
         WHERE n.domain='org' AND n.state_code=$1 AND e.status='active' AND e.vacant=false`,
        [s.stateCode],
      )).rows[0].n
      out.push({
        // A 'state' node always carries a stateCode by app convention
        // (matching InMemoryRepository's own `s.stateCode!` non-null
        // assertion for this exact case).
        code: s.stateCode as number,
        name: s.name,
        departments: orgUnder.filter((n: any) => n.typeKey === 'department').length,
        offices: orgUnder.filter((n: any) => n.typeKey === 'office').length,
        employees: employeeCount,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }),

  getState: publicProcedure.input(z.object({ code: z.number() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT * FROM hierarchy_nodes WHERE type_key = 'state' AND state_code = $1`, [input.code])
    return result.rows[0] ? toNode(result.rows[0]) : null
  }),

  getNode: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id = $1`, [input.id])
    return result.rows[0] ? toNode(result.rows[0]) : null
  }),

  listChildren: publicProcedure.input(z.object({ parentId: z.string().uuid() })).query(({ input }) =>
    activeChildren(input.parentId)
  ),

  listOrgRoots: publicProcedure.input(z.object({ stateCode: z.number() })).query(async ({ input }) => {
    const result = await pool.query(
      `SELECT * FROM hierarchy_nodes WHERE domain='org' AND type_key='department' AND state_code=$1 AND status='active' ORDER BY sort_order`,
      [input.stateCode],
    )
    return result.rows.map(toNode)
  }),

  listDepartments: publicProcedure.query(async () => {
    const result = await pool.query(
      `SELECT * FROM hierarchy_nodes WHERE domain='org' AND type_key='department' AND status='active'
       ORDER BY COALESCE(state_code, 0), name`,
    )
    return result.rows.map(toNode)
  }),

  listPostingNodes: publicProcedure.input(z.object({ stateCode: z.number() })).query(async ({ input }) => {
    const result = await pool.query(
      `SELECT * FROM hierarchy_nodes
       WHERE domain='org' AND type_key = ANY($1) AND state_code=$2 AND status='active' ORDER BY name`,
      [Array.from(POSTING_TYPES), input.stateCode],
    )
    return result.rows.map(toNode)
  }),

  breadcrumb: publicProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) =>
    fetchBreadcrumb(input.id)
  ),

  childCount: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [input.id])
    return result.rows[0].n
  }),

  geoRoot: publicProcedure.query(async () => {
    const result = await pool.query(`SELECT * FROM hierarchy_nodes WHERE type_key='country'`)
    return result.rows[0] ? toNode(result.rows[0]) : null
  }),

  childCounts: publicProcedure.input(z.object({ parentId: z.string().uuid() })).query(async ({ input }) => {
    const children = await activeChildren(input.parentId)
    const out: Record<string, number> = {}
    for (const c of children) {
      const result = await pool.query(`SELECT COUNT(*)::int AS n FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [c.id])
      out[c.id] = result.rows[0].n
    }
    return out
  }),

  createNode: publicProcedure
    .input(z.object({
      domain: domainSchema, typeKey: z.string().min(1), parentId: z.string().uuid().nullable(),
      stateCode: z.number().int().nullable(), name: z.string().min(1), metadata: z.record(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.typeKey === 'branch' && input.parentId) {
        // Dedup check-then-insert isn't atomic on its own, and there's no
        // unique index backing "one branch per name per parent" (branch
        // names aren't unique across other type_keys, so a table-wide
        // constraint isn't the right fix). A Postgres advisory lock keyed
        // on the exact dedup tuple serializes concurrent createNode calls
        // for the *same* (parentId, 'branch', name) without needing a
        // schema change — pg_advisory_xact_lock auto-releases at
        // COMMIT/ROLLBACK, so no separate unlock call is needed. Without
        // this, two concurrent creates for the same branch name under the
        // same parent could both pass the dedup SELECT before either
        // commits, producing two identically-named branch nodes.
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `branch:${input.parentId}:${input.name.trim().toLowerCase()}`,
          ])
          const dup = await client.query(
            `SELECT * FROM hierarchy_nodes WHERE parent_id=$1 AND type_key='branch' AND status='active' AND lower(trim(name))=lower(trim($2))`,
            [input.parentId, input.name],
          )
          if (dup.rows[0]) {
            await client.query('COMMIT')
            return toNode(dup.rows[0])
          }
          const siblingCount = (await client.query(
            `SELECT COUNT(*)::int AS n FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [input.parentId],
          )).rows[0].n
          const result = await client.query(
            `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, sort_order, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [input.domain, input.typeKey, input.parentId, input.stateCode, input.name, siblingCount, input.metadata ?? {}],
          )
          await client.query('COMMIT')
          return toNode(result.rows[0])
        } catch (e) {
          await client.query('ROLLBACK')
          throw e
        } finally {
          client.release()
        }
      }
      const siblingCount = input.parentId
        ? (await pool.query(`SELECT COUNT(*)::int AS n FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [input.parentId])).rows[0].n
        : 0
      const result = await pool.query(
        `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, sort_order, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.domain, input.typeKey, input.parentId, input.stateCode, input.name, siblingCount, input.metadata ?? {}],
      )
      return toNode(result.rows[0])
    }),

  updateNode: publicProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object({ name: z.string().min(1).optional(), metadata: z.record(z.string()).optional() }) }))
    .mutation(async ({ input }) => {
      const sets: string[] = []
      const values: any[] = []
      if (input.patch.name !== undefined) { values.push(input.patch.name); sets.push(`name=$${values.length}`) }
      if (input.patch.metadata !== undefined) { values.push(input.patch.metadata); sets.push(`metadata=$${values.length}`) }
      values.push(input.id)
      const result = await pool.query(
        `UPDATE hierarchy_nodes SET ${[...sets, 'updated_at=now()'].join(', ')} WHERE id=$${values.length} RETURNING *`,
        values,
      )
      return toNode(result.rows[0])
    }),

  setNodeStatus: publicProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(['active', 'archived']) }))
    .mutation(async ({ input }) => {
      const ids = await subtreeIds(input.id)
      await pool.query(`UPDATE hierarchy_nodes SET status=$1, updated_at=now() WHERE id = ANY($2)`, [input.status, ids])
    }),

  deleteNode: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const ids = await subtreeIds(input.id)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM employees WHERE org_node_id = ANY($1)`, [ids])
      // Opportunities used to live inside the node's own metadata, so they
      // died with it automatically. Now they're a separate table keyed by
      // department_id, so a node delete has to cascade to them explicitly —
      // stage_changes cascades via FK once the opportunity rows are gone.
      await client.query(`DELETE FROM opportunities WHERE department_id = ANY($1)`, [ids])
      await client.query(`DELETE FROM hierarchy_nodes WHERE id = ANY($1)`, [ids])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      // Deleting a subtree containing a node any `transfers.to_org_node_id`
      // (RESTRICT) or `commercial_boqs.department_id` (RESTRICT) still
      // points at is rejected by the DB either way — this only replaces the
      // raw, unhandled 23503 with a friendly message.
      if (isForeignKeyViolation(e)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this node — it is still referenced elsewhere (e.g. a past transfer or an existing BOQ).' })
      }
      throw e
    } finally {
      client.release()
    }
  }),

  moveNode: publicProcedure
    .input(z.object({ id: z.string().uuid(), newParentId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        if (input.newParentId) {
          // Locks both the node being moved and its prospective new parent,
          // in a stable (sorted) order so two concurrent moveNode calls
          // touching the same two nodes can't deadlock each other. Without
          // this lock, two concurrent calls swapping two nodes' parents
          // (A: move X under Y; B, at the same instant: move Y under X)
          // can each pass the cycle check below before the other commits —
          // both checks see a pre-move snapshot, both pass, and both
          // UPDATEs land, producing a real parent_id cycle with no
          // constraint to catch it afterward.
          const lockIds = [input.id, input.newParentId].sort()
          await client.query('SELECT id FROM hierarchy_nodes WHERE id = ANY($1) ORDER BY id FOR UPDATE', [lockIds])
          const ids = await subtreeIds(input.id, client)
          if (ids.includes(input.newParentId)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot move a node into its own subtree' })
          }
        }
        await client.query(`UPDATE hierarchy_nodes SET parent_id=$1, updated_at=now() WHERE id=$2`, [input.newParentId, input.id])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  duplicateNode: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const ids = await subtreeIds(input.id)
    const rows = (await pool.query(`SELECT * FROM hierarchy_nodes WHERE id = ANY($1)`, [ids])).rows
    const idMap = new Map<string, string>()
    for (const r of rows) idMap.set(r.id, crypto.randomUUID())
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const r of rows) {
        const newId = idMap.get(r.id)!
        const newParentId = r.id === input.id ? r.parent_id : (idMap.get(r.parent_id) ?? r.parent_id)
        const newName = r.id === input.id ? `${r.name} (Copy)` : r.name
        await client.query(
          `INSERT INTO hierarchy_nodes (id, domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [newId, r.domain, r.type_key, newParentId, r.state_code, newName, r.code, r.sort_order, r.metadata, r.status],
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    const cloneRoot = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id=$1`, [idMap.get(input.id)])
    return toNode(cloneRoot.rows[0])
  }),

  importChildren: publicProcedure
    .input(z.object({ parentId: z.string().uuid(), rows: z.array(z.object({ name: z.string(), type: z.string().optional() })) }))
    .mutation(async ({ input }) => {
      const parentResult = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id=$1`, [input.parentId])
      const parent = parentResult.rows[0]
      if (!parent) return 0
      const validTypes = childTypesOf(parent.type_key)
      const defaultType = NODE_TYPE_MAP[parent.type_key]?.childKeys[0] ?? 'district'

      const existingChildren = (await pool.query(
        `SELECT type_key, name FROM hierarchy_nodes WHERE parent_id=$1 AND status='active'`, [input.parentId],
      )).rows
      let siblingCount = existingChildren.length
      // Mirrors createNode's branch-name dedup rule above — this procedure
      // used to bypass it entirely by inserting directly instead of going
      // through createNode, so a CSV import containing a name that
      // duplicates an existing active branch (or another row earlier in the
      // same import) silently created a genuine duplicate node instead of
      // being a safe no-op the way one createNode call would be.
      const existingBranchNames = new Set<string>(
        existingChildren.filter((c: any) => c.type_key === 'branch').map((c: any) => String(c.name).trim().toLowerCase()),
      )

      const toInsert: { typeKey: string; name: string; sortOrder: number }[] = []
      for (const row of input.rows) {
        const trimmed = row.name.trim()
        if (!trimmed) continue
        const matched = row.type ? validTypes.find((t) => t.label.toLowerCase() === row.type!.trim().toLowerCase()) : undefined
        const typeKey = matched?.key ?? defaultType
        if (typeKey === 'branch') {
          const key = trimmed.toLowerCase()
          if (existingBranchNames.has(key)) continue
          existingBranchNames.add(key)
        }
        toInsert.push({ typeKey, name: trimmed, sortOrder: siblingCount })
        siblingCount += 1
      }
      if (!toInsert.length) return 0

      // One multi-row INSERT instead of one round trip per row (also drops
      // the previous version's redundant per-row siblingCount re-SELECT —
      // tracked locally above instead, since this procedure is now the only
      // writer touching this parent's children for the duration of the call).
      const params: any[] = [parent.domain, input.parentId, parent.state_code]
      const valueRows = toInsert.map((r) => {
        params.push(r.typeKey, r.name, r.sortOrder)
        const n = params.length
        return `($1,$${n - 2},$2,$3,$${n - 1},$${n},'{}')`
      })
      await pool.query(
        `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, sort_order, metadata)
         VALUES ${valueRows.join(', ')}`,
        params,
      )
      return toInsert.length
    }),

  moveTargets: publicProcedure.input(z.object({ nodeId: z.string().uuid() })).query(async ({ input }) => {
    const nodeResult = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id=$1`, [input.nodeId])
    const node = nodeResult.rows[0]
    if (!node) return []
    const banned = new Set(await subtreeIds(input.nodeId))
    const candidates = (await pool.query(
      `SELECT * FROM hierarchy_nodes WHERE domain=$1 AND state_code IS NOT DISTINCT FROM $2 AND status='active'`,
      [node.domain, node.state_code],
    )).rows
    return candidates
      .filter((c) => !banned.has(c.id))
      .filter((c) => {
        const allowed = NODE_TYPE_MAP[c.type_key]?.childKeys ?? []
        return allowed.length === 0 || allowed.includes(node.type_key)
      })
      .map(toNode)
  }),

  reorderNode: publicProcedure
    .input(z.object({ id: z.string().uuid(), beforeId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      const nodeResult = await pool.query(`SELECT * FROM hierarchy_nodes WHERE id=$1`, [input.id])
      const node = nodeResult.rows[0]
      if (!node) return
      const siblings = (await pool.query(
        `SELECT * FROM hierarchy_nodes WHERE parent_id IS NOT DISTINCT FROM $1 AND status='active' ORDER BY sort_order, name`,
        [node.parent_id],
      )).rows
      const ordered = siblings.filter((n) => n.id !== input.id)
      const idx = input.beforeId ? ordered.findIndex((n) => n.id === input.beforeId) : -1
      if (idx >= 0) ordered.splice(idx, 0, node)
      else ordered.push(node)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (let i = 0; i < ordered.length; i++) {
          await client.query(`UPDATE hierarchy_nodes SET sort_order=$1 WHERE id=$2`, [i, ordered[i].id])
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
