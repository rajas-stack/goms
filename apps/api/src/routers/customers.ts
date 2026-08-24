import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

// pg returns TIMESTAMPTZ columns as Date objects; normalize to ISO strings so
// the wire contract (and expectedUpdatedAt round-tripping) is a plain string
// whether called via HTTP or in-process (e.g. createCaller in tests).
function serializeCustomer(row: any) {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

export const customersRouter = router({
  list: publicProcedure.query(() =>
    pool.query('SELECT * FROM customers ORDER BY name').then((r) => r.rows.map(serializeCustomer))
  ),
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) =>
      pool
        .query('SELECT * FROM customers WHERE id=$1', [input.id])
        .then((r) => serializeCustomer(r.rows[0]))
    ),
  create: publicProcedure
    .input(z.object({ name: z.string().min(1), notes: z.string().optional() }))
    .mutation(({ input }) =>
      pool
        .query('INSERT INTO customers (name, notes) VALUES ($1,$2) RETURNING *', [
          input.name,
          input.notes ?? null,
        ])
        .then((r) => serializeCustomer(r.rows[0]))
    ),
  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1),
        notes: z.string().optional(),
        expectedUpdatedAt: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `UPDATE customers SET name=$1, notes=$2, updated_at=now()
         WHERE id=$3 AND updated_at=$4 RETURNING *`,
        [input.name, input.notes ?? null, input.id, input.expectedUpdatedAt]
      )
      if (result.rowCount === 0) throw new TRPCError({ code: 'CONFLICT' })
      return serializeCustomer(result.rows[0])
    }),
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => pool.query('DELETE FROM customers WHERE id=$1', [input.id])),
})
