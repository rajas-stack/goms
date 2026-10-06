import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { buildOwnerMap, effectiveOwner, OWNABLE_ENTITY_MAP } from '@goms/domain'
import { loadOwnershipContext, toAssignment } from '../lib/ownershipContext.js'

export { loadOwnershipContext }

export const ownershipRouter = router({
  listAssignments: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM ownership_assignments ORDER BY start_date DESC')
    return result.rows.map(toAssignment)
  }),
  listFor: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        'SELECT * FROM ownership_assignments WHERE entity_type=$1 AND entity_id=$2 ORDER BY start_date DESC',
        [input.entityType, input.entityId],
      )
      return result.rows.map(toAssignment)
    }),
  listOwnedBy: protectedReadProcedure
    .input(z.object({ salesPersonId: z.string().uuid(), asOf: z.string() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT * FROM ownership_assignments
         WHERE sales_person_id=$1 AND start_date <= $2 AND (end_date IS NULL OR $2 < end_date)`,
        [input.salesPersonId, input.asOf],
      )
      return result.rows.map(toAssignment)
    }),
  resolveOwner: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string().uuid(), asOf: z.string() }))
    .query(async ({ input }) => {
      const { assignments, ctx } = await loadOwnershipContext()
      return effectiveOwner(assignments, input.entityType, input.entityId, input.asOf, ctx)
    }),
  resolveOwners: protectedReadProcedure
    .input(z.object({ entityType: z.string(), entityIds: z.array(z.string().uuid()), asOf: z.string() }))
    .query(async ({ input }) => {
      const { assignments, ctx } = await loadOwnershipContext()
      const map = buildOwnerMap(assignments, input.entityType, input.entityIds, input.asOf, ctx)
      return Object.fromEntries(map)
    }),
  assign: protectedProcedure
    .input(z.object({
      entityType: z.string(), entityId: z.string().uuid(), salesPersonId: z.string().uuid(),
      role: z.string().optional(), startDate: z.string(), endDate: z.string().nullable().optional(),
      reason: z.enum(['initial', 'transfer', 'delegation', 'reassignment', 'correction']).optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const role = input.role ?? 'owner'
      if (!OWNABLE_ENTITY_MAP[input.entityType]) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not an ownable entity type: ${input.entityType}` })
      }
      if (role === 'delegate' && !input.endDate) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A delegation must have an end date' })
      }
      if (input.endDate && input.endDate <= input.startDate) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'An assignment cannot end on or before it starts' })
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const person = (await client.query('SELECT id FROM sales_persons WHERE id=$1', [input.salesPersonId])).rows[0]
        if (!person) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such salesperson: ${input.salesPersonId}` })

        // One open owner per entity. Reassigning closes the incumbent at the
        // new start date, which keeps the two intervals exactly adjacent —
        // no gap, no overlap — because the end is exclusive.
        if (role === 'owner') {
          const openOwners = (await client.query(
            `SELECT * FROM ownership_assignments
             WHERE entity_type=$1 AND entity_id=$2 AND role='owner' AND end_date IS NULL FOR UPDATE`,
            [input.entityType, input.entityId],
          )).rows
          for (const a of openOwners) {
            if (input.startDate <= a.start_date) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `The current owner's assignment starts on ${a.start_date}; a replacement must start after that.`,
              })
            }
          }
          for (const a of openOwners) {
            await client.query('UPDATE ownership_assignments SET end_date=$1 WHERE id=$2', [input.startDate, a.id])
          }
        }

        const result = await client.query(
          `INSERT INTO ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date, reason, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            input.entityType, input.entityId, input.salesPersonId, role, input.startDate,
            input.endDate ?? null, input.reason ?? 'initial', input.note ?? '',
          ],
        )
        await client.query('COMMIT')
        return toAssignment(result.rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        // The FOR UPDATE above only locks existing open-owner rows — it
        // locks nothing when this is the entity's first-ever assignment, so
        // two concurrent `assign` calls for the same never-before-owned
        // entity can both pass the check above and both attempt this
        // INSERT. ownership_assignments_one_open_owner_per_entity (see the
        // 2026-08-26 migration) stops the second one from landing; this
        // just gives its loser a friendly message instead of a raw 23505.
        if (isUniqueViolation(e)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This entity already has an open owner — refresh and try again.' })
        }
        throw e
      } finally {
        client.release()
      }
    }),
  end: protectedProcedure
    .input(z.object({ id: z.string().uuid(), endDate: z.string() }))
    .mutation(async ({ input }) => {
      const a = (await pool.query('SELECT * FROM ownership_assignments WHERE id=$1', [input.id])).rows[0]
      if (!a) return
      if (input.endDate <= a.start_date) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'An assignment cannot end on or before it starts' })
      }
      await pool.query('UPDATE ownership_assignments SET end_date=$1 WHERE id=$2', [input.endDate, input.id])
    }),
  transferBookOfBusiness: protectedProcedure
    .input(z.object({
      fromSalesPersonId: z.string().uuid(), toSalesPersonId: z.string().uuid(),
      effectiveDate: z.string(), note: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.toSalesPersonId === input.fromSalesPersonId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot transfer a book of business to the same person' })
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const from = (await client.query('SELECT id FROM sales_persons WHERE id=$1', [input.fromSalesPersonId])).rows[0]
        if (!from) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such salesperson: ${input.fromSalesPersonId}` })
        const to = (await client.query('SELECT id FROM sales_persons WHERE id=$1', [input.toSalesPersonId])).rows[0]
        if (!to) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such salesperson: ${input.toSalesPersonId}` })

        // Only currently-open owner rows that actually started before the
        // handoff — an assignment that starts on or after it can't be closed
        // by it without violating the half-open-interval invariant, so it's
        // left alone rather than silently failing the whole batch.
        const open = (await client.query(
          `SELECT * FROM ownership_assignments
           WHERE sales_person_id=$1 AND role='owner' AND end_date IS NULL AND start_date < $2 FOR UPDATE`,
          [input.fromSalesPersonId, input.effectiveDate],
        )).rows

        const batchId = crypto.randomUUID()
        const created: any[] = []
        for (const a of open) {
          await client.query('UPDATE ownership_assignments SET end_date=$1 WHERE id=$2', [input.effectiveDate, a.id])
          const result = await client.query(
            `INSERT INTO ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date, reason, batch_id, note)
             VALUES ($1,$2,$3,'owner',$4,NULL,'transfer',$5,$6) RETURNING *`,
            [a.entity_type, a.entity_id, input.toSalesPersonId, input.effectiveDate, batchId, input.note ?? ''],
          )
          created.push(toAssignment(result.rows[0]))
        }
        await client.query('COMMIT')
        return created
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
