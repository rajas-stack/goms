import { z } from 'zod'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { writeAuditLog } from '../lib/auditLog.js'

function toProtectedValue(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, fieldKey: row.field_key,
    frozen: row.frozen, frozenAt: row.frozen_at, frozenBy: row.frozen_by,
  }
}

export const protectedValuesRouter = router({
  listFor: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        'SELECT * FROM protected_values WHERE entity_type=$1 AND entity_id=$2', [input.entityType, input.entityId],
      )
      return result.rows.map(toProtectedValue)
    }),

  freeze: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid(), fieldKey: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen, frozen_at, frozen_by)
           VALUES ($1,$2,$3,true,now(),$4)
           ON CONFLICT (entity_type, entity_id, field_key)
           DO UPDATE SET frozen=true, frozen_at=now(), frozen_by=$4`,
          [input.entityType, input.entityId, input.fieldKey, ctx.user?.email ?? null],
        )
        await writeAuditLog(client, {
          entityType: input.entityType, entityId: input.entityId, field: input.fieldKey,
          oldValue: 'unfrozen', newValue: 'frozen', reason: '', action: 'freeze', changedBy: ctx.user?.email,
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  unfreeze: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid(), fieldKey: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen)
           VALUES ($1,$2,$3,false)
           ON CONFLICT (entity_type, entity_id, field_key) DO UPDATE SET frozen=false`,
          [input.entityType, input.entityId, input.fieldKey],
        )
        await writeAuditLog(client, {
          entityType: input.entityType, entityId: input.entityId, field: input.fieldKey,
          oldValue: 'frozen', newValue: 'unfrozen', reason: input.reason, action: 'unfreeze', changedBy: ctx.user?.email,
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
