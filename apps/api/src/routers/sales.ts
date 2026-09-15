import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation } from '../db-errors.js'
import { tierRank } from '@goms/domain'

function toSalesPerson(row: any) {
  return {
    id: row.id, employeeCode: row.employee_code, name: row.name, officialEmail: row.official_email,
    personalEmail: row.personal_email, mobile: row.mobile, altMobile: row.alt_mobile,
    joinedOn: row.joined_on, leftOn: row.left_on, status: row.status, notes: row.notes,
    metadata: row.metadata, createdAt: row.created_at.toISOString(), createdBy: null,
  }
}

function toSalesPosting(row: any) {
  return {
    id: row.id, salesPersonId: row.sales_person_id, designation: row.designation, tierKey: row.tier_key,
    managerId: row.manager_id, gmOverrideId: row.gm_override_id, office: row.office, startDate: row.start_date,
    endDate: row.end_date, changeType: row.change_type, reason: row.reason,
    createdAt: row.created_at.toISOString(), createdBy: null,
  }
}

const statusSchema = z.enum(['active', 'onLeave', 'resigned', 'inactive'])
const personPatchShape = {
  employeeCode: z.string().optional(), name: z.string().min(1).optional(), officialEmail: z.string().optional(),
  personalEmail: z.string().optional(), mobile: z.string().optional(), altMobile: z.string().optional(),
  joinedOn: z.string().nullable().optional(), leftOn: z.string().nullable().optional(),
  status: statusSchema.optional(), notes: z.string().optional(), metadata: z.record(z.string()).optional(),
}
const personColumnFor: Record<string, string> = {
  employeeCode: 'employee_code', name: 'name', officialEmail: 'official_email', personalEmail: 'personal_email',
  mobile: 'mobile', altMobile: 'alt_mobile', joinedOn: 'joined_on', leftOn: 'left_on',
  status: 'status', notes: 'notes', metadata: 'metadata',
}
const personJsonColumns = new Set(['metadata'])

async function onePerson(id: string) {
  const result = await pool.query('SELECT * FROM sales_persons WHERE id=$1', [id])
  return result.rows[0] ? toSalesPerson(result.rows[0]) : null
}

export const salesRouter = router({
  listPersons: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM sales_persons ORDER BY name')
    return result.rows.map(toSalesPerson)
  }),
  getPerson: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => onePerson(input.id)),
  listPostings: protectedReadProcedure.input(z.object({ salesPersonId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM sales_postings WHERE sales_person_id=$1 ORDER BY start_date DESC', [input.salesPersonId])
    return result.rows.map(toSalesPosting)
  }),
  currentPostings: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM sales_postings WHERE end_date IS NULL')
    const out: Record<string, any> = {}
    for (const row of result.rows) out[row.sales_person_id] = toSalesPosting(row)
    return out
  }),
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1), officialEmail: z.string().min(1), personalEmail: z.string().optional(),
      mobile: z.string().optional(), altMobile: z.string().optional(), notes: z.string().optional(),
      designation: z.string().min(1), tierKey: z.string().min(1), managerId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const dup = await pool.query('SELECT 1 FROM sales_persons WHERE official_email=$1', [input.officialEmail])
      if (dup.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'A sales person with this official email already exists' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const personResult = await client.query(
          `INSERT INTO sales_persons (name, official_email, personal_email, mobile, alt_mobile, notes)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [input.name, input.officialEmail, input.personalEmail ?? '', input.mobile ?? '', input.altMobile ?? '', input.notes ?? ''],
        )
        const person = personResult.rows[0]
        await client.query(
          `INSERT INTO sales_postings (sales_person_id, designation, tier_key, manager_id, office, start_date, end_date, change_type, reason)
           VALUES ($1,$2,$3,$4,'',CURRENT_DATE,NULL,'initial','')`,
          [person.id, input.designation, input.tierKey, input.managerId ?? null],
        )
        await client.query('COMMIT')
        return toSalesPerson(person)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(personPatchShape) }))
    .mutation(async ({ input }) => {
      const fields = Object.keys(input.patch)
      if (!fields.length) return onePerson(input.id)
      const values = fields.map((f) => (personJsonColumns.has(f) ? JSON.stringify((input.patch as any)[f]) : (input.patch as any)[f]))
      const setClauses = fields.map((f, i) => `${personColumnFor[f]}=$${i + 1}`)
      values.push(input.id)
      await pool.query(`UPDATE sales_persons SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${values.length}`, values)
      return onePerson(input.id)
    }),
  setStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid(), status: statusSchema }))
    .mutation(({ input }) => pool.query('UPDATE sales_persons SET status=$1, updated_at=now() WHERE id=$2', [input.status, input.id]).then(() => undefined)),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    // sales_postings and ownership_assignments both cascade via FK — but
    // commercial_boqs.sales_person_id is RESTRICT (commercial-boq.sql:26),
    // not cascade, and isn't pre-checked here, so deleting a salesperson
    // who owns any BOQ still fails at the DB level. This catch only
    // replaces that raw, unhandled 23503 with a friendly message.
    try {
      await pool.query('DELETE FROM sales_persons WHERE id=$1', [input.id])
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this sales person — they are still referenced by at least one BOQ.' })
      }
      throw e
    }
  }),
  transfer: protectedProcedure
    .input(z.object({
      salesPersonId: z.string().uuid(), designation: z.string().min(1), tierKey: z.string().min(1),
      managerId: z.string().uuid().nullable().optional(), office: z.string().optional(),
      effectiveDate: z.string(), reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const personResult = await client.query('SELECT * FROM sales_persons WHERE id=$1 FOR UPDATE', [input.salesPersonId])
        if (!personResult.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: `No such salesperson: ${input.salesPersonId}` })
        const current = (await client.query('SELECT * FROM sales_postings WHERE sales_person_id=$1 AND end_date IS NULL FOR UPDATE', [input.salesPersonId])).rows[0]
        if (current && input.effectiveDate <= current.start_date) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `The current posting starts on ${current.start_date}; a transfer must take effect after that.` })
        }
        if (current) {
          await client.query('UPDATE sales_postings SET end_date=$1 WHERE id=$2', [input.effectiveDate, current.id])
        }
        const oldRank = current ? tierRank(current.tier_key) : null
        const newRank = tierRank(input.tierKey)
        const changeType = oldRank === null ? 'initial' : newRank < oldRank ? 'promotion' : newRank > oldRank ? 'demotion' : 'lateralMove'
        const postingResult = await client.query(
          `INSERT INTO sales_postings (sales_person_id, designation, tier_key, manager_id, office, start_date, end_date, change_type, reason)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8) RETURNING *`,
          [input.salesPersonId, input.designation, input.tierKey, input.managerId ?? null, input.office ?? '', input.effectiveDate, changeType, input.reason ?? ''],
        )
        await client.query('COMMIT')
        return toSalesPosting(postingResult.rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  updatePostingManager: protectedProcedure
    .input(z.object({
      personId: z.string().uuid(),
      managerId: z.string().uuid().nullable().optional(),
      // Item 1: independently-settable GM/Higher Reporting Manager — omitted
      // leaves it untouched (e.g. an RM-only change), set to null reverts to
      // auto-deriving from the RM chain.
      gmOverrideId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const sets: string[] = []
      const values: (string | null)[] = []
      if (input.managerId !== undefined) { sets.push(`manager_id=$${sets.length + 1}`); values.push(input.managerId) }
      if (input.gmOverrideId !== undefined) { sets.push(`gm_override_id=$${sets.length + 1}`); values.push(input.gmOverrideId) }
      if (sets.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' })
      values.push(input.personId)
      const result = await pool.query(
        `UPDATE sales_postings SET ${sets.join(', ')} WHERE sales_person_id=$${values.length} AND end_date IS NULL RETURNING *`,
        values,
      )
      if (!result.rows[0]) throw new TRPCError({ code: 'BAD_REQUEST', message: `No open posting for salesperson: ${input.personId}` })
      return toSalesPosting(result.rows[0])
    }),
})
