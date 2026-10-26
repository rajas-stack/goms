import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { CUSTOM_FIELD_TYPES, bidSystemField, coerceCustomValue, hasOptions, normalizeOptions, slugifyFieldKey, customTypesCompatible, convertCustomFieldValue, type CustomFieldType, type CustomValue } from '@goms/domain'
import { PEOPLE_COLUMN_ID_MAX, assertPeopleColumnId, isEmptyPeopleColumnConfig, normalizePeopleColumnConfig, type PeopleColumnConfig } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors.js'
import { writeAuditLog } from '../lib/auditLog.js'
import { customValueColumns, customValueFromRow, CUSTOM_VALUE_COLUMNS } from '../lib/customFieldValues.js'
import { assertEntityExists, auditDisplay } from '../lib/customFieldEntities.js'
import { liveOptionsFor, withLiveOptions } from '../lib/bidOptionLookups.js'
import { syncFieldToMilestone } from '../lib/bidTimelineSync.js'

/** Built-in Live Bids fields: name and options come from code and Settings > Masters > Live Bids. */
function assertNotSystemField(row: any, what: string): void {
  if (bidSystemField(row.key)) throw new TRPCError({ code: 'BAD_REQUEST', message: `"${row.name}" is a built-in Live Bids field; ${what}` })
}

function toBidCustomField(row: any) {
  return {
    id: row.id, key: row.key, name: row.name, dataType: row.data_type as CustomFieldType,
    sheet: row.sheet as string, options: (row.options as string[] | null) ?? null, hasHeldValue: row.has_held_value as boolean, position: row.position, status: row.status as 'active' | 'archived',
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

const fieldType = z.enum(CUSTOM_FIELD_TYPES as [CustomFieldType, ...CustomFieldType[]])
const fieldName = z.string().trim().min(1).max(80)

/** Serializes definition changes (create/rename/unarchive/reorder) so the
 *  key dedupe, the active-name uniqueness and dense positions can never race.
 *  Transaction-scoped: released at COMMIT/ROLLBACK. */
async function lockDefinitions(client: any) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bid_custom_fields'))`)
}

function badRequest(e: unknown): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'Invalid value.' })
}

function nameConflict(name: string): never {
  throw new TRPCError({ code: 'CONFLICT', message: `A column named "${name}" already exists.` })
}

async function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function loadField(client: any, id: string, lock = false) {
  const row = (await client.query(`SELECT * FROM bid_custom_fields WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such custom column.' })
  return row
}

export const bidCustomFieldsRouter = router({
  list: protectedReadProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT * FROM bid_custom_fields ${input?.includeArchived ? '' : `WHERE status='active'`} ORDER BY position, created_at, insert_seq`,
      )
      return withLiveOptions(pool, result.rows.map(toBidCustomField))
    }),

  create: protectedProcedure
    .input(z.object({ name: fieldName, dataType: fieldType, options: z.array(z.string()).optional(), sheet: z.enum(['bidTracker', 'pipeline', 'campaign', 'master']).optional() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      let options: string[] | null = null
      if (hasOptions(input.dataType)) {
        try { options = normalizeOptions(input.options ?? []) } catch (e) { badRequest(e) }
      } else if (input.options !== undefined) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a select or multi-select column has options.' })
      }
      await lockDefinitions(client)
      const taken = new Set<string>((await client.query('SELECT key FROM bid_custom_fields')).rows.map((r: any) => r.key))
      const key = slugifyFieldKey(input.name, taken)
      const position = (await client.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM bid_custom_fields')).rows[0].next
      let row: any
      try {
        row = (await client.query(
          `INSERT INTO bid_custom_fields (key, name, data_type, options, position, created_by, updated_by, sheet)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *`,
          [key, input.name, input.dataType, options === null ? null : JSON.stringify(options), position, ctx.user?.email ?? null, input.sheet ?? 'bidTracker'],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) nameConflict(input.name)
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: row.id, field: 'name', oldValue: '', newValue: input.name, reason: '',
        action: 'custom_field_created', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  update: protectedProcedure
    .input(z.object({
      id: z.string().guid('Invalid UUID'),
      // Keys stay fixed; type changes are transactional across the column and all its values.
      patch: z.object({ name: fieldName.optional(), options: z.array(z.string()).optional(), dataType: fieldType.optional(), expectedDataType: fieldType.optional(), resetValues: z.boolean().optional() }),
    }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const current = await loadField(client, input.id, true)
      assertNotSystemField(current, 'edit its options in Settings > Masters > Live Bids.')
      if (input.patch.expectedDataType && input.patch.expectedDataType !== current.data_type) throw new TRPCError({ code: 'CONFLICT', message: 'This column changed in another session. Reopen Change data type and try again.' })
      const nextType = input.patch.dataType ?? current.data_type as CustomFieldType
      const typeChanged = nextType !== current.data_type
      const kept = customTypesCompatible(current.data_type, nextType)
      const sets: string[] = []
      const values: unknown[] = []
      const audits: Parameters<typeof writeAuditLog>[1][] = []
      const base = { entityType: 'bidCustomField', entityId: current.id, changedBy: ctx.user?.email }

      if (typeChanged) {
        const held = (await client.query(`SELECT bid_id, ${CUSTOM_VALUE_COLUMNS} FROM bid_custom_field_values WHERE field_id=$1 FOR UPDATE`, [input.id])).rows
        if (!kept && held.length && !input.patch.resetValues) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Changing to an unrelated data type requires resetting its values.' })
        for (const entry of held) {
          const previous = customValueFromRow(current.data_type, entry)
          let next: CustomValue
          try { next = convertCustomFieldValue(current.data_type, nextType, previous) } catch (cause) { badRequest(cause) }
          if (next === null) await client.query('DELETE FROM bid_custom_field_values WHERE field_id=$1 AND bid_id=$2', [input.id, entry.bid_id])
          else {
            const columns = customValueColumns(nextType, next)
            await client.query(`UPDATE bid_custom_field_values SET value_text=$1, value_number=$2, value_date=$3, value_bool=$4, updated_by=$5, updated_at=now() WHERE field_id=$6 AND bid_id=$7`, [columns.text, columns.number, columns.date, columns.bool, ctx.user?.email ?? null, input.id, entry.bid_id])
          }
          if (previous !== next) await writeAuditLog(client, { entityType: 'bidCustomFieldValue', entityId: entry.bid_id, field: current.key, oldValue: String(previous ?? ''), newValue: String(next ?? ''), reason: `Column data type changed to ${nextType}`, action: next === null ? 'custom_value_cleared' : 'custom_value_set', changedBy: ctx.user?.email })
          await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [entry.bid_id])
        }
        values.push(nextType); sets.push(`data_type=$${values.length}`)
        audits.push({ ...base, field: 'dataType', oldValue: current.data_type, newValue: nextType, reason: kept ? 'Compatible values retained' : `${held.length} values reset`, action: 'custom_field_type_changed' })
      }

      if (input.patch.name !== undefined && input.patch.name !== current.name) {
        values.push(input.patch.name); sets.push(`name=$${values.length}`)
        audits.push({ ...base, field: 'name', oldValue: current.name, newValue: input.patch.name, reason: '', action: 'custom_field_renamed' })
      }
      if (typeChanged || input.patch.options !== undefined) {
        if (input.patch.options !== undefined && !hasOptions(nextType)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a select or multi-select column has options.' })
        let next: string[] | null
        try { next = hasOptions(nextType) ? normalizeOptions(input.patch.options ?? (hasOptions(current.data_type) ? current.options ?? [] : [])) : null } catch (e) { badRequest(e) }
        const prev: string[] = current.options ?? []
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
          const removed = prev.filter((o) => !next?.includes(o))
          values.push(next === null ? null : JSON.stringify(next)); sets.push(`options=$${values.length}`)
          audits.push({
            ...base, field: 'options', oldValue: JSON.stringify(prev), newValue: JSON.stringify(next),
            reason: removed.length ? `Removed: ${removed.join(', ')} (existing values kept)` : '', action: 'custom_field_options_changed',
          })
        }
      }
      if (!sets.length) return toBidCustomField(current)

      values.push(ctx.user?.email ?? null); sets.push(`updated_by=$${values.length}`)
      values.push(input.id)
      let row: any
      try {
        row = (await client.query(`UPDATE bid_custom_fields SET ${sets.join(', ')}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values)).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) nameConflict(input.patch.name ?? current.name)
        throw e
      }
      for (const a of audits) await writeAuditLog(client, a)
      return toBidCustomField(row)
    })),

  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().guid('Invalid UUID')) }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const active = (await client.query(`SELECT id, position FROM bid_custom_fields WHERE status='active' FOR UPDATE`)).rows
      const activeIds = new Set<string>(active.map((r: any) => r.id))
      if (input.ids.length !== activeIds.size || new Set(input.ids).size !== input.ids.length || !input.ids.every((id) => activeIds.has(id))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ids must be exactly the current active columns, each once.' })
      }
      const oldPosition = new Map<string, number>(active.map((r: any) => [r.id, r.position]))
      for (const [index, id] of input.ids.entries()) {
        if (oldPosition.get(id) === index) continue
        await client.query('UPDATE bid_custom_fields SET position=$1, updated_by=$2, updated_at=now() WHERE id=$3', [index, ctx.user?.email ?? null, id])
        await writeAuditLog(client, {
          entityType: 'bidCustomField', entityId: id, field: 'position', oldValue: String(oldPosition.get(id)), newValue: String(index),
          reason: '', action: 'custom_field_reordered', changedBy: ctx.user?.email,
        })
      }
      const rows = (await client.query(`SELECT * FROM bid_custom_fields WHERE status='active' ORDER BY position, created_at, insert_seq`)).rows
      return (rows as any[]).map(toBidCustomField)
    })),

  archive: protectedProcedure
    .input(z.object({ id: z.string().guid('Invalid UUID') }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      const current = await loadField(client, input.id, true)
      if (current.status === 'archived') return toBidCustomField(current)
      const row = (await client.query(
        `UPDATE bid_custom_fields SET status='archived', updated_by=$1, updated_at=now() WHERE id=$2 RETURNING *`, [ctx.user?.email ?? null, input.id],
      )).rows[0]
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'status', oldValue: 'active', newValue: 'archived', reason: 'Values are kept',
        action: 'custom_field_archived', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  unarchive: protectedProcedure
    .input(z.object({ id: z.string().guid('Invalid UUID') }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const current = await loadField(client, input.id, true)
      if (current.status === 'active') return toBidCustomField(current)
      let row: any
      try {
        row = (await client.query(
          `UPDATE bid_custom_fields SET status='active', updated_by=$1, updated_at=now() WHERE id=$2 RETURNING *`, [ctx.user?.email ?? null, input.id],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new TRPCError({ code: 'CONFLICT', message: `Another active column is already named "${current.name}" — rename one of them first.` })
        }
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'status', oldValue: 'archived', newValue: 'active', reason: '',
        action: 'custom_field_unarchived', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  /** Hard delete — only for a column that has NEVER held a value (spec §8.1).
   *  `has_held_value` is set on the first non-null write and never reset, so a
   *  column whose values were all cleared afterwards is still archive-only. */
  delete: protectedProcedure
    // `withValues` = the person confirmed deleting the column AND every value it holds (audit keeps the record).
    .input(z.object({ id: z.string().guid('Invalid UUID'), withValues: z.boolean().optional() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      const current = await loadField(client, input.id, true)
      assertNotSystemField(current, 'it cannot be deleted. Hide it from Manage columns instead.')
      const valueCount = (await client.query('SELECT count(*)::int AS n FROM bid_custom_field_values WHERE field_id=$1', [input.id])).rows[0].n as number
      const used = valueCount > 0
      const blocked = () => new TRPCError({ code: 'CONFLICT', message: 'This column has values — archive it instead, or delete it together with its values.' })
      if ((used || current.has_held_value) && !input.withValues) throw blocked()
      if (used) await client.query('DELETE FROM bid_custom_field_values WHERE field_id=$1', [input.id])
      try {
        await client.query('DELETE FROM bid_custom_fields WHERE id=$1', [input.id])
      } catch (e) {
        if (isForeignKeyViolation(e)) throw blocked()
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'name', oldValue: current.name, newValue: '', reason: used ? `Deleted with ${valueCount} value${valueCount === 1 ? '' : 's'}` : input.withValues && current.has_held_value ? 'Deleted (its values had been cleared)' : 'Never held a value',
        action: 'custom_field_deleted', changedBy: ctx.user?.email,
      })
    })),

  /** Sets (or, with `null`/blank, clears) one bid's value for one column.
   *  Ordinary field write: deliberately NOT routed through
   *  `assertFieldsNotProtected` (spec §8.1). */
  setValue: protectedProcedure
    .input(z.object({ bidId: z.string().guid('Invalid UUID'), fieldId: z.string().guid('Invalid UUID'), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      // Serialize cell writes with type changes, so a value cannot be written using a stale type.
      const field = await loadField(client, input.fieldId, true)
      if (field.status === 'archived') throw new TRPCError({ code: 'BAD_REQUEST', message: 'This column is archived.' })
      const bid = (await client.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [input.bidId])).rows[0]
      if (!bid) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such bid.' })

      const dataType = field.data_type as CustomFieldType
      let value: CustomValue
      const options = await liveOptionsFor(client, field.key, field.options)
      try { value = coerceCustomValue(dataType, input.value, options) } catch (e) { badRequest(e) }
      await assertEntityExists(client, dataType, value)

      const existing = (await client.query(
        `SELECT ${CUSTOM_VALUE_COLUMNS} FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2`, [input.bidId, input.fieldId],
      )).rows[0]
      const oldValue = existing ? customValueFromRow(dataType, existing) : null
      // Readable audit text: an entity column logs the name, not the stored id/code.
      const audit = async (action: string) => writeAuditLog(client, {
        // entityId is the BID so the edit shows in that bid's Activity History.
        entityType: 'bidCustomFieldValue', entityId: input.bidId, field: field.key,
        oldValue: await auditDisplay(client, dataType, oldValue), newValue: await auditDisplay(client, dataType, value),
        reason: '', action, changedBy: ctx.user?.email,
      })

      if (value === null) {
        if (existing) {
          await client.query('DELETE FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2', [input.bidId, input.fieldId])
          await audit('custom_value_cleared')
          await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [input.bidId])
          await syncFieldToMilestone(client, input.bidId, field.key, null, ctx.user?.email)
        }
        return { bidId: input.bidId, fieldId: input.fieldId, key: field.key as string, value: null as CustomValue }
      }

      const c = customValueColumns(dataType, value)
      // Durable "has ever held a value" — gates hard deletion of the column.
      await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [input.fieldId])
      await client.query(
        `INSERT INTO bid_custom_field_values (bid_id, field_id, value_text, value_number, value_date, value_bool, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (bid_id, field_id) DO UPDATE SET
           value_text=EXCLUDED.value_text, value_number=EXCLUDED.value_number, value_date=EXCLUDED.value_date,
           value_bool=EXCLUDED.value_bool, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [input.bidId, input.fieldId, c.text, c.number, c.date, c.bool, ctx.user?.email ?? null],
      )
      if (oldValue !== value) {
        await audit('custom_value_set')
        await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [input.bidId])
        // Pre-CXO / Final CXO / LOA date move their Timeline phase (BID_TIMELINE_SYNC).
        await syncFieldToMilestone(client, input.bidId, field.key, value, ctx.user?.email)
      }
      return { bidId: input.bidId, fieldId: input.fieldId, key: field.key as string, value }
    })),

  valuesForBid: protectedReadProcedure
    .input(z.object({ bidId: z.string().guid('Invalid UUID') }))
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT f.key, f.data_type, ${CUSTOM_VALUE_COLUMNS}
         FROM bid_custom_field_values v JOIN bid_custom_fields f ON f.id = v.field_id
         WHERE v.bid_id=$1 AND f.status='active'`,
        [input.bidId],
      )
      const out: Record<string, CustomValue> = {}
      for (const r of result.rows) out[r.key] = customValueFromRow(r.data_type, r)
      return out
    }),

  /** Manage columns › People columns: who each person column's dropdown offers, by column id. */
  peopleColumns: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT column_id, settings FROM bid_people_column_settings')
    const out: Record<string, PeopleColumnConfig> = {}
    for (const r of result.rows) out[r.column_id] = normalizePeopleColumnConfig(r.settings ?? {})
    return out
  }),

  /** Saves one column's setup; `null` or an empty setup removes it (the column offers its default list again). */
  setPeopleColumn: protectedProcedure
    .input(z.object({
      columnId: z.string().max(PEOPLE_COLUMN_ID_MAX),
      config: z.object({ verticals: z.array(z.string()).default([]), departments: z.array(z.string()), people: z.array(z.string()), multiple: z.boolean() }).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      let columnId: string
      let config: PeopleColumnConfig | null
      try {
        columnId = assertPeopleColumnId(input.columnId)
        config = input.config ? normalizePeopleColumnConfig(input.config) : null
      } catch (e) { badRequest(e) }
      if (!config || isEmptyPeopleColumnConfig(config)) {
        await pool.query('DELETE FROM bid_people_column_settings WHERE column_id=$1', [columnId])
        return
      }
      await pool.query(
        `INSERT INTO bid_people_column_settings (column_id, settings, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (column_id) DO UPDATE SET settings=EXCLUDED.settings, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [columnId, JSON.stringify(config), ctx.user?.email ?? null],
      )
    }),
})
