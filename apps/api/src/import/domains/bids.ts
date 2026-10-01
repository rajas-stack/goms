import { z } from 'zod'
import { coerceCustomValue, formatBidCode, type CustomFieldType, type CustomValue } from '@goms/domain'
import { classifyRows, findFuzzyCandidates } from '../engine.js'
import { assertFieldsNotProtected } from '../../lib/protectedValues.js'
import { writeAuditLog } from '../../lib/auditLog.js'
import { auditText, CUSTOM_VALUE_COLUMNS, customValueColumns, customValueFromRow } from '../../lib/customFieldValues.js'
import { displayStored, loadEntityIndex, resolveImportCell, type EntityIndex } from '../../lib/customFieldEntities.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

type Client = { query: (sql: string, params?: unknown[]) => Promise<any> }

/** A bid row is identified by its opportunity's GeM Tender ID (a human filling in a
 *  sheet has no opportunity UUIDs). Any other column is either an existing custom
 *  column (matched by its name or `custom:<key>`, case-insensitively) or an UNKNOWN
 *  heading — which is reported, never turned into a new column (spec §8.1). */
const bidRowSchema = z.object({
  gemTenderId: z.string().min(1, 'GeM Tender ID is required').trim(),
  tenderLink: z.string().optional().default(''),
}).passthrough()
export type BidImportRow = z.infer<typeof bidRowSchema>

const STANDARD_HEADINGS = new Set(['gemtenderid', 'tenderlink'])

interface CustomFieldDef { id: string; key: string; name: string; dataType: CustomFieldType; options: string[] | null; status: 'active' | 'archived' }

async function fetchCustomFields(client: Client): Promise<CustomFieldDef[]> {
  const result = await client.query('SELECT id, key, name, data_type, options, status FROM bid_custom_fields')
  return result.rows.map((r: any) => ({ id: r.id, key: r.key, name: r.name, dataType: r.data_type, options: r.options ?? null, status: r.status }))
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Splits a row's non-standard headings into ones that fill an ACTIVE custom column
 *  (blank cells are "no change", never a clear) and ones that match nothing usable
 *  (non-empty only; a blank unknown column is just ignored). */
function classifyHeadings(row: Record<string, unknown>, fields: CustomFieldDef[]) {
  const recognized: { field: CustomFieldDef; heading: string; raw: unknown }[] = []
  const unknown: string[] = []
  for (const [heading, raw] of Object.entries(row)) {
    const h = heading.trim().toLowerCase()
    if (STANDARD_HEADINGS.has(h) || isBlank(raw)) continue
    const matches = (f: CustomFieldDef) => f.name.trim().toLowerCase() === h || `custom:${f.key}` === h
    const active = fields.find((f) => f.status === 'active' && matches(f))
    if (active) { recognized.push({ field: active, heading, raw }); continue }
    unknown.push(fields.some((f) => f.status === 'archived' && matches(f)) ? `${heading} (archived column)` : heading)
  }
  return { recognized, unknown }
}

/** Every opportunity with a GeM Tender ID, whether or not it has a bid yet. */
async function fetchOpportunityIdsByTenderId(client: Client): Promise<Map<string, string>> {
  const result = await client.query(`SELECT id, gem_tender_id FROM opportunities WHERE gem_tender_id IS NOT NULL AND gem_tender_id <> ''`)
  return new Map(result.rows.map((r: any) => [String(r.gem_tender_id).trim(), r.id]))
}

interface ExistingBid { tenderLink: string; customValues: Record<string, string> }

/** Only opportunities that already have a bid — classifyRows' `existingByKey`, which
 *  decides create vs update vs unchanged. */
async function fetchExistingBidsByTenderId(client: Client): Promise<Map<string, ExistingBid>> {
  const bids = await client.query(`
    SELECT b.id, o.gem_tender_id, b.tender_link
    FROM bids b JOIN opportunities o ON o.id = b.opportunity_id
    WHERE o.gem_tender_id IS NOT NULL AND o.gem_tender_id <> ''
  `)
  const values = await client.query(
    `SELECT v.bid_id, f.key, f.data_type, ${CUSTOM_VALUE_COLUMNS}
     FROM bid_custom_field_values v JOIN bid_custom_fields f ON f.id = v.field_id WHERE f.status='active'`,
  )
  const byBid = new Map<string, Record<string, string>>()
  for (const v of values.rows) {
    const forBid = byBid.get(v.bid_id) ?? {}
    forBid[v.key] = auditText(customValueFromRow(v.data_type, v))
    byBid.set(v.bid_id, forBid)
  }
  return new Map(bids.rows.map((r: any) => [
    String(r.gem_tender_id).trim(),
    { tenderLink: r.tender_link ?? '', customValues: byBid.get(r.id) ?? {} },
  ]))
}

function coerceRecognized(recognized: ReturnType<typeof classifyHeadings>['recognized'], index: EntityIndex) {
  const values: { field: CustomFieldDef; value: Exclude<CustomValue, null> }[] = []
  const errors: string[] = []
  for (const { field, heading, raw } of recognized) {
    try {
      const value = coerceCustomValue(field.dataType, resolveImportCell(field.dataType, raw, index), field.options)
      if (value !== null) values.push({ field, value })
    } catch (e) {
      errors.push(`Column "${heading}": ${e instanceof Error ? e.message : 'invalid value'}`)
    }
  }
  return { values, errors }
}

export async function validateBidRows(client: Client, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const opportunityIdByTenderId = await fetchOpportunityIdsByTenderId(client)
  const existingBidsByTenderId = await fetchExistingBidsByTenderId(client)
  const customFields = await fetchCustomFields(client)
  const entityIndex = await loadEntityIndex(client)
  const knownTenderIds = Array.from(opportunityIdByTenderId.keys())

  const results = classifyRows<unknown, ExistingBid>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = bidRowSchema.safeParse(raw)
      return parsed.success ? parsed.data.gemTenderId : `__row_${index}__`
    },
    existingByKey: existingBidsByTenderId,
    diffFields: (raw, existing) => {
      const row = bidRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.tenderLink && row.tenderLink !== existing.tenderLink) {
        diffs.push({ field: 'tenderLink', oldValue: existing.tenderLink, newValue: row.tenderLink })
      }
      const { values } = coerceRecognized(classifyHeadings(row, customFields).recognized, entityIndex)
      for (const { field, value } of values) {
        const before = existing.customValues[field.key] ?? ''
        if (String(value) !== before) {
          diffs.push({
            field: `custom:${field.key}`,
            oldValue: before === '' ? '' : displayStored(field.dataType, before, entityIndex),
            newValue: displayStored(field.dataType, value, entityIndex),
          })
        }
      }
      return diffs
    },
    validateRow: (raw) => {
      const parsed = bidRowSchema.safeParse(raw)
      if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
      const key = parsed.data.gemTenderId
      const { errors: valueErrors } = coerceRecognized(classifyHeadings(parsed.data, customFields).recognized, entityIndex)
      if (valueErrors.length) return { errors: valueErrors }
      if (opportunityIdByTenderId.has(key)) return { errors: [] }
      const suggestions = findFuzzyCandidates(key, knownTenderIds)
      if (suggestions.length > 0) {
        return {
          errors: [`No opportunity found with GeM Tender ID "${key}" — did you mean one of the suggested tender IDs?`],
          needsReview: true,
          candidates: suggestions,
        }
      }
      return { errors: [`No opportunity found with GeM Tender ID "${key}" — create the opportunity first.`] }
    },
  })

  // An unknown heading is a NOTICE on the row, not a blocker: the row's standard
  // and known-column values still import; the heading's values are ignored.
  rawRows.forEach((raw, index) => {
    const parsed = bidRowSchema.safeParse(raw)
    if (!parsed.success) return
    const { unknown } = classifyHeadings(parsed.data, customFields)
    if (unknown.length) {
      results[index].warnings = [`Unknown column${unknown.length === 1 ? '' : 's'} ignored: ${unknown.join(', ')}. No column was created — add it as a custom column first.`]
    }
  })
  return results
}

export async function commitBidRows(client: Client, rawRows: unknown[], preview: ImportRowResult[]): Promise<void> {
  const opportunityIdByTenderId = await fetchOpportunityIdsByTenderId(client)
  const customFields = await fetchCustomFields(client)
  const entityIndex = await loadEntityIndex(client)

  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = bidRowSchema.parse(rawRows[i])
    const opportunityId = opportunityIdByTenderId.get(row.gemTenderId)
    if (!opportunityId) continue // validate already guarantees a create/update row resolves; defensive only
    const { recognized, unknown } = classifyHeadings(row, customFields)
    const { values } = coerceRecognized(recognized, entityIndex)

    let bidId: string
    if (result.action === 'create') {
      const opp = (await client.query('SELECT submission_date FROM opportunities WHERE id=$1', [opportunityId])).rows[0]
      const bidCode = await allocateBidCodeForImport(client)
      bidId = (await client.query(
        `INSERT INTO bids (opportunity_id, bid_code, tender_link) VALUES ($1,$2,$3) RETURNING id`,
        [opportunityId, bidCode, row.tenderLink || null],
      )).rows[0].id
      const parsed = opp?.submission_date ? new Date(opp.submission_date) : null
      const dueAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null
      await client.query(
        `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, source)
         VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline',$2,'manual')`,
        [bidId, dueAt],
      )
    } else {
      const bid = (await client.query('SELECT id, tender_link FROM bids WHERE opportunity_id=$1', [opportunityId])).rows[0]
      bidId = bid.id
      // A blank cell is "no change", never a clear. And the import commit is a
      // direct-edit path like any other (spec §13): a frozen tenderLink rejects
      // a change to it exactly the way bids.update does.
      if (row.tenderLink && row.tenderLink !== (bid.tender_link ?? '')) {
        await assertFieldsNotProtected(client, 'bid', bidId, ['tenderLink'])
        await client.query('UPDATE bids SET tender_link=$1, updated_at=now() WHERE id=$2', [row.tenderLink, bidId])
      }
    }

    for (const { field, value } of values) await upsertImportedCustomValue(client, bidId, field, value, entityIndex)
    // A sheet with columns we could not place is something a human should glance at.
    if (unknown.length) await client.query(`UPDATE bids SET data_confidence='needs_review', updated_at=now() WHERE id=$1`, [bidId])
  }

  // Spec §17 — a needs-review row (a fuzzy-matched GeM Tender ID) is never
  // auto-applied, but the EXISTING bid its top candidate most likely refers
  // to is flagged for a human to re-check.
  const needsReviewOpportunityIds = new Set<string>()
  for (const result of preview) {
    if (result.action !== 'needs-review') continue
    const topCandidateKey = result.candidates?.[0]?.key
    const opportunityId = topCandidateKey ? opportunityIdByTenderId.get(topCandidateKey) : undefined
    if (opportunityId) needsReviewOpportunityIds.add(opportunityId)
  }
  if (needsReviewOpportunityIds.size) {
    await client.query(
      `UPDATE bids SET data_confidence='needs_review', updated_at=now() WHERE opportunity_id = ANY($1)`,
      [Array.from(needsReviewOpportunityIds)],
    )
  }
}

/** Same typed upsert + has_held_value + audit as bidCustomFields.setValue. */
async function upsertImportedCustomValue(client: Client, bidId: string, field: CustomFieldDef, value: Exclude<CustomValue, null>, index: EntityIndex) {
  const existing = (await client.query(
    `SELECT ${CUSTOM_VALUE_COLUMNS} FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2`, [bidId, field.id],
  )).rows[0]
  const oldValue = existing ? customValueFromRow(field.dataType, existing) : null
  const c = customValueColumns(field.dataType, value)
  await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [field.id])
  await client.query(
    `INSERT INTO bid_custom_field_values (bid_id, field_id, value_text, value_number, value_date, value_bool)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (bid_id, field_id) DO UPDATE SET
       value_text=EXCLUDED.value_text, value_number=EXCLUDED.value_number, value_date=EXCLUDED.value_date,
       value_bool=EXCLUDED.value_bool, updated_at=now()`,
    [bidId, field.id, c.text, c.number, c.date, c.bool],
  )
  if (oldValue !== value) {
    await writeAuditLog(client, {
      entityType: 'bidCustomFieldValue', entityId: bidId, field: field.key, oldValue: displayStored(field.dataType, oldValue, index),
      newValue: displayStored(field.dataType, value, index), reason: 'Imported', action: 'custom_value_set',
    })
  }
}

async function allocateBidCodeForImport(client: Client): Promise<string> {
  const year = new Date().getFullYear()
  const result = await client.query(
    `INSERT INTO bid_number_sequences (year, next_value) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_value = bid_number_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [year],
  )
  return formatBidCode(year, result.rows[0].allocated)
}
