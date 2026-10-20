import {
  RBAC_NODE_MANIFEST, expandDynamicNodes, resolveMyAccess, subjectKey, syncNodeList, toGrantMap,
  type RbacAction, type RbacEffect, type RbacGrant, type RbacGrantMap, type RbacMyAccess, type RbacNode, type RbacNodeKind,
  type RbacSubjectRef, type RbacSyncResult,
} from '@goms/domain'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { writeAuditLog } from './auditLog.js'

/** Permission-tree changes are audited under this entity; the generic audit feed excludes it (lib/auditLog.ts). */
export { RBAC_TREE_AUDIT_ENTITY as RBAC_TREE_ENTITY } from './auditLog.js'
import { RBAC_TREE_AUDIT_ENTITY as RBAC_TREE_ENTITY } from './auditLog.js'

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }

const toNode = (r: any): RbacNode => ({
  id: r.id, parentId: r.parent_id ?? null, label: r.label, kind: r.kind as RbacNodeKind, actions: (r.actions ?? []) as RbacAction[],
  order: Number(r.sort_order ?? 0), ...(r.dynamic ? { dynamic: r.dynamic } : {}), retired: !!r.retired_at, runtime: false,
})

export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Upserts every manifest node, retires missing ones and restores reappearing ones. Grants are never touched. Serialised
 *  with an advisory lock so concurrently booting instances do not race. */
export async function syncRbacNodes(actor: string | null): Promise<RbacSyncResult> {
  return inTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('rbac_nodes_sync'))`)
    const stored = (await client.query('SELECT * FROM rbac_nodes')).rows.map(toNode)
    const { nodes, result } = syncNodeList(stored, RBAC_NODE_MANIFEST)
    const live = nodes.filter((n) => !n.retired)
    if (live.length > 0) {
      await client.query(
        `INSERT INTO rbac_nodes (id, parent_id, label, kind, actions, sort_order, dynamic, retired_at)
         SELECT n.id, n.parent_id, n.label, n.kind, string_to_array(n.actions, ','), n.sort_order, n.dynamic::jsonb, NULL
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[])
           AS n(id, parent_id, label, kind, actions, sort_order, dynamic)
         ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, label = EXCLUDED.label, kind = EXCLUDED.kind,
           actions = EXCLUDED.actions, sort_order = EXCLUDED.sort_order, dynamic = EXCLUDED.dynamic, retired_at = NULL, updated_at = now()
         WHERE (rbac_nodes.parent_id, rbac_nodes.label, rbac_nodes.kind, rbac_nodes.actions, rbac_nodes.sort_order, rbac_nodes.dynamic, rbac_nodes.retired_at)
           IS DISTINCT FROM (EXCLUDED.parent_id, EXCLUDED.label, EXCLUDED.kind, EXCLUDED.actions, EXCLUDED.sort_order, EXCLUDED.dynamic, NULL::timestamptz)`,
        [live.map((n) => n.id), live.map((n) => n.parentId), live.map((n) => n.label), live.map((n) => n.kind),
          live.map((n) => n.actions.join(',')), live.map((n) => n.order), live.map((n) => (n.dynamic ? JSON.stringify(n.dynamic) : null))],
      )
    }
    await client.query(`UPDATE rbac_nodes SET retired_at = now() WHERE retired_at IS NULL AND NOT (id = ANY($1::text[]))`, [live.map((n) => n.id)])
    if (result.added + result.updated + result.retired + result.restored > 0) {
      await writeAuditLog(client, {
        entityType: RBAC_TREE_ENTITY, entityId: 'nodes', field: 'sync', oldValue: '', newValue: JSON.stringify(result), reason: '', action: 'sync', changedBy: actor,
      })
    }
    return result
  })
}

/** Stored nodes plus the saved-view children of each Views node. */
export async function loadRbacNodes(db: Queryable = pool): Promise<RbacNode[]> {
  const nodes = (await db.query('SELECT * FROM rbac_nodes ORDER BY sort_order, id')).rows.map(toNode)
  const views = (await db.query('SELECT id, name, sheet FROM bid_saved_views')).rows.map((r) => ({ id: String(r.id), name: r.name, sheet: r.sheet ?? 'bidTracker' }))
  return expandDynamicNodes(nodes, views)
}

const toGrant = (r: any): RbacGrant => ({ nodeId: r.node_id, action: r.action as RbacAction, effect: r.effect as RbacEffect })

export async function loadGrants(subject: RbacSubjectRef, db: Queryable = pool): Promise<RbacGrant[]> {
  const { rows } = await db.query('SELECT node_id, action, effect FROM rbac_grants WHERE subject_type=$1 AND subject_id=$2 ORDER BY node_id, action', [subject.type, subject.id])
  return rows.map(toGrant)
}

export async function linkedTemplate(subject: RbacSubjectRef, db: Queryable = pool): Promise<string | null> {
  if (subject.type === 'template') return null
  const { rows } = await db.query('SELECT template_id FROM rbac_template_links WHERE subject_type=$1 AND subject_id=$2', [subject.type, subject.id])
  return rows[0]?.template_id ?? null
}

/** Writes one subject's cell changes and audits each one (old → new, '' = inherit). Unchanged cells write nothing. */
export async function writeGrantChanges(
  client: PoolClient, subject: RbacSubjectRef, changes: readonly { nodeId: string; action: RbacAction; value: RbacEffect | 'inherit' }[], actor: string | null,
): Promise<number> {
  const before = toGrantMap(await loadGrants(subject, client))
  let written = 0
  for (const { nodeId, action, value } of changes) {
    const old = before[nodeId]?.[action] ?? 'inherit'
    if (old === value) continue
    if (value === 'inherit') {
      await client.query('DELETE FROM rbac_grants WHERE subject_type=$1 AND subject_id=$2 AND node_id=$3 AND action=$4', [subject.type, subject.id, nodeId, action])
    } else {
      await client.query(
        `INSERT INTO rbac_grants (subject_type, subject_id, node_id, action, effect, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (subject_type, subject_id, node_id, action) DO UPDATE SET effect = EXCLUDED.effect, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [subject.type, subject.id, nodeId, action, value, actor],
      )
    }
    await writeAuditLog(client, {
      entityType: RBAC_TREE_ENTITY, entityId: subjectKey(subject), field: `${nodeId}#${action}`,
      oldValue: old === 'inherit' ? '' : old, newValue: value === 'inherit' ? '' : value, reason: '', action: 'update', changedBy: actor,
    })
    written++
  }
  return written
}

export async function auditTree(client: PoolClient, entityId: string, field: string, oldValue: string, newValue: string, action: string, actor: string | null) {
  await writeAuditLog(client, { entityType: RBAC_TREE_ENTITY, entityId, field, oldValue, newValue, reason: '', action, changedBy: actor })
}

// --- the caller's resolved tree --------------------------------------------------------------------------------------

const CACHE_MS = 30_000
const cache = new Map<string, { at: number; value: RbacMyAccess }>()
export const clearRbacTreeCache = (): void => cache.clear()

async function grantMaps(type: 'role' | 'user' | 'template', ids: readonly string[]): Promise<RbacGrantMap[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query('SELECT subject_id, node_id, action, effect FROM rbac_grants WHERE subject_type=$1 AND subject_id = ANY($2::text[])', [type, ids])
  return ids.map((id) => toGrantMap(rows.filter((r) => r.subject_id === id).map(toGrant)))
}

/** Resolves the tree for one person: their own overrides, their roles (functional from the server policy + custom by
 *  membership), and the templates linked to them or to any of those roles. Cached per email. */
export async function resolveForEmail(email: string, functionalRoles: readonly string[], fresh = false): Promise<RbacMyAccess> {
  const mail = email.toLowerCase()
  const hit = cache.get(mail)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const custom = (await pool.query('SELECT role_id FROM rbac_custom_role_members WHERE email=$1', [mail])).rows.map((r) => `custom:${r.role_id}`)
  const roleIds = [...functionalRoles, ...custom]
  const links = (await pool.query(
    `SELECT DISTINCT template_id::text AS id FROM rbac_template_links WHERE (subject_type='user' AND subject_id=$1) OR (subject_type='role' AND subject_id = ANY($2::text[]))`,
    [mail, roleIds],
  )).rows.map((r) => r.id as string)
  const [user] = await grantMaps('user', [mail])
  const roles = await grantMaps('role', roleIds)
  const templates = await grantMaps('template', links)
  const anyGrant = [user, ...roles, ...templates].some((m) => Object.keys(m).length > 0)
  const value = anyGrant
    ? resolveMyAccess({ nodes: await loadRbacNodes(), user, roles, templates })
    : { configured: false, allowed: {} }
  cache.set(mail, { at: Date.now(), value })
  return value
}
