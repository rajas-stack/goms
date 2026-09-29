import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { assertFieldsNotProtected } from '../lib/protectedValues.js'
import { formatBidCode, DEFAULT_BID_STAGE_KEY, isAtOrAfterSubmitted, PIPELINE_STAGE_MAP, computeAttentionFlag, applyFilterRules } from '@goms/domain'
import { applyStageChange } from './opportunities.js'

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

const bidColumnFor: Record<string, string> = {
  stageKey: 'stage_key', decision: 'decision', tenderLink: 'tender_link',
}

const bidActionQueueRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query(`
      SELECT f.id AS follow_up_id, f.due_date, f.note, f.assignee_id, f.status,
             b.id AS bid_id, b.bid_code, b.stage_key,
             o.opportunity_name,
             EXISTS (
               SELECT 1 FROM bid_corrigenda c
               LEFT JOIN bid_corrigendum_changes ch ON ch.corrigendum_id = c.id
               WHERE c.bid_id = b.id GROUP BY c.id HAVING bool_or(ch.decision = 'pending' OR ch.decision IS NULL)
             ) AS has_pending_corrigendum
      FROM follow_ups f
      JOIN bids b ON b.id = f.entity_id AND f.entity_type = 'bid'
      JOIN opportunities o ON o.id = b.opportunity_id
      WHERE f.status = 'open'
      ORDER BY f.due_date
    `)
    const today = new Date().toISOString().slice(0, 10)
    return result.rows.map((r: any) => ({
      followUpId: r.follow_up_id, bidId: r.bid_id, bidCode: r.bid_code, stageKey: r.stage_key,
      opportunityName: r.opportunity_name, dueDate: r.due_date, note: r.note, assigneeId: r.assignee_id,
      attentionFlag: computeAttentionFlag({ dueAt: r.due_date, hasPendingCorrigendum: r.has_pending_corrigendum ?? false, today }),
    }))
  }),
})

export const bidsRouter = router({
  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneBid(input.id)),

  listForGrid: protectedReadProcedure
    .input(z.object({ filterRules: z.array(z.object({ field: z.string(), operator: z.literal('eq'), value: z.string() })).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const [gridResult, corrigendaPendingResult, ownershipResult] = await Promise.all([
        pool.query(`
          SELECT b.*, o.department_id, o.state_code, o.opportunity_name, o.gem_tender_id, o.submission_date,
                 o.value_amount, o.value_unit, o.emd_amount, o.emd_unit, o.vertical
          FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
          ORDER BY b.created_at DESC
        `),
        pool.query(`
          SELECT c.bid_id FROM bid_corrigenda c
          JOIN bid_corrigendum_changes ch ON ch.corrigendum_id = c.id
          WHERE ch.decision = 'pending' GROUP BY c.bid_id
        `),
        pool.query(`SELECT entity_id, sales_person_id FROM ownership_assignments WHERE entity_type='bid' AND role='owner' AND end_date IS NULL`),
      ])
      const pendingCorrigendumBidIds = new Set(corrigendaPendingResult.rows.map((r: any) => r.bid_id))
      // NOTE: this resolves DIRECT bid-level owner assignments only, not
      // spec §4.6's full inheritance-from-opportunity chain — sufficient for
      // grid filtering/display; the bid detail page's Overview tab (Task 31)
      // uses the full ownership.resolveOwner procedure for the authoritative
      // single-bid view.
      const salesPersonIds = [...new Set(ownershipResult.rows.map((r: any) => r.sales_person_id))]
      const emailsResult = salesPersonIds.length
        ? await pool.query('SELECT id, official_email FROM sales_persons WHERE id = ANY($1)', [salesPersonIds])
        : { rows: [] }
      const emailById = new Map(emailsResult.rows.map((r: any) => [r.id, r.official_email]))
      const ownerEmailByBidId = new Map(
        ownershipResult.rows.map((r: any) => [r.entity_id, emailById.get(r.sales_person_id) ?? null]),
      )

      const today = new Date().toISOString().slice(0, 10)
      const rows = gridResult.rows.map((r: any) => {
        const dueAt = r.submission_date && !Number.isNaN(new Date(r.submission_date).getTime()) ? r.submission_date : null
        return {
          ...toBid(r), departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
          gemTenderId: r.gem_tender_id, submissionDate: r.submission_date, valueAmount: r.value_amount,
          valueUnit: r.value_unit, emdAmount: r.emd_amount, emdUnit: r.emd_unit, vertical: r.vertical,
          ownerEmail: ownerEmailByBidId.get(r.id) ?? null,
          attentionFlag: computeAttentionFlag({ dueAt, hasPendingCorrigendum: pendingCorrigendumBidIds.has(r.id), today }),
        }
      })
      return applyFilterRules(rows, input?.filterRules ?? [], ctx.user?.email ?? null)
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

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        stageKey: z.string().optional(), decision: z.enum(['pending', 'go', 'no_go']).optional(),
        tenderLink: z.string().nullable().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM bids WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const patch: Record<string, unknown> = { ...input.patch }
        const effectiveStageKey = (patch.stageKey as string | undefined) ?? current.stage_key
        if (patch.decision === 'go' && !isAtOrAfterSubmitted(effectiveStageKey)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot mark Go before the bid reaches Submitted.' })
        }
        // Auto-derive the terminal stage from a final decision (spec §4.4) —
        // this always wins over any stageKey also present in the same patch,
        // so the two fields can never visibly disagree.
        if (patch.decision === 'go') patch.stageKey = 'goApproved'
        if (patch.decision === 'no_go') patch.stageKey = 'dropped'

        const fields = Object.keys(patch)
        if (fields.length) {
          await assertFieldsNotProtected(client, 'bid', input.id, fields)
          const values = fields.map((f) => patch[f])
          const setClauses = fields.map((f, i) => `${bidColumnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE bids SET ${setClauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
        }

        // Bid -> Opportunity sync (spec §4.4) — exactly these two points, both
        // through the shared applyStageChange helper, same transaction.
        const newStageKey = (patch.stageKey as string | undefined) ?? current.stage_key
        if (newStageKey === 'submitted' && current.stage_key !== 'submitted') {
          const opp = (await client.query('SELECT stage_key FROM opportunities WHERE id=$1', [current.opportunity_id])).rows[0]
          if (opp && (PIPELINE_STAGE_MAP[opp.stage_key]?.order ?? 0) < (PIPELINE_STAGE_MAP['submitted']?.order ?? 0)) {
            await applyStageChange(client, current.opportunity_id, 'submitted', 'Bid submitted (synced from Bid Tracker)')
          }
        }
        if (patch.decision === 'go' || patch.decision === 'no_go') {
          const opp = (await client.query('SELECT stage_key FROM opportunities WHERE id=$1', [current.opportunity_id])).rows[0]
          if (opp && !(PIPELINE_STAGE_MAP[opp.stage_key]?.isClosed ?? false)) {
            const target = patch.decision === 'go' ? 'won' : 'dropped'
            await applyStageChange(client, current.opportunity_id, target, `Bid decision recorded: ${patch.decision} (synced from Bid Tracker)`)
          }
        }

        await client.query('COMMIT')
        return (await oneBid(input.id))!
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  archive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query(`UPDATE bids SET status='archived', archived_at=now(), updated_at=now() WHERE id=$1`, [input.id])
    return (await oneBid(input.id))!
  }),

  unarchive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query(`UPDATE bids SET status='active', archived_at=NULL, updated_at=now() WHERE id=$1`, [input.id])
    return (await oneBid(input.id))!
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const bid = (await client.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
      if (!bid) { await client.query('COMMIT'); return }

      // Spec §4.7's hard-delete gate — checked here, not left to whatever FK
      // constraints happen to exist, so the error names exactly what's blocking.
      const [corrigenda, protectedRows, docs, followUps] = await Promise.all([
        client.query('SELECT 1 FROM bid_corrigenda WHERE bid_id=$1 LIMIT 1', [input.id]),
        client.query(`SELECT 1 FROM protected_values WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
        client.query(`SELECT 1 FROM documents WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
        client.query(`SELECT 1 FROM follow_ups WHERE entity_type='bid' AND entity_id=$1 LIMIT 1`, [input.id]),
      ])
      if (corrigenda.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has corrigendum history. Archive it instead.' })
      if (protectedRows.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has protected-value history. Archive it instead.' })
      if (docs.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has uploaded documents. Archive it instead.' })
      if (followUps.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete — this bid has follow-ups. Archive it instead.' })

      // Polymorphic, no FK — must be deleted explicitly. Audit-log rows are the
      // one thing deliberately NEVER touched here (spec §4.7): they survive the
      // entity, same convention as commercial_audit_logs/employee_merge_audit.
      await client.query(`DELETE FROM ownership_assignments WHERE entity_type='bid' AND entity_id=$1`, [input.id])
      // bid_milestones and bid_corrigenda cascade via their own FKs; the gate
      // above already guarantees bid_corrigenda is empty in practice.
      await client.query('DELETE FROM bids WHERE id=$1', [input.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),

  actionQueue: bidActionQueueRouter,
})
