import { z } from 'zod'
import { classifyRows, findFuzzyCandidates } from '../engine.js'
import { assertFieldsNotProtected } from '../../lib/protectedValues.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

type Client = { query: (sql: string, params?: unknown[]) => Promise<any> }

const bidMilestoneRowSchema = z.object({
  gemTenderId: z.string().min(1, 'GeM Tender ID is required').trim(),
  milestoneType: z.string().min(1, 'Milestone Type is required'),
  key: z.string().min(1, 'Key is required'),
  label: z.string().min(1, 'Label is required'),
  dueAt: z.string().optional().default(''),
  venue: z.string().optional().default(''),
  notes: z.string().optional().default(''),
})
export type BidMilestoneImportRow = z.infer<typeof bidMilestoneRowSchema>

/** Every tender ID that already HAS a bid — a milestone can only attach to a real bid
 *  (bid_milestones.bid_id is NOT NULL), so this is the resolution set for both the exact
 *  match and the fuzzy-suggestion fallback. An opportunity with no bid yet is a `reject`,
 *  not a `needs-review`: nothing about the tender ID is ambiguous, there is simply nothing
 *  valid to attach the milestone to. */
async function fetchBidIdsByTenderId(client: Client): Promise<Map<string, string>> {
  const result = await client.query(`
    SELECT o.gem_tender_id, b.id AS bid_id
    FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
    WHERE o.gem_tender_id IS NOT NULL AND o.gem_tender_id <> ''
  `)
  return new Map(result.rows.map((r: any) => [String(r.gem_tender_id).trim(), r.bid_id]))
}

interface ExistingMilestone { label: string; dueAt: string; venue: string; notes: string }

/** Keyed `${gemTenderId}::${key}` — (bid_id, key), not the tender ID alone, is the real
 *  uniqueness constraint. */
async function fetchExistingMilestonesByKey(client: Client): Promise<Map<string, ExistingMilestone>> {
  const result = await client.query(`
    SELECT o.gem_tender_id, m.key, m.label, m.due_at, m.venue, m.notes
    FROM bid_milestones m
    JOIN bids b ON b.id = m.bid_id
    JOIN opportunities o ON o.id = b.opportunity_id
    WHERE o.gem_tender_id IS NOT NULL AND o.gem_tender_id <> ''
  `)
  return new Map(result.rows.map((r: any) => [
    `${String(r.gem_tender_id).trim()}::${r.key}`,
    { label: r.label, dueAt: r.due_at ? new Date(r.due_at).toISOString() : '', venue: r.venue ?? '', notes: r.notes ?? '' },
  ]))
}

export async function validateBidMilestoneRows(client: Client, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const bidIdByTenderId = await fetchBidIdsByTenderId(client)
  const existingByKey = await fetchExistingMilestonesByKey(client)
  const knownTenderIds = Array.from(bidIdByTenderId.keys())

  return classifyRows<unknown, ExistingMilestone>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = bidMilestoneRowSchema.safeParse(raw)
      return parsed.success ? `${parsed.data.gemTenderId}::${parsed.data.key}` : `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = bidMilestoneRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.label !== existing.label) diffs.push({ field: 'label', oldValue: existing.label, newValue: row.label })
      if (row.dueAt !== existing.dueAt) diffs.push({ field: 'dueAt', oldValue: existing.dueAt, newValue: row.dueAt })
      if (row.venue !== existing.venue) diffs.push({ field: 'venue', oldValue: existing.venue, newValue: row.venue })
      if (row.notes !== existing.notes) diffs.push({ field: 'notes', oldValue: existing.notes, newValue: row.notes })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = bidMilestoneRowSchema.safeParse(raw)
      if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
      const key = parsed.data.gemTenderId
      if (bidIdByTenderId.has(key)) return { errors: [] }
      const suggestions = findFuzzyCandidates(key, knownTenderIds)
      if (suggestions.length > 0) {
        return {
          errors: [`No bid found for GeM Tender ID "${key}" — did you mean one of the suggested tender IDs?`],
          needsReview: true,
          candidates: suggestions,
        }
      }
      return { errors: [`No bid found for GeM Tender ID "${key}" — the opportunity must have a bid in Bid Tracker before its milestones can be imported.`] }
    },
  })
}

export async function commitBidMilestoneRows(client: Client, rawRows: unknown[], preview: ImportRowResult[]): Promise<void> {
  const bidIdByTenderId = await fetchBidIdsByTenderId(client)

  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = bidMilestoneRowSchema.parse(rawRows[i])
    const bidId = bidIdByTenderId.get(row.gemTenderId)
    if (!bidId) continue // validate already guarantees a create/update row resolves; defensive only

    const dueAt = row.dueAt || null
    if (result.action === 'create') {
      await client.query(
        `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, venue, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [bidId, row.milestoneType, row.key, row.label, dueAt, row.venue || null, row.notes || null],
      )
    } else {
      // Same protected-value guard every direct-edit path uses (spec §13) — the
      // import commit path is a direct edit like any other, not exempt.
      await assertFieldsNotProtected(client, 'bid', bidId, [row.key])
      await client.query(
        `UPDATE bid_milestones SET label=$1, due_at=$2, venue=$3, notes=$4, updated_at=now() WHERE bid_id=$5 AND key=$6`,
        [row.label, dueAt, row.venue || null, row.notes || null, bidId, row.key],
      )
    }
    if (row.key === 'submissionDeadline') {
      await client.query('UPDATE opportunities SET submission_date=$1 WHERE id=(SELECT opportunity_id FROM bids WHERE id=$2)', [dueAt ?? '', bidId])
    }
  }
}
