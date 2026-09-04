import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, protectedProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

// Maps the DB row (snake_case, TIMESTAMPTZ) onto the frontend's `Customer`
// shape (camelCase, plain ISO-string timestamps) — see src/lib/types.ts:356.
function toCustomer(row: any) {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    address: row.address,
    gst: row.gst,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const patchShape = {
  name: z.string().min(1).optional(),
  organization: z.string().optional(),
  address: z.string().optional(),
  gst: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
}

export const customersRouter = router({
  list: publicProcedure.query(() =>
    pool.query('SELECT * FROM customers ORDER BY name').then((r) => r.rows.map(toCustomer))
  ),
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM customers WHERE id=$1', [input.id])
      return result.rows[0] ? toCustomer(result.rows[0]) : null
    }),
  create: protectedProcedure
    .input(z.object({ ...patchShape, name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `INSERT INTO customers (name, organization, address, gst, contact_name, contact_email, contact_phone, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.name,
          input.organization ?? '',
          input.address ?? '',
          input.gst ?? '',
          input.contactName ?? '',
          input.contactEmail ?? '',
          input.contactPhone ?? '',
          input.notes ?? '',
        ]
      )
      return toCustomer(result.rows[0])
    }),
  // `expectedUpdatedAt` is optional — a caller that read the row first and
  // passes back `patch.updatedAt` gets an optimistic-concurrency CONFLICT on
  // a stale write; omitting it (as InMemoryRepository callers implicitly do
  // today) just overwrites, matching existing behavior.
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(patchShape), expectedUpdatedAt: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { id, patch, expectedUpdatedAt } = input
      const fields = Object.keys(patch) as Array<keyof typeof patch>
      const columnFor: Record<string, string> = {
        name: 'name', organization: 'organization', address: 'address', gst: 'gst',
        contactName: 'contact_name', contactEmail: 'contact_email', contactPhone: 'contact_phone', notes: 'notes',
      }
      const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
      const values = fields.map((f) => patch[f])
      let query = `UPDATE customers SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${fields.length + 1}`
      values.push(id)
      if (expectedUpdatedAt) {
        query += ` AND updated_at=$${fields.length + 2}`
        values.push(expectedUpdatedAt)
      }
      query += ' RETURNING *'
      const result = await pool.query(query, values)
      if (result.rowCount === 0) throw new TRPCError({ code: 'CONFLICT' })
      return toCustomer(result.rows[0])
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => pool.query('DELETE FROM customers WHERE id=$1', [input.id]).then(() => undefined)),
})
