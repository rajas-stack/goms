import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { formatBidCode, DEFAULT_BID_STAGE_KEY } from '@goms/domain'

export function toBid(row: any) {
  return {
    id: row.id, opportunityId: row.opportunity_id, bidCode: row.bid_code, stageKey: row.stage_key,
    decision: row.decision, status: row.status, dataConfidence: row.data_confidence,
    tenderLink: row.tender_link, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

async function oneBid(id: string) {
  const result = await pool.query('SELECT * FROM bids WHERE id=$1', [id])
  return result.rows[0] ? toBid(result.rows[0]) : null
}

async function allocateBidCode(client: any): Promise<string> {
  const year = new Date().getFullYear()
  const result = await client.query(
    `INSERT INTO bid_number_sequences (year, next_value) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_value = bid_number_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [year],
  )
  return formatBidCode(year, result.rows[0].allocated)
}

/** Parses opportunities.submission_date (a plain, unvalidated TEXT column —
 *  spec §4.5) into a TIMESTAMPTZ. Returns null for anything that doesn't
 *  parse, rather than throwing — most existing rows are exactly this messy
 *  (e.g. "10-10-2026 14:00 Hrs" per the reference screenshots). */
function parseSubmissionDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const bidsRouter = router({
  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneBid(input.id)),

  listForGrid: protectedReadProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const result = await pool.query(`
        SELECT b.*, o.department_id, o.state_code, o.opportunity_name, o.gem_tender_id, o.submission_date,
               o.value_amount, o.value_unit, o.emd_amount, o.emd_unit, o.vertical
        FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
        ORDER BY b.created_at DESC
      `)
      return result.rows.map((r: any) => ({
        ...toBid(r), departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
        gemTenderId: r.gem_tender_id, submissionDate: r.submission_date, valueAmount: r.value_amount,
        valueUnit: r.value_unit, emdAmount: r.emd_amount, emdUnit: r.emd_unit, vertical: r.vertical,
      }))
    }),

  create: protectedProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const opp = (await client.query('SELECT submission_date FROM opportunities WHERE id=$1', [input.opportunityId])).rows[0]
        if (!opp) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such opportunity: ${input.opportunityId}` })

        const bidCode = await allocateBidCode(client)
        let bidRow: any
        try {
          bidRow = (await client.query(
            `INSERT INTO bids (opportunity_id, bid_code, stage_key) VALUES ($1,$2,$3) RETURNING *`,
            [input.opportunityId, bidCode, DEFAULT_BID_STAGE_KEY],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'This opportunity already has a bid.' })
          }
          throw e
        }

        // Seed the submissionDeadline milestone directly via SQL (bid_milestones
        // table, not the bidMilestones router — this insert must be in the SAME
        // transaction as the bids insert, and calling a sibling tRPC procedure
        // from here would open a second pool connection, breaking that
        // atomicity). Task 12 (bidMilestones router) reads/writes this same row.
        const dueAt = parseSubmissionDate(opp.submission_date)
        await client.query(
          `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, source)
           VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline',$2,'manual')`,
          [bidRow.id, dueAt],
        )

        await client.query('COMMIT')
        return toBid(bidRow)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
