import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { assertFieldsNotProtected } from '../lib/protectedValues.js'

function toBidMilestone(row: any) {
  return {
    id: row.id, bidId: row.bid_id, milestoneType: row.milestone_type, key: row.key, label: row.label,
    dueAt: row.due_at, venue: row.venue, notes: row.notes, status: row.status, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

/** Writes opportunities.submission_date to mirror a `key='submissionDeadline'`
 *  milestone change (spec §4.5) — MUST run in the same transaction as the
 *  milestone write itself, so the two never observably disagree even for an
 *  instant. Shared by `create`/`update` here AND by bidCorrigenda's
 *  reviewChange (Task 15) when an accepted change targets this key. */
export async function syncSubmissionDeadlineToOpportunity(client: any, bidId: string, dueAt: string | null) {
  const bid = (await client.query('SELECT opportunity_id FROM bids WHERE id=$1', [bidId])).rows[0]
  if (!bid) return
  await client.query('UPDATE opportunities SET submission_date=$1 WHERE id=$2', [dueAt ?? '', bid.opportunity_id])
}

export const bidMilestonesRouter = router({
  listForBid: protectedReadProcedure.input(z.object({ bidId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM bid_milestones WHERE bid_id=$1 ORDER BY due_at NULLS LAST', [input.bidId])
    return result.rows.map(toBidMilestone)
  }),

  /** Every live milestone across every non-archived bid, soonest first, joined
   *  with its bid and opportunity for display (the portfolio-wide Milestones &
   *  Dates page). Superseded milestones are history, not upcoming dates. */
  listAll: protectedReadProcedure.query(async () => {
    const result = await pool.query(`
      SELECT m.*, b.bid_code, o.opportunity_name
      FROM bid_milestones m
      JOIN bids b ON b.id = m.bid_id
      JOIN opportunities o ON o.id = b.opportunity_id
      WHERE b.status = 'active' AND m.status <> 'superseded'
      ORDER BY m.due_at NULLS LAST, m.created_at
    `)
    return result.rows.map((r: any) => ({ ...toBidMilestone(r), bidCode: r.bid_code, opportunityName: r.opportunity_name }))
  }),

  create: protectedProcedure
    .input(z.object({
      bidId: z.string().uuid(), milestoneType: z.string().min(1), key: z.string().min(1), label: z.string().min(1),
      dueAt: z.string().nullable().optional(), venue: z.string().optional(), notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        let row: any
        try {
          row = (await client.query(
            `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, venue, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [input.bidId, input.milestoneType, input.key, input.label, input.dueAt ?? null, input.venue ?? null, input.notes ?? null],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `This bid already has a milestone keyed "${input.key}".` })
          throw e
        }
        if (input.key === 'submissionDeadline') {
          await syncSubmissionDeadlineToOpportunity(client, input.bidId, input.dueAt ?? null)
        }
        await client.query('COMMIT')
        return toBidMilestone(row)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        label: z.string().optional(), dueAt: z.string().nullable().optional(),
        venue: z.string().nullable().optional(), notes: z.string().nullable().optional(),
        status: z.enum(['open', 'completed', 'superseded']).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM bid_milestones WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const columnFor: Record<string, string> = { label: 'label', dueAt: 'due_at', venue: 'venue', notes: 'notes', status: 'status' }
        const fields = Object.keys(input.patch)
        if (fields.length) {
          await assertFieldsNotProtected(client, 'bid', current.bid_id, [current.key])
          const values = fields.map((f) => (input.patch as any)[f])
          const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE bid_milestones SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
        }
        if (current.key === 'submissionDeadline' && input.patch.dueAt !== undefined) {
          await syncSubmissionDeadlineToOpportunity(client, current.bid_id, input.patch.dueAt)
        }
        await client.query('COMMIT')
        const updated = (await pool.query('SELECT * FROM bid_milestones WHERE id=$1', [input.id])).rows[0]
        return toBidMilestone(updated)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const milestone = (await pool.query('SELECT bid_id, key FROM bid_milestones WHERE id=$1', [input.id])).rows[0]
    if (!milestone) return
    // Review Focus (Task 12): a pending corrigendum change still targeting
    // this milestone by key must block the delete — otherwise reviewChange's
    // later accept on that change would silently match zero rows and report
    // success, having applied nothing.
    const pending = await pool.query(
      `SELECT 1 FROM bid_corrigendum_changes ch
       JOIN bid_corrigenda c ON c.id = ch.corrigendum_id
       WHERE c.bid_id=$1 AND ch.field_key=$2 AND ch.decision='pending' LIMIT 1`,
      [milestone.bid_id, milestone.key],
    )
    if (pending.rows.length) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this milestone — a pending corrigendum change still targets it. Resolve the corrigendum first.' })
    }
    await pool.query('DELETE FROM bid_milestones WHERE id=$1', [input.id])
  }),
})
