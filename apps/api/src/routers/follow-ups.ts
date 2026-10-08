import { z } from 'zod'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

function toFollowUp(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, assigneeId: row.assignee_id,
    dueDate: row.due_date, status: row.status, note: row.note, createdAt: row.created_at, createdBy: null,
  }
}

export const followUpsRouter = router({
  listForEntity: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        'SELECT * FROM follow_ups WHERE entity_type=$1 AND entity_id=$2 ORDER BY due_date',
        [input.entityType, input.entityId],
      )
      return result.rows.map(toFollowUp)
    }),
  listOpen: protectedReadProcedure.query(async () => {
    const result = await pool.query(`SELECT * FROM follow_ups WHERE status='open' ORDER BY due_date`)
    return result.rows.map(toFollowUp)
  }),
  create: protectedProcedure
    .input(z.object({
      entityType: z.string(), entityId: z.string().uuid(), dueDate: z.string(),
      note: z.string().optional(), assigneeId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await pool.query(
        `INSERT INTO follow_ups (entity_type, entity_id, assignee_id, due_date, status, note, created_by)
         VALUES ($1,$2,$3,$4,'open',$5,$6) RETURNING *`,
        [input.entityType, input.entityId, input.assigneeId ?? null, input.dueDate, input.note ?? '', ctx.user?.email?.trim().toLowerCase() ?? null],
      )
      return toFollowUp(result.rows[0])
    }),
  setStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(['open', 'done', 'cancelled']) }))
    .mutation(({ input }) =>
      pool.query('UPDATE follow_ups SET status=$1 WHERE id=$2', [input.status, input.id]).then(() => undefined)
    ),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) =>
    pool.query('DELETE FROM follow_ups WHERE id=$1', [input.id]).then(() => undefined)
  ),
})
