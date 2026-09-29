import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { writeAuditLog } from '../lib/auditLog.js'
import { SYSTEM_BID_VIEWS, SYSTEM_BID_VIEW_KEYS } from '@goms/domain'

function toSavedView(row: any) {
  return {
    id: row.id, name: row.name, scope: row.scope, ownerEmail: row.owner_email, isSystem: false,
    filterRules: row.filter_rules, sort: row.sort, visibleColumns: row.visible_columns,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

const patchShape = z.object({
  name: z.string().min(1).optional(), filterRules: z.array(z.any()).optional(),
  sort: z.array(z.any()).optional(), visibleColumns: z.array(z.any()).optional(),
})

export const bidSavedViewsRouter = router({
  list: protectedReadProcedure.query(async ({ ctx }) => {
    const systemViews = SYSTEM_BID_VIEWS.map((v) => ({
      id: v.key, key: v.key, name: v.name, scope: 'global' as const, ownerEmail: null, isSystem: true,
      filterRules: v.filterRules, sort: [], visibleColumns: [], createdBy: null, createdAt: null, updatedAt: null,
    }))
    const email = ctx.user?.email ?? null
    const dbResult = email
      ? await pool.query('SELECT * FROM bid_saved_views WHERE scope=$1 OR owner_email=$2', ['global', email])
      : await pool.query('SELECT * FROM bid_saved_views WHERE scope=$1', ['global'])
    return [...systemViews, ...dbResult.rows.map(toSavedView)]
  }),

  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
    const result = await pool.query('SELECT * FROM bid_saved_views WHERE id=$1', [input.id])
    const row = result.rows[0]
    if (!row) return null
    // Review Focus (Task 19): enforce the exact same scope='global' OR
    // ownerEmail=self rule list() already does — a get-only leak here would
    // defeat list()'s filtering for anyone willing to guess/discover an id.
    const email = ctx.user?.email ?? null
    if (row.scope !== 'global' && row.owner_email !== email) return null
    return toSavedView(row)
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), scope: z.enum(['personal', 'global']), filterRules: z.array(z.any()).optional(), sort: z.array(z.any()).optional(), visibleColumns: z.array(z.any()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const ownerEmail = input.scope === 'personal' ? (ctx.user?.email ?? null) : null
      if (input.scope === 'personal' && !ownerEmail) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A personal view requires a signed-in user.' })
      }
      const result = await pool.query(
        `INSERT INTO bid_saved_views (name, scope, owner_email, filter_rules, sort, visible_columns, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.name, input.scope, ownerEmail, JSON.stringify(input.filterRules ?? []), JSON.stringify(input.sort ?? []), JSON.stringify(input.visibleColumns ?? []), ctx.user?.email ?? null],
      )
      if (input.scope === 'global') {
        // `pool` itself satisfies writeAuditLog's minimal `{query}` shape —
        // no transaction needed for a single best-effort log write, so no
        // client to acquire/release here.
        await writeAuditLog(pool, {
          entityType: 'bidSavedView', entityId: result.rows[0].id, field: 'name', oldValue: '', newValue: input.name,
          reason: '', action: 'create', changedBy: ctx.user?.email,
        }).catch(() => undefined) // best-effort logging, never blocks the create itself
      }
      return toSavedView(result.rows[0])
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), patch: patchShape }))
    .mutation(async ({ input, ctx }) => {
      if (SYSTEM_BID_VIEW_KEYS.has(input.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'System views cannot be modified.' })
      }
      const columnFor: Record<string, string> = { name: 'name', filterRules: 'filter_rules', sort: 'sort', visibleColumns: 'visible_columns' }
      const jsonFields = new Set(['filterRules', 'sort', 'visibleColumns'])
      const fields = Object.keys(input.patch)
      if (fields.length) {
        const values = fields.map((f) => (jsonFields.has(f) ? JSON.stringify((input.patch as any)[f]) : (input.patch as any)[f]))
        const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
        values.push(input.id)
        await pool.query(`UPDATE bid_saved_views SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
      }
      const result = await pool.query('SELECT * FROM bid_saved_views WHERE id=$1', [input.id])
      if (!result.rows[0]) throw new TRPCError({ code: 'NOT_FOUND' })
      await writeAuditLog(pool, {
        entityType: 'bidSavedView', entityId: input.id, field: 'patch', oldValue: '', newValue: JSON.stringify(input.patch),
        reason: '', action: 'update', changedBy: ctx.user?.email,
      }).catch(() => undefined)
      return toSavedView(result.rows[0])
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    if (SYSTEM_BID_VIEW_KEYS.has(input.id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'System views cannot be deleted.' })
    }
    await pool.query('DELETE FROM bid_saved_views WHERE id=$1', [input.id])
    await writeAuditLog(pool, {
      entityType: 'bidSavedView', entityId: input.id, field: 'name', oldValue: '', newValue: '',
      reason: '', action: 'delete', changedBy: ctx.user?.email,
    }).catch(() => undefined)
  }),
})
